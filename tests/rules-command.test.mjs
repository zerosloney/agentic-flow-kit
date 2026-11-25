// rules-command.test.mjs — command 原语的 expectExit：
// 声明的预期退出码（非负整数或非空数组）命中即通过；未声明时仅 0 通过且失败详情保持旧口径；
// 非法值（负数 / 字符串 / 非整数 / 空数组）按配置错误处理（exit 2，stderr 以 JSON 路径点名 assert.args.expectExit）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function fixture() {
  const dir = makeTmp('rules-command-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const json = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

function rules(root, args = []) {
  return spawnSync(process.execPath, [BIN, 'rules', 'check', '--target', root, '--json', ...args], {
    encoding: 'utf8',
  });
}

const RULE_ID = 'cmd.expect-exit';

/**
 * 树杀能力探测：受限环境里 taskkill 被拒（沙箱 / 权限不足）、POSIX 上 ps 缺失时，
 * 「整棵进程树都被终止」这条断言无从验证——先探一次，不支持就跳过，别把环境限制
 * 报成代码缺陷。
 */
function treeKillSupported() {
  if (process.platform !== 'win32') {
    return spawnSync('ps', ['-eo', 'pid='], { stdio: 'ignore' }).status === 0;
  }
  const probe = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  const killed = spawnSync('taskkill', ['/PID', String(probe.pid), '/T', '/F'], { stdio: 'ignore' });
  try {
    probe.kill('SIGKILL');
  } catch {
    /* 已退出时忽略 */
  }
  return killed.status === 0;
}

/** 写一条 project 层 command 规则；args 合并进 assert.args，extra 合并进规则对象（如 timeoutMs）。 */
function writeCommandRule(root, args = {}, extra = {}) {
  write(root, '.agents/rules/project.json', json({
    version: 1,
    rules: [{
      id: RULE_ID,
      face: 'any',
      phase: 'always',
      severity: 'block',
      ...extra,
      assert: { kind: 'command', args: { run: 'node -e "process.exit(0)"', ...args } },
      message: { zh: '命令退出码不符', en: 'unexpected command exit code' },
    }],
  }));
}

test('expectExit accepts a declared exit code (scalar and array form)', () => {
  const dir = fixture();
  writeCommandRule(dir, { run: 'node -e "process.exit(1)"', expectExit: 1 });
  let r = rules(dir, ['--with-commands']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  let out = JSON.parse(r.stdout);
  assert.ok(out.passed.some((p) => p.ruleId === RULE_ID), r.stdout);
  assert.deepEqual(out.violations, []);

  writeCommandRule(dir, { run: 'node -e "process.exit(2)"', expectExit: [1, 2] });
  r = rules(dir, ['--with-commands']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  out = JSON.parse(r.stdout);
  assert.ok(out.passed.some((p) => p.ruleId === RULE_ID), r.stdout);
  assert.deepEqual(out.violations, []);
});

test('expectExit mismatch reports actual vs expected exit codes', () => {
  const dir = fixture();
  writeCommandRule(dir, { run: 'node -e "process.exit(0)"', expectExit: 1 });
  const r = rules(dir, ['--with-commands']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.violations.length, 1, r.stdout);
  assert.ok(out.violations[0].detail.startsWith('[退出码] 实际 0，期望 1'), out.violations[0].detail);
});

test('a declared set that includes 0 still reports actual vs expected on mismatch', () => {
  // 回归：曾按「预期集合里有没有 0」决定详情形状，expectExit: [0, 1] 不匹配时反而看不出期望值。
  const dir = fixture();
  writeCommandRule(dir, { run: 'node -e "process.exit(2)"', expectExit: [0, 1] });
  const r = rules(dir, ['--with-commands']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.violations[0].detail.startsWith('[退出码] 实际 2，期望 0 / 1'), out.violations[0].detail);
});

test('without expectExit only exit 0 passes and detail keeps legacy shape', () => {
  const dir = fixture();
  writeCommandRule(dir, { run: 'node -e "process.exit(3)"' });
  const r = rules(dir, ['--with-commands']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.violations.length, 1, r.stdout);
  assert.ok(!out.violations[0].detail.includes('[退出码]'), out.violations[0].detail);
});

test('invalid expectExit values are config errors', () => {
  const cases = [
    ['negative', [-1]],
    ['string', ['1']],
    ['non-integer', [1.5]],
    ['empty array', []],
  ];
  for (const [label, expectExit] of cases) {
    const dir = fixture();
    writeCommandRule(dir, { run: 'node -e "process.exit(0)"', expectExit });
    const r = rules(dir, ['--with-commands']);
    assert.equal(r.status, 2, `${label}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /assert\.args\.expectExit/, label);
  }
});

// ---- {gradlew} 占位符：有 wrapper 用 wrapper（Windows 为 gradlew.bat，否则 ./gradlew），否则用 gradle ----

const wrapperFile = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
const wrapperCommand = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

/** 假启动器：把「启动器名 + 收到的参数」写进 cwd/marker.txt。 */
function writeFakeLauncher(root, name, label) {
  if (process.platform === 'win32') {
    write(root, name, `@echo off\r\necho ${label} %* > marker.txt\r\nexit /b 0\r\n`);
  } else {
    const abs = path.join(root, name);
    write(root, name, `#!/bin/sh\necho "${label} $*" > marker.txt\n`);
    fs.chmodSync(abs, 0o755);
  }
}

test('{gradlew} runs the wrapper when the project has one', () => {
  const dir = fixture();
  writeFakeLauncher(dir, wrapperFile, 'wrapper');
  writeCommandRule(dir, { run: '{gradlew} test' });
  const r = rules(dir, ['--with-commands']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.violations, [], r.stdout);
  assert.equal(fs.readFileSync(path.join(dir, 'marker.txt'), 'utf8').trim(), 'wrapper test');
  assert.equal(out.passed.find((p) => p.ruleId === RULE_ID).command, `${wrapperCommand} test`);
});

test('{gradlew} falls back to gradle when the project has no wrapper', () => {
  const dir = fixture();
  // 放一个假的 gradle 并让它进 PATH：不依赖机器上是否真的装了 Gradle。
  writeFakeLauncher(dir, process.platform === 'win32' ? 'gradle.bat' : 'gradle', 'gradle');
  const env = process.platform === 'win32' ? {} : { PATH: `${dir}${path.delimiter}${process.env.PATH || ''}` };
  writeCommandRule(dir, { run: '{gradlew} test', env });
  const r = rules(dir, ['--with-commands']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.violations, [], r.stdout);
  assert.equal(fs.readFileSync(path.join(dir, 'marker.txt'), 'utf8').trim(), 'gradle test');
  assert.equal(out.passed.find((p) => p.ruleId === RULE_ID).command, 'gradle test');
});

test('{gradlew} keeps the surrounding command text intact', () => {
  const dir = fixture();
  writeFakeLauncher(dir, wrapperFile, 'wrapper');
  writeCommandRule(dir, { run: '{gradlew} test --flag value --k=v' });
  const r = rules(dir, ['--with-commands']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.violations, [], r.stdout);
  assert.equal(fs.readFileSync(path.join(dir, 'marker.txt'), 'utf8').trim(), 'wrapper test --flag value --k=v');
  assert.equal(out.passed.find((p) => p.ruleId === RULE_ID).command, `${wrapperCommand} test --flag value --k=v`);
});

// ---- 超时终止整棵进程树（spawnSync 的 timeout 只杀 shell）----

test('timeout kills the whole process tree, not just the shell', (t) => {
  if (!treeKillSupported()) {
    t.skip('当前环境不允许终止进程树（taskkill 被拒 / ps 缺失），跳过树杀断言');
    return;
  }
  const dir = fixture();
  const pidFile = path.join(dir, 'grandchild.pid');
  write(dir, 'spawn-grandchild.mjs', [
    "import { spawn } from 'node:child_process';",
    "import fs from 'node:fs';",
    "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { detached: true, stdio: 'ignore' });",
    'child.unref();',
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
    'setTimeout(() => {}, 60000);',
    '',
  ].join('\n'));
  writeCommandRule(dir, { run: `"${process.execPath}" spawn-grandchild.mjs` }, { timeoutMs: 1000 });
  const r = rules(dir, ['--with-commands']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.violations.length, 1, r.stdout);
  assert.ok(out.violations[0].detail.includes('[超时]'), out.violations[0].detail);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  try {
    // 求值结束后孙进程必须已不存在：shell 被杀但孙进程活着时会抛不出 ESRCH。
    assert.throws(() => process.kill(pid, 0));
  } finally {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* 已不存在 */
    }
  }
});

test('exit codes pass through the tree runner (0 and 3)', () => {
  const dir = fixture();
  writeCommandRule(dir, { run: 'node -e "process.exit(0)"' });
  let r = rules(dir, ['--with-commands']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  let out = JSON.parse(r.stdout);
  assert.ok(out.passed.some((p) => p.ruleId === RULE_ID), r.stdout);

  writeCommandRule(dir, { run: 'node -e "process.exit(3)"', expectExit: 3 });
  r = rules(dir, ['--with-commands']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  out = JSON.parse(r.stdout);
  assert.ok(out.passed.some((p) => p.ruleId === RULE_ID), r.stdout);
  assert.deepEqual(out.violations, [], r.stdout);
});

test('timeoutMs null leaves the command unlimited', () => {
  const dir = fixture();
  writeCommandRule(dir, { run: 'node -e "setTimeout(() => process.exit(0), 300)"' }, { timeoutMs: null });
  const r = rules(dir, ['--with-commands']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).violations.length, 0, r.stdout);
});
