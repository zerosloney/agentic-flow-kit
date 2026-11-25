// gate-guards.test.mjs — 门禁第 5/6 道守卫的 fail-closed 分支：
// 公证证明链（缺公钥 / 缺载荷 / 篡改 / 坏签名 / 交接信封）与中央策略面（缺配置 / 坏格式 / 未同步 / 合规）。
// 口径：只断言守卫状态与违规条目，不依赖人类文案排版；文案只做语义子串匹配（zh/en 均可）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers/tmp.mjs';
import { makeT } from '../src/i18n.mjs';
import { runGateChecks } from '../src/ci/gate.mjs';
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
