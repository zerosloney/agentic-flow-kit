import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers/tmp.mjs';
import { makeT } from '../src/i18n.mjs';
import {
  runGovernanceProbes,
  toGateVerdict,
  notaryTouches,
} from '../src/governance/probes.mjs';
import { initArchConfig } from '../src/install/arch-guard.mjs';
import { initSandboxConfig } from '../src/install/sandbox.mjs';
import { recordMcpAudit, MCP_GATEWAY_CONFIG_REL } from '../src/install/mcp-gateway.mjs';
import { generateKeyPair, signPayload, writeSignatureFile } from '../src/install/notary.mjs';
import { createHandoffEnvelope, writeHandoffFile } from '../src/install/handoff.mjs';

const t = makeT('zh-CN');

test('runGovernanceProbes: empty project returns skipped/passed baseline', () => {
  const tmp = makeTmp('gov-empty-');
  const res = runGovernanceProbes({ target: tmp, t });

  assert.equal(res.target, tmp);
  assert.ok(typeof res.durationMs === 'number');
  assert.ok(res.summary);
  assert.equal(res.summary.total, 7);
  assert.equal(res.summary.failed, 0);

  // Probes in baseline:
  // arch, skills, mcp, sandbox, notary, policy are skipped; metrics is passed
  assert.equal(res.byId.arch.status, 'skipped');
  assert.equal(res.byId.skills.status, 'skipped');
  assert.equal(res.byId.mcp.status, 'skipped');
  assert.equal(res.byId.sandbox.status, 'skipped');
  assert.equal(res.byId.notary.status, 'skipped');
  assert.equal(res.byId.policy.status, 'skipped');
  assert.equal(res.byId.metrics.status, 'passed');

  assert.equal(res.summary.skipped, 6);
  assert.equal(res.summary.passed, 1);
  assert.equal(res.summary.warned, 0);

  // toGateVerdict on baseline
  const verdict = toGateVerdict(res, { strict: false });
  assert.equal(verdict.passed, true);
  assert.equal(verdict.verdict, 'APPROVED');
  assert.equal(verdict.guards.length, 7);
});

test('runGovernanceProbes: filters by selected probes subset', () => {
  const tmp = makeTmp('gov-subset-');
  const res = runGovernanceProbes({ target: tmp, probes: ['arch', 'policy'], t });

  assert.equal(res.summary.total, 2);
  assert.equal(res.probes.length, 2);
  assert.ok(res.byId.arch);
  assert.ok(res.byId.policy);
  assert.equal(res.byId.metrics, undefined);
});

test('runGovernanceProbes: arch probe 4-state lifecycle', () => {
  const tmp = makeTmp('gov-arch-');

  // 1. Skipped (no config)
  const r1 = runGovernanceProbes({ target: tmp, probes: ['arch'], t });
  assert.equal(r1.byId.arch.status, 'skipped');

  // 2. Passed (clean config and valid code)
  initArchConfig(tmp, { preset: 'clean' });
  const r2 = runGovernanceProbes({ target: tmp, probes: ['arch'], t });
  assert.equal(r2.byId.arch.status, 'passed');
  assert.ok(r2.byId.arch.doctorChecks.length > 0);
  assert.equal(r2.byId.arch.doctorChecks[0].ok, true);

  // 3. Failed (layer violation)
  fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'infra'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src', 'infra', 'db.mjs'), 'export const db = 1;', 'utf8');
  fs.writeFileSync(
    path.join(tmp, 'src', 'domain', 'order.mjs'),
    'import { db } from "../infra/db.mjs";',
    'utf8',
  );

  const r3 = runGovernanceProbes({ target: tmp, probes: ['arch'], t });
  assert.equal(r3.byId.arch.status, 'failed');
  assert.ok(r3.byId.arch.details.violations > 0);
  assert.equal(r3.byId.arch.doctorChecks[0].ok, false);

  // 4. Failed (corrupted config)
  fs.writeFileSync(path.join(tmp, '.agents', 'config', 'architecture.json'), '{ invalid json', 'utf8');
  const r4 = runGovernanceProbes({ target: tmp, probes: ['arch'], t });
  assert.equal(r4.byId.arch.status, 'failed');
  assert.equal(r4.byId.arch.doctorChecks[0].ok, false);
});

