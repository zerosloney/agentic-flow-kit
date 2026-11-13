import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  compileHookGroups, findHookDrift, mergeHooksIntoRoot, parseHookSpec,
} from '../src/install/hooks.mjs';
import { buildPlan } from '../src/install/plan.mjs';
import { HOSTS } from '../src/hosts/registry.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const FIXTURES = path.join(KIT, 'tests', 'fixtures', 'hooks');
const GOLDEN_HOSTS = ['claude', 'codebuddy', 'trae', 'qwen', 'qoder', 'zcode', 'commandcode'];

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-hooks-'));
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

function install(dir, host, extra = []) {
  return run(['install', '--agent', host, '--stack', 'node', '--target', '.', '--json', ...extra], dir);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hookFile(host, dir) {
  return path.join(dir, HOSTS[host].dir, HOSTS[host].hooks.file);
}

function readInstalledGroups(host, dir) {
  const root = readJson(hookFile(host, dir));
  const config = HOSTS[host].hooks.events;
  const container = String(config.container || 'hooks').split('.');
  const events = container.reduce((node, key) => node?.[key], root);
  return (events[config.event] || []).map((group) => ({ event: config.event, ...group }));
}

function golden(host) {
  return readJson(path.join(FIXTURES, `${host}.json`));
}

function spec() {
  return parseHookSpec(fs.readFileSync(path.join(KIT, 'templates/engine/.agents/hooks/gates.json'), 'utf8'));
}

test('golden: neutral gates spec compiles to the verified host schemas', () => {
  const hooks = spec();
  assert.ok(hooks.length >= 2);
  for (const host of GOLDEN_HOSTS) {
    assert.deepEqual(compileHookGroups(hooks, HOSTS[host].hooks.events), golden(host), host);
  }
});

test('covered hosts install the compiled wiring without duplicating it', () => {
  const dir = tmpRepo();
  for (const host of GOLDEN_HOSTS) {
    const r = install(dir, host);
    assert.equal(r.status, 0, `${host}: ${r.stderr}`);
  }
  for (const host of GOLDEN_HOSTS) {
    assert.deepEqual(readInstalledGroups(host, dir), golden(host), host);
    const text = fs.readFileSync(hookFile(host, dir), 'utf8');
    const count = text.split('pre-write-check.cjs').length - 1;
    // Trae 只接命令门禁；其余宿主各一条写前门。
    assert.equal(count, host === 'trae' ? 0 : 1, `${host}: duplicated wiring in ${text}`);
  }
});

test('reinstalling does not rewrite or duplicate host hook files', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'claude').status, 0);
  assert.equal(install(dir, 'qwen').status, 0);
  const files = ['claude', 'qwen'].map((host) => hookFile(host, dir));
  const before = files.map((file) => fs.readFileSync(file, 'utf8'));
  const upgrade = json(run(['upgrade', '--target', '.', '--json'], dir));
  assert.equal(upgrade.stats.conflict, 0);
  files.forEach((file, index) => {
    assert.equal(fs.readFileSync(file, 'utf8'), before[index], path.basename(file));
  });
  assert.equal(before[0].split('pre-shell-check.cjs').length - 1, 1);
});

test('user hooks and unrelated settings survive; managed wiring is repaired', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'claude').status, 0);
  const file = hookFile('claude', dir);
  const config = readJson(file);
  config.customTopLevel = 'keep-me';
  config.hooks.PreToolUse[1].hooks[0].timeout = 999;
  config.hooks.PreToolUse.unshift({
    matcher: 'Read',
    hooks: [{ type: 'command', command: 'node scripts/my-hook.mjs' }],
  });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  assert.equal(run(['upgrade', '--target', '.', '--json'], dir).status, 0);
  const after = readJson(file);
  assert.equal(after.customTopLevel, 'keep-me');
  assert.ok(after.hooks.PreToolUse.some((group) => group.matcher === 'Read'
    && group.hooks.some((hook) => hook.command === 'node scripts/my-hook.mjs')));
  const shell = after.hooks.PreToolUse.find((group) => group.matcher === 'Bash');
  assert.equal(shell.hooks[0].timeout, 800);
  assert.equal(fs.readFileSync(file, 'utf8').split('pre-shell-check.cjs').length - 1, 1);
});

