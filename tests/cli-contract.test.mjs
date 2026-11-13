import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXIT, exitCodeForError } from '../src/cli/exit.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-contract-'));
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

function sha(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function addOrphan(dir, rel, content, managed = content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  const manifest = readManifest(dir);
  manifest.files[rel] = sha(managed);
  writeManifest(dir, manifest);
}

function parseSingleJson(r) {
  return JSON.parse(r.stdout);
}

// ---- 退出码映射（纯单元，不 spawn） ----

test('exit code mapping covers every documented class', () => {
  assert.equal(EXIT.OK, 0);
  assert.equal(EXIT.CONFLICT, 1);
  assert.equal(EXIT.USAGE, 2);
  assert.equal(EXIT.TARGET, 3);
  assert.equal(EXIT.HOST, 4);
  assert.equal(EXIT.IO, 5);

  for (const code of ['BAD_COMMAND', 'BAD_LANG', 'BAD_MODEL', 'BAD_TIER', 'NO_HOSTS', 'MISSING_ARG', 'HOST_NOT_INSTALLED']) {
    assert.equal(exitCodeForError({ code }), EXIT.USAGE, code);
  }
  for (const code of ['TARGET_MISSING', 'NO_MANIFEST', 'NO_HOSTS_IN_MANIFEST']) {
    assert.equal(exitCodeForError({ code }), EXIT.TARGET, code);
  }
  assert.equal(exitCodeForError({ code: 'UNKNOWN_HOST' }), EXIT.HOST);
  for (const code of ['EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EROFS', 'EEXIST']) {
    assert.equal(exitCodeForError({ code }), EXIT.IO, code);
  }
  assert.equal(exitCodeForError(new Error('boom')), EXIT.CONFLICT);
  assert.equal(exitCodeForError({ code: 'SOMETHING_ELSE' }), EXIT.CONFLICT);
  assert.equal(exitCodeForError(null), EXIT.CONFLICT);
});

test('CLI maps usage, target and host errors to their exit codes', () => {
  const dir = tmpRepo();
  assert.equal(run(['nope'], dir).status, EXIT.USAGE);
  assert.equal(run(['install', '--agent', 'not-a-host', '--target', '.'], dir).status, EXIT.HOST);
  assert.equal(run(['diff', '--target', path.join(dir, 'missing')], dir).status, EXIT.TARGET);
  assert.equal(run(['diff', '--target', '.'], dir).status, EXIT.TARGET, 'no manifest yet');
});

test('CLI maps filesystem failures to exit code 5', () => {
  const dir = tmpRepo();
  // 宿主目录位置被同名文件占住：写盘阶段 mkdir 抛 ENOTDIR/EEXIST。
  fs.writeFileSync(path.join(dir, '.claude'), 'x', 'utf8');
  const r = run(['install', '--agent', 'claude', '--target', '.'], dir);
  assert.equal(r.status, EXIT.IO, r.stderr);
  assert.match(r.stderr, /ENOTDIR|EEXIST|ENOENT/);
});

// ---- --json 输出契约 ----

test('install --json keeps stdout pure JSON and human progress on stderr', () => {
  const dir = tmpRepo();
  const r = install(dir, ['--json']);
  const out = parseSingleJson(r);
  assert.equal(out.command, 'install');
  assert.equal(out.target, dir);
  assert.equal(out.dryRun, false);
  assert.equal(out.language, 'zh-CN');
  assert.equal(out.stack, 'node');
  assert.deepEqual(out.hosts, ['trae']);
  assert.deepEqual(out.conflicts, []);
  assert.ok(out.plan.count > 0);
  assert.ok(fs.existsSync(out.manifest));
  assert.ok(r.stderr.trim().length > 0, 'human progress should go to stderr');
  assert.ok(!r.stderr.includes('"command"'), 'stderr should not contain the JSON payload');
});

test('install --strict fails on conflicts and reports them in JSON', () => {
  const dir = tmpRepo();
  install(dir);
  fs.appendFileSync(path.join(dir, '.agents/commands/new-task.md'), '\nuser edit\n', 'utf8');

  const plain = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--target', '.', '--json'], dir);
  assert.equal(plain.status, 0, 'without --strict conflicts do not fail the run');
  assert.ok(parseSingleJson(plain).conflicts.length >= 1);

  const strict = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--target', '.', '--json', '--strict'], dir);
  assert.equal(strict.status, EXIT.CONFLICT, strict.stderr);
  assert.ok(parseSingleJson(strict).conflicts.includes('.agents/commands/new-task.md'));
});

test('diff and status --strict fail on any drift', () => {
  const dir = tmpRepo();
  install(dir);
  fs.appendFileSync(path.join(dir, '.agents/commands/new-task.md'), '\nuser edit\n', 'utf8');

  const diff = run(['diff', '--target', '.', '--json', '--strict'], dir);
  assert.equal(diff.status, EXIT.CONFLICT);
  const diffOut = parseSingleJson(diff);
  assert.ok(diffOut.summary.userModified >= 1);
  assert.equal(run(['diff', '--target', '.', '--json'], dir).status, EXIT.OK);

  const status = run(['status', '--target', '.', '--json', '--strict'], dir);
  assert.equal(status.status, EXIT.CONFLICT);
  assert.ok(parseSingleJson(status).summary.userModified >= 1);
  assert.equal(run(['status', '--target', '.', '--json'], dir).status, EXIT.OK);
});

test('prune --json --strict reports skipped orphans and exits 1', () => {
  const dir = tmpRepo();
  install(dir);
  addOrphan(dir, 'legacy/edited.md', 'edited\n', 'managed\n');

  const r = run(['prune', '--target', '.', '--json', '--strict'], dir);
  assert.equal(r.status, EXIT.CONFLICT, r.stderr);
  const out = parseSingleJson(r);
  assert.equal(out.skipped, 1);
  assert.equal(out.deleted, 0);
  assert.deepEqual(out.items, [{ path: 'legacy/edited.md', action: 'skip' }]);
  assert.ok(fs.existsSync(path.join(dir, 'legacy/edited.md')));
});

test('prune --json reports deletions and exits 0 without --strict', () => {
  const dir = tmpRepo();
  install(dir);
  addOrphan(dir, 'legacy/old.md', 'old\n');

  const r = run(['prune', '--target', '.', '--json'], dir);
  assert.equal(r.status, EXIT.OK, r.stderr);
  const out = parseSingleJson(r);
  assert.equal(out.deleted, 1);
  assert.equal(out.skipped, 0);
  assert.deepEqual(out.items, [{ path: 'legacy/old.md', action: 'delete' }]);
  assert.equal(fs.existsSync(path.join(dir, 'legacy/old.md')), false);
});

test('explain --json returns one structured object', () => {
  const dir = tmpRepo();
  install(dir);

  const r = run(['explain', '.agents/commands/new-task.md', '--target', '.', '--json'], dir);
  assert.equal(r.status, EXIT.OK, r.stderr);
  const out = parseSingleJson(r);
  assert.equal(out.path, '.agents/commands/new-task.md');
  assert.equal(out.kind, 'unchanged');
  assert.ok(out.template);
  assert.ok(out.managedHash);
  assert.equal(out.actualHash, out.managedHash);
  assert.equal(out.model, null);
});

test('doctor --json returns checks and a summary', () => {
  const dir = tmpRepo();
  install(dir);

  const r = run(['doctor', '--target', '.', '--json'], dir);
  assert.equal(r.status, EXIT.OK, r.stderr);
  const out = parseSingleJson(r);
  assert.equal(out.ok, true);
  assert.equal(out.target, dir);
  assert.ok(Array.isArray(out.checks) && out.checks.length > 0);
  assert.equal(out.summary.total, out.checks.length);
  assert.equal(out.summary.failed, 0);
  assert.ok(out.checks.every((c) => typeof c.name === 'string' && typeof c.ok === 'boolean'));
  assert.equal(out.deep, null);
});

test('list-hosts --json lists the registry surface', () => {
  const r = run(['list-hosts', '--json'], KIT);
  assert.equal(r.status, EXIT.OK, r.stderr);
  const hosts = parseSingleJson(r);
  assert.equal(hosts.length, 10);
  const claude = hosts.find((h) => h.name === 'claude');
  assert.ok(claude);
  assert.equal(claude.dir, '.claude');
  assert.equal(claude.modelField, 'model');
  assert.ok(hosts.every((h) => typeof h.skills === 'string'));
});
