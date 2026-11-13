import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function installTarget() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-policy-'));
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
