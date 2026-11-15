// codex-host.test.mjs — issue #45 A 档：Codex 内置宿主的用户级 hook 接线与适配层行为。
// 假 HOME 手法同 check-local-gates.test.mjs：os.homedir() 在 POSIX 读 HOME、Windows 读
// USERPROFILE，两者都盖即跨平台生效。
// 适配层委托 spawnSync('flow-kit', ...)：测试用 PATH 垫片把 flow-kit 指回本仓 bin/flow-kit.mjs，
// 保证测的是本仓代码而非全局安装；payload 路径一律 path.join 生成，交给 JSON.stringify 转义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { HOSTS } from '../src/hosts/registry.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

// PATH 垫片：Windows 写 flow-kit.cmd（cmd 按 PATHEXT 解析，不写无扩展名 sh 脚本避免抢占），
// POSIX 写可执行 flow-kit sh 脚本。
function makeShim() {
  const dir = makeTmp('fk-codex-shim-');
  const binFwd = BIN.split(path.sep).join('/');
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'flow-kit.cmd'), `@echo off\r\nnode "${binFwd}" %*\r\n`, 'utf8');
  } else {
    fs.writeFileSync(path.join(dir, 'flow-kit'), `#!/bin/sh\nexec node "${binFwd}" "$@"\n`, 'utf8');
    fs.chmodSync(path.join(dir, 'flow-kit'), 0o755);
  }
  return dir;
}

const shim = makeShim();

// 展开 env 时先删掉 Windows 的 Path 原键再统一写 PATH，避免双键并存的未定义行为。
function childEnv(home) {
  const env = { ...process.env };
  delete env.Path;
  env.PATH = `${shim}${path.delimiter}${process.env.PATH || process.env.Path || ''}`;
  env.HOME = home;
  env.USERPROFILE = home;
  env.FLOW_KIT_TEST = '1';
  return env;
}

function tmpRepo() {
  const dir = makeTmp('fk-codex-repo-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function runWith(args, cwd, home) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: childEnv(home) });
}

// 经垫片以 Codex hook 形态调起适配层（flow-kit hook codex-gate），喂 stdin payload。
function runGate(payload, cwd, home) {
  const r = spawnSync('flow-kit', ['hook', 'codex-gate'], {
    cwd,
    encoding: 'buffer',
    shell: process.platform === 'win32',
    input: Buffer.from(JSON.stringify(payload), 'utf8'),
    env: childEnv(home),
  });
  return { status: r.status, out: Buffer.from(r.stdout || []).toString('utf8') };
}

const SPEC = () => HOSTS.codex.userHooks;
const hooksPath = (home) => path.join(home, '.codex', 'hooks.json');
const readHooks = (home) => JSON.parse(fs.readFileSync(hooksPath(home), 'utf8'));
const flowKitEntry = (config) => config.hooks.PreToolUse.find((entry) => JSON.stringify(entry).includes('flow-kit'));
const installCodex = (repo, home) => runWith(['install', '--agent', 'codex', '--stack', 'node', '--target', '.'], repo, home);

test('install --agent codex wires user-level hooks without project files', () => {
  const repo = tmpRepo();
  const home = makeTmp('fk-codex-home-');
  const r = installCodex(repo, home);
  assert.equal(r.status, 0, r.stderr);
  const entry = flowKitEntry(readHooks(home));
  assert.ok(entry, 'flow-kit entry written to ~/.codex/hooks.json');
  assert.equal(entry.matcher, SPEC().matcher);
  assert.equal(entry.hooks[0].type, 'command');
  assert.equal(entry.hooks[0].command, SPEC().command);
  assert.equal(entry.hooks[0].timeout, SPEC().timeout);
  // 零项目文件宿主：不写 .codex/ 项目目录
  assert.equal(fs.existsSync(path.join(repo, '.codex')), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, '.agents/install-manifest.json'), 'utf8'));
  assert.ok(manifest.hosts.includes('codex'));
  assert.match(r.stdout, /重新信任/);
});

test('install --agent codex --json reports userHooks wiring', () => {
  const repo = tmpRepo();
  const home = makeTmp('fk-codex-home-');
  const r = installCodex(repo, home);
  assert.equal(r.status, 0, r.stderr);
  const out = runWith(['install', '--agent', 'codex', '--target', '.', '--json'], repo, home);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout).userHooks, [{ host: 'codex', changed: false }]);
});

test('upgrade is idempotent: hooks.json bytes stay put and output reports ok', () => {
  const repo = tmpRepo();
  const home = makeTmp('fk-codex-home-');
  assert.equal(installCodex(repo, home).status, 0);
  const before = fs.readFileSync(hooksPath(home), 'utf8');
  const r = runWith(['upgrade', '--target', '.'], repo, home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(hooksPath(home), 'utf8'), before);
  assert.match(r.stdout, /已是最新/);
  assert.doesNotMatch(r.stdout, /重新信任/);
});

