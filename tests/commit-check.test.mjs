import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT_CHECK = path.join(KIT, 'templates', 'engine', '.agents', 'hooks', 'commit-check.cjs');

// 测试探针：把调用参数追加写入日志文件——用于断言命令被执行、{old}/{new} 已替换。
// FK_PROBE_EXIT 非零则按其退出码退出；FK_PROBE_MS 忙等指定毫秒（供 timeoutMs 超时截断用）。
const PROBE = `const fs = require('fs');
if (process.env.FK_PROBE_MS) {
  const end = Date.now() + Number(process.env.FK_PROBE_MS);
  while (Date.now() < end) {}
}
fs.appendFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)) + '\\n');
process.exit(Number(process.env.FK_PROBE_EXIT || 0));
`;

function tmpRepo() {
  const dir = makeTmp('fk-commit-check-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  git(dir, ['config', 'user.email', 'kit@example.com']);
  git(dir, ['config', 'user.name', 'kit']);
  return dir;
}

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function commitFile(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(dir, ['add', rel]);
  git(dir, ['commit', '-q', '--no-verify', '-m', `add ${rel}`]);
  return git(dir, ['rev-parse', 'HEAD']);
}

function writeConfig(dir, config) {
  fs.mkdirSync(path.join(dir, '.agents', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'hooks', 'commit-check.config.json'), JSON.stringify(config));
}

function writeProbe(dir) {
  const probe = path.join(dir, 'probe.cjs');
  const log = path.join(dir, 'probe-log.txt');
  fs.writeFileSync(probe, PROBE);
  return { probe, log };
}

function run(dir, args, extraEnv = {}) {
  return spawnSync(process.execPath, [COMMIT_CHECK, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: dir, ...extraEnv },
  });
}

function probeCommand(dir, extra = '') {
  const { probe, log } = writeProbe(dir);
  return { log, command: `node "${probe}" "${log}" {old} {new}${extra}` };
}

test('未配置 pushTests 时 --range 模式不产生推送前测试输出', () => {
  const dir = tmpRepo();
  writeConfig(dir, { builds: [], checks: [] });
  const c1 = commitFile(dir, 'src/a.js', 'a\n');
  const c2 = commitFile(dir, 'src/b.js', 'b\n');
  const r = run(dir, ['--range', c1, c2]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!r.stdout.includes('推送前测试'), r.stdout);
});

test('范围文件命中 ext 时执行命令，{old}/{new} 替换为传入的两个 sha', () => {
  const dir = tmpRepo();
  const { log, command } = probeCommand(dir);
  writeConfig(dir, { pushTests: [{ name: 'unit', command, ext: ['.js'] }] });
  const c1 = commitFile(dir, 'src/a.js', 'a\n');
  const c2 = commitFile(dir, 'src/b.js', 'b\n');
  const r = run(dir, ['--range', c1, c2]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('OK: unit 推送前测试通过'), r.stdout);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls, [[c1, c2]]);
});

test('范围文件不命中时打印 SKIP 行且命令未执行', () => {
  const dir = tmpRepo();
  const { log, command } = probeCommand(dir);
  writeConfig(dir, { pushTests: [{ name: 'unit', command, ext: ['.py'] }] });
  const c1 = commitFile(dir, 'src/a.js', 'a\n');
  const c2 = commitFile(dir, 'src/b.js', 'b\n');
  const r = run(dir, ['--range', c1, c2]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('SKIP: 无匹配的源码变更，跳过推送前测试'), r.stdout);
  assert.equal(fs.existsSync(log), false);
});

test('when 指向不存在的文件时打印 SKIP 行且命令未执行', () => {
  const dir = tmpRepo();
  const { log, command } = probeCommand(dir);
  writeConfig(dir, { pushTests: [{ name: 'unit', command, ext: ['.js'], when: ['missing-runner.txt'] }] });
  const c1 = commitFile(dir, 'src/a.js', 'a\n');
  const c2 = commitFile(dir, 'src/b.js', 'b\n');
  const r = run(dir, ['--range', c1, c2]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('SKIP: unit'), r.stdout);
  assert.ok(r.stdout.includes('missing-runner.txt'), r.stdout);
  assert.equal(fs.existsSync(log), false);
});

