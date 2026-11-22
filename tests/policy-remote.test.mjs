import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function installTarget(prefix = 'flow-kit-policy-target-') {
  const dir = makeTmp(prefix);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
  const r = spawnSync(process.execPath, [BIN, 'install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

function runCli(dir, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function json(r) {
  assert.equal(r.stdout.trim().startsWith('{'), true, `expected JSON, got: ${r.stdout.slice(0, 300)}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

test('policy link stores remote configuration in policy.json', () => {
  const dir = installTarget();
  const r = runCli(dir, ['policy', 'link', 'https://github.com/acme-corp/agent-policies.git', '--ref', 'v2.0.0', '--enforce', 'gates,gateBudgets', '--target', '.', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.equal(out.command, 'policy link');
  assert.equal(out.remote.url, 'https://github.com/acme-corp/agent-policies.git');
  assert.equal(out.remote.ref, 'v2.0.0');
  assert.deepEqual(out.remote.enforce, ['gates', 'gateBudgets']);

  const policy = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'config', 'policy.json'), 'utf8'));
  assert.equal(policy.remote.url, 'https://github.com/acme-corp/agent-policies.git');
  assert.equal(policy.remote.ref, 'v2.0.0');
  assert.deepEqual(policy.remote.enforce, ['gates', 'gateBudgets']);
});

test('policy check and sync against central baseline detects drift and converges', () => {
  const central = makeTmp('flow-kit-central-policy-');
  const target = installTarget();

  // 1. 在中央策略目录中放置基线策略与表面文件
  const centralPolicy = {
    $schema: 'policy/config@1',
    version: 2,
    surfaces: {
      gates: '.agents/hooks/gates.json',
      gateBudgets: '.agents/config/gate-budgets.json',
    },
    budgets: {
      maxRuleLines: 500,
    },
  };
  fs.mkdirSync(path.join(central, '.agents', 'config'), { recursive: true });
  fs.mkdirSync(path.join(central, '.agents', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(central, '.agents', 'config', 'policy.json'), JSON.stringify(centralPolicy, null, 2));

  // 将 target 的当前 gates.json 与 gate-budgets.json 复制到 central 作为初始一致基线
  const localGates = fs.readFileSync(path.join(target, '.agents', 'hooks', 'gates.json'), 'utf8');
  const localBudgets = fs.readFileSync(path.join(target, '.agents', 'config', 'gate-budgets.json'), 'utf8');
  fs.writeFileSync(path.join(central, '.agents', 'hooks', 'gates.json'), localGates);
  fs.writeFileSync(path.join(central, '.agents', 'config', 'gate-budgets.json'), localBudgets);

  // 2. 绑定中央策略基线
  const linkRes = runCli(target, ['policy', 'link', central, '--target', '.']);
  assert.equal(linkRes.status, 0, linkRes.stderr);

  // 3. 首次检查：完全一致，无漂移
  const check1 = runCli(target, ['policy', 'check', '--target', '.', '--json']);
  assert.equal(check1.status, 0, check1.stderr);
  const out1 = json(check1);
  assert.equal(out1.ok, true);
  assert.equal(out1.synced, true);
  assert.equal(out1.driftCount, 0);

  // 4. 中央策略库变更：修改 gate-budgets.json 中的 fullMs 预算
  const budgetsObj = JSON.parse(localBudgets);
  budgetsObj.fullMs = 999999;
  fs.writeFileSync(path.join(central, '.agents', 'config', 'gate-budgets.json'), JSON.stringify(budgetsObj, null, 2));

  // 5. 再次检查：检出漂移
  const check2 = runCli(target, ['policy', 'check', '--target', '.', '--json']);
  assert.equal(check2.status, 0, check2.stderr);
  const out2 = json(check2);
  assert.equal(out2.ok, true);
  assert.equal(out2.synced, false);
  assert.ok(out2.driftCount >= 1);
  assert.ok(out2.changes.some((c) => c.category === 'budgets'));

  // 6. --strict 模式下有漂移必须返回非 0 状态码
  const checkStrict = runCli(target, ['policy', 'check', '--target', '.', '--strict']);
  assert.equal(checkStrict.status, 1);

  // 7. 同步中央策略基线
  const syncRes = runCli(target, ['policy', 'sync', '--target', '.', '--json']);
  assert.equal(syncRes.status, 0, syncRes.stderr);
  const syncOut = json(syncRes);
  assert.ok(syncOut.updatedCount >= 1);
  assert.ok(syncOut.updatedFiles.includes('.agents/config/gate-budgets.json'));

  // 8. 同步后检查：恢复一致
  const check3 = runCli(target, ['policy', 'check', '--target', '.', '--json']);
  assert.equal(check3.status, 0, check3.stderr);
  const out3 = json(check3);
  assert.equal(out3.synced, true);
  assert.equal(out3.driftCount, 0);

  // 验证本地文件内容已更新
  const updatedLocalBudgets = JSON.parse(fs.readFileSync(path.join(target, '.agents', 'config', 'gate-budgets.json'), 'utf8'));
  assert.equal(updatedLocalBudgets.fullMs, 999999);

  // 验证 manifest 哈希已被更新
  const manifest = JSON.parse(fs.readFileSync(path.join(target, '.agents', 'install-manifest.json'), 'utf8'));
  assert.ok(manifest.files['.agents/config/gate-budgets.json']);
});

test('doctor and attestation verify remote policy status and chain binding', () => {
  const central = makeTmp('flow-kit-central-doctor-');
  const target = installTarget();

  const centralPolicy = {
    $schema: 'policy/config@1',
    version: 1,
    surfaces: {
      gates: '.agents/hooks/gates.json',
    },
  };
  fs.mkdirSync(path.join(central, '.agents', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(central, 'policy.json'), JSON.stringify(centralPolicy, null, 2));
  fs.writeFileSync(
    path.join(central, '.agents', 'hooks', 'gates.json'),
    fs.readFileSync(path.join(target, '.agents', 'hooks', 'gates.json'), 'utf8'),
  );

  runCli(target, ['policy', 'link', central, '--target', '.']);

  // 1. 对齐状态下的 doctor
  const doc1 = runCli(target, ['doctor', '--target', '.', '--attest', '--json']);
  assert.equal(doc1.status, 0, doc1.stderr);
  const docOut1 = json(doc1);
  const policyRemoteCheck1 = docOut1.checks.find((c) => c.name === 'policy-remote');
  assert.ok(policyRemoteCheck1, 'expected policy-remote check in doctor');
  assert.equal(policyRemoteCheck1.ok, true);
  assert.equal(policyRemoteCheck1.warn, false);

  // 验证证明链中的 policy.remote 字段
  assert.ok(docOut1.attestation.policy.remote);
  assert.equal(docOut1.attestation.policy.remote.url, central);

  // 2. 引入漂移
  fs.writeFileSync(path.join(central, '.agents', 'hooks', 'gates.json'), JSON.stringify({ custom: 'drift' }));

  // 3. 漂移状态下的 doctor：报 warning，不破坏整体体检
  const doc2 = runCli(target, ['doctor', '--target', '.', '--json']);
  const docOut2 = json(doc2);
  const driftCheck = docOut2.checks.find((c) => c.name === 'policy-remote drift');
  assert.ok(driftCheck, 'expected policy-remote drift warning in doctor');
  assert.equal(driftCheck.warn, true);
});
