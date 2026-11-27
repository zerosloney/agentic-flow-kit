import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readManifest, writeManifest } from '../src/install/manifest.mjs';
import { ensureModeSync, writeAtomicSync } from '../src/install/atomic.mjs';
import { baselinePath, writeBaseline } from '../src/install/baseline.mjs';
import { writeUserHooksConfig } from '../src/install/user-hooks.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

const OLD_BYTES = '{"kit":"agentic-flow-kit","marker":"old-bytes"}\n';

function manifestPath(dir) {
  return path.join(dir, '.agents', 'install-manifest.json');
}

function newManifest() {
  return { kit: 'agentic-flow-kit', version: '9.9.9', files: { 'a.md': { hash: 'x' } } };
}

test('writeManifest：rename 前失败（.tmp 被目录占位）时抛错且旧 manifest 逐字节不动', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  fs.mkdirSync(path.dirname(manifestPath(dir)), { recursive: true });
  fs.writeFileSync(manifestPath(dir), OLD_BYTES, 'utf8');
  // 崩溃窗口模拟：占住 tmp 路径，迫使写入在触碰最终文件之前失败
  fs.mkdirSync(`${manifestPath(dir)}.tmp`);

  // Windows 对「向目录路径写文件」报 EPERM，POSIX 报 EISDIR
  assert.throws(() => writeManifest(dir, newManifest()), (err) => ['EISDIR', 'EPERM'].includes(err.code));

  assert.equal(fs.readFileSync(manifestPath(dir), 'utf8'), OLD_BYTES);
});

test('writeManifest：正常写入内容正确、无 .tmp 残留、旧内容被完整替换', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  fs.mkdirSync(path.dirname(manifestPath(dir)), { recursive: true });
  fs.writeFileSync(manifestPath(dir), OLD_BYTES, 'utf8');

  const manifest = newManifest();
  writeManifest(dir, manifest);

  assert.equal(fs.readFileSync(manifestPath(dir), 'utf8'), `${JSON.stringify(manifest, null, 2)}\n`);
  assert.equal(fs.existsSync(`${manifestPath(dir)}.tmp`), false);
});

test('readManifest：文件缺失返回 null', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  assert.equal(readManifest(dir), null);
});

test('readManifest：坏 JSON 抛错，消息含文件路径与修复指引', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  fs.mkdirSync(path.dirname(manifestPath(dir)), { recursive: true });
  fs.writeFileSync(manifestPath(dir), '{"kit":"agentic-flow-kit",', 'utf8');

  assert.throws(() => readManifest(dir), (err) => err instanceof Error
    && err.message.includes(manifestPath(dir))
    && err.message.includes('reinstall'));
});

test('readManifest：解析成功但根不是对象（数组）抛错', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  fs.mkdirSync(path.dirname(manifestPath(dir)), { recursive: true });
  fs.writeFileSync(manifestPath(dir), '[]', 'utf8');

  assert.throws(() => readManifest(dir));
});

test('writeAtomicSync：父目录不存在时递归创建、无 .tmp 残留', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  const file = path.join(dir, 'nested', 'file.txt');

  writeAtomicSync(file, 'new');

  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

// .githooks 必须带 x 位（POSIX 上 git 不执行非可执行 hook）；Windows 无权限位语义，只校验落盘内容。
test('writeAtomicSync：mode 参数在 POSIX 落盘后生效（含覆盖已有文件的旧权限）', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  const file = path.join(dir, '.githooks', 'pre-commit');
  writeAtomicSync(file, '#!/bin/sh\n', 0o755);
  assert.equal(fs.readFileSync(file, 'utf8'), '#!/bin/sh\n');

  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o755);
    fs.chmodSync(file, 0o644);
    ensureModeSync(file, 0o755);
    assert.equal(fs.statSync(file).mode & 0o777, 0o755);
  }
});

test('writeBaseline：tmp 被目录占位时抛错且旧基线字节不动', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  const abs = baselinePath(dir, 'AGENTS.md');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'OLD-BASELINE\n', 'utf8');
  fs.mkdirSync(`${abs}.tmp`);

  // Windows 对「向目录路径写文件」报 EPERM，POSIX 报 EISDIR
  assert.throws(() => writeBaseline(dir, 'AGENTS.md', 'NEW\n'), (err) => ['EISDIR', 'EPERM'].includes(err.code));

  assert.equal(fs.readFileSync(abs, 'utf8'), 'OLD-BASELINE\n');
});

test('writeUserHooksConfig：tmp 被目录占位时抛错且旧配置字节不动', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  const file = path.join(dir, '.codex', 'hooks.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"hooks":{"x":1}}\n', 'utf8');
  fs.mkdirSync(`${file}.tmp`);

  // Windows 对「向目录路径写文件」报 EPERM，POSIX 报 EISDIR
  assert.throws(() => writeUserHooksConfig(file, { hooks: {} }), (err) => ['EISDIR', 'EPERM'].includes(err.code));

  assert.equal(fs.readFileSync(file, 'utf8'), '{"hooks":{"x":1}}\n');
});

test('空跑 upgrade 不重写未变文件：AGENTS.md mtime 不动且 strict 干净', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const r1 = runCli(['install', '--agent', 'claude', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r1.status, 0, r1.stderr);

  // 把 mtime 指到明确的过去：upgrade 若重写该文件，mtime 必然跳回当前时间
  const agents = path.join(dir, 'AGENTS.md');
  const past = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(agents, past, past);

  const r2 = runCli(['upgrade', '--target', '.'], dir);
  assert.equal(r2.status, 0, r2.stderr);
  const mtime = fs.statSync(agents).mtimeMs;
  assert.ok(Math.abs(mtime - past.getTime()) < 1000, `AGENTS.md mtime 被刷新：${mtime} != ${past.getTime()}`);

  const st = runCli(['status', '--target', '.', '--strict'], dir);
  assert.equal(st.status, 0, st.stdout + st.stderr);
});

test('托管文件走原子写：写失败时旧文件字节不动', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const r1 = runCli(['install', '--agent', 'claude', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r1.status, 0, r1.stderr);
  const agents = path.join(dir, 'AGENTS.md');
  const original = fs.readFileSync(agents);

  // 崩溃窗口模拟（同 writeManifest 用例手法）：占住 tmp 路径，迫使 rename 前失败。
  // 内容未变的托管条目不落盘，故第二遍用 --lang en 重装，让 AGENTS.md 渲染结果与磁盘不同、必然进入写入路径。
  fs.mkdirSync(`${agents}.tmp`);
  const r2 = runCli(['install', '--agent', 'claude', '--lang', 'en', '--stack', 'node', '--target', '.', '--force'], dir);
  assert.notEqual(r2.status, 0);

  assert.ok(fs.readFileSync(agents).equals(original), '写入失败时 AGENTS.md 旧字节必须原样保留');
});
