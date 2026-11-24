import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT_CHECK = path.join(KIT, 'templates', 'engine', '.agents', 'hooks', 'commit-check.cjs');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

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

function rules(dir, args = []) {
  return spawnSync(process.execPath, [BIN, 'rules', 'check', '--target', dir, ...args], { encoding: 'utf8' });
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

test('条件构建：命中 ext 才跑，.agents/ 下变更被排除', () => {
  const dir = tmpRepo();
  const { log, command } = probeCommand(dir);
  writeConfig(dir, { builds: [{ name: 'backend', command, ext: ['.cs'] }], checks: [] });

  const src = path.join(dir, 'src', 'a.cs');
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.writeFileSync(src, 'class A {}\n');
  git(dir, ['add', 'src/a.cs']);
  const hit = run(dir, []);
  assert.equal(hit.status, 0, hit.stdout + hit.stderr);
  assert.ok(hit.stdout.includes('OK: backend 构建通过'), hit.stdout);
  assert.equal(fs.existsSync(log), true);

  fs.rmSync(log, { force: true });
  git(dir, ['commit', '-q', '--no-verify', '-m', 'src']);
  const agentFile = path.join(dir, '.agents', 'notes', 'x.cs');
  fs.mkdirSync(path.dirname(agentFile), { recursive: true });
  fs.writeFileSync(agentFile, 'class X {}\n');
  git(dir, ['add', '.agents/notes/x.cs']);
  const miss = run(dir, []);
  assert.equal(miss.status, 0, miss.stdout + miss.stderr);
  assert.ok(miss.stdout.includes('SKIP: 无匹配的源码变更，跳过构建验证'), miss.stdout);
  assert.equal(fs.existsSync(log), false);
});

test('构建被文件锁拦下时输出 lockHint 与冲突行', () => {
  const dir = tmpRepo();
  writeConfig(dir, {
    builds: [{
      name: 'backend',
      command: 'node -e "console.log(\'MSB3027: locked\'); process.exit(1)"',
      ext: ['.cs'],
      lockPattern: 'MSB3027',
      lockHint: '停掉占用进程后重试',
    }],
    checks: [],
  });
  const file = path.join(dir, 'src', 'a.cs');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'class A {}\n');
  git(dir, ['add', 'src/a.cs']);
  const r = run(dir, []);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('停掉占用进程后重试'), r.stdout);
  assert.ok(r.stdout.includes('MSB3027'), r.stdout);
});

// 回归：builds 的 pkg: 谓词读 entry.cwd 下的 package.json（曾误读仓库根：本该跳过却执行 / 本该执行却跳过）。
test('builds pkg: 谓词读 cwd 下的 package.json', () => {
  const hitDir = tmpRepo();
  const hit = probeCommand(hitDir);
  writeConfig(hitDir, { builds: [{ name: 'build', command: hit.command, cwd: 'frontend', when: ['pkg:scripts.build'] }] });
  fs.mkdirSync(path.join(hitDir, 'frontend', 'src'), { recursive: true });
  fs.writeFileSync(path.join(hitDir, 'frontend', 'package.json'), '{"scripts":{"build":"vite build"}}\n');
  fs.writeFileSync(path.join(hitDir, 'frontend', 'src', 'a.js'), 'a\n');
  git(hitDir, ['add', 'frontend/src/a.js']);
  const ran = run(hitDir, []);
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.ok(ran.stdout.includes('OK: build 构建通过'), ran.stdout);
  assert.equal(fs.existsSync(hit.log), true);

  const missDir = tmpRepo();
  const miss = probeCommand(missDir);
  writeConfig(missDir, { builds: [{ name: 'build', command: miss.command, cwd: 'frontend', when: ['pkg:scripts.build'] }] });
  fs.mkdirSync(path.join(missDir, 'frontend', 'src'), { recursive: true });
  fs.writeFileSync(path.join(missDir, 'package.json'), '{"scripts":{"build":"vite build"}}\n');
  fs.writeFileSync(path.join(missDir, 'frontend', 'src', 'a.js'), 'a\n');
  git(missDir, ['add', 'frontend/src/a.js']);
  const skipped = run(missDir, []);
  assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr);
  assert.equal(fs.existsSync(miss.log), false);
  assert.ok(skipped.stdout.includes('SKIP: build'), skipped.stdout);
  assert.ok(skipped.stdout.includes('pkg:scripts.build'), skipped.stdout);
});

