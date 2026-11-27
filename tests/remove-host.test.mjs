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

function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1', ...env },
  });
}

function install(dir, hosts, extra = [], env = {}) {
  const agentArgs = hosts.flatMap((host) => ['--agent', host]);
  const r = run(['install', ...agentArgs, '--lang', 'zh-CN', '--stack', 'node', '--target', '.', ...extra], dir, env);
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

// —— prevHooksPath：完整卸载时还原安装前被覆盖的本地 core.hooksPath ——

function setLocalConfig(dir, key, value) {
  const r = spawnSync('git', ['-C', dir, 'config', '--local', key, value], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

function localConfig(dir, key) {
  const r = spawnSync('git', ['-C', dir, 'config', '--local', '--get', key], { encoding: 'utf8' });
  return { status: r.status, value: r.stdout.trim() };
}

test('uninstall restores the pre-install core.hooksPath', () => {
  const dir = tmpRepo();
  setLocalConfig(dir, 'core.hooksPath', '.husky');
  install(dir, ['claude']);
  assert.equal(localConfig(dir, 'core.hooksPath').value, '.githooks');
  assert.equal(manifestOf(dir).prevHooksPath, '.husky');

  const r = run(['uninstall', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(json(r).manifestRemoved, true);
  assert.equal(localConfig(dir, 'core.hooksPath').value, '.husky');
});

test('uninstall unsets core.hooksPath when none was set before install', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  const manifest = manifestOf(dir);
  assert.equal('prevHooksPath' in manifest, true);
  assert.equal(manifest.prevHooksPath, null);
  assert.equal(localConfig(dir, 'core.hooksPath').value, '.githooks');

  const r = run(['uninstall', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const after = localConfig(dir, 'core.hooksPath');
  assert.notEqual(after.status, 0, 'the kit-set key must be unset after uninstall');
});

test('uninstall keeps core.hooksPath the user changed after install', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  setLocalConfig(dir, 'core.hooksPath', '.custom-hooks');

  const r = run(['uninstall', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(localConfig(dir, 'core.hooksPath').value, '.custom-hooks');
});

test('remove-host leaves core.hooksPath untouched', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);

  const r = run(['remove-host', 'claude', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(localConfig(dir, 'core.hooksPath').value, '.githooks');
});

// 宿主配置被用户改过后 remove-host 只摘托管条目：存活下来的配置必须解除托管，
// 否则后续 uninstall 把它当普通托管文件整文件删除（连用户内容一起）。
test('remove-host stops tracking a host config that survives with user content', () => {
  for (const [host, rel] of [['qwen', '.qwen/settings.json'], ['claude', '.mcp.json']]) {
    const dir = tmpRepo();
    install(dir, [host]);
    const settings = JSON.parse(read(dir, rel));
    settings.userCustom = 'MY-OWN-KEY';
    fs.writeFileSync(path.join(dir, rel), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

    const removed = run(['remove-host', host, '--target', '.', '--json'], dir);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(rel in manifestOf(dir).files, false, `${rel}: surviving config must leave the managed file set`);
    assert.equal(JSON.parse(read(dir, rel)).userCustom, 'MY-OWN-KEY', `${rel}: remove-host must keep user content`);

    const uninstalled = run(['uninstall', '--target', '.', '--json'], dir);
    assert.equal(uninstalled.status, 0, uninstalled.stderr);
    assert.ok(exists(dir, rel), `${rel}: uninstall must not delete a config it no longer manages`);
    assert.equal(JSON.parse(read(dir, rel)).userCustom, 'MY-OWN-KEY', `${rel}: user content must survive uninstall`);
  }
});

// 用户级 hooks 配置损坏时须在删除任何文件之前中止；假 HOME 保证绝不碰真实家目录。
test('remove-host aborts before any write when the user hooks config is corrupt', () => {
  const dir = tmpRepo();
  const home = makeTmp('flow-kit-remove-home-');
  const env = { HOME: home, USERPROFILE: home };
  install(dir, ['codex', 'claude'], [], env);
  const hooksFile = path.join(home, '.codex', 'hooks.json');
  const corrupt = '{ BROKEN JSON !!!\n';
  fs.writeFileSync(hooksFile, corrupt, 'utf8');
  const manifestBefore = read(dir, '.agents/install-manifest.json');
  const gitignoreBefore = read(dir, '.gitignore');

  const r = run(['remove-host', 'codex', '--target', '.', '--json'], dir, env);
  assert.equal(r.status, EXIT.USAGE, `corrupt user hooks config must abort: ${r.stderr}`);
  assert.match(r.stderr, /hooks/);
  assert.equal(read(dir, '.agents/install-manifest.json'), manifestBefore);
  assert.equal(read(dir, '.gitignore'), gitignoreBefore, 'no file may be rewritten before the abort');
  assert.equal(fs.readFileSync(hooksFile, 'utf8'), corrupt, 'the corrupt file must not be overwritten');
  assert.ok(exists(dir, '.claude/commands/wf-new-task.md'), 'remaining host files must stay intact');
});

test('uninstall aborts before deleting anything when the user hooks config is corrupt', () => {
  const dir = tmpRepo();
  const home = makeTmp('flow-kit-uninstall-home-');
  const env = { HOME: home, USERPROFILE: home };
  install(dir, ['codex'], [], env);
  const hooksFile = path.join(home, '.codex', 'hooks.json');
  const corrupt = '{ BROKEN JSON !!!\n';
  fs.writeFileSync(hooksFile, corrupt, 'utf8');
  const manifestBefore = read(dir, '.agents/install-manifest.json');

  const r = run(['uninstall', '--target', '.', '--json'], dir, env);
  assert.equal(r.status, EXIT.USAGE, `corrupt user hooks config must abort: ${r.stderr}`);
  assert.match(r.stderr, /hooks/);
  assert.equal(read(dir, '.agents/install-manifest.json'), manifestBefore);
  assert.ok(exists(dir, 'AGENTS.md'), 'managed files must not be deleted before the abort');
  assert.ok(exists(dir, '.githooks'), 'git hooks must not be deleted before the abort');
  assert.equal(localConfig(dir, 'core.hooksPath').value, '.githooks');
  assert.equal(fs.readFileSync(hooksFile, 'utf8'), corrupt, 'the corrupt file must not be overwritten');
});

// manifest 可被篡改：uninstall 的删除面必须以 target 为界，--force 也不例外。
test('uninstall never deletes manifest entries outside the target, even with --force', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  const rel = `../${path.basename(dir)}-victim.txt`;
  const victim = path.resolve(dir, rel);
  try {
    fs.writeFileSync(victim, 'keep\n', 'utf8');
    const manifest = manifestOf(dir);
    manifest.files[rel] = '0'.repeat(64);
    fs.writeFileSync(path.join(dir, '.agents/install-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const r = run(['uninstall', '--target', '.', '--force', '--json'], dir);
    assert.equal(r.status, EXIT.TARGET, r.stderr);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep\n');
    const out = json(r);
    assert.equal(out.invalid, 1);
    assert.equal(out.items.find((item) => item.path === rel)?.action, 'invalid');
    assert.equal(exists(dir, '.agents/install-manifest.json'), true, 'hostile manifest must be kept for inspection');
  } finally {
    fs.rmSync(victim, { force: true });
  }
});

// 宿主归属只看前缀，恶意 key 可借 ../ 逃逸；删除前必须再按 target 边界解析。
test('remove-host never deletes owned entries outside the target, even with --force', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  const rel = `.claude/../../${path.basename(dir)}-victim.txt`;
  const victim = path.resolve(dir, rel);
  try {
    fs.writeFileSync(victim, 'keep\n', 'utf8');
    const manifest = manifestOf(dir);
    manifest.files[rel] = '0'.repeat(64);
    fs.writeFileSync(path.join(dir, '.agents/install-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const r = run(['remove-host', 'claude', '--target', '.', '--force', '--json'], dir);
    assert.equal(r.status, EXIT.TARGET, r.stderr);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep\n');
    const out = json(r);
    assert.equal(out.invalid, 1);
    assert.equal(out.items.find((item) => item.path === rel)?.action, 'invalid');
  } finally {
    fs.rmSync(victim, { force: true });
  }
});
