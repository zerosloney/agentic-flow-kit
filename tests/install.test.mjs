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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-'));
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

function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel));
}

test('fresh install creates engine, host, scaffold and manifest', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);

  for (const rel of [
    '.agents/install-manifest.json',
    '.agents/commands/new-task.md',
    '.agents/scripts/verify.mjs',
    '.agents/config/engine.json',
    '.githooks/pre-commit',
    '.githooks/pre-push',
    '.trae/commands/wf-new-task.md',
    '.trae/agents/implementer.md',
    'AGENTS.md',
    'wiki/INDEX.md',
    'wiki/知识沉淀总览.html',
    'workflow/INDEX.md',
    'workflow/intents/_TEMPLATE.md',
    '.gitattributes',
    '.gitignore',
    'wiki/产品需求/.gitkeep',
    'wiki/项目规范/.gitkeep',
    'workflow/evidence/.gitkeep',
    'workflow/reviews.d/.gitkeep',
  ]) {
    assert.ok(exists(dir, rel), `missing ${rel}`);
  }

  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  assert.equal(manifest.kit, 'agentic-flow-kit');
  assert.deepEqual(manifest.hosts, ['trae']);
  assert.equal(manifest.stack, 'node');
  assert.equal(manifest.language, 'zh-CN');
  assert.ok(manifest.files['.agents/commands/new-task.md']);

  const engine = JSON.parse(read(dir, '.agents/config/engine.json'));
  assert.deepEqual(engine.options.hosts, ['trae']);
  assert.equal(engine.options.stack, 'node');
  assert.equal(engine.options.language, 'zh-CN');
});

test('add-host accepts a positional host and adds the memory file', () => {
  const dir = tmpRepo();
  const r1 = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = run(['add-host', 'claude', '--target', '.'], dir);
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(exists(dir, '.claude/settings.json'));
  assert.ok(exists(dir, '.claude/commands/wf-stages.md'));
  assert.ok(exists(dir, 'CLAUDE.md'));
  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  assert.deepEqual(manifest.hosts.sort(), ['claude', 'trae'].sort());
  assert.equal(manifest.stack, 'node', 'add-host must preserve the installed stack');
});

test('upgrade conflicts on a modified managed file and --force overwrites', () => {
  const dir = tmpRepo();
  const r1 = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r1.status, 0, r1.stderr);
  const file = path.join(dir, '.agents/commands/new-task.md');
  const original = fs.readFileSync(file, 'utf8');
  fs.appendFileSync(file, '\n<!-- user edit -->\n');

  const r2 = run(['upgrade', '--target', '.'], dir);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /conflict|冲突/);
  assert.ok(fs.readFileSync(file, 'utf8').includes('<!-- user edit -->'));
  assert.equal(JSON.parse(read(dir, '.agents/install-manifest.json')).stack, 'node', 'upgrade must preserve the installed stack');

  const r3 = run(['upgrade', '--target', '.', '--force'], dir);
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('dry-run writes nothing', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'trae', '--stack', 'node', '--dry-run', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!exists(dir, '.agents'));
  assert.ok(!exists(dir, 'AGENTS.md'));
});

test('doctor passes after install', () => {
  const dir = tmpRepo();
  const r1 = run(['install', '--agent', 'trae', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = run(['doctor', '--target', '.'], dir);
  assert.equal(r2.status, 0, r2.stdout);
});

test('unknown host fails with a helpful message', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'nope', '--target', '.'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown host|未知宿主/i);
});

test('--track-hosts suppresses local host ignores', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'qwen', '--track-hosts', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(exists(dir, '.qwen/settings.json'));
  assert.ok(!read(dir, '.gitignore').includes('.qwen/'));
});
