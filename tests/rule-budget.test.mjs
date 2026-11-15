// issue #44 守卫：dotnet profile 的 rule-budgets.txt 须与 kit 发行模板同步——模板/预算任一侧再漂移，
// 装户首次 git commit 即被 pre-commit 阻断，这里让 CI 先红。口径 = max(zh-CN, en) 两语言渲染实测。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const RULE_BUDGET = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'rule-budget.mjs');

function tmpRepo(prefix) {
  const dir = makeTmp(prefix);
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

function checkBudgets(cwd) {
  return spawnSync(process.execPath, [RULE_BUDGET, '--all'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

// rule-budget 的「提交后树」口径：索引优先，故把全部文件 add 进索引（不 commit，无需 git 身份）。
function addAll(cwd) {
  const r = spawnSync('git', ['add', '-A'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

test('dotnet profile fresh install passes its own shipped budgets in both languages', () => {
  for (const lang of ['zh-CN', 'en']) {
    const dir = tmpRepo('flow-kit-budget-');
    const r = run(['install', '--agent', 'trae', '--agent', 'codebuddy', '--stack', 'dotnet', '--lang', lang, '--target', '.'], dir);
    assert.equal(r.status, 0, r.stderr);
    addAll(dir);
    const c = checkBudgets(dir);
    assert.equal(c.status, 0, `[${lang}] rule-budget exit ${c.status}\n${c.stdout}${c.stderr}`);
    assert.doesNotMatch(c.stdout, /常驻面超限/);
  }
});

test('node profile ships an empty budget list and the gate stays no-op', () => {
  const dir = tmpRepo('flow-kit-budget-node-');
  const r = run(['install', '--agent', 'trae', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  addAll(dir);
  const c = checkBudgets(dir);
  assert.equal(c.status, 0, `${c.stdout}${c.stderr}`);
});

test('budget rows actually enforce (sanity)', () => {
  const dir = tmpRepo('flow-kit-budget-enforce-');
  const r = run(['install', '--agent', 'trae', '--agent', 'codebuddy', '--stack', 'dotnet', '--lang', 'zh-CN', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  // 追加 10KB 使 stages.md（上限 26624B）与目录合计双双超限，防守卫退化为恒绿。
  fs.appendFileSync(path.join(dir, '.agents', 'commands', 'stages.md'), '\n' + 'x'.repeat(10 * 1024));
  addAll(dir);
  const c = checkBudgets(dir);
  assert.equal(c.status, 1, `expected rule-budget to fail, got 0\n${c.stdout}`);
  assert.match(c.stdout, /常驻面超限/);
});
