import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-diff-'));
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

function install(dir, extra = []) {
  const r = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.', ...extra], dir);
  assert.equal(r.status, 0, r.stderr);
  return r;
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function readManifest(dir) {
  return JSON.parse(read(dir, '.agents/install-manifest.json'));
}

function writeManifest(dir, value) {
  fs.writeFileSync(
    path.join(dir, '.agents/install-manifest.json'),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function diffJson(dir, extra = []) {
  const r = run(['diff', '--target', '.', '--json', ...extra], dir);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function itemOf(result, rel) {
  const item = result.items.find((entry) => entry.targetRel === rel);
  assert.ok(item, `missing diff item for ${rel}`);
  return item;
}

test('fresh install has no drift', () => {
  const dir = tmpRepo();
  install(dir);
  const result = diffJson(dir);
  assert.equal(result.summary.userModified, 0);
  assert.equal(result.summary.kitUpdated, 0);
  assert.equal(result.summary.orphan, 0);
  assert.equal(result.summary.missing, 0);
  assert.ok(result.summary.unchanged > 100, 'expected the full managed surface to be unchanged');
  for (const item of result.items) {
    assert.equal(item.kind, 'unchanged', item.targetRel);
    assert.equal(item.managed, true, item.targetRel);
    assert.equal(item.actualHash, item.managedHash, item.targetRel);
  }
});

test('diff reports user-modified, missing and orphan entries', () => {
  const dir = tmpRepo();
  install(dir);
  const modified = '.agents/commands/new-task.md';
  fs.appendFileSync(path.join(dir, modified), '\n<!-- user edit -->\n', 'utf8');
  const missing = '.agents/commands/review.md';
  fs.rmSync(path.join(dir, missing));
  const manifest = readManifest(dir);
  manifest.files['legacy/old.md'] = '0'.repeat(64);
  writeManifest(dir, manifest);
  fs.mkdirSync(path.join(dir, 'legacy'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'legacy/old.md'), 'orphan\n', 'utf8');

  const result = diffJson(dir);
  const user = itemOf(result, modified);
  assert.equal(user.kind, 'user-modified');
  assert.notEqual(user.actualHash, user.managedHash);
  assert.equal(user.kitChanged, false);
  const gone = itemOf(result, missing);
  assert.equal(gone.kind, 'missing');
  assert.equal(gone.actualHash, null);
  assert.equal(typeof gone.managedHash, 'string');
  const orphan = itemOf(result, 'legacy/old.md');
  assert.equal(orphan.kind, 'orphan');
  assert.equal(orphan.managed, true);
  assert.equal(typeof orphan.actualHash, 'string');
  assert.equal(result.summary.userModified, 1);
  assert.equal(result.summary.missing, 1);
  assert.equal(result.summary.orphan, 1);
});

test('diff reports kit-updated when the current template differs from the installed hash', () => {
  const dir = tmpRepo();
  install(dir);
  const manifest = readManifest(dir);
  manifest.language = 'en';
  writeManifest(dir, manifest);

  const result = diffJson(dir);
  assert.ok(result.summary.kitUpdated > 0, 'language switch should surface template updates');
  const engine = itemOf(result, '.agents/config/engine.json');
  assert.equal(engine.kind, 'kit-updated');
  assert.equal(engine.kitChanged, true);
  assert.equal(engine.actualHash, engine.managedHash);
  assert.notEqual(engine.expectedHash, engine.managedHash);
});

test('diff JSON exposes stable fields', () => {
  const dir = tmpRepo();
  install(dir);
  const result = diffJson(dir);
  assert.equal(result.target, dir);
  assert.equal(typeof result.kitVersion, 'string');
  assert.deepEqual(result.manifest.hosts, ['trae']);
  assert.equal(result.manifest.stack, 'node');
  assert.equal(result.manifest.language, 'zh-CN');
  assert.equal(result.summary.total, result.items.length);
  const item = itemOf(result, '.agents/commands/new-task.md');
  assert.equal(typeof item.targetRel, 'string');
  assert.equal(typeof item.kind, 'string');
  assert.ok('managedHash' in item);
  assert.ok('actualHash' in item);
  assert.ok('expectedHash' in item);
  assert.equal(typeof item.category, 'string');
});

test('diff is read-only and supports --all', () => {
  const dir = tmpRepo();
  install(dir);
  const before = read(dir, '.agents/commands/new-task.md');
  const plain = run(['diff', '--target', '.'], dir);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /没有差异/);
  assert.equal(read(dir, '.agents/commands/new-task.md'), before);

  const all = run(['diff', '--target', '.', '--all'], dir);
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /未变 \.agents\/commands\/new-task\.md/);
  assert.equal(read(dir, '.agents/commands/new-task.md'), before);
});

test('status summarizes the installed surface', () => {
  const dir = tmpRepo();
  install(dir);
  const json = run(['status', '--target', '.', '--json'], dir);
  assert.equal(json.status, 0, json.stderr);
  const status = JSON.parse(json.stdout);
  assert.equal(status.manifest.stack, 'node');
  assert.equal(status.manifest.language, 'zh-CN');
  assert.deepEqual(status.manifest.hosts, ['trae']);
  assert.equal(status.summary.total, status.summary.unchanged);

  const human = run(['status', '--target', '.'], dir);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /安装状态/);
  assert.match(human.stdout, /语言=zh-CN/);
  assert.match(human.stdout, /宿主：trae/);
});

test('diff without a manifest exits 3', () => {
  const dir = tmpRepo();
  const r = run(['diff', '--target', '.'], dir);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /install/);
});

test('doctor surfaces manifest drift as advisory', () => {
  const dir = tmpRepo();
  install(dir);

  const clean = JSON.parse(run(['doctor', '--target', '.', '--json'], dir).stdout);
  assert.equal(clean.checks.some((c) => c.name === 'manifest drift'), false);

  fs.appendFileSync(path.join(dir, '.agents/commands/new-task.md'), '\nuser edit\n', 'utf8');
  const drifted = run(['doctor', '--target', '.', '--json'], dir);
  assert.equal(drifted.status, 0, drifted.stderr);
  const out = JSON.parse(drifted.stdout);
  const check = out.checks.find((c) => c.name === 'manifest drift');
  assert.ok(check, 'drift check should be present');
  assert.equal(check.ok, true);
  assert.equal(check.warn, true);
  assert.match(check.detail, /用户修改 1/);
  assert.equal(out.ok, true, 'drift is advisory, not a failure');

  const human = run(['doctor', '--target', '.'], dir);
  assert.match(human.stdout, /! manifest drift/);
});

test('diff output is localized in English', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'trae', '--lang', 'en', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  const diff = run(['diff', '--target', '.'], dir);
  assert.equal(diff.status, 0, diff.stderr);
  assert.match(diff.stdout, /Managed file diff:/);
  assert.match(diff.stdout, /No differences\./);
  assert.match(diff.stdout, /Total \d+: unchanged/);
});

