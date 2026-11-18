import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../src/cli/exit.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-remove-');
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
  const agentArgs = hosts.flatMap((host) => ['--agent', host]);
  const r = run(['install', ...agentArgs, '--lang', 'zh-CN', '--stack', 'node', '--target', '.', ...extra], dir);
  assert.equal(r.status, 0, r.stderr);
  return r;
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel));
}

function manifestOf(dir) {
  return JSON.parse(read(dir, '.agents/install-manifest.json'));
}

function json(r) {
  assert.equal(r.stdout.trim().startsWith('{'), true, `expected JSON, got: ${r.stdout.slice(0, 200)}`);
  return JSON.parse(r.stdout);
}

function seedLock(dir, info) {
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'install.lock'), JSON.stringify(info), 'utf8');
}

test('remove-host keeps the other host and refreshes ignore blocks', () => {
  const dir = tmpRepo();
  install(dir, ['claude', 'trae']);
  assert.ok(exists(dir, '.trae/commands/wf-new-task.md'));
  assert.match(read(dir, '.gitignore'), /\.claude\//);

  const removed = run(['remove-host', 'trae', '--target', '.', '--json'], dir);
  assert.equal(removed.status, 0, removed.stderr);
  const out = json(removed);
  assert.deepEqual(out.hosts, ['trae']);
  assert.deepEqual(out.remaining, ['claude']);
  assert.ok(out.deleted > 0);
  assert.equal(exists(dir, '.trae'), false);

  assert.ok(exists(dir, '.claude/commands/wf-new-task.md'));
  assert.ok(exists(dir, '.claude/agents/implementer.md'));
  const gitignore = read(dir, '.gitignore');
  assert.match(gitignore, /\.claude\//);
  assert.match(gitignore, /agentic-flow-kit ignores/);

  const manifest = manifestOf(dir);
  assert.deepEqual(manifest.hosts, ['claude']);
  assert.equal(Object.keys(manifest.files).some((rel) => rel.startsWith('.trae/')), false);

  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.userModified, 0);
  assert.equal(diff.summary.kitUpdated, 0);
  assert.equal(diff.summary.orphan, 0);
  assert.equal(diff.summary.missing, 0);
});

test('removed host disappears from the ignore block', () => {
  const dir = tmpRepo();
  install(dir, ['claude', 'opencode']);
  assert.match(read(dir, '.gitignore'), /\.opencode\//);

  const r = run(['remove-host', 'opencode', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const gitignore = read(dir, '.gitignore');
  assert.doesNotMatch(gitignore, /\.opencode\//);
  assert.match(gitignore, /\.claude\//);
});

test('removed host can be restored with add-host', () => {
  const dir = tmpRepo();
  install(dir, ['claude', 'trae']);
  assert.equal(run(['remove-host', 'trae', '--target', '.', '--json'], dir).status, 0);
  assert.equal(exists(dir, '.trae'), false);

  const again = run(['add-host', 'trae', '--target', '.', '--json'], dir);
  assert.equal(again.status, 0, again.stderr);
  assert.ok(exists(dir, '.trae/commands/wf-new-task.md'));
  assert.deepEqual(manifestOf(dir).hosts.sort(), ['claude', 'trae']);
});

test('root memory is kept and stops being managed', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  fs.appendFileSync(path.join(dir, 'CLAUDE.md'), '\nuser note\n', 'utf8');

  const r = run(['remove-host', 'claude', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.equal(out.kept, 1);
  assert.ok(exists(dir, 'CLAUDE.md'));
  assert.match(read(dir, 'CLAUDE.md'), /user note/);
  assert.equal(exists(dir, '.claude'), false);

  const manifest = manifestOf(dir);
  assert.deepEqual(manifest.hosts, []);
  assert.equal('CLAUDE.md' in manifest.files, false);
});

test('user-modified host files require --force and drive --strict', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  fs.appendFileSync(path.join(dir, '.trae/commands/wf-new-task.md'), '\nuser edit\n', 'utf8');

  const skipped = run(['remove-host', 'trae', '--target', '.', '--json'], dir);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(json(skipped).skipped, 1);
  assert.ok(exists(dir, '.trae/commands/wf-new-task.md'));
  assert.deepEqual(manifestOf(dir).hosts, []);
  assert.ok('.trae/commands/wf-new-task.md' in manifestOf(dir).files);

  const strict = run(['remove-host', 'trae', '--target', '.', '--json', '--strict'], dir);
  assert.equal(strict.status, 1);

  const forced = run(['remove-host', 'trae', '--target', '.', '--json', '--force'], dir);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(exists(dir, '.trae/commands/wf-new-task.md'), false);
});

test('remove-host --dry-run writes nothing', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  const before = manifestOf(dir);

  const r = run(['remove-host', 'trae', '--target', '.', '--dry-run', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(json(r).deleted > 0);
  assert.ok(exists(dir, '.trae/commands/wf-new-task.md'));
  assert.deepEqual(manifestOf(dir), before);
});

test('remove-host validates usage, host name and installation state', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  assert.equal(run(['remove-host', '--target', '.'], dir).status, 2);
  assert.equal(run(['remove-host', 'not-a-host', '--target', '.'], dir).status, 4);
  assert.equal(run(['remove-host', 'claude', '--target', '.'], dir).status, 2);
  assert.equal(run(['uninstall', '--target', path.join(dir, 'missing')], dir).status, 3);
});

test('uninstall removes managed files, keeps root memory and user block content', () => {
  const dir = tmpRepo();
  install(dir, ['claude', 'trae']);
  fs.appendFileSync(path.join(dir, '.gitignore'), 'user-ignore\n', 'utf8');

  const r = run(['uninstall', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.equal(out.skipped, 0);
  assert.equal(out.manifestRemoved, true);
  assert.ok(out.deleted > 0);

  assert.ok(exists(dir, 'CLAUDE.md'));
  assert.equal(exists(dir, '.claude'), false);
  assert.equal(exists(dir, '.trae'), false);
  assert.equal(exists(dir, '.agents/install-manifest.json'), false);
  assert.equal(exists(dir, '.agents/commands/new-task.md'), false);

  const gitignore = read(dir, '.gitignore');
  assert.match(gitignore, /user-ignore/);
  assert.doesNotMatch(gitignore, /agentic-flow-kit ignores/);
});

test('uninstall keeps user-modified files until --force', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  fs.appendFileSync(path.join(dir, '.agents/commands/new-task.md'), '\nuser edit\n', 'utf8');

  const first = run(['uninstall', '--target', '.', '--json'], dir);
  assert.equal(first.status, 0, first.stderr);
  const out = json(first);
  assert.equal(out.skipped, 1);
  assert.equal(out.manifestRemoved, false);
  assert.ok(exists(dir, '.agents/commands/new-task.md'));
  assert.ok(exists(dir, '.agents/install-manifest.json'));

  const strict = run(['uninstall', '--target', '.', '--json', '--strict'], dir);
  assert.equal(strict.status, 1);

  const forced = run(['uninstall', '--target', '.', '--json', '--force'], dir);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(exists(dir, '.agents/commands/new-task.md'), false);
  assert.equal(exists(dir, '.agents/install-manifest.json'), false);
});

// —— 安装锁：remove-host / uninstall 也是托管状态的写路径，必须与并发安装互斥 ——

test('fresh install lock blocks remove-host and leaves the manifest untouched', () => {
  const dir = tmpRepo();
  install(dir, ['claude', 'trae']);
  const before = manifestOf(dir);
  seedLock(dir, { pid: 432100, ts: Date.now(), command: 'install' });

  const r = run(['remove-host', 'trae', '--target', '.', '--json'], dir);
  assert.equal(r.status, EXIT.LOCK, `lock conflict must exit ${EXIT.LOCK}: ${r.stdout} ${r.stderr}`);
  assert.deepEqual(manifestOf(dir), before);
  assert.ok(exists(dir, '.trae'), 'blocked run must not delete host files');
  assert.ok(exists(dir, '.agents/install.lock'), 'fresh lock must not be removed by the blocked run');
});

test('fresh install lock blocks uninstall and leaves the manifest untouched', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  const before = manifestOf(dir);
  seedLock(dir, { pid: 432101, ts: Date.now(), command: 'install' });

  const r = run(['uninstall', '--target', '.', '--json'], dir);
  assert.equal(r.status, EXIT.LOCK, `lock conflict must exit ${EXIT.LOCK}: ${r.stdout} ${r.stderr}`);
  assert.deepEqual(manifestOf(dir), before);
  assert.ok(exists(dir, '.agents/commands/new-task.md'), 'blocked run must not delete managed files');
  assert.ok(exists(dir, '.agents/install.lock'), 'fresh lock must not be removed by the blocked run');
});

test('stale install lock is taken over and remove-host completes', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  seedLock(dir, { pid: 999999, ts: Date.now() - 16 * 60_000, command: 'upgrade' });

  const r = run(['remove-host', 'trae', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(manifestOf(dir).hosts, []);
  assert.equal(exists(dir, '.agents/install.lock'), false, 'stale lock must be released after success');
});

test('successful remove-host and uninstall leave no lock file behind', () => {
  const dir = tmpRepo();
  install(dir, ['claude', 'trae']);

  const removed = run(['remove-host', 'trae', '--target', '.', '--json'], dir);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(exists(dir, '.agents/install.lock'), false);

  const uninstalled = run(['uninstall', '--target', '.', '--json'], dir);
  assert.equal(uninstalled.status, 0, uninstalled.stderr);
  assert.equal(exists(dir, '.agents/install.lock'), false);
});
