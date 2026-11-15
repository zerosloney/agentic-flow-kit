import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-ci-');
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

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function manifest(dir) {
  return JSON.parse(read(dir, '.agents/install-manifest.json'));
}

test('--ci azure installs only the azure pipeline and diff stays strict-clean', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--ci', 'azure', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'azure-pipelines.yml')));
  assert.equal(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')), false);
  assert.equal(manifest(dir).ci, 'azure');
  const diff = run(['diff', '--all', '--strict', '--target', '.'], dir);
  assert.equal(diff.status, 0, `${diff.stdout}${diff.stderr}`);
  assert.doesNotMatch(diff.stdout, /\.github\/workflows\/ci\.yml/);
});

test('--ci github installs only the github workflow and upgrade replays the choice', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--ci', 'github', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')));
  assert.equal(fs.existsSync(path.join(dir, 'azure-pipelines.yml')), false);
  assert.equal(manifest(dir).ci, 'github');
  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'azure-pipelines.yml')), false);
  assert.ok(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')));
  assert.equal(manifest(dir).ci, 'github');
});

test('--ci none installs no CI and doctor reports it as disabled', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--ci', 'none', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'azure-pipelines.yml')), false);
  assert.equal(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')), false);
  const diff = run(['diff', '--all', '--strict', '--target', '.'], dir);
  assert.equal(diff.status, 0, `${diff.stdout}${diff.stderr}`);
  const doctor = run(['doctor', '--target', '.'], dir);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /CI 未安装（--ci none）|CI not installed \(--ci none\)/);
});

test('--ci overrides the tier default (lean + github still installs CI)', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--tier', 'lean', '--ci', 'github', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')));
  assert.equal(fs.existsSync(path.join(dir, 'azure-pipelines.yml')), false);
  assert.equal(manifest(dir).ci, 'github');
});

test('invalid --ci value fails the install', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--ci', 'bogus', '--target', '.'], dir);
  assert.notEqual(r.status, 0);
  assert.match(`${r.stdout}${r.stderr}`, /--ci/);
});

test('enterprise with --ci github satisfies the CI policy check', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--tier', 'enterprise', '--ci', 'github', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'azure-pipelines.yml')), false);
  const doctor = run(['doctor', '--target', '.', '--json'], dir);
  assert.equal(doctor.status, 0, doctor.stderr);
  const out = JSON.parse(doctor.stdout);
  assert.equal(out.summary.failed, 0, JSON.stringify(out.checks.filter((c) => !c.ok)));
  assert.equal(out.checks.find((c) => c.name === 'enterprise policy').ok, true);
  assert.match(out.checks.find((c) => c.name === 'enterprise policy').detail, /ci/);
});
