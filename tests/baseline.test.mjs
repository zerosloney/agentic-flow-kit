import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyPlan } from '../src/install/apply.mjs';
import { BASELINE_DIR, readBaseline } from '../src/install/baseline.mjs';
import { readManifest, sha256Text } from '../src/install/manifest.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-baseline-'));
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

function planFor(target, rel, text) {
  return {
    target,
    entries: [{
      srcAbs: null,
      targetRel: rel,
      category: 'engine',
      priority: 10,
      kind: 'file',
      getText: () => text,
    }],
  };
}

function apply({ target, rel = 'notes/config.txt', text, manifest = { files: {} }, baseline = true, force = false, benignUnchanged = false }) {
  return applyPlan({
    plan: planFor(target, rel, text),
    vars: {},
    manifest,
    dryRun: false,
    force,
    baseline,
    benignUnchanged,
    log: () => {},
  });
}

test('install writes baselines and records baselineVersion without touching hashes', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.equal(out.baseline, true);

  const target = path.join(dir, 'AGENTS.md');
  assert.equal(fs.readFileSync(path.join(dir, BASELINE_DIR, 'AGENTS.md'), 'utf8'), fs.readFileSync(target, 'utf8'));
  assert.equal(fs.existsSync(path.join(dir, BASELINE_DIR, '.claude/settings.json')), false);

  const manifest = readManifest(dir);
  assert.equal(manifest.baseline, true);
  assert.equal(manifest.baselineVersion, manifest.version);
  assert.equal(Object.keys(manifest.files).length, 304);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').includes('.agents/.kit/'), true);

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.summary.failed, 0);
  const check = doctor.checks.find((item) => item.name === 'baseline');
  assert.ok(check);
  assert.equal(check.ok, true);
});

test('three-way merge keeps user changes and applies template changes from different regions', () => {
  const dir = tmpRepo();
  const rel = 'notes/config.txt';
  const initial = 'a\nb\nc\nd\n';
  const first = apply({ target: dir, rel, text: initial });
  assert.equal(first.stats.create, 1);
  assert.equal(readBaseline(dir, rel), initial);

  const user = 'A\nb\nc\nd\n';
  fs.writeFileSync(path.join(dir, rel), user, 'utf8');
  const theirs = 'a\nb\nc\nD\n';
  const merged = apply({ target: dir, rel, text: theirs, manifest: { files: first.files } });

  assert.equal(merged.stats.merge, 1);
  assert.equal(merged.stats.conflict, 0);
  assert.equal(fs.readFileSync(path.join(dir, rel), 'utf8'), 'A\nb\nc\nD\n');
  // manifest 记录模板侧哈希；合并结果不参与哈希，避免下次升级误覆盖用户内容。
  assert.equal(merged.files[rel], sha256Text(theirs));
  assert.equal(readBaseline(dir, rel), theirs);

  const again = apply({ target: dir, rel, text: theirs, manifest: { files: merged.files }, benignUnchanged: true });
  assert.equal(again.stats.merge, 0);
  assert.equal(again.stats.conflict, 0);
  assert.equal(again.stats.skip, 1);
  assert.equal(fs.readFileSync(path.join(dir, rel), 'utf8'), 'A\nb\nc\nD\n');
});

test('same-region conflicts write markers, keep the old manifest hash and count a conflict', () => {
  const dir = tmpRepo();
  const rel = 'notes/conflict.txt';
  const initial = 'value\n';
  const first = apply({ target: dir, rel, text: initial });
  fs.writeFileSync(path.join(dir, rel), 'user value\n', 'utf8');

  const merged = apply({ target: dir, rel, text: 'kit value\n', manifest: { files: first.files } });
  assert.equal(merged.stats.conflict, 1);
  assert.deepEqual(merged.conflicts, [rel]);
  assert.deepEqual(merged.conflictPaths, [rel]);
  assert.equal(merged.files[rel], first.files[rel]);
  const text = fs.readFileSync(path.join(dir, rel), 'utf8');
  assert.match(text, /<<<<<<< current/);
  assert.match(text, /=======/);
  assert.match(text, />>>>>>> kit/);
});

test('without a baseline or for binary files the old hash-skip behavior is kept', () => {
  const dir = tmpRepo();
  const rel = 'notes/legacy.txt';
  const first = apply({ target: dir, rel, text: 'old\n', baseline: false });
  fs.writeFileSync(path.join(dir, rel), 'user\n', 'utf8');
  const skipped = apply({ target: dir, rel, text: 'new\n', manifest: { files: first.files }, baseline: false });
  assert.equal(skipped.stats.conflict, 1);
  assert.equal(fs.readFileSync(path.join(dir, rel), 'utf8'), 'user\n');

  const binRel = 'assets/logo.png';
  const binFirst = apply({ target: dir, rel: binRel, text: 'fake-binary\n' });
  fs.writeFileSync(path.join(dir, binRel), 'user-binary\n', 'utf8');
  const binSkipped = apply({ target: dir, rel: binRel, text: 'new-binary\n', manifest: { files: binFirst.files } });
  assert.equal(binSkipped.stats.conflict, 1);
  assert.equal(fs.readFileSync(path.join(dir, binRel), 'utf8'), 'user-binary\n');
});

test('--no-baseline disables baselines and is replayed by upgrade', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json', '--no-baseline'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(json(r).baseline, false);
  assert.equal(fs.existsSync(path.join(dir, BASELINE_DIR)), false);
  let manifest = readManifest(dir);
  assert.equal(manifest.baseline, false);
  assert.equal(manifest.baselineVersion, null);

  const upgrade = json(run(['upgrade', '--target', '.', '--json'], dir));
  assert.equal(upgrade.baseline, false);
  manifest = readManifest(dir);
  assert.equal(manifest.baseline, false);

  const reenabled = json(run(['upgrade', '--target', '.', '--json', '--baseline'], dir));
  assert.equal(reenabled.baseline, true);
  assert.ok(fs.existsSync(path.join(dir, BASELINE_DIR)));
});

test('prune --baseline removes only orphan baselines', () => {  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json'], dir).status, 0);
  const orphan = path.join(dir, BASELINE_DIR, 'notes/orphan.txt');
  fs.mkdirSync(path.dirname(orphan), { recursive: true });
  fs.writeFileSync(orphan, 'orphan\n', 'utf8');
  const managed = path.join(dir, BASELINE_DIR, 'AGENTS.md');
  assert.equal(fs.existsSync(managed), true);

  const keep = json(run(['prune', '--target', '.', '--json'], dir));
  assert.equal(keep.baselines, 0);
  assert.equal(fs.existsSync(orphan), true);

  const pruned = json(run(['prune', '--target', '.', '--json', '--baseline'], dir));
  assert.equal(pruned.baselines, 1);
  assert.deepEqual(pruned.items, [{ path: 'notes/orphan.txt', action: 'baseline-delete' }]);
  assert.equal(fs.existsSync(orphan), false);
  assert.equal(fs.existsSync(managed), true);
});

test('uninstall removes the baseline tree with the rest of the managed state', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json'], dir).status, 0);
  assert.equal(fs.existsSync(path.join(dir, BASELINE_DIR)), true);
  const r = run(['uninstall', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, BASELINE_DIR)), false);
});