// 回归：when 与 whenEnv 是两道独立的门（when 满足不得绕过未满足的 whenEnv），未满足都不执行。
test('when 与 whenEnv 同时配置时按 AND 生效', () => {
  const rangeFixture = () => {
    const dir = tmpRepo();
    const { log, command } = probeCommand(dir);
    writeConfig(dir, { pushTests: [{ name: 'unit', command, ext: ['.js'], when: ['package.json'], whenEnv: 'RUN_PUSH=1' }] });
    const c1 = commitFile(dir, 'src/a.js', 'a\n');
    const c2 = commitFile(dir, 'src/b.js', 'b\n');
    return { dir, log, c1, c2 };
  };

  const onlyWhen = rangeFixture();
  fs.writeFileSync(path.join(onlyWhen.dir, 'package.json'), '{"scripts":{"test":"x"}}\n');
  const off = run(onlyWhen.dir, ['--range', onlyWhen.c1, onlyWhen.c2]);
  assert.equal(off.status, 0, off.stdout + off.stderr);
  assert.ok(!/^(OK|SKIP|BLOCK): .*unit/m.test(off.stdout), off.stdout);
  assert.ok(!/whenEnv|WARN:/.test(off.stderr), off.stderr);
  assert.equal(fs.existsSync(onlyWhen.log), false);

  const onlyEnv = rangeFixture();
  const onNoPkg = run(onlyEnv.dir, ['--range', onlyEnv.c1, onlyEnv.c2], { RUN_PUSH: '1' });
  assert.equal(onNoPkg.status, 0, onNoPkg.stdout + onNoPkg.stderr);
  assert.ok(onNoPkg.stdout.includes('SKIP: unit（未找到 package.json，跳过推送前测试'), onNoPkg.stdout);
  assert.equal(fs.existsSync(onlyEnv.log), false);

  const both = rangeFixture();
  fs.writeFileSync(path.join(both.dir, 'package.json'), '{"scripts":{"test":"x"}}\n');
  const on = run(both.dir, ['--range', both.c1, both.c2], { RUN_PUSH: '1' });
  assert.equal(on.status, 0, on.stdout + on.stderr);
  assert.ok(on.stdout.includes('OK: unit'), on.stdout);
  assert.equal(fs.existsSync(both.log), true);
});

// 回归：畸形 whenEnv（缺 =）永不启用，但必须告警可见（WARN 行 + 非 JSON 汇总）。
test('畸形 whenEnv 不执行命令且 WARN / rules check 汇总点名', () => {
  const dir = tmpRepo();
  const { log, command } = probeCommand(dir);
  writeConfig(dir, { pushTests: [{ name: 'unit', command, ext: ['.js'], whenEnv: 'RUN_PUSH' }] });
  const c1 = commitFile(dir, 'src/a.js', 'a\n');
  const c2 = commitFile(dir, 'src/b.js', 'b\n');

  const r = run(dir, ['--range', c1, c2], { RUN_PUSH: '1' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.existsSync(log), false);
  assert.match(r.stderr, /^WARN: .*unit.*whenEnv/m);

  const jsonOut = rules(dir, ['--range', `${c1}..${c2}`, '--with-commands', '--prefix', 'commit.push.', '--json']);
  const skip = JSON.parse(jsonOut.stdout).skipped.find((s) => s.ruleId === 'commit.push.0');
  assert.ok(skip, jsonOut.stdout);
  assert.equal(skip.reason, 'whenEnv');
  assert.equal(skip.invalid, true);

  const textOut = rules(dir, ['--range', `${c1}..${c2}`, '--with-commands', '--prefix', 'commit.push.']);
  assert.match(textOut.stdout, /写法有误/);
  assert.match(textOut.stdout, /commit\.push\.0/);
});

// 回归：暂存区为空时不跑构建命令（files 过滤先于命令执行）。
test('暂存区为空时不执行 builds 命令', () => {
  const dir = tmpRepo();
  const { log, command } = probeCommand(dir);
  writeConfig(dir, { builds: [{ name: 'build', command }] });

  const r = run(dir, []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.existsSync(log), false);
  assert.ok(r.stdout.includes('SKIP: 无匹配的源码变更，跳过构建验证'), r.stdout);

  const jsonOut = rules(dir, ['--staged', '--with-commands', '--prefix', 'commit.build.', '--json']);
  assert.equal(jsonOut.status, 0, jsonOut.stdout + jsonOut.stderr);
  const parsed = JSON.parse(jsonOut.stdout);
  assert.ok(parsed.skipped.some((s) => s.ruleId === 'commit.build.0' && s.reason === 'files'), jsonOut.stdout);
});

// 回归：配置 JSON 坏不得当未配置放过——旧脚本按「无配置」跳过，等于三段检查全部静默失效。
test('commit-check.config.json 解析失败时 fail-closed（exit 2）', () => {
  const dir = tmpRepo();
  const { log, command } = probeCommand(dir);
  fs.mkdirSync(path.join(dir, '.agents', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'hooks', 'commit-check.config.json'), `{ "builds": [ { "name": "build", "command": ${JSON.stringify(command)} } `);

  const r = run(dir, []);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /BLOCK: .*commit-check\.config\.json 解析失败/);
  assert.equal(fs.existsSync(log), false);
});
