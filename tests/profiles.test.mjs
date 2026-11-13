import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dedupeEntries } from '../src/install/plan.mjs';
import { parseProfileArgs, SURFACES } from '../src/install/profiles.mjs';
import { makeT } from '../src/i18n.mjs';
import { buildInstallArgs } from '../src/tui/wizard.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const t = makeT('zh-CN');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-profile-'));
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

function install(dir, stackArgs, extra = []) {
  return run(['install', '--agent', 'claude', '--stack', stackArgs, '--target', '.', '--json', ...extra], dir);
}

test('parseProfileArgs accepts stack+surface and --surface, dedupes and rejects unknown surfaces', () => {
  assert.deepEqual(parseProfileArgs({ stackArg: 'dotnet+frontend', surfaceArgs: ['api'], t }), {
    stack: 'dotnet',
    surfaces: ['frontend', 'api'],
  });
  assert.deepEqual(parseProfileArgs({ surfaceArgs: ['api,frontend', 'api'], fallbackSurfaces: ['data'], t }), {
    stack: null,
    surfaces: ['api', 'frontend'],
  });
  assert.deepEqual(parseProfileArgs({ surfaceArgs: [], fallbackSurfaces: ['frontend'], t }).surfaces, ['frontend']);
  assert.throws(
    () => parseProfileArgs({ surfaceArgs: ['mobile'], t }),
    (err) => err.code === 'BAD_SURFACE' && /frontend, api, data/.test(err.message),
  );
  assert.deepEqual(SURFACES, ['frontend', 'api', 'data']);
});

test('same-name profile files resolve deterministically: later layer wins', () => {
  const entry = (targetRel, priority, source) => ({ targetRel, priority, source });
  const layers = [
    entry('AGENTS.md', 20, 'stack'),
    entry('AGENTS.md', 21, 'frontend'),
    entry('AGENTS.md', 22, 'api'),
  ];
  assert.equal(dedupeEntries(layers).find((e) => e.targetRel === 'AGENTS.md').source, 'api');
  assert.equal(dedupeEntries([...layers].reverse()).find((e) => e.targetRel === 'AGENTS.md').source, 'api');
  // 不同 targetRel 全部保留
  assert.equal(dedupeEntries([...layers, entry('X.md', 21, 'frontend')]).length, 2);
});

test('dotnet + frontend stacks surface files and records the composition', () => {
  const dir = tmpRepo();
  const r = install(dir, 'dotnet+frontend', ['--surface', 'api']);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.equal(out.stack, 'dotnet');
  assert.deepEqual(out.surfaces, ['frontend', 'api']);

  assert.ok(fs.existsSync(path.join(dir, '.agents/notes/frontend-surface.md')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/notes/api-surface.md')));
  assert.equal(fs.existsSync(path.join(dir, '.agents/notes/data-surface.md')), false);

  const profile = JSON.parse(fs.readFileSync(path.join(dir, '.agents/config/profile.json'), 'utf8'));
  assert.deepEqual(profile, {
    kit: 'agentic-flow-kit',
    version: profile.version,
    stack: 'dotnet',
    surfaces: ['frontend', 'api'],
    profiles: ['dotnet', 'frontend', 'api'],
  });

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.surfaces, ['frontend', 'api']);
  assert.equal(manifest.stack, 'dotnet');

  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.unchanged, diff.summary.total);

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.summary.failed, 0, JSON.stringify(doctor.checks.filter((c) => !c.ok)));
  assert.ok(doctor.checks.some((c) => c.name === 'profile composition' && c.ok));
});

test('single-stack installs are unchanged (no extra profile files)', () => {
  const dir = tmpRepo();
  const r = install(dir, 'node');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(json(r).surfaces, []);
  assert.equal(fs.existsSync(path.join(dir, '.agents/config/profile.json')), false);
  assert.equal(fs.existsSync(path.join(dir, '.agents/notes/frontend-surface.md')), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.surfaces, []);
});

test('unknown surface fails with usage exit and writes nothing', () => {
  const dir = tmpRepo();
  const r = install(dir, 'node', ['--surface', 'mobile']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /无效的 surface/);
  assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false);
});

test('upgrade and adopt preserve the recorded composition', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'dotnet+frontend').status, 0);

  const upgrade = json(run(['upgrade', '--target', '.', '--json'], dir));
  assert.deepEqual(upgrade.surfaces, ['frontend']);

  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));
  const adopt = json(run(['adopt', '--target', '.', '--json'], dir));
  assert.deepEqual(adopt.surfaces, ['frontend']);
  assert.deepEqual(adopt.modified, []);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.surfaces, ['frontend']);
});

test('doctor flags a composition record that disagrees with the manifest', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'node+data').status, 0);
  const file = path.join(dir, '.agents/config/profile.json');
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  profile.surfaces = ['api'];
  fs.writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  const check = doctor.checks.find((c) => c.name === 'profile composition');
  assert.equal(check.ok, false);
  assert.match(check.detail, /profile\.json/);
});

test('TUI install args keep the surfaces flag opt-in', () => {
  const base = buildInstallArgs({ hosts: ['claude'], lang: 'zh-CN', stack: 'dotnet' });
  assert.equal('surfaces' in base, false);
  const composed = buildInstallArgs({ hosts: ['claude'], lang: 'zh-CN', stack: 'dotnet', surfaces: ['frontend'] });
  assert.deepEqual(composed.surfaces, ['frontend']);
});
