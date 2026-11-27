import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
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
  const dir = makeTmp('flow-kit-hooks-');
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
  const names = Array.isArray(config.event) ? config.event : [config.event];
  return names.flatMap((event) => (events[event] || []).map((group) => ({ event, ...group })));
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
    const count = host === 'qoder'
      ? text.split('"pre-write-check"').length - 1
      : text.split('flow-kit hook pre-write-check').length - 1;
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
  assert.equal(before[0].split('flow-kit hook pre-shell-check').length - 1, 1);
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
  assert.equal(fs.readFileSync(file, 'utf8').split('flow-kit hook pre-shell-check').length - 1, 1);
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
  assert.match(check.detail, /pre-shell-check/);

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
  assert.match(check.detail, /pre-write-check/);

  // upgrade 会同时补齐缺失和清理过期接线。
  assert.equal(run(['upgrade', '--target', '.', '--json'], dir).status, 0);
  const repaired = readJson(file);
  assert.deepEqual(repaired.hooks.PreToolUse.map((group) => group.matcher), ['Write|Edit|MultiEdit', 'Bash']);
  doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.checks.find((item) => item.name === 'hooks claude').ok, true);
});

test('claude wires the PostToolUse/Agent usage observation leg and doctor accepts it', () => {
  const dir = tmpRepo();
  const r = install(dir, 'claude');
  assert.equal(r.status, 0, r.stderr);
  const config = readJson(hookFile('claude', dir));
  assert.deepEqual(config.hooks.PostToolUse, [{
    matcher: 'Agent',
    hooks: [{ type: 'command', command: 'flow-kit hook usage-collect', timeout: 10 }],
  }]);
  // PreToolUse 两门不受观测腿影响
  assert.deepEqual(config.hooks.PreToolUse.map((group) => group.matcher), ['Write|Edit|MultiEdit', 'Bash']);
  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  const check = doctor.checks.find((item) => item.name === 'hooks claude');
  assert.equal(check.ok, true, JSON.stringify(check));
});

test('claude wires the SessionStart routing leg idempotently; undeclared hosts degrade to advisory', () => {
  const dir = tmpRepo();
  const r = install(dir, 'claude');
  assert.equal(r.status, 0, r.stderr);
  const file = hookFile('claude', dir);
  const config = readJson(file);
  assert.deepEqual(config.hooks.SessionStart, [{
    matcher: 'startup|resume|clear|compact|fork',
    hooks: [{ type: 'command', command: 'flow-kit hook session-context', timeout: 10 }],
  }]);
  // 注入腿不触碰两道门与 usage 观测腿
  assert.deepEqual(config.hooks.PreToolUse.map((group) => group.matcher), ['Write|Edit|MultiEdit', 'Bash']);
  assert.deepEqual(config.hooks.PostToolUse.map((group) => group.matcher), ['Agent']);
  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  const wiring = doctor.checks.find((item) => item.name === 'hooks claude');
  assert.equal(wiring.ok, true, JSON.stringify(wiring));
  assert.equal(doctor.checks.some((item) => item.name === 'guarantee claude'
    && /session-context/.test(item.detail)), false);

  // 幂等重放：升级不重写文件、不重复追加注入腿
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(run(['upgrade', '--target', '.', '--json'], dir).status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(before.split('flow-kit hook session-context').length - 1, 1);

  // 用户开关归用户所有：默认不写、不进 manifest，写了升级也不覆盖（口径同 model-roles.local.json）
  const localRel = '.agents/config/session-context.local.json';
  assert.equal(fs.existsSync(path.join(dir, localRel)), false);
  assert.ok(!readJson(path.join(dir, '.agents/install-manifest.json')).files[localRel]);
  fs.writeFileSync(path.join(dir, localRel), '{"enabled":false}\n', 'utf8');
  assert.equal(run(['upgrade', '--target', '.', '--json'], dir).status, 0);
  assert.equal(fs.readFileSync(path.join(dir, localRel), 'utf8'), '{"enabled":false}\n');

  // 未声明 SessionStart 的宿主：编译期过滤 + doctor guarantee advisory，接线对账不误报
  const other = tmpRepo();
  assert.equal(install(other, 'codebuddy').status, 0);
  assert.equal(readJson(hookFile('codebuddy', other)).hooks.SessionStart, undefined);
  const otherDoctor = json(run(['doctor', '--target', '.', '--json'], other));
  const advisory = otherDoctor.checks.find((item) => item.name === 'guarantee codebuddy'
    && /session-context/.test(item.detail));
  assert.ok(advisory, JSON.stringify(otherDoctor.checks));
  assert.equal(advisory.ok, true);
  assert.equal(advisory.warn, true);
  assert.match(advisory.detail, /SessionStart\/session/);
  assert.match(advisory.detail, /宿主未声明该事件/);
  assert.equal(otherDoctor.checks.find((item) => item.name === 'hooks codebuddy').ok, true);
  assert.equal(otherDoctor.summary.failed, 0);
});

test('doctor reports inapplicable hook spec entries as a guarantee advisory', () => {
  // codebuddy 只声明 PreToolUse：usage-collect（PostToolUse/agent）编译时被静默过滤，
  // doctor 必须给 guarantee advisory 而非置词全无；接线对账不误报。
  const dir = tmpRepo();
  const installed = install(dir, 'codebuddy');
  assert.equal(installed.status, 0, installed.stderr);
  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  const advisory = doctor.checks.find((item) => item.name === 'guarantee codebuddy'
    && /usage-collect/.test(item.detail));
  assert.ok(advisory, JSON.stringify(doctor.checks));
  assert.equal(advisory.ok, true);
  assert.equal(advisory.warn, true);
  assert.match(advisory.detail, /PostToolUse\/agent/);
  assert.match(advisory.detail, /宿主未声明该事件/);
  const wiring = doctor.checks.find((item) => item.name === 'hooks codebuddy');
  assert.equal(wiring.ok, true, JSON.stringify(wiring));
  assert.equal(doctor.summary.failed, 0);
  const plain = run(['doctor', '--target', '.'], dir);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /! guarantee codebuddy/);

  // claude 声明了 PostToolUse/Agent：同一规格条目全部适用，无降级 advisory。
  const claudeDir = tmpRepo();
  assert.equal(install(claudeDir, 'claude').status, 0);
  const claudeDoctor = json(run(['doctor', '--target', '.', '--json'], claudeDir));
  assert.equal(claudeDoctor.checks.some((item) => item.name === 'guarantee claude'
    && /usage-collect/.test(item.detail)), false);
});

