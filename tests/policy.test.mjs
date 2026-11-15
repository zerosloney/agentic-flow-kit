import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function installTarget() {
  const dir = makeTmp('flow-kit-policy-');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
  const r = spawnSync(process.execPath, [BIN, 'install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

function policy(dir, args) {
  // R5-1b：policy 脚本随包分发，经包内运行时入口执行。
  return spawnSync(process.execPath, [BIN, 'run', 'policy', '--root', dir, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function json(r) {
  assert.equal(r.stdout.trim().startsWith('{'), true, `expected JSON, got: ${r.stdout.slice(0, 300)}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

function editJson(dir, rel, edit) {
  const file = path.join(dir, rel);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(data);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

test('fresh install passes policy check and renders a deterministic view', () => {
  const dir = installTarget();
  const r = policy(dir, ['check', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.equal(out.ok, true);
  assert.equal(out.problems.length, 0);
  assert.ok(out.summary.mechanisms.total >= 32, `mechanisms: ${out.summary.mechanisms.total}`);

  const first = policy(dir, ['explain']);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /## 策略面（policy.json）/);
  assert.match(first.stdout, /策略即代码校验/);
  const second = policy(dir, ['explain']);
  assert.equal(second.stdout, first.stdout);
});

test('policy check rejects an unregistered mechanism reference', () => {
  const dir = installTarget();
  editJson(dir, '.agents/config/policy.json', (data) => {
    data.mechanisms.required.push('未登记机制-X');
  });
  const r = policy(dir, ['check', '--json']);
  assert.equal(r.status, 1);
  const out = json(r);
  assert.equal(out.ok, false);
  assert.ok(out.problems.some((p) => p.code === 'POLICY_MECHANISM' && p.message.includes('未登记机制-X')));
});

test('policy check rejects a registry row missing from policy.json', () => {
  const dir = installTarget();
  editJson(dir, '.agents/config/policy.json', (data) => {
    data.mechanisms.required = data.mechanisms.required.filter((name) => name !== '测试守卫');
  });
  const r = policy(dir, ['check', '--json']);
  assert.equal(r.status, 1);
  const out = json(r);
  assert.ok(out.problems.some((p) => p.message.includes('机制未登记到 policy.json: 测试守卫')));
});

test('policy check fails when the rule budget is exceeded', () => {
  const dir = installTarget();
  fs.appendFileSync(path.join(dir, '.agents/config/rule-budgets.txt'), 'AGENTS.md 10\n', 'utf8');
  const r = policy(dir, ['check', '--json']);
  assert.equal(r.status, 1);
  const out = json(r);
  assert.ok(out.problems.some((p) => p.code === 'POLICY_BUDGET'), JSON.stringify(out.problems));
});

test('policy check enforces enum closures and role/model references', () => {
  const dir = installTarget();
  editJson(dir, '.agents/config/pipeline.json', (data) => {
    data.stopTypes.push('bogus');
  });
  editJson(dir, '.agents/config/pr-review.json', (data) => {
    data.modelRoles.finder = 'nope';
  });
  const r = policy(dir, ['check', '--json']);
  assert.equal(r.status, 1);
  const out = json(r);
  assert.ok(out.problems.some((p) => p.code === 'POLICY_ENUM' && p.message.includes('stopTypes')));
  assert.ok(out.problems.some((p) => p.code === 'POLICY_ROLE' && p.message.includes('nope')));
});

test('policy command rejects unknown subcommands with usage exit code', () => {
  const dir = installTarget();
  const r = policy(dir, ['bogus']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /用法/);
});

// ---- issue #42：升级/install 换新 policy.json 而旧版机制台账未随迁（userModified 不覆盖）→ check 必红；
// `policy check --fix` 一次性迁移：台账缺行取 kit 模板原行追加，required 缺名追加数组尾。----

const NEW_MECHANISMS = ['测试守卫', '策略即代码校验', 'SBOM 与许可证门', '开发容器声明门'];
const OWN_ROW = '| 关单改动面门（taskScopeGate） | verify.mjs scope 段 | taskScopeGate 拦截计数（月） | 不退役（改动面主干） | 2026-11-01 建 | 现役 [不退役主干] | — |';
const TEMPLATE_REGISTRY = path.join(KIT, 'templates', 'engine', '.agents', 'config', 'mechanism-registry.md');

function registryRowName(line) {
  if (!line.startsWith('|')) return null;
  return line.split('|')[1]?.trim() ?? null;
}

function templateRow(name) {
  const line = fs.readFileSync(TEMPLATE_REGISTRY, 'utf8').split(/\r?\n/).find((l) => registryRowName(l) === name);
  assert.ok(line, `kit 模板缺机制行: ${name}`);
  return line.trimEnd();
}

function editRegistry(dir, edit) {
  const file = path.join(dir, '.agents/config/mechanism-registry.md');
  const text = fs.readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, edit(text.split(/\r?\n/)).join(eol), 'utf8');
}

// 复现 adoption 场景：装户拿到新 policy.json，台账仍是旧面——删 4 个新机制行、留项目自有行。
function makeAdoptionFixture(dir) {
  editRegistry(dir, (lines) => lines.filter((line) => !NEW_MECHANISMS.includes(registryRowName(line))));
  editRegistry(dir, (lines) => {
    let lastIdx = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const name = registryRowName(lines[i]);
      if (name && name !== '机制' && name !== '---') lastIdx = i;
    }
    lines.splice(lastIdx + 1, 0, OWN_ROW);
    return lines;
  });
}

test('adoption check fails on both directions and --fix migrates once', () => {
  const dir = installTarget();
  makeAdoptionFixture(dir);

  const before = policy(dir, ['check', '--json']);
  assert.equal(before.status, 1);
  const out = json(before);
  const refs = out.problems.filter((p) => p.message.startsWith('policy.json 引用了未登记机制'));
  assert.equal(refs.length, 4, JSON.stringify(out.problems));
  for (const name of NEW_MECHANISMS) assert.ok(refs.some((p) => p.message.includes(name)), name);
  const missingEntries = out.problems.filter((p) => p.message.startsWith('机制未登记到 policy.json: '));
  assert.equal(missingEntries.length, 1);
  assert.ok(missingEntries[0].message.includes('关单改动面门（taskScopeGate）'));

  const fixed = policy(dir, ['check', '--fix']);
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.match(fixed.stdout, /--fix 已追加机制台账 4 行（取自 kit 模板）/);
  assert.match(fixed.stdout, /--fix 已把 1 个机制登入 policy\.json required/);
  assert.match(fixed.stdout, /✅ 策略面一致/);

  const registryText = fs.readFileSync(path.join(dir, '.agents/config/mechanism-registry.md'), 'utf8');
  for (const name of NEW_MECHANISMS) assert.ok(registryText.includes(templateRow(name)), name);
  assert.ok(registryText.indexOf(OWN_ROW) < registryText.indexOf(templateRow('测试守卫')), '新行追加在最后一个数据行之后');
  const cfgData = JSON.parse(fs.readFileSync(path.join(dir, '.agents/config/policy.json'), 'utf8'));
  assert.ok(cfgData.mechanisms.required.includes('关单改动面门（taskScopeGate）'));

  const after = policy(dir, ['check', '--json']);
  assert.equal(after.status, 0, after.stderr);
  assert.equal(json(after).ok, true);
});

test('unregistered reference errors carry a pasteable template row', () => {
  const dir = installTarget();
  makeAdoptionFixture(dir);
  const r = policy(dir, ['check']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /可粘贴行（取自 kit 模板，门禁位置\/CI 描述按本仓改写）: \| 测试守卫 \|/);
  assert.ok(r.stderr.includes(templateRow('测试守卫')), templateRow('测试守卫'));
  assert.match(r.stderr, /修法：把 "关单改动面门（taskScopeGate）" 追加到 policy\.json mechanisms\.required/);
});

test('type-tag closure violations stay unfixed but gain guidance', () => {
  const dir = installTarget();
  editRegistry(dir, (lines) => lines.map((line) => (
    registryRowName(line) === '测试守卫' ? line.replace('现役[不退役主干]', '现役') : line
  )));
  const r = policy(dir, ['check', '--json']);
  assert.equal(r.status, 1);
  const out = json(r);
  assert.equal(out.problems.length, 1);
  assert.ok(out.problems[0].message.includes('机制类型不在闭集（测试守卫）: 现役'));
  assert.ok(out.problems[0].message.includes('[类型] 标记'));

  const fixed = policy(dir, ['check', '--fix', '--json']);
  assert.equal(fixed.status, 1);
  const out2 = json(fixed);
  assert.equal(out2.problems.length, 1);
  assert.ok(out2.problems[0].message.includes('机制类型不在闭集（测试守卫）'));
  assert.ok(out2.problems[0].message.includes('[类型] 标记'));
});

test('--fix reports template-missing mechanisms as not migrated', () => {
  const dir = installTarget();
  makeAdoptionFixture(dir);
  editJson(dir, '.agents/config/policy.json', (data) => {
    data.mechanisms.required.push('幽灵机制-XYZ');
  });

  const fixed = policy(dir, ['check', '--fix']);
  assert.equal(fixed.status, 1);
  assert.match(fixed.stdout, /--fix 已追加机制台账 4 行（取自 kit 模板）/);
  assert.match(fixed.stderr, /--fix 未能自动迁移：幽灵机制-XYZ（kit 模板无对应行）/);
  assert.match(fixed.stderr, /policy\.json 引用了未登记机制: 幽灵机制-XYZ/);
  assert.match(fixed.stderr, /kit 模板中无此机制行/);

  const registryText = fs.readFileSync(path.join(dir, '.agents/config/mechanism-registry.md'), 'utf8');
  for (const name of NEW_MECHANISMS) assert.ok(registryText.includes(templateRow(name)), name);
  const cfgData = JSON.parse(fs.readFileSync(path.join(dir, '.agents/config/policy.json'), 'utf8'));
  assert.ok(cfgData.mechanisms.required.includes('关单改动面门（taskScopeGate）'));
  assert.ok(cfgData.mechanisms.required.includes('幽灵机制-XYZ'));
});

test('explain rejects --fix with usage exit code', () => {
  const dir = installTarget();
  const r = policy(dir, ['explain', '--fix']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /用法/);
});