test('doctor fails on a stale matcher and upgrade renormalizes it', () => {
  const repo = tmpRepo();
  const home = makeTmp('fk-codex-home-');
  assert.equal(installCodex(repo, home).status, 0);
  const config = readHooks(home);
  config.hooks.PreToolUse[0].matcher = '^(Bash)$';
  fs.writeFileSync(hooksPath(home), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const d = runWith(['doctor', '--target', '.'], repo, home);
  assert.equal(d.status, 1);
  assert.match(d.stdout, /hooks codex \(user\)/);
  assert.match(d.stdout, /matcher 过期/);
  assert.ok(d.stdout.includes('^(Bash)$'), 'stale matcher quoted');
  assert.ok(d.stdout.includes('^(exec_command|apply_patch)$'), 'expected matcher quoted');
  assert.ok(d.stdout.includes('重新信任'), 're-trust reminder attached');

  const u = runWith(['upgrade', '--target', '.'], repo, home);
  assert.equal(u.status, 0, u.stderr);
  assert.equal(flowKitEntry(readHooks(home)).matcher, SPEC().matcher);
  assert.match(u.stdout, /重新信任/);
});

test('codex-gate adapter: deny, allow and no-op states', () => {
  const repo = tmpRepo();
  const home = makeTmp('fk-codex-home-');
  assert.equal(installCodex(repo, home).status, 0);
  const deny = (cmd) => {
    const r = runGate({ tool_name: 'exec_command', tool_input: { cmd, workdir: repo }, cwd: repo }, repo, home);
    assert.equal(r.status, 0, r.out);
    return r.out;
  };
  // gates.json deny 清单经归一后的 Bash payload 命中
  assert.match(deny('dotnet ef database update'), /permissionDecision"\s*:\s*"deny/);
  assert.match(deny('git push --force origin main'), /permissionDecision"\s*:\s*"deny/);
  // allow：无输出放行
  assert.equal(deny('git status'), '');
  // 非 flow-kit 仓（向上找不到 manifest）→ no-op
  const nowhere = makeTmp('fk-codex-nowhere-');
  const r = runGate({ tool_name: 'exec_command', tool_input: { cmd: 'dotnet ef database update', workdir: nowhere }, cwd: nowhere }, repo, home);
  assert.equal(r.status, 0);
  assert.equal(r.out, '');
  // MCP 工具当前不设门
  const mcp = runGate({ tool_name: 'mcp__x__y', tool_input: {}, cwd: repo }, repo, home);
  assert.equal(mcp.status, 0);
  assert.equal(mcp.out, '');
  // apply_patch 已知边界：补丁形态解析不出路径 → 内容判据 fail-open 放行（git 钩子兜底）
  const patch = runGate({ tool_name: 'apply_patch', tool_input: { input: '*** Begin Patch' }, cwd: repo }, repo, home);
  assert.equal(patch.status, 0);
  assert.equal(patch.out, '');
});

test('uninstall removes only the flow-kit entry and keeps other entries', () => {
  const repo = tmpRepo();
  const home = makeTmp('fk-codex-home-');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(hooksPath(home), `${JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'context-mode', hooks: [{ type: 'command', command: 'npx context-mode hook' }] }] },
  }, null, 2)}\n`, 'utf8');
  assert.equal(installCodex(repo, home).status, 0);
  let config = readHooks(home);
  assert.equal(config.hooks.PreToolUse.length, 2);
  // 头部插入：本门先于既有 context-mode hook 执行
  assert.equal(config.hooks.PreToolUse[0].hooks[0].command, SPEC().command);
  assert.equal(config.hooks.PreToolUse[1].hooks[0].command, 'npx context-mode hook');
  assert.match(installCodex(repo, home).stdout, /已是最新/);

  const rem = runWith(['remove-host', 'codex', '--target', '.'], repo, home);
  assert.equal(rem.status, 0, rem.stderr);
  config = readHooks(home);
  assert.equal(config.hooks.PreToolUse.length, 1);
  assert.equal(config.hooks.PreToolUse[0].hooks[0].command, 'npx context-mode hook');
  assert.match(rem.stdout, /已移除用户级 hook 接线/);

  assert.equal(installCodex(repo, home).status, 0);
  const un = runWith(['uninstall', '--target', '.'], repo, home);
  assert.equal(un.status, 0, un.stderr);
  config = readHooks(home);
  assert.equal(config.hooks.PreToolUse.length, 1);
  assert.equal(config.hooks.PreToolUse[0].hooks[0].command, 'npx context-mode hook');
  assert.match(un.stdout, /已移除用户级 hook 接线/);
});

test('invalid user hooks JSON fails loud without overwriting', () => {
  const repo = tmpRepo();
  const home = makeTmp('fk-codex-home-');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(hooksPath(home), '{ broken', 'utf8');
  const r = installCodex(repo, home);
  assert.equal(r.status, 2); // USER_HOOKS_CONFIG → EXIT.USAGE
  assert.match(r.stderr, /用户级 hooks 配置不是合法 JSON/);
  assert.equal(fs.readFileSync(hooksPath(home), 'utf8'), '{ broken');
});
