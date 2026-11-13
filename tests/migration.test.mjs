import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readManifest, writeManifest } from '../src/install/manifest.mjs';
import { loadMigrations, migrateManifest } from '../src/install/migrations.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-migration-'));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
  return dir;
}

function oldManifest() {
  return {
    kit: 'agentic-flow-kit',
    version: '2.1.0',
    language: 'zh-CN',
    hosts: ['claude'],
    stack: 'node',
    files: {},
  };
}

test('default migrations include the 0→1 schema initialization', async () => {
  const migrations = await loadMigrations();
  assert.equal(migrations.length >= 1, true);
  assert.deepEqual(
    migrations.slice(0, 1).map(({ from, to }) => [from, to]),
    [[0, 1]],
  );
});

test('migrateManifest upgrades an old manifest, is idempotent, and supports dry-run', async () => {
  const dir = tmpRepo();
  writeManifest(dir, oldManifest());
  const first = await migrateManifest({ target: dir, manifest: readManifest(dir) });
  assert.equal(first.changed, true);
  assert.deepEqual(first.applied, ['0-1']);
  assert.equal(readManifest(dir).schemaVersion, 1);

  const second = await migrateManifest({ target: dir, manifest: readManifest(dir) });
  assert.equal(second.changed, false);
  assert.deepEqual(second.applied, []);

  writeManifest(dir, oldManifest());
  const dry = await migrateManifest({ target: dir, manifest: readManifest(dir), dryRun: true });
  assert.equal(dry.changed, true);
  assert.equal(dry.dryRun, true);
  assert.equal(readManifest(dir).schemaVersion, undefined);
});

test('migration failures do not write the manifest', async () => {
  const dir = tmpRepo();
  writeManifest(dir, oldManifest());
  const before = fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8');
  const migrations = [{
    file: '0-1.mjs',
    from: 0,
    to: 1,
    migrate: () => { throw new Error('boom'); },
  }];
  await assert.rejects(
    () => migrateManifest({ target: dir, manifest: readManifest(dir), migrations }),
    (error) => error.code === 'MIGRATION_FAILED' && /boom/.test(error.message),
  );
  assert.equal(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8'), before);
});

test('a future manifest schema is rejected', async () => {
  const dir = tmpRepo();
  writeManifest(dir, { ...oldManifest(), schemaVersion: 99 });
  await assert.rejects(
    () => migrateManifest({ target: dir, manifest: readManifest(dir) }),
    (error) => error.code === 'MANIFEST_SCHEMA' && error.version === 99,
  );
});

test('upgrade migrates an old manifest without touching user files', () => {
  const dir = tmpRepo();
  const install = spawnSync(process.execPath, [BIN, 'install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(install.status, 0, install.stderr);
  fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'notes/user.txt'), 'keep me\n', 'utf8');

  const manifestFile = path.join(dir, '.agents/install-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  delete manifest.schemaVersion;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const dry = spawnSync(process.execPath, [BIN, 'upgrade', '--target', '.', '--dry-run', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(dry.status, 0, dry.stderr);
  const dryOut = JSON.parse(dry.stdout);
  assert.deepEqual(dryOut.migration.applied, ['0-1']);
  assert.equal(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).schemaVersion, undefined);

  const real = spawnSync(process.execPath, [BIN, 'upgrade', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(real.status, 0, real.stderr);
  assert.equal(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).schemaVersion, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'notes/user.txt'), 'utf8'), 'keep me\n');

  const again = spawnSync(process.execPath, [BIN, 'upgrade', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).migration, undefined);
});