test('doctor reports userHooks-only hosts the same inapplicable advisory', () => {
  // codex 只有用户级单事件接线（~/.codex/hooks.json，PreToolUse）：usage-collect
  // （PostToolUse/agent）不接线且无项目级 hooks 对账兜底，doctor 须给同构 guarantee
  // advisory 而非静默；假 HOME 手法同 codex-host.test.mjs。
  const dir = tmpRepo();
  const home = makeTmp('flow-kit-codex-home-');
  const env = { ...process.env, FLOW_KIT_TEST: '1', HOME: home, USERPROFILE: home };
  const runIn = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: 'utf8', env });
  const installed = runIn(['install', '--agent', 'codex', '--stack', 'node', '--target', '.', '--json']);
  assert.equal(installed.status, 0, installed.stderr);
  const doctor = json(runIn(['doctor', '--target', '.', '--json']));
  const advisory = doctor.checks.find((item) => item.name === 'guarantee codex'
    && /usage-collect/.test(item.detail));
  assert.ok(advisory, JSON.stringify(doctor.checks));
  assert.equal(advisory.ok, true);
  assert.equal(advisory.warn, true);
  assert.match(advisory.detail, /PostToolUse\/agent/);
  assert.match(advisory.detail, /宿主未声明该事件/);
  // 用户级接线在位：不误报接线缺失；advisory 不改 exit 语义。
  assert.equal(doctor.checks.find((item) => item.name === 'hooks codex (user)').ok, true);
  assert.equal(doctor.summary.failed, 0);
  const plain = runIn(['doctor', '--target', '.']);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /! guarantee codex/);
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

test('removing an event from the spec drops its managed hook and doctor sees no extra', () => {
  const hooks = spec();
  const cfg = HOSTS.claude.hooks.events;
  const root = {};
  assert.equal(mergeHooksIntoRoot(root, hooks, cfg), true);
  const before = JSON.stringify(root);
  assert.match(before, /session-context/);
  const without = hooks.filter((item) => !String(item.script).includes('session-context'));
  assert.equal(mergeHooksIntoRoot(root, without, cfg), true);
  assert.doesNotMatch(JSON.stringify(root), /session-context/);
  root.hooks.SessionStart = [{ matcher: '', hooks: [{ command: 'echo user' }, { command: 'flow-kit hook session-context' }] }];
  assert.equal(mergeHooksIntoRoot(root, without, cfg), true);
  assert.deepEqual(root.hooks.SessionStart, [{ matcher: '', hooks: [{ command: 'echo user' }] }]);
  const drift = findHookDrift(root, without, cfg);
  assert.equal(drift.extra.length, 0);
  assert.equal(drift.missing.length, 0);
});

test('invalid hook specs are rejected and merge is a no-op on empty input', () => {
  assert.equal(parseHookSpec('{'), null);
  assert.equal(parseHookSpec('{"hooks":[{"event":"PreToolUse","tool":"write"}]}'), null);
  assert.equal(parseHookSpec('{"hooks":[{"event":"PreToolUse","tool":"network","script":".agents/hooks/x.cjs"}]}'), null);
  const root = { hooks: { PreToolUse: [] } };
  assert.equal(mergeHooksIntoRoot(root, [], HOSTS.claude.hooks.events), false);
  const drift = findHookDrift(root, spec(), HOSTS.claude.hooks.events);
  // claude 声明全部四腿（写前门 / 命令门 / usage 观测 / 会话入口注入），空 root 即四条全缺。
  assert.equal(drift.missing.length, 4);
  assert.equal(drift.extra.length, 0);
});
