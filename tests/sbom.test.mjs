import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

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

function setupTargetProject(tmp) {
  const target = path.join(tmp, 'project');
  fs.mkdirSync(target, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: target }).status, 0);

  const rInstall = runCli(target, [
    'install',
    '--agent', 'claude',
    '--stack', 'node',
    '--target', '.',
    '--json',
  ]);
  assert.equal(rInstall.status, 0, rInstall.stderr);

  // Seed sample telemetry records
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(target, '.agents', 'verifications.jsonl'),
    JSON.stringify({ ts: now, name: 'lint', ok: true }) + '\n' +
    JSON.stringify({ ts: now, name: 'test', ok: true }) + '\n'
  );
  fs.writeFileSync(
    path.join(target, '.agents', 'confirmations.jsonl'),
    JSON.stringify({ ts: now, rule: 'STOP-1', approved: true, decider: 'user' }) + '\n'
  );
  fs.mkdirSync(path.join(target, '.agents', 'evals'), { recursive: true });
  fs.writeFileSync(
    path.join(target, '.agents', 'evals', 'results.jsonl'),
    JSON.stringify({ ts: now, evalId: 'eval-security', score: 0.95, passed: true }) + '\n'
  );

  return target;
}

test('sbom export --format native produces valid A-SBOM with components and telemetry', () => {
  const tmp = makeTmp('flow-kit-sbom-native-');
  const target = setupTargetProject(tmp);
  const sbomOut = path.join(target, 'my-sbom.json');

  const r = runCli(target, [
    'sbom', 'export',
    '--format', 'native',
    '--out', sbomOut,
    '--target', '.',
    '--json',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const res = json(r);
  assert.equal(res.ok, true);
  assert.equal(res.format, 'native');
  assert.equal(res.file, sbomOut);
  assert.ok(res.digest);
  assert.ok(res.proofRoot);
  assert.ok(res.componentsCount > 0);

  assert.ok(fs.existsSync(sbomOut));
  const sbom = JSON.parse(fs.readFileSync(sbomOut, 'utf8'));
  assert.equal(sbom.schema, 'flow-kit-sbom/v1');
  assert.equal(sbom.format, 'native');
  assert.ok(sbom.kitVersion);
  assert.ok(sbom.metadata?.createdAt);
  assert.ok(Array.isArray(sbom.hosts) && sbom.hosts.some((h) => h.name === 'claude'));
  assert.ok(Array.isArray(sbom.skills) && sbom.skills.length > 0);
  assert.ok(sbom.skills[0].name && sbom.skills[0].hash);
  assert.ok(sbom.models);
  assert.ok(sbom.proofChain?.root);
  assert.ok(sbom.telemetry?.verifications?.total === 2);
  assert.equal(sbom.telemetry?.verifications?.passRate, 100);
  assert.equal(sbom.telemetry?.confirmations?.total, 1);
  assert.equal(sbom.telemetry?.evals?.total, 1);
});

test('sbom export --format cyclonedx produces valid CycloneDX 1.5 JSON', () => {
  const tmp = makeTmp('flow-kit-sbom-cdx-');
  const target = setupTargetProject(tmp);
  const cdxOut = path.join(target, 'sbom.cdx.json');

  const r = runCli(target, [
    'sbom', 'export',
    '--format', 'cyclonedx',
    '--out', cdxOut,
    '--target', '.',
    '--json',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const res = json(r);
  assert.equal(res.ok, true);
  assert.equal(res.format, 'cyclonedx');

  const cdx = JSON.parse(fs.readFileSync(cdxOut, 'utf8'));
  assert.equal(cdx.bomFormat, 'CycloneDX');
  assert.equal(cdx.specVersion, '1.5');
  assert.match(cdx.serialNumber, /^urn:uuid:[0-9a-f-]+/i);
  assert.ok(Array.isArray(cdx.components));
  assert.ok(cdx.components.some((c) => c.type === 'framework' && c.name === 'agentic-flow-kit'));
  assert.ok(cdx.components.some((c) => c.type === 'platform' && c.name === 'ai-host-claude'));
  assert.ok(cdx.components.some((c) => c.type === 'data' && c.name.startsWith('ai-skill-')));
  assert.ok(cdx.components.some((c) => c.type === 'machine-learning-model'));
  assert.ok(cdx.properties?.some((p) => p.name === 'flow-kit:proofChainRoot'));
});

test('sbom export --format spdx produces valid SPDX 2.3 JSON', () => {
  const tmp = makeTmp('flow-kit-sbom-spdx-');
  const target = setupTargetProject(tmp);
  const spdxOut = path.join(target, 'sbom.spdx.json');

  const r = runCli(target, [
    'sbom', 'export',
    '--format', 'spdx',
    '--out', spdxOut,
    '--target', '.',
    '--json',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const res = json(r);
  assert.equal(res.ok, true);
  assert.equal(res.format, 'spdx');

  const spdx = JSON.parse(fs.readFileSync(spdxOut, 'utf8'));
  assert.equal(spdx.spdxVersion, 'SPDX-2.3');
  assert.equal(spdx.dataLicense, 'CC0-1.0');
  assert.equal(spdx.SPDXID, 'SPDXRef-DOCUMENT');
  assert.ok(Array.isArray(spdx.packages));
  assert.ok(spdx.packages.some((p) => p.SPDXID === 'SPDXRef-Package-agentic-flow-kit'));
  assert.ok(spdx.packages.some((p) => p.SPDXID.startsWith('SPDXRef-Skill-')));
  assert.ok(Array.isArray(spdx.relationships));
  assert.ok(spdx.relationships.some((rel) => rel.relationshipType === 'DESCRIBES'));
});

test('sbom verify passes for untampered project and catches tampering', () => {
  const tmp = makeTmp('flow-kit-sbom-verify-');
  const target = setupTargetProject(tmp);
  const sbomFile = path.join(target, 'sbom.json');

  // Export native SBOM
  runCli(target, ['sbom', 'export', '--out', sbomFile, '--target', '.']);

  // 1. Untampered verify passes
  const rOk = runCli(target, ['sbom', 'verify', sbomFile, '--target', '.', '--json']);
  assert.equal(rOk.status, 0, rOk.stderr);
  const resOk = json(rOk);
  assert.equal(resOk.ok, true);
  assert.equal(resOk.problems.length, 0);

  // 2. Tamper: modify a skill file on disk
  const firstSkillDir = fs.readdirSync(path.join(target, '.agents', 'skills'))[0];
  const skillMd = path.join(target, '.agents', 'skills', firstSkillDir, 'SKILL.md');
  fs.appendFileSync(skillMd, '\n<!-- tampered content -->');

  const rBad = runCli(target, ['sbom', 'verify', sbomFile, '--target', '.', '--json']);
  assert.notEqual(rBad.status, 0, 'verification should fail when skill is tampered');
  const resBad = json(rBad);
  assert.equal(resBad.ok, false);
  assert.ok(resBad.problems.some((p) => p.includes('modified') || p.includes('篡改') || p.includes('校验失败')));
});

test('doctor automatically verifies .agents/sbom.json when present', () => {
  const tmp = makeTmp('flow-kit-sbom-doctor-');
  const target = setupTargetProject(tmp);
  const autoSbom = path.join(target, '.agents', 'sbom.json');

  // Export directly to .agents/sbom.json
  runCli(target, ['sbom', 'export', '--out', autoSbom, '--target', '.']);

  // Doctor passes with sbom check
  const rDoc1 = runCli(target, ['doctor', '--target', '.', '--json']);
  assert.equal(rDoc1.status, 0, rDoc1.stderr);
  const doc1 = json(rDoc1);
  const sbomCheck1 = doc1.checks.find((c) => c.name === 'sbom');
  assert.ok(sbomCheck1, 'doctor should execute sbom check');
  assert.equal(sbomCheck1.ok, true);

  // Tamper with policy.json
  const policyFile = path.join(target, '.agents', 'config', 'policy.json');
  fs.writeFileSync(policyFile, JSON.stringify({ tampered: true }), 'utf8');

  // Doctor fails sbom check
  const rDoc2 = runCli(target, ['doctor', '--target', '.', '--json']);
  assert.notEqual(rDoc2.status, 0, 'doctor should fail when sbom tampered');
  const doc2 = json(rDoc2);
  const sbomCheck2 = doc2.checks.find((c) => c.name === 'sbom');
  assert.ok(sbomCheck2);
  assert.equal(sbomCheck2.ok, false);
});

test('sbom commands output localized English text with --lang en', () => {
  const tmp = makeTmp('flow-kit-sbom-en-');
  const target = setupTargetProject(tmp);
  const sbomFile = path.join(target, 'en-sbom.json');

  // Human-readable export output in English
  const rExport = runCli(target, [
    'sbom', 'export',
    '--out', sbomFile,
    '--target', '.',
    '--lang', 'en',
  ]);
  assert.equal(rExport.status, 0, rExport.stderr);
  assert.match(rExport.stdout, /Exported AI Software Bill of Materials:/);

  // Human-readable verify output in English
  const rVerify = runCli(target, [
    'sbom', 'verify', sbomFile,
    '--target', '.',
    '--lang', 'en',
  ]);
  assert.equal(rVerify.status, 0, rVerify.stderr);
  assert.match(rVerify.stdout, /AI Software Bill of Materials integrity verified:/);
});
