// gate-guards.test.mjs — 门禁第 5/6 道守卫的 fail-closed 分支：
// 公证证明链（缺公钥 / 缺载荷 / 篡改 / 坏签名 / 交接信封）与中央策略面（缺配置 / 坏格式 / 未同步 / 合规）。
// 口径：只断言守卫状态与违规条目，不依赖人类文案排版；文案只做语义子串匹配（zh/en 均可）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers/tmp.mjs';
import { makeT } from '../src/i18n.mjs';
import { generateCiWorkflow, generateGateBadge, notaryTouches, renderGateMarkdown, renderGateText, runGateChecks } from '../src/ci/gate.mjs';
import { gateCommand } from '../src/commands/gate.mjs';
import { parseArgs } from '../src/cli/args.mjs';
import { generateKeyPair, signPayload, writeSignatureFile } from '../src/install/notary.mjs';

const t = makeT('zh-CN');

function guardOf(dir, name) {
  const res = runGateChecks({ target: dir, strict: false, t });
  const guard = res.guards.find((g) => g.name === name);
  assert.ok(guard, `缺少 ${name} 守卫`);
  return { res, guard };
}

function writeKey(dir) {
  const { publicKey, privateKey } = generateKeyPair();
  fs.mkdirSync(path.join(dir, '.agents', 'keys'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'keys', 'flow-kit-key.pub.pem'), publicKey, 'utf8');
  return privateKey;
}

function writeSigned(dir, relSig, relPayload, payload, privateKey) {
  writeSignatureFile(path.join(dir, relSig), signPayload({ payload, privateKeyPem: privateKey }));
  fs.mkdirSync(path.dirname(path.join(dir, relPayload)), { recursive: true });
  fs.writeFileSync(path.join(dir, relPayload), JSON.stringify(payload), 'utf8');
}

test('notary guard: 有签名但缺公钥 → failed 且点名签名文件', () => {
  const dir = makeTmp('gate-guard-nokey-');
  const { privateKey } = generateKeyPair();
  const payload = { spec: 'workflow-v1', author: 'agent' };
  writeSigned(dir, '.agents/attestation.sig', '.agents/attestation.json', payload, privateKey);

  const { res, guard } = guardOf(dir, 'notary');

  assert.equal(guard.status, 'failed');
  assert.equal(res.passed, false);
  assert.match(guard.reason, /公钥|public key/i);
  assert.match(guard.details.violations[0], /attestation\.sig/);
});

test('notary guard: 有签名缺载荷 → failed 且点名载荷文件', () => {
  const dir = makeTmp('gate-guard-nopayload-');
  const privateKey = writeKey(dir);
  writeSignatureFile(
    path.join(dir, '.agents', 'attestation.sig'),
    signPayload({ payload: { spec: 'workflow-v1' }, privateKeyPem: privateKey }),
  );

  const { guard } = guardOf(dir, 'notary');

  assert.equal(guard.status, 'failed');
  assert.match(guard.reason, /载荷|payload/i);
  assert.match(guard.details.violations[0], /attestation\.json/);
});

test('notary guard: sbom 载荷被改 → failed 且点名 sbom.json', () => {
  const dir = makeTmp('gate-guard-sbom-');
  const privateKey = writeKey(dir);
  writeSignatureFile(
    path.join(dir, '.agents', 'sbom.sig'),
    signPayload({ payload: { bomFormat: 'flow-kit-sbom', components: [] }, privateKeyPem: privateKey }),
  );
  fs.writeFileSync(path.join(dir, '.agents', 'sbom.json'), JSON.stringify({ bomFormat: 'flow-kit-sbom', components: ['x'] }), 'utf8');

  const { guard } = guardOf(dir, 'notary');

  assert.equal(guard.status, 'failed');
  assert.match(guard.reason, /sbom\.json/);
  assert.equal(guard.details.violations.length, 1);
  assert.match(guard.details.violations[0], /sbom\.json/);
});

