import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256Text } from '../src/install/manifest.mjs';
import { userHooksLockFile } from '../src/install/lock.mjs';
import { HOSTS } from '../src/hosts/registry.mjs';
import { userHooksFile, wireUserHooks } from '../src/install/user-hooks.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const INSTALL_ARGS = ['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'];

function tmpRepo() {
  const dir = makeTmp('flow-kit-lock-');
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

function seedLock(dir, info) {
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'install.lock'), JSON.stringify(info), 'utf8');
}

test('fresh install lock blocks install with INSTALL_LOCKED holder info', () => {
  const dir = tmpRepo();
  seedLock(dir, { pid: 432100, ts: Date.now(), command: 'install' });

  const r = run(INSTALL_ARGS, dir);
  assert.notEqual(r.status, 0, `install must fail while a fresh lock is held: ${r.stdout}`);
  assert.match(r.stderr, /安装锁冲突/);
  assert.match(r.stderr, /pid 432100/);
  assert.match(r.stderr, /命令 install/);
  assert.match(r.stderr, /确认无并发安装后可删除该锁文件/);
  assert.ok(exists(dir, '.agents/install.lock'), 'fresh lock must not be removed by the blocked run');
  assert.equal(exists(dir, '.agents/install-manifest.json'), false, 'blocked run must not install');
});

test('stale install lock is taken over with a warning and cleaned up', () => {
  const dir = tmpRepo();
  seedLock(dir, { pid: 999999, ts: Date.now() - 16 * 60_000, command: 'upgrade' });

  const r = run(INSTALL_ARGS, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /陈旧/);
  assert.equal(exists(dir, '.agents/install.lock'), false, 'lock must be released after success');
  assert.ok(exists(dir, '.agents/install-manifest.json'), 'stale takeover must complete the install');
});

test('successful install leaves no lock file behind', () => {
  const dir = tmpRepo();
  const r = run(INSTALL_ARGS, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(exists(dir, '.agents/install.lock'), false);
});

test('untracked file identical to planned output is claimed and tracked', () => {
  // 参考仓库先装一次拿到该条目的最终渲染产物，再逐字节种入目标仓库（未跟踪状态）。
  const ref = tmpRepo();
  const r0 = run(INSTALL_ARGS, ref);
  assert.equal(r0.status, 0, r0.stderr);
  const planned = read(ref, '.agents/commands/new-task.md');

  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.agents/commands'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents/commands/new-task.md'), planned, 'utf8');

  const r = run(INSTALL_ARGS, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /new-task\.md（已存在且内容与本工具产物一致，纳入跟踪）/);
  assert.doesNotMatch(r.stdout, /new-task\.md（已存在且非本工具安装/);
  assert.equal(read(dir, '.agents/commands/new-task.md'), planned, 'claimed file must keep its bytes');
  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  assert.equal(manifest.files['.agents/commands/new-task.md'], sha256Text(planned));
});

test('untracked file with different content is still skipped as foreign', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.agents/commands'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents/commands/new-task.md'), '# my own notes\n', 'utf8');

  const r = run(INSTALL_ARGS, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /new-task\.md（已存在且非本工具安装，跳过/);
  assert.equal(read(dir, '.agents/commands/new-task.md'), '# my own notes\n');
  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  assert.equal(manifest.files['.agents/commands/new-task.md'], undefined);
});

test('repeat install keeps engine.json byte-identical', async () => {
  const dir = tmpRepo();
  const r1 = run(INSTALL_ARGS, dir);
  assert.equal(r1.status, 0, r1.stderr);
  const first = read(dir, '.agents/config/engine.json');

  // installedAt 是毫秒精度 ISO 串：睡过毫秒边界再装第二次，保证「未复用」实现必红。
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const r2 = run(INSTALL_ARGS, dir);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(read(dir, '.agents/config/engine.json'), first);
});

// 进程内直调 wireUserHooks 会写「家目录」：HOME（POSIX）/ USERPROFILE（Windows）都盖住
// 才能跨平台把 os.homedir() 重定向到一次性目录（手法同 codex-host.test.mjs）。
// 全局锁文件由被保护配置文件的绝对路径派生：假 HOME 不同 → 配置路径不同 → 锁不同，
// 各测试进程互不争锁。fn 第二参即按本用例 HOME 派生的预期锁路径。
function withFakeHome(fn) {
  const home = makeTmp('flow-kit-uhooks-home-');
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const configFile = userHooksFile(HOSTS.codex.userHooks, home);
    return fn(home, userHooksLockFile(configFile));
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
  }
}

function seedGlobalLock(lockFile, info) {
  fs.writeFileSync(lockFile, JSON.stringify(info), 'utf8');
}

test('fresh user-hooks lock blocks wiring with USER_HOOKS_LOCKED guidance', () => {
  withFakeHome((home, lockFile) => {
    seedGlobalLock(lockFile, { pid: 432100, ts: Date.now(), command: 'install' });
    try {
      assert.throws(() => wireUserHooks({ host: 'codex' }), (err) => err instanceof Error
        && err.code === 'USER_HOOKS_LOCKED'
        && err.message.includes(lockFile)
        && err.message.includes('pid 432100')
        && /确认无并发安装后可删除该锁文件/.test(err.message));
      assert.equal(
        fs.existsSync(path.join(home, '.codex', 'hooks.json')),
        false,
        'blocked wiring must not touch the user config',
      );
    } finally {
      fs.rmSync(lockFile, { force: true });
    }
  });
});

test('stale user-hooks lock is taken over with a warning and cleaned up', () => {
  withFakeHome((home, lockFile) => {
    seedGlobalLock(lockFile, { pid: 999999, ts: Date.now() - 16 * 60_000, command: 'install' });
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
      const r = wireUserHooks({ host: 'codex' });
      assert.equal(r.changed, true, 'stale takeover must complete the wiring');
      assert.ok(warnings.some((w) => w.includes('陈旧')), 'stale takeover must warn');
      assert.equal(fs.existsSync(lockFile), false, 'derived lock must be released');
    } finally {
      console.warn = origWarn;
      fs.rmSync(lockFile, { force: true });
    }
  });
});

test('normal user-hooks wiring leaves no lock behind', () => {
  withFakeHome((home, lockFile) => {
    const r = wireUserHooks({ host: 'codex' });
    assert.equal(r.changed, true);
    assert.equal(fs.existsSync(lockFile), false);
  });
});
