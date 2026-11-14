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
  const dir = makeTmp('flow-kit-adopt-');
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

function install(dir, hosts, extra = []) {
  const agents = hosts.flatMap((host) => ['--agent', host]);
  const r = run(['install', ...agents, '--lang', 'zh-CN', '--stack', 'node', '--target', '.', ...extra], dir);
  assert.equal(r.status, 0, r.stderr);
  return r;
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function manifestOf(dir) {
  return JSON.parse(read(dir, '.agents/install-manifest.json'));
}

function json(r) {
  assert.equal(r.stdout.trim().startsWith('{'), true, `expected JSON, got: ${r.stdout.slice(0, 200)}`);
  return JSON.parse(r.stdout);
}

test('adopt reconstructs the manifest and leaves no drift', () => {
  const dir = tmpRepo();
  install(dir, ['claude', 'trae']);
  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));

  const r = run(['adopt', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.deepEqual(out.hosts, ['claude', 'trae']);
  assert.equal(out.language, 'zh-CN');
  assert.equal(out.stack, 'node');
  assert.ok(out.adopted.length > 0);
  assert.deepEqual(out.modified, []);
  assert.deepEqual(out.missing, []);
  assert.ok(out.derived.includes('workflow/INDEX.md'));
  assert.ok(out.manifest);

  const manifest = manifestOf(dir);
  assert.equal(Object.keys(manifest.files).length, out.adopted.length);
  assert.deepEqual(manifest.hosts, ['claude', 'trae']);
  assert.ok(manifest.derived.includes('workflow/INDEX.md'));

  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.total, diff.summary.unchanged);

  const upgrade = run(['upgrade', '--target', '.', '--json'], dir);
  assert.equal(upgrade.status, 0, upgrade.stderr);
  const after = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(after.summary.userModified, 0);
  assert.equal(after.summary.kitUpdated, 0);
});

test('adopt is idempotent', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));

  const first = json(run(['adopt', '--target', '.', '--json'], dir));
  const firstManifest = manifestOf(dir);
  const second = json(run(['adopt', '--target', '.', '--json'], dir));

  assert.deepEqual(second.adopted.sort(), first.adopted.sort());
  assert.deepEqual(second.modified, first.modified);
  assert.deepEqual(second.missing, first.missing);
  assert.deepEqual(manifestOf(dir), firstManifest);
});

test('adopt --dry-run writes nothing', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));

  const r = run(['adopt', '--target', '.', '--dry-run', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.ok(out.adopted.length > 0);
  assert.equal(out.manifest, null);
  assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false);
});

test('modified and missing files are reported but not adopted', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  fs.appendFileSync(path.join(dir, '.agents/commands/new-task.md'), '\nuser edit\n', 'utf8');
  fs.rmSync(path.join(dir, '.agents/commands/review.md'));
  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));

  const r = run(['adopt', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.ok(out.modified.some((item) => item.path === '.agents/commands/new-task.md'));
  assert.ok(out.missing.includes('.agents/commands/review.md'));

  const manifest = manifestOf(dir);
  assert.equal('.agents/commands/new-task.md' in manifest.files, false);
  assert.equal('.agents/commands/review.md' in manifest.files, false);
  assert.match(read(dir, '.agents/commands/new-task.md'), /user edit/);
});

test('unrecognized files are reported and left unmanaged', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  fs.writeFileSync(path.join(dir, '.trae/commands/custom.md'), '# custom\n', 'utf8');
  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));

  const out = json(run(['adopt', '--target', '.', '--json'], dir));
  assert.ok(out.unrecognized.includes('.trae/commands/custom.md'));
  assert.equal('.trae/commands/custom.md' in manifestOf(dir).files, false);
});

test('adopt with nothing recognizable exits 1 and writes no manifest', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'notes.md'), '# notes\n', 'utf8');
  const r = run(['adopt', '--agent', 'trae', '--target', '.', '--json'], dir);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(json(r).manifest, null);
  assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false);
});
