import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOSTS } from '../src/hosts/registry.mjs';
import { readManifest } from '../src/install/manifest.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const FIXTURES = path.join(KIT, 'tests', 'fixtures', 'enterprise');
const HOSTS_ALL = ['claude', 'qwen', 'qoder', 'commandcode', 'codebuddy', 'trae', 'zcode', 'opencode', 'pi', 'cline'];

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-enterprise-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function json(r) {
  assert.equal(r.stdout.trim().startsWith('{'), true, `expected JSON, got: ${r.stdout.slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

function install(dir, host, extra = []) {
  return run(['install', '--agent', host, '--stack', 'node', '--target', '.', '--json', ...extra], dir);
}

function configRel(host) {
  const h = HOSTS[host];
  return h.hooks ? `${h.dir}/${h.hooks.file}` : null;
}

function descriptor(host, dir, level) {
  const rel = configRel(host);
  let text = '';
  if (rel) {
    try {
      text = fs.readFileSync(path.join(dir, rel), 'utf8');
    } catch {
      text = '';
    }
  }
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return {
    level,
    hooks: text.includes('"PreToolUse"'),
    permissions: Boolean(parsed?.permissions),
    sandbox: Boolean(parsed?.sandbox),
    hardenedRules: /WebFetch|Read\(|curl/.test(text),
  };
}

test('enterprise snapshot: every config-capable host has a verified hardening posture', () => {
  const dir = tmpRepo();
  for (const host of HOSTS_ALL) {
    const r = install(dir, host, ['--tier', 'enterprise']);
    assert.equal(r.status, 0, `${host}: ${r.stderr}`);
  }
  const manifest = readManifest(dir);
  assert.equal(manifest.tier, 'enterprise');
  assert.equal(manifest.hardened, true);
  for (const host of HOSTS_ALL) {
    const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${host}.json`), 'utf8'));
    assert.deepEqual(descriptor(host, dir, manifest.enterprise.hosts[host]), expected, host);
  }
});

test('manifest records the actual matrix and doctor shows tier, posture and gaps', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'claude', ['--tier', 'enterprise']).status, 0);
  assert.equal(install(dir, 'qwen', ['--tier', 'enterprise']).status, 0);
  assert.equal(install(dir, 'codebuddy', ['--tier', 'enterprise']).status, 0);
  const manifest = readManifest(dir);
  const e = manifest.enterprise;
  assert.equal(e.posture, 'hardened');
  assert.deepEqual(e.hosts, { claude: 'managed', qwen: 'permissions', codebuddy: 'hooks' });
  assert.deepEqual(e.gaps, ['codebuddy']);
  assert.equal(e.proofChain, true);
  assert.deepEqual(e.policyChecks, ['githooks', 'ci', 'permissions']);

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.summary.failed, 0, JSON.stringify(doctor.checks.filter((c) => !c.ok)));
  const posture = doctor.checks.find((c) => c.name === 'enterprise');
  assert.ok(posture);
  assert.match(posture.detail, /enterprise/);
  assert.match(posture.detail, /hardened/);
  assert.match(posture.detail, /claude:managed/);
  assert.match(posture.detail, /codebuddy/);
  assert.equal(doctor.checks.find((c) => c.name === 'enterprise gaps').warn, true);
  assert.equal(doctor.checks.find((c) => c.name === 'enterprise proof-chain').ok, true);
  assert.equal(doctor.checks.find((c) => c.name === 'enterprise policy').ok, true);
});

test('default tiers are unchanged and enterprise can be switched on and off', () => {
  const dir = tmpRepo();
  const out = json(install(dir, 'claude'));
  assert.equal('enterprise' in out, false);
  assert.equal(readManifest(dir).enterprise, undefined);
  assert.equal(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8').includes('Read(.env*)'), false);
  let doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.checks.some((c) => c.name === 'enterprise'), false);

  const upgraded = json(run(['upgrade', '--target', '.', '--tier', 'enterprise', '--json'], dir));
  assert.equal(upgraded.enterprise.posture, 'hardened');
  assert.equal(readManifest(dir).enterprise.posture, 'hardened');
  assert.ok(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8').includes('Read(.env*)'));

  assert.equal(run(['upgrade', '--target', '.', '--tier', 'standard', '--json'], dir).status, 0);
  assert.equal(readManifest(dir).enterprise, undefined);
  doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.checks.some((c) => c.name === 'enterprise'), false);
});

test('removing a host refreshes the enterprise matrix', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'claude', ['--tier', 'enterprise']).status, 0);
  assert.equal(install(dir, 'qwen', ['--tier', 'enterprise']).status, 0);
  assert.equal(run(['remove-host', 'qwen', '--target', '.', '--json'], dir).status, 0);
  const manifest = readManifest(dir);
  assert.deepEqual(manifest.enterprise.hosts, { claude: 'managed' });
  assert.deepEqual(manifest.enterprise.gaps, []);
});

test('hardened manifests without an enterprise record are recomputed by doctor', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'claude', ['--tier', 'enterprise']).status, 0);
  const manifest = readManifest(dir);
  delete manifest.enterprise;
  fs.writeFileSync(path.join(dir, '.agents/install-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.summary.failed, 0);
  assert.equal(doctor.checks.some((c) => c.name === 'enterprise'), true);
});