test('whenEnv 不满足时不执行不打印；满足时执行', () => {
  const dir = tmpRepo();
  const { log, command } = probeCommand(dir);
  writeConfig(dir, { pushTests: [{ name: 'unit', command, ext: ['.js'], whenEnv: 'RUN_PUSH=1' }] });
  const c1 = commitFile(dir, 'src/a.js', 'a\n');
  const c2 = commitFile(dir, 'src/b.js', 'b\n');
  const off = run(dir, ['--range', c1, c2]);
  assert.equal(off.status, 0, off.stdout + off.stderr);
  assert.ok(!off.stdout.includes('推送前测试'), off.stdout);
  assert.equal(fs.existsSync(log), false);
  const on = run(dir, ['--range', c1, c2], { RUN_PUSH: '1' });
  assert.equal(on.status, 0, on.stdout + on.stderr);
  assert.ok(on.stdout.includes('OK: unit 推送前测试通过'), on.stdout);
  assert.equal(fs.existsSync(log), true);
});

test('命令返回非 0 时 BLOCK 且退出码 1', () => {
  const dir = tmpRepo();
  const { command } = probeCommand(dir);
  writeConfig(dir, { pushTests: [{ name: 'unit', command, ext: ['.js'] }] });
  const c1 = commitFile(dir, 'src/a.js', 'a\n');
  const c2 = commitFile(dir, 'src/b.js', 'b\n');
  const r = run(dir, ['--range', c1, c2], { FK_PROBE_EXIT: '3' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('推送前测试未通过'), r.stdout);
});

test('不带 --range 的暂存区模式不执行 pushTests', () => {
  const dir = tmpRepo();
  const { log, command } = probeCommand(dir);
  writeConfig(dir, { pushTests: [{ name: 'unit', command, ext: ['.js'] }] });
  commitFile(dir, 'src/a.js', 'a\n');
  fs.writeFileSync(path.join(dir, 'src/staged.js'), 's\n');
  git(dir, ['add', 'src/staged.js']);
  const r = run(dir, []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!r.stdout.includes('推送前测试'), r.stdout);
  assert.equal(fs.existsSync(log), false);
});

test('prefix 为数组时任一前缀命中即触发，全不命中不触发', () => {
  const dir = tmpRepo();
  const { log, command } = probeCommand(dir);
  writeConfig(dir, { pushTests: [{ name: 'unit', command, prefix: ['lib/', 'pkg/'] }] });
  const c1 = commitFile(dir, 'src/a.js', 'a\n');
  const c2 = commitFile(dir, 'lib/x.js', 'x\n');
  const c3 = commitFile(dir, 'other/y.js', 'y\n');
  const hit = run(dir, ['--range', c1, c2]);
  assert.equal(hit.status, 0, hit.stdout + hit.stderr);
  assert.ok(hit.stdout.includes('OK: unit 推送前测试通过'), hit.stdout);
  const callsAfterHit = fs.readFileSync(log, 'utf8').trim().split('\n').length;
  assert.equal(callsAfterHit, 1);
  const miss = run(dir, ['--range', c2, c3]);
  assert.equal(miss.status, 0, miss.stdout + miss.stderr);
  assert.ok(miss.stdout.includes('SKIP: 无匹配的源码变更，跳过推送前测试'), miss.stdout);
  const callsAfterMiss = fs.readFileSync(log, 'utf8').trim().split('\n').length;
  assert.equal(callsAfterMiss, callsAfterHit);
});

test('old 为全零 sha（新分支首推）取全量匹配语义', () => {
  const dir = tmpRepo();
  const { log, command } = probeCommand(dir);
  writeConfig(dir, { pushTests: [{ name: 'unit', command, ext: ['.js'] }] });
  const zero = '0'.repeat(40);
  const c1 = commitFile(dir, 'src/a.js', 'a\n');
  const r = run(dir, ['--range', zero, c1]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('OK: unit 推送前测试通过'), r.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(log, 'utf8').trim()), [zero, c1]);
});

test('timeoutMs 到点截断命令并 BLOCK', () => {
  const dir = tmpRepo();
  const { log, command } = probeCommand(dir);
  writeConfig(dir, { pushTests: [{ name: 'unit', command, ext: ['.js'], timeoutMs: 500 }] });
  const c1 = commitFile(dir, 'src/a.js', 'a\n');
  const c2 = commitFile(dir, 'src/b.js', 'b\n');
  const r = run(dir, ['--range', c1, c2], { FK_PROBE_MS: '3000' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('[超时]'), r.stdout);
  assert.ok(r.stdout.includes('推送前测试未通过'), r.stdout);
  assert.equal(fs.existsSync(log), false);
});
