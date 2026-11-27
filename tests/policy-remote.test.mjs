import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { EXIT } from '../src/cli/exit.mjs';

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

test('policy sync skips user-modified managed surfaces and reports conflicts', () => {
  const central = makeTmp('flow-kit-central-conflict-');
  const target = installTarget();
  const rel = '.agents/config/gate-budgets.json';
  const localPath = path.join(target, rel);
  const manifestPath = path.join(target, '.agents', 'install-manifest.json');

  const remotePolicy = {
    $schema: 'policy/config@1',
    version: 2,
    surfaces: { gateBudgets: rel },
  };
  fs.mkdirSync(path.join(central, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(path.join(central, '.agents', 'config', 'policy.json'), JSON.stringify(remotePolicy, null, 2));
  fs.writeFileSync(path.join(central, rel), fs.readFileSync(localPath));

  assert.equal(runCli(target, ['policy', 'link', central, '--target', '.']).status, 0);

  const beforeManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const beforeHash = beforeManifest.files[rel];
  assert.ok(beforeHash, 'installed surface must be tracked in manifest');

  // 用户本地治理调优
  const userContent = JSON.stringify({ fullMs: 4242, userTuned: true }, null, 2);
  fs.writeFileSync(localPath, userContent);

  // 中央基线同步到不同内容
  const remoteContent = JSON.stringify({ fullMs: 999999 }, null, 2);
  fs.writeFileSync(path.join(central, rel), remoteContent);

  const syncRes = runCli(target, ['policy', 'sync', '--target', '.', '--json', '--strict']);
  assert.equal(syncRes.status, 1, syncRes.stderr);
  const out = json(syncRes);
  assert.equal(out.conflicts.length, 1);
  assert.equal(out.conflicts[0].surface, 'gateBudgets');
  assert.equal(out.conflicts[0].rel, rel);
  assert.ok(out.conflicts[0].local);
  assert.ok(out.conflicts[0].remote);
  assert.equal(out.updatedFiles.includes(rel), false);

  // 本地内容与 manifest 记录均保持不变
  assert.equal(fs.readFileSync(localPath, 'utf8'), userContent);
  const afterManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(afterManifest.files[rel], beforeHash);
});

test('policy sync without strict still writes unmodified managed surfaces', () => {
  const central = makeTmp('flow-kit-central-clean-');
  const target = installTarget();
  const rel = '.agents/config/gate-budgets.json';
  const localPath = path.join(target, rel);
  const manifestPath = path.join(target, '.agents', 'install-manifest.json');

  const remotePolicy = {
    $schema: 'policy/config@1',
    version: 2,
    surfaces: { gateBudgets: rel },
  };
  fs.mkdirSync(path.join(central, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(path.join(central, '.agents', 'config', 'policy.json'), JSON.stringify(remotePolicy, null, 2));
  fs.writeFileSync(path.join(central, rel), fs.readFileSync(localPath));

  assert.equal(runCli(target, ['policy', 'link', central, '--target', '.']).status, 0);
  const beforeHash = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files[rel];
  assert.ok(beforeHash);

  const remoteContent = JSON.stringify({ fullMs: 777777 }, null, 2);
  fs.writeFileSync(path.join(central, rel), remoteContent);

  const syncRes = runCli(target, ['policy', 'sync', '--target', '.', '--json', '--strict']);
  assert.equal(syncRes.status, 0, syncRes.stderr);
  const out = json(syncRes);
  assert.deepEqual(out.conflicts, []);
  assert.ok(out.updatedFiles.includes(rel));
  assert.equal(fs.readFileSync(localPath, 'utf8'), remoteContent);

  const expectedHash = crypto.createHash('sha256').update(remoteContent, 'utf8').digest('hex');
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files[rel], expectedHash);
  assert.notEqual(expectedHash, beforeHash);
});

test('policy sync writes surfaces not tracked by the manifest', () => {
  const central = makeTmp('flow-kit-central-untracked-');
  const target = installTarget();
  const rel = '.agents/config/custom-surface.json';
  const localPath = path.join(target, rel);
  const manifestPath = path.join(target, '.agents', 'install-manifest.json');

  const remotePolicy = {
    $schema: 'policy/config@1',
    version: 1,
    surfaces: { custom: rel },
  };
  fs.mkdirSync(path.join(central, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(path.join(central, '.agents', 'config', 'policy.json'), JSON.stringify(remotePolicy, null, 2));
  const remoteContent = JSON.stringify({ from: 'central' }, null, 2);
  fs.writeFileSync(path.join(central, rel), remoteContent);

  assert.equal(runCli(target, ['policy', 'link', central, '--target', '.']).status, 0);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, JSON.stringify({ from: 'user' }, null, 2));

  const syncRes = runCli(target, ['policy', 'sync', '--target', '.', '--json']);
  assert.equal(syncRes.status, 0, syncRes.stderr);
  const out = json(syncRes);
  assert.deepEqual(out.conflicts, []);
  assert.ok(out.updatedFiles.includes(rel));
  assert.equal(fs.readFileSync(localPath, 'utf8'), remoteContent);

  // 非托管面维持现行为：不新增 manifest 记录
  assert.equal(rel in JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files, false);
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

// remote.url 以 - 开头会被 git 当成选项（--upload-pack 可执行本地命令）；必须在任何 git 调用前拒绝。
test('policy check rejects option-like remote urls before invoking git', () => {
  const dir = makeTmp('flow-kit-policy-inject-');
  const marker = path.join(dir, 'pwned.txt');
  const url = `--upload-pack=touch ${marker.split(path.sep).join('/')} github.com/a/b.git`;
  fs.mkdirSync(path.join(dir, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'config', 'policy.json'), `${JSON.stringify({
    $schema: 'policy/config@1',
    version: 1,
    surfaces: {},
    remote: { url, ref: 'main', enforce: [] },
  }, null, 2)}\n`, 'utf8');

  const r = runCli(dir, ['policy', 'check', '--target', '.']);
  assert.equal(r.status, EXIT.USAGE, r.stderr);
  assert.ok(r.stderr.includes('--upload-pack'), `error must name the rejected value: ${r.stderr}`);
  assert.equal(fs.existsSync(marker), false, 'git must never parse the url as an option');
  fs.rmSync(marker, { force: true });
});

test('policy sync rejects option-like remote refs', () => {
  const dir = makeTmp('flow-kit-policy-ref-');
  const r = runCli(dir, ['policy', 'sync', '--remote', 'missing.git', '--ref=--upload-pack=x', '--target', '.']);
  assert.equal(r.status, EXIT.USAGE, r.stderr);
  assert.ok(r.stderr.includes('--upload-pack=x'), `error must name the rejected value: ${r.stderr}`);
});

// 远程基线可带任意 surfaces 值；解析到 target 之外的路径不得读取或写入。
test('policy sync refuses surface paths that resolve outside the target', () => {
  const remoteParent = makeTmp('flow-kit-policy-sync-remote-');
  const remote = path.join(remoteParent, 'remote');
  fs.mkdirSync(remote);
  const target = installTarget('flow-kit-policy-sync-target-');
  const rel = `../${path.basename(target)}-escape.txt`;
  const victim = path.resolve(target, rel);
  try {
    fs.writeFileSync(victim, 'KEEP\n', 'utf8');
    fs.writeFileSync(path.resolve(remote, rel), 'PWNED\n', 'utf8');
    fs.writeFileSync(path.join(remote, 'policy.json'), JSON.stringify({ version: 1, surfaces: { escape: rel } }, null, 2));

    const localPolicyPath = path.join(target, '.agents', 'config', 'policy.json');
    const localPolicy = JSON.parse(fs.readFileSync(localPolicyPath, 'utf8'));
    localPolicy.remote = { url: remote, ref: 'main', enforce: [] };
    fs.writeFileSync(localPolicyPath, `${JSON.stringify(localPolicy, null, 2)}\n`, 'utf8');

    const sync = runCli(target, ['policy', 'sync', '--target', '.']);
    assert.notEqual(sync.status, 0, 'sync must refuse a surface outside the target');
    assert.ok(sync.stderr.includes(rel), `sync must name the rejected path: ${sync.stderr}`);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'KEEP\n', 'nothing outside the target may be written');

    const check = runCli(target, ['policy', 'check', '--target', '.']);
    assert.notEqual(check.status, 0, 'check must refuse a surface outside the target');
    assert.ok(check.stderr.includes(rel), `check must name the rejected path: ${check.stderr}`);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'KEEP\n', 'nothing outside the target may be read into the diff');
  } finally {
    fs.rmSync(victim, { force: true });
  }
});