test('notary guard: 坏签名对象 → failed（篡改归类），不抛异常', () => {
  const dir = makeTmp('gate-guard-badsig-');
  writeKey(dir);
  fs.writeFileSync(path.join(dir, '.agents', 'attestation.sig'), JSON.stringify({ schema: 'nope/v1' }), 'utf8');
  fs.writeFileSync(path.join(dir, '.agents', 'attestation.json'), JSON.stringify({ spec: 'workflow-v1' }), 'utf8');

  const { guard } = guardOf(dir, 'notary');

  assert.equal(guard.status, 'failed');
  assert.match(guard.reason, /篡改|tampered/i);
  assert.match(guard.reason, /Unsupported signature schema/);
});

test('notary guard: 交接信封缺工件 → failed 且错误信息带真实原因（不是 undefined）', () => {
  const dir = makeTmp('gate-guard-handoff-');
  const envelope = {
    schema: 'flow-kit-handoff/v1',
    id: 'H-001',
    fromRole: 'implementer',
    toRole: 'reviewer',
    task: 'demo',
    summary: 'normal handoff summary',
    assumptions: [],
    artifacts: [{ path: 'missing-artifact.txt', hash: 'deadbeef' }],
    createdAt: '2026-11-26T00:00:00.000Z',
  };
  fs.mkdirSync(path.join(dir, '.agents', 'handoffs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'handoffs', 'H-001.json'), JSON.stringify(envelope), 'utf8');

  const { guard } = guardOf(dir, 'notary');

  assert.equal(guard.status, 'failed');
  assert.match(guard.details.violations[0], /H-001/);
  assert.match(guard.reason, /交接|handoff/i);
  assert.match(guard.reason, /Missing artifact: missing-artifact\.txt/);
  assert.doesNotMatch(guard.reason, /undefined/);
});

test('policy guard: 未配置 → skipped', () => {
  const dir = makeTmp('gate-guard-policy-none-');
  const { guard } = guardOf(dir, 'policy');

  assert.equal(guard.status, 'skipped');
  assert.match(guard.reason, /policy\.json/);
});

test('policy guard: 坏 JSON / null 都 fail-closed', () => {
  for (const [label, text] of [['坏 JSON', '{oops'], ['null', 'null']]) {
    const dir = makeTmp('gate-guard-policy-bad-');
    fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agents', 'policy.json'), text, 'utf8');

    const { guard } = guardOf(dir, 'policy');
    assert.equal(guard.status, 'failed', label);
    assert.match(guard.reason, /格式|invalid/i, label);
    assert.doesNotMatch(guard.reason, /Cannot read properties|TypeError/, label);
  }
});

test('policy guard: 远程策略未同步 → warned 并给同步提示', () => {
  const dir = makeTmp('gate-guard-policy-unsynced-');
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agents', 'policy.json'),
    JSON.stringify({ version: '1.0', remotePolicyServer: 'https://policy.example.com' }),
    'utf8',
  );

  const { guard } = guardOf(dir, 'policy');

  assert.equal(guard.status, 'warned');
  assert.match(guard.reason, /同步|sync/i);
  assert.match(guard.hint, /policy pull|同步/);
});

test('policy guard: 合规策略 → passed', () => {
  const dir = makeTmp('gate-guard-policy-ok-');
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'policy.json'), JSON.stringify({ version: '1.0' }), 'utf8');

  const { guard } = guardOf(dir, 'policy');

  assert.equal(guard.status, 'passed');
  assert.match(guard.reason, /1\.0/);
});

