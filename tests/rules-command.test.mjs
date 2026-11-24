// rules-command.test.mjs — command 原语的 expectExit：
// 声明的预期退出码（非负整数或非空数组）命中即通过；未声明时仅 0 通过且失败详情保持旧口径；
// 非法值（负数 / 字符串 / 非整数 / 空数组）按配置错误处理（exit 2，stderr 以 JSON 路径点名 assert.args.expectExit）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

/** 写一条 project 层 command 规则；args 合并进 assert.args。 */
function writeCommandRule(root, args = {}) {
  write(root, '.agents/rules/project.json', json({
    version: 1,
    rules: [{
      id: RULE_ID,
      face: 'any',
      phase: 'always',
      severity: 'block',
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
