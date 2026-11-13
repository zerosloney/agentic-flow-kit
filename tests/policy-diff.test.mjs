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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-policy-diff-'));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
  const r = spawnSync(process.execPath, [BIN, 'install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

function upgrade(dir, extra = []) {
  return spawnSync(process.execPath, [BIN, 'upgrade', '--target', '.', '--explain-policy', '--dry-run', ...extra], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function editJson(dir, rel, edit) {
  const file = path.join(dir, rel);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(data);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

test('explain-policy is empty when the installed policy surface matches the templates', () => {
  const dir = installTarget();
  const r = upgrade(dir, ['--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.policyDiff.changed, false);
  assert.deepEqual(out.policyDiff.changes, []);

  const human = upgrade(dir);
  assert.equal(human.status, 0, human.stderr);
  assert.equal(human.stdout.includes('策略差异'), false);
});

test('explain-policy reports role/model, gate and budget changes', () => {
  const dir = installTarget();
  editJson(dir, '.agents/config/model-roles.json', (data) => {
    data.roles.code.model = 'custom-model';
  });
  editJson(dir, '.agents/hooks/gates.json', (data) => {
    data.allow.push({ tool: 'shell', pat: 'echo hi' });
  });
  editJson(dir, '.agents/config/gate-budgets.json', (data) => {
    data.fullMs = 999999;
  });

  const r = upgrade(dir, ['--json']);
  assert.equal(r.status, 0, r.stderr);
  const { policyDiff } = JSON.parse(r.stdout);
  assert.equal(policyDiff.changed, true);

  const role = policyDiff.changes.find((item) => item.category === 'roles' && item.key === 'model.code');
  assert.deepEqual([role.from, role.to], ['custom-model', null]);

  const gate = policyDiff.changes.find((item) => item.category === 'gates' && item.from?.includes('echo hi'));
  assert.ok(gate, JSON.stringify(policyDiff.changes));
  assert.equal(gate.op, 'removed');

  const budget = policyDiff.changes.find((item) => item.category === 'budgets' && item.key === 'fullMs');
  assert.deepEqual([budget.from, budget.to], [999999, 240000]);

  const human = upgrade(dir);
  assert.match(human.stdout, /策略差异/);
  assert.match(human.stdout, /custom-model/);
});

test('explain-policy reports enum changes', () => {
  const dir = installTarget();
  editJson(dir, '.agents/config/pipeline.json', (data) => {
    data.stopTypes.push('bogus');
  });
  const r = upgrade(dir, ['--json']);
  assert.equal(r.status, 0, r.stderr);
  const { policyDiff } = JSON.parse(r.stdout);
  const enumChange = policyDiff.changes.find((item) => item.category === 'enums' && item.from === 'bogus');
  assert.ok(enumChange, JSON.stringify(policyDiff.changes));
  assert.equal(enumChange.path, '.agents/config/pipeline.json');
});
