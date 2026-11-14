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
  const dir = makeTmp('flow-kit-attest-');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
  const r = spawnSync(process.execPath, [BIN, 'install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

function doctor(dir, args) {
  return spawnSync(process.execPath, [BIN, 'doctor', '--target', '.', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function json(r) {
  assert.equal(r.stdout.trim().startsWith('{'), true, `expected JSON, got: ${r.stdout.slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

test('doctor --attest writes a deterministic proof file and reports the chain', () => {
  const dir = installTarget();
  const proof = path.join(dir, 'proof.json');
  const r = doctor(dir, ['--attest', '--out', proof, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.equal(out.ok, true);
  assert.equal(out.attestation.ok, true);
  assert.equal(out.attestation.schema, 'flow-kit-attest/v1');
  assert.equal(out.attestation.policy.version, 1);
  assert.match(out.attestation.chain.root, /^[0-9a-f]{64}$/);
  assert.ok(out.attestation.manifest.files > 100);

  const written = JSON.parse(fs.readFileSync(proof, 'utf8'));
  assert.deepEqual(written, out.attestation);
});

test('attestation output is deterministic and binds eval digests when present', () => {
  const dir = installTarget();
  fs.mkdirSync(path.join(dir, '.agents/evals'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents/evals/results.jsonl'), '{"ts":"2026-01-01T00:00:00Z","exitCode":0}\n{"ts":"2026-01-02T00:00:00Z","exitCode":1}\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.agents/evals/eval-log.json'), `${JSON.stringify({
    version: 1,
    updatedAt: '2026-01-02T00:00:00.000Z',
    entries: [{ ts: '2026-01-02T00:00:00.000Z', signature: 'x', passRate: 1, tasks: 5, model: 'm', note: '', threshold: 0.8, outcome: 'pass' }],
  }, null, 2)}\n`, 'utf8');

  const one = path.join(dir, 'proof-1.json');
  const two = path.join(dir, 'proof-2.json');
  assert.equal(doctor(dir, ['--attest', '--out', one, '--json']).status, 0);
  assert.equal(doctor(dir, ['--attest', '--out', two, '--json']).status, 0);
  assert.equal(fs.readFileSync(one, 'utf8'), fs.readFileSync(two, 'utf8'));

  const out = JSON.parse(fs.readFileSync(one, 'utf8'));
  assert.equal(out.evals.results.present, true);
  assert.equal(out.evals.results.lines, 2);
  assert.equal(out.evals.evalLog.entries, 1);
  assert.match(out.evals.results.digest, /^[0-9a-f]{64}$/);
});

test('attestation detects a tampered managed file and still archives the proof', () => {
  const dir = installTarget();
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\ntampered\n', 'utf8');
  const proof = path.join(dir, 'tampered-proof.json');
  const r = doctor(dir, ['--attest', '--out', proof, '--json']);
  assert.equal(r.status, 1);
  const out = json(r);
  assert.equal(out.attestation.ok, false);
  assert.ok(out.attestation.problems.some((problem) => problem.includes('AGENTS.md')));
  assert.equal(fs.existsSync(proof), true);
  assert.equal(JSON.parse(fs.readFileSync(proof, 'utf8')).ok, false);
});