test('gate contracts: canonical .agents/config/policy.json, doraTier, arch details, notaryTouches keys, GitHub --force, and NaN threshold rejection', async () => {
  const dir = makeTmp('gate-contracts-s5-');

  // 1. Canonical .agents/config/policy.json is recognized (not skipped)
  fs.mkdirSync(path.join(dir, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agents', 'config', 'policy.json'),
    JSON.stringify({ version: '2.0' }),
    'utf8',
  );
  const { guard: policyGuard } = guardOf(dir, 'policy');
  assert.equal(policyGuard.status, 'passed');
  assert.equal(policyGuard.details?.version, '2.0');

  // 2. Metrics guard exposes top-level doraTier instead of undefined
  const { guard: metricsGuard } = guardOf(dir, 'metrics');
  assert.ok(typeof metricsGuard.details?.tier === 'string' && metricsGuard.details.tier.length > 0);

  // 3. Arch guard populates structured violation details on boundary/cycle failure
  fs.mkdirSync(path.join(dir, 'src', 'a'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'b'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agents', 'config', 'architecture.json'),
    JSON.stringify({
      layers: { a: { path: 'src/a/**', disallow: ['b'] }, b: { path: 'src/b/**' } },
      rules: { noCircularDependencies: true },
    }),
    'utf8',
  );
  fs.writeFileSync(path.join(dir, 'src', 'b', 'mod.mjs'), 'export const x = 1;\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'a', 'mod.mjs'), 'import "../b/mod.mjs";\n', 'utf8');
  const { guard: archGuard } = guardOf(dir, 'arch');
  assert.equal(archGuard.status, 'failed');
  assert.equal(archGuard.details?.violations, 1);
  assert.equal(archGuard.details?.layerViolations?.length, 1);

  // 4. notaryTouches includes .agents/keys/
  assert.equal(notaryTouches(['.agents/keys/flow-kit-key.pub.pem']), true);

  // 5. generateCiWorkflow protects existing GitHub workflow unless force=true
  generateCiWorkflow({ provider: 'github', target: dir, t, force: false });
  assert.throws(
    () => generateCiWorkflow({ provider: 'github', target: dir, t, force: false }),
    (err) => err.code === 'CONFIG_EXISTS',
  );

  // 6. gateCommand & runGateChecks reject non-numeric/bare thresholds and empty/bare --rules
  await assert.rejects(
    () => gateCommand({ args: parseArgs(['gate', 'check', '--target', dir, '--max-cfr', 'not-a-number']), t }),
    (err) => err.code === 'BAD_GATE_USAGE',
  );
  await assert.rejects(
    () => gateCommand({ args: parseArgs(['gate', 'check', '--target', dir, '--max-cfr']), t }),
    (err) => err.code === 'BAD_GATE_USAGE',
  );
  await assert.rejects(
    () => gateCommand({ args: parseArgs(['gate', 'check', '--target', dir, '--rules', '']), t }),
    (err) => err.code === 'BAD_GATE_USAGE',
  );
  await assert.rejects(
    () => gateCommand({ args: parseArgs(['gate', 'check', '--target', dir, '--rules']), t }),
    (err) => err.code === 'BAD_GATE_USAGE',
  );
  assert.throws(
    () => runGateChecks({ target: dir, thresholds: { maxCfr: Number.NaN }, t }),
    (err) => err.code === 'BAD_GATE_USAGE',
  );
  assert.throws(
    () => runGateChecks({ target: dir, rules: [], t }),
    (err) => err.code === 'BAD_GATE_USAGE',
  );

  // 7. In-process gateCommand check / badge / init-ci + renderers roundtrip
  const outDir = makeTmp('gate-cmd-inproc-');
  const origLog = console.log;
  console.log = () => {};
  try {
    assert.equal(await gateCommand({ args: parseArgs(['gate', 'init-ci', '--target', outDir]), t }), 0);
    assert.equal(await gateCommand({ args: parseArgs(['gate', 'badge', '--target', outDir, '--rules', 'policy', '--out', 'badge.md']), t }), 0);
    assert.equal(await gateCommand({
      args: parseArgs(['gate', 'check', '--target', outDir, '--rules', 'policy', '--json', '--out', 'report.md', '--badge-out', 'badge.svg']),
      t,
    }), 0);
  } finally {
    console.log = origLog;
  }
  assert.equal(fs.existsSync(path.join(outDir, 'badge.md')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'report.md')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'badge.svg')), true);

  const fullRes = runGateChecks({ target: dir, strict: true, t });
  assert.match(renderGateText(fullRes, t), /REJECTED/);
  assert.match(renderGateMarkdown(fullRes, t), /REJECTED/);
  assert.match(generateGateBadge(fullRes, { format: 'svg' }), /<svg/);
});