test('runGovernanceProbes: skills probe warns on missing dataset and passes with eval entries', () => {
  const tmp = makeTmp('gov-skills-');

  // 1. Skipped when no .agents/skills
  const r1 = runGovernanceProbes({ target: tmp, probes: ['skills'], t });
  assert.equal(r1.byId.skills.status, 'skipped');

  // 2. Warned when custom skills installed without dataset or eval entries
  fs.mkdirSync(path.join(tmp, '.agents', 'skills', 'custom-skill'), { recursive: true });
  const r2 = runGovernanceProbes({ target: tmp, probes: ['skills'], t });
  assert.equal(r2.byId.skills.status, 'warned');
  assert.equal(r2.byId.skills.doctorChecks[0].warn, true);

  // 3. Passed when eval entries exist
  fs.mkdirSync(path.join(tmp, '.agents', 'evals'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.agents', 'evals', 'eval-log.json'),
    JSON.stringify({ entries: [{ skill: 'custom-skill', outcome: 'pass' }] }),
    'utf8',
  );
  const r3 = runGovernanceProbes({ target: tmp, probes: ['skills'], t });
  assert.equal(r3.byId.skills.status, 'passed');

  // 4. Failed when eval-log is malformed
  fs.writeFileSync(path.join(tmp, '.agents', 'evals', 'eval-log.json'), '{ broken', 'utf8');
  const r4 = runGovernanceProbes({ target: tmp, probes: ['skills'], t });
  assert.equal(r4.byId.skills.status, 'failed');
});

test('runGovernanceProbes: mcp probe warns on anomaly denials and fails on corrupt config', () => {
  const tmp = makeTmp('gov-mcp-');

  // 1. Skipped when no config & no audit
  const r1 = runGovernanceProbes({ target: tmp, probes: ['mcp'], t });
  assert.equal(r1.byId.mcp.status, 'skipped');

  // 2. Passed with healthy audit log (<= 5 denials)
  for (let i = 0; i < 3; i++) {
    recordMcpAudit(tmp, { role: 'coder', tool: 'wiki_search', decision: 'ALLOWED' });
  }
  const r2 = runGovernanceProbes({ target: tmp, probes: ['mcp'], t });
  assert.equal(r2.byId.mcp.status, 'passed');

  // 3. Warned when > 5 denials
  for (let i = 0; i < 6; i++) {
    recordMcpAudit(tmp, { role: 'coder', tool: 'write_file', decision: 'DENIED_PARAM', reason: 'Blocked' });
  }
  const r3 = runGovernanceProbes({ target: tmp, probes: ['mcp'], t });
  assert.equal(r3.byId.mcp.status, 'warned');
  assert.equal(r3.byId.mcp.doctorChecks[0].warn, true);

  // 4. Failed when config is corrupted
  fs.mkdirSync(path.join(tmp, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmp, MCP_GATEWAY_CONFIG_REL), 'invalid json', 'utf8');
  const r4 = runGovernanceProbes({ target: tmp, probes: ['mcp'], t });
  assert.equal(r4.byId.mcp.status, 'failed');
  assert.equal(r4.byId.mcp.doctorChecks[0].ok, false);
});

test('runGovernanceProbes: sandbox probe warns on degraded auto and fails on corrupt config', () => {
  const tmp = makeTmp('gov-sb-');

  // 1. Skipped when no config
  const r1 = runGovernanceProbes({ target: tmp, probes: ['sandbox'], t });
  assert.equal(r1.byId.sandbox.status, 'skipped');

  // 2. Warned or passed depending on container engine detection in auto mode
  initSandboxConfig(tmp, { mode: 'auto' });
  const r2 = runGovernanceProbes({ target: tmp, probes: ['sandbox'], t });
  // In environments without docker/podman, auto degrades -> warned; if engine available -> passed
  assert.ok(['warned', 'passed'].includes(r2.byId.sandbox.status));

  // 3. Failed on corrupted config
  fs.writeFileSync(path.join(tmp, '.agents', 'config', 'sandbox.json'), '{ broken json', 'utf8');
  const r3 = runGovernanceProbes({ target: tmp, probes: ['sandbox'], t });
  assert.equal(r3.byId.sandbox.status, 'failed');
  assert.equal(r3.byId.sandbox.doctorChecks[0].ok, false);
});

test('runGovernanceProbes: notary probe enforces fail-closed signatures and parses handoffs', () => {
  const tmp = makeTmp('gov-notary-');

  // 1. Skipped when no signatures
  const r1 = runGovernanceProbes({ target: tmp, probes: ['notary'], t });
  assert.equal(r1.byId.notary.status, 'skipped');
  assert.equal(r1.handoffs.total, 0);

  // 2. Failed if signature exists but missing key
  fs.mkdirSync(path.join(tmp, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.agents', 'attestation.sig'), 'dummy sig', 'utf8');
  const r2 = runGovernanceProbes({ target: tmp, probes: ['notary'], t });
  assert.equal(r2.byId.notary.status, 'failed');

  // 3. Generate key pair & sign valid attestation
  const keyDir = path.join(tmp, '.agents', 'keys');
  fs.mkdirSync(keyDir, { recursive: true });
  const keys = generateKeyPair();
  const privKeyPath = path.join(keyDir, 'flow-kit-key.key.pem');
  const pubKeyPath = path.join(keyDir, 'flow-kit-key.pub.pem');
  fs.writeFileSync(privKeyPath, keys.privateKey, 'utf8');
  fs.writeFileSync(pubKeyPath, keys.publicKey, 'utf8');

  const payload = { version: '1.0.0', commit: 'abc1234', timestamp: new Date().toISOString() };
  fs.writeFileSync(path.join(tmp, '.agents', 'attestation.json'), JSON.stringify(payload), 'utf8');
  const sigObj = signPayload({ payload, privateKeyPem: keys.privateKey, keyId: 'test-key' });
  writeSignatureFile(path.join(tmp, '.agents', 'attestation.sig'), sigObj);

  const r3 = runGovernanceProbes({ target: tmp, probes: ['notary'], t });
  assert.equal(r3.byId.notary.status, 'passed');

  // 4. Add handoff envelope
  const handoff = createHandoffEnvelope({
    target: tmp,
    fromRole: 'architect',
    toRole: 'engineer',
    task: 'implement governance',
    artifacts: [],
    signWithKey: keys.privateKey,
  });
  writeHandoffFile(path.join(tmp, '.agents', 'handoffs', `${handoff.id}.json`), handoff);

  const r4 = runGovernanceProbes({ target: tmp, probes: ['notary'], t });
  assert.equal(r4.byId.notary.status, 'passed');
  assert.equal(r4.handoffs.total, 1);
  assert.equal(r4.handoffs.clean, true);

  // 5. Corrupted handoff payload -> failed
  fs.writeFileSync(path.join(tmp, '.agents', 'handoffs', 'corrupt.json'), '{ broken json', 'utf8');
  const r5 = runGovernanceProbes({ target: tmp, probes: ['notary'], t });
  assert.equal(r5.byId.notary.status, 'failed');
  assert.equal(r5.handoffs.tampered, 1);
  assert.equal(r5.handoffs.clean, false);
});

test('runGovernanceProbes: policy probe warns on unsynced remote server and fails on corrupt config', () => {
  const tmp = makeTmp('gov-policy-');

  // 1. Skipped when no policy.json
  const r1 = runGovernanceProbes({ target: tmp, probes: ['policy'], t });
  assert.equal(r1.byId.policy.status, 'skipped');

  // 2. Passed on clean local policy
  fs.mkdirSync(path.join(tmp, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.agents', 'config', 'policy.json'),
    JSON.stringify({ version: '1.0' }),
    'utf8',
  );
  const r2 = runGovernanceProbes({ target: tmp, probes: ['policy'], t });
  assert.equal(r2.byId.policy.status, 'passed');

  // 3. Warned when remote policy declared but unsynced
  fs.writeFileSync(
    path.join(tmp, '.agents', 'config', 'policy.json'),
    JSON.stringify({ version: '1.0', remotePolicyServer: 'https://policy.example.com' }),
    'utf8',
  );
  const r3 = runGovernanceProbes({ target: tmp, probes: ['policy'], t });
  assert.equal(r3.byId.policy.status, 'warned');

  // 4. Failed when corrupt
  fs.writeFileSync(path.join(tmp, '.agents', 'config', 'policy.json'), 'invalid', 'utf8');
  const r4 = runGovernanceProbes({ target: tmp, probes: ['policy'], t });
  assert.equal(r4.byId.policy.status, 'failed');
});

test('runGovernanceProbes: diffScoping marks untouched probes passed', () => {
  const tmp = makeTmp('gov-diff-');
  initArchConfig(tmp, { preset: 'clean' });
  initSandboxConfig(tmp, { mode: 'auto' });

  // Only modified README.md -> untouched probes should be marked passed by diff scoping
  const changedFiles = ['README.md'];
  const res = runGovernanceProbes({ target: tmp, changedFiles, t });

  assert.equal(res.byId.arch.status, 'passed');
  assert.match(res.byId.arch.reason, /(0 architecture layer files|架构分层文件变更)/i);
  assert.equal(res.byId.sandbox.status, 'passed');
  assert.match(res.byId.sandbox.reason, /(0 sandbox configurations|沙箱配置变更)/i);
  assert.equal(res.byId.notary.status, 'passed');
  assert.match(res.byId.notary.reason, /(0 signed proofs|公证签名)/i);
  assert.equal(res.byId.policy.status, 'passed');
  assert.match(res.byId.policy.reason, /(0 policy definitions|策略规约变更)/i);
});

test('toGateVerdict: respects strict mode on warned probes', () => {
  const mockBatch = {
    target: '/test',
    durationMs: 120,
    summary: { total: 3, passed: 2, warned: 1, failed: 0, skipped: 0 },
    probes: [
      { id: 'arch', name: 'arch', title: 'Arch', status: 'passed', reason: 'ok', durationMs: 10 },
      { id: 'sandbox', name: 'sandbox', title: 'Sandbox', status: 'warned', reason: 'degraded', durationMs: 20 },
      { id: 'policy', name: 'policy', title: 'Policy', status: 'passed', reason: 'ok', durationMs: 10 },
    ],
  };

  // strict = false -> APPROVED
  const v1 = toGateVerdict(mockBatch, { strict: false });
  assert.equal(v1.verdict, 'APPROVED');
  assert.equal(v1.passed, true);
  assert.equal(v1.guards.length, 3);
  assert.equal(v1.summary.warned, 1);

  // strict = true -> REJECTED
  const v2 = toGateVerdict(mockBatch, { strict: true });
  assert.equal(v2.verdict, 'REJECTED');
  assert.equal(v2.passed, false);
});

test('notaryTouches: matches exact notary artifacts', () => {
  assert.equal(notaryTouches(['.agents/attestation.sig']), true);
  assert.equal(notaryTouches(['.agents/attestation.json']), true);
  assert.equal(notaryTouches(['.agents/sbom.sig']), true);
  assert.equal(notaryTouches(['.agents/sbom.json']), true);
  assert.equal(notaryTouches(['.agents/handoffs/order.json']), true);
  assert.equal(notaryTouches(['.agents/keys/notary.pub.pem']), true);
  assert.equal(notaryTouches(['.agents/notary/public.pem']), true);
  assert.equal(notaryTouches(['src/domain/user.mjs', 'package.json']), false);
});
