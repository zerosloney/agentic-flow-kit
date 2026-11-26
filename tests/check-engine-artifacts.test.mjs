// check-engine-artifacts.mjs 自愈门口径：整文件生成的派生工件只在「未提交且非生成内容」时拦下，
// 已提交的手工内容照常重生成并提示 git 找回；锚点生成的文件（workflow/INDEX.md）不受影响。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-artifacts-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function install(dir) {
  const r = run(['install', '--agent', 'claude', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  return r;
}

function gate(dir) {
  return run(['run', 'check-engine-artifacts.mjs', '--root', '.'], dir);
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

test('干净项目：3 份生成物一致，exit 0', () => {
  const dir = tmpRepo();
  install(dir);
  const r = gate(dir);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /3 份生成物与单源一致/);
});

test('已提交的手工内容：自愈重生成并提示可用 git 找回', () => {
  const dir = tmpRepo();
  install(dir);
  const rel = 'workflow/effective-policy.md';
  fs.appendFileSync(path.join(dir, rel), '\n<!-- MANUAL: 手工策略说明 -->\n', 'utf8');
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--no-verify', '-m', 'manual note'], { cwd: dir });

  const r = gate(dir);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /git show HEAD:workflow\/effective-policy\.md/);
  assert.doesNotMatch(read(dir, rel), /MANUAL/, '已提交的手工内容照常被生成器重写');
});

test('未提交的手工内容：不重生成，判红并点名', () => {
  const dir = tmpRepo();
  install(dir);
  const rel = 'workflow/effective-policy.md';
  fs.appendFileSync(path.join(dir, rel), '\n<!-- MANUAL: 手工策略说明 -->\n', 'utf8');

  const r = gate(dir);
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(read(dir, rel), /MANUAL/, '未提交的手工内容不得被覆盖');
  assert.match(`${r.stdout}\n${r.stderr}`, /workflow\/effective-policy\.md/);
  assert.match(`${r.stdout}\n${r.stderr}`, /未提交/);
});

test('锚点生成的工作流索引：锚点外手工说明未提交也照常自愈并保留', () => {
  const dir = tmpRepo();
  install(dir);
  const rel = 'workflow/INDEX.md';
  const full = read(dir, rel);
  const anchor = full.indexOf('<!-- GENERATED:BEGIN');
  assert.ok(anchor > 0, 'INDEX.md 必须含 GENERATED 锚点');
  const header = '# 我的索引\n\n> 手工说明\n\n';
  fs.writeFileSync(path.join(dir, rel), header + full.slice(anchor), 'utf8');
  // 新增一篇 intent 让索引过期（锚点内漂移），触发自愈。
  fs.mkdirSync(path.join(dir, 'workflow/intents'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'workflow/intents/2026-11-26-demo.md'),
    '---\n状态: draft\n级别: L2\n日期: 2026-11-26\n模块: engine\n---\n\n# INTENT — demo\n',
    'utf8',
  );

  const r = gate(dir);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.ok(read(dir, rel).startsWith(header), '锚点外手工说明必须原样保留');
});

test('装完尚未提交就改了单源：磁盘仍是安装时的生成物，照常自愈', () => {
  const dir = tmpRepo();
  install(dir);
  // 不提交：install 产出的文件都是未跟踪的。
  fs.mkdirSync(path.join(dir, '.agents/commands'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.agents/roles'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents/commands/zz-demo.md'), '---\ndescription: demo\n---\n\n# zz-demo\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.agents/roles/zz-demo.md'), '# zz-demo-role\n', 'utf8');
  const r = gate(dir);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(read(dir, '.agents/notes/engine-map.md'), /zz-demo/);
  assert.doesNotMatch(r.stdout, /git show HEAD:/, '安装时的生成物被重写不需要找回提示');
});
