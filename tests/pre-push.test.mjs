import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// 假 flow-kit 转发到本地 CLI：推送范围里 pre-push 以 `flow-kit run/hook` 调包内 runtime，
// 安装树里没有包入口，须借 PATH 前置的 shim 转发。Windows 走 .cmd（cmd.exe 按 PATHEXT
// 解析无扩展命令），POSIX 走无扩展名 sh 脚本——两个平台的 shim 都写，按平台各自生效。
function writeShim(dir) {
  const shimDir = path.join(dir, 'shim');
  fs.mkdirSync(shimDir, { recursive: true });
  const cli = path.join(KIT, 'bin', 'flow-kit.mjs');
  fs.writeFileSync(path.join(shimDir, 'flow-kit.cmd'), `@echo off\r\nnode "${cli}" %*\r\n`);
  const sh = path.join(shimDir, 'flow-kit');
  fs.writeFileSync(sh, `#!/bin/sh\nexec node "${cli}" "$@"\n`);
  fs.chmodSync(sh, 0o755);
  return shimDir;
}

test('node 栈安装后 pre-push 触及 tests/ 不再触发写死的后端测试：exit 0 且无 Cannot find module', () => {
  const dir = makeTmp('fk-pre-push-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const inst = spawnSync(process.execPath, [BIN, 'install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(inst.status, 0, inst.stdout + inst.stderr);

  const shimDir = writeShim(dir);
  const PATH = `${shimDir}${path.delimiter}${process.env.PATH || ''}`;

  git(dir, ['config', 'user.email', 'kit@example.com']);
  git(dir, ['config', 'user.name', 'kit']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# tmp\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '--no-verify', '-m', 'init']);
  const oldSha = git(dir, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'smoke.test.js'), 'test("smoke", () => {});\n');
  git(dir, ['add', 'tests/smoke.test.js']);
  git(dir, ['commit', '-q', '--no-verify', '-m', 'add tests']);
  const newSha = git(dir, ['rev-parse', 'HEAD']);

  // stdin 喂待推引用行（<local_ref> <local_sha> <remote_ref> <remote_sha>）——远端旧、本地新
  const r = spawnSync(process.execPath, [path.join(dir, '.githooks', 'pre-push')], {
    cwd: dir,
    encoding: 'utf8',
    input: `refs/heads/main ${newSha} refs/heads/main ${oldSha}\n`,
    env: { ...process.env, PATH },
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  assert.equal(r.status, 0, `pre-push exit ${r.status}\n${out}`);
  assert.ok(!out.includes('Cannot find module'), out);
});