test('doctor detects missing and stale hook wiring', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'claude').status, 0);
  const file = hookFile('claude', dir);

  const config = readJson(file);
  config.hooks.PreToolUse = config.hooks.PreToolUse.filter((group) => group.matcher !== 'Bash');
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  let doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  let check = doctor.checks.find((item) => item.name === 'hooks claude');
  assert.equal(check.ok, false);
  assert.match(check.detail, /缺失/);
  assert.match(check.detail, /pre-shell-check\.cjs/);

  // 先补齐缺失，再单独验证“多余接线”：托管脚本被挂到了错误的 matcher 上。
  assert.equal(run(['upgrade', '--target', '.', '--json'], dir).status, 0);
  const repairedConfig = readJson(file);
  repairedConfig.hooks.PreToolUse.push({
    matcher: 'Read',
    hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR"/.agents/hooks/pre-write-check.cjs', timeout: 120 }],
  });
  fs.writeFileSync(file, `${JSON.stringify(repairedConfig, null, 2)}\n`, 'utf8');
  doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  check = doctor.checks.find((item) => item.name === 'hooks claude');
  assert.equal(check.ok, false);
  assert.match(check.detail, /多余|过期/);
  assert.match(check.detail, /pre-write-check\.cjs/);

  // upgrade 会同时补齐缺失和清理过期接线。
  assert.equal(run(['upgrade', '--target', '.', '--json'], dir).status, 0);
  const repaired = readJson(file);
  assert.deepEqual(repaired.hooks.PreToolUse.map((group) => group.matcher), ['Write|Edit|MultiEdit', 'Bash']);
  doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.checks.find((item) => item.name === 'hooks claude').ok, true);
});

test('hosts without hooks.events keep the static template fallback', () => {
  for (const host of ['opencode', 'pi', 'cline']) {
    const plan = buildPlan({
      target: os.tmpdir(),
      hosts: [host],
      lang: 'zh-CN',
      stack: 'node',
      projectName: 'fallback',
      mcp: false,
    });
    assert.equal(plan.entries.some((entry) => entry.kind === 'merge-host'), false, host);
  }
  const covered = buildPlan({
    target: os.tmpdir(),
    hosts: ['claude'],
    lang: 'zh-CN',
    stack: 'node',
    projectName: 'covered',
    mcp: false,
  });
  assert.equal(covered.entries.filter((entry) => entry.kind === 'merge-host').length, 1);
});

test('Qwen settings.json carries hooks and MCP in one idempotent file', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'qwen').status, 0);
  const file = hookFile('qwen', dir);
  let config = readJson(file);
  assert.ok(config.mcpServers['flow-kit-wiki']);
  assert.deepEqual(readInstalledGroups('qwen', dir), golden('qwen'));
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(run(['upgrade', '--target', '.', '--json'], dir).status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  const nomcp = tmpRepo();
  assert.equal(install(nomcp, 'qwen', ['--no-mcp']).status, 0);
  config = readJson(hookFile('qwen', nomcp));
  assert.equal(config.mcpServers, undefined);
  assert.deepEqual(readInstalledGroups('qwen', nomcp), golden('qwen'));
});

test('invalid hook specs are rejected and merge is a no-op on empty input', () => {
  assert.equal(parseHookSpec('{'), null);
  assert.equal(parseHookSpec('{"hooks":[{"event":"PreToolUse","tool":"write"}]}'), null);
  assert.equal(parseHookSpec('{"hooks":[{"event":"PreToolUse","tool":"network","script":".agents/hooks/x.cjs"}]}'), null);
  const root = { hooks: { PreToolUse: [] } };
  assert.equal(mergeHooksIntoRoot(root, [], HOSTS.claude.hooks.events), false);
  const drift = findHookDrift(root, spec(), HOSTS.claude.hooks.events);
  assert.equal(drift.missing.length, 2);
  assert.equal(drift.extra.length, 0);
});
