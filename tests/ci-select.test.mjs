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

test('--ci gitlab installs only the gitlab-ci pipeline and upgrade replays the choice', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--ci', 'gitlab', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.gitlab-ci.yml')));
  assert.equal(fs.existsSync(path.join(dir, 'azure-pipelines.yml')), false);
  assert.equal(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')), false);
  assert.equal(manifest(dir).ci, 'gitlab');
  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'azure-pipelines.yml')), false);
  assert.equal(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')), false);
  assert.ok(fs.existsSync(path.join(dir, '.gitlab-ci.yml')));
  assert.equal(manifest(dir).ci, 'gitlab');
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

function addOrigin(dir, url) {
  spawnSync('git', ['remote', 'add', 'origin', url], { cwd: dir });
}

test('github origin installs only the github workflow', () => {
  const dir = tmpRepo();
  addOrigin(dir, 'https://github.com/example/repo.git');
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')));
  assert.equal(fs.existsSync(path.join(dir, 'azure-pipelines.yml')), false);
  assert.equal(manifest(dir).ci, 'github');
});

test('azure origin installs only the azure pipeline', () => {
  const dir = tmpRepo();
  addOrigin(dir, 'https://dev.azure.com/org/project/_git/repo');
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'azure-pipelines.yml')));
  assert.equal(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')), false);
  assert.equal(manifest(dir).ci, 'azure');
});

test('gitlab origin installs only the gitlab pipeline', () => {
  const dir = tmpRepo();
  addOrigin(dir, 'https://gitlab.com/example/repo.git');
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.gitlab-ci.yml')));
  assert.equal(fs.existsSync(path.join(dir, 'azure-pipelines.yml')), false);
  assert.equal(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')), false);
  assert.equal(manifest(dir).ci, 'gitlab');
});

test('unrecognized origin installs no CI', () => {
  const dir = tmpRepo();
  addOrigin(dir, 'https://git.internal-corp.local/example/repo.git');
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'azure-pipelines.yml')), false);
  assert.equal(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')), false);
  assert.equal(fs.existsSync(path.join(dir, '.gitlab-ci.yml')), false);
  assert.equal(manifest(dir).ci, 'none');
});

// 模拟 ≤2.10 的旧 manifest：没有 ci 字段，交付面只能从 files 推断。
function stripCiField(dir) {
  const m = manifest(dir);
  delete m.ci;
  fs.writeFileSync(path.join(dir, '.agents/install-manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
}

test('legacy manifest without ci keeps both CI files on upgrade despite a github origin', () => {
  const dir = tmpRepo();
  addOrigin(dir, 'https://github.com/example/repo.git');
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--ci', 'both', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  stripCiField(dir);
  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.equal(manifest(dir).ci, 'both');
  assert.ok('azure-pipelines.yml' in manifest(dir).files);
  assert.ok('.github/workflows/ci.yml' in manifest(dir).files);
  assert.ok(fs.existsSync(path.join(dir, 'azure-pipelines.yml')));
  assert.ok(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')));
  const diff = run(['diff', '--all', '--strict', '--target', '.'], dir);
  assert.equal(diff.status, 0, `${diff.stdout}${diff.stderr}`);
});

test('legacy lean manifest without ci stays CI-free on upgrade', () => {
  const dir = tmpRepo();
  addOrigin(dir, 'https://github.com/example/repo.git');
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--tier', 'lean', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(manifest(dir).ci, undefined);
  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'azure-pipelines.yml')), false);
  assert.equal(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')), false);
  assert.ok(['none', undefined].includes(manifest(dir).ci));
});

test('legacy manifest with only the azure pipeline replays azure and adds no github CI', () => {
  const dir = tmpRepo();
  addOrigin(dir, 'https://github.com/example/repo.git');
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--ci', 'azure', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  stripCiField(dir);
  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.equal(manifest(dir).ci, 'azure');
  assert.ok(fs.existsSync(path.join(dir, 'azure-pipelines.yml')));
  assert.equal(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')), false);
  assert.equal('.github/workflows/ci.yml' in manifest(dir).files, false);
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
