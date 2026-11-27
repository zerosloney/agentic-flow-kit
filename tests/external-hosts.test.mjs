import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateHostDefinition } from '../src/hosts/external.mjs';
import { mergeHooksIntoRoot, parseHookSpec } from '../src/install/hooks.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpDir(prefix = 'flow-kit-ext-') {
  return makeTmp(prefix);
}

function tmpRepo() {
  const dir = tmpDir();
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

function json(r) {
  assert.equal(r.stdout.trim().startsWith('{'), true, `expected JSON, got: ${r.stdout.slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

function jsonArray(r) {
  assert.equal(r.stdout.trim().startsWith('['), true, `expected JSON array, got: ${r.stdout.slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

function writeHost(dir, name, def) {
  const hostsDir = path.join(dir, '.flow-kit', 'hosts');
  fs.mkdirSync(hostsDir, { recursive: true });
  const file = path.join(hostsDir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(def, null, 2), 'utf8');
  return file;
}

function writeTemplates(dir, name, files) {
  const root = path.join(dir, '.flow-kit', 'hosts', name);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
  }
  return root;
}

const DEMO = {
  name: 'demo',
  dir: '.demo',
  label: 'Demo Host',
  commands: { dir: 'commands', ext: '.md' },
  agents: { dir: 'agents', ext: '.md' },
  skills: { mode: 'index' },
  hooks: null,
};

function installDemo(dir, extra = [], env = {}) {
  return run(['install', '--agent', 'demo', '--stack', 'node', '--lang', 'zh-CN', '--target', '.', '--json', ...extra], dir, env);
}

test('external host installs commands, agents and skill index; diff/upgrade/adopt stay clean', () => {
  const dir = tmpRepo();
  writeHost(dir, 'demo', DEMO);
  writeTemplates(dir, 'demo', {
    'commands/greet.md': '# greet\n\nSay hello.\n',
    'agents/helper.md': '---\nname: helper\n---\n\nHelp out.\n',
  });

  const r = installDemo(dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.deepEqual(out.hosts, ['demo']);
  assert.ok(fs.existsSync(path.join(dir, '.demo/commands/greet.md')));
  assert.ok(fs.existsSync(path.join(dir, '.demo/agents/helper.md')));
  assert.ok(fs.existsSync(path.join(dir, '.demo/commands/wf-skills.md')));

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.hosts, ['demo']);

  const hosts = jsonArray(run(['list-hosts', '--target', '.', '--json'], dir));
  const demo = hosts.find((h) => h.name === 'demo');
  assert.equal(demo.source, 'project');
  assert.equal(demo.dir, '.demo');
  assert.equal(hosts.filter((h) => h.source === 'builtin').length, 14);

  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.unchanged, diff.summary.total);

  const upgrade = json(run(['upgrade', '--target', '.', '--json'], dir));
  assert.deepEqual(upgrade.conflicts, []);
  assert.equal(upgrade.stats.conflict, 0);

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.summary.failed, 0, JSON.stringify(doctor.checks.filter((c) => !c.ok)));
  const source = doctor.checks.find((c) => c.name === 'host demo source');
  assert.ok(source);
  assert.match(source.detail, /project/);

  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));
  const adopt = json(run(['adopt', '--target', '.', '--json'], dir));
  assert.deepEqual(adopt.hosts, ['demo']);
  assert.deepEqual(adopt.modified, []);
  const after = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(after.summary.unchanged, after.summary.total);
});

test('external hosts can opt into the hook compiler via hooks.events', () => {
  const dir = tmpRepo();
  writeHost(dir, 'demo', {
    ...DEMO,
    hooks: {
      file: 'hooks.json',
      events: {
        event: 'PreToolUse',
        container: 'hooks',
        matchers: { shell: 'Bash' },
        tools: ['shell'],
        timeouts: { shell: 600 },
        command: { form: 'relative', template: 'node {script}' },
      },
    },
  });
  writeTemplates(dir, 'demo', { 'hooks.json': '{"hooks":{}}\n' });

  const r = installDemo(dir);
  assert.equal(r.status, 0, r.stderr);
  const hooks = JSON.parse(fs.readFileSync(path.join(dir, '.demo/hooks.json'), 'utf8'));
  assert.deepEqual(hooks.hooks.PreToolUse, [{
    matcher: 'Bash',
    hooks: [{ type: 'command', command: 'node .agents/hooks/pre-shell-check.cjs', timeout: 600 }],
  }]);

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  const check = doctor.checks.find((item) => item.name === 'hooks demo');
  assert.ok(check);
  assert.equal(check.ok, true, check.detail);
});

const T = (key, vars) => `${vars.file}: ${vars.detail}`;

function hostWithEvents(event) {
  return validateHostDefinition({
    name: 'demo',
    dir: '.demo',
    hooks: {
      file: 'hooks.json',
      events: {
        event,
        container: 'hooks',
        matchers: { shell: 'Bash' },
        tools: ['shell'],
        timeouts: { shell: 600 },
        command: { form: 'relative', template: 'node {script}' },
      },
    },
  }, 'demo.json', T);
}

const SHELL_SPEC = () => parseHookSpec(JSON.stringify({ hooks: [
  { event: 'PreToolUse', tool: 'shell', script: '.agents/hooks/a.cjs' },
  { event: 'PostToolUse', tool: 'shell', script: '.agents/hooks/b.cjs' },
] }));

test('external host event arrays normalize like built-ins and compile each event', () => {
  // 去空白、去重、保序，统一归一为数组（与内置 claude 的数组声明同形）。
  const def = hostWithEvents(['PreToolUse', ' PostToolUse ', 'PostToolUse']);
  assert.deepEqual(def.hooks.events.event, ['PreToolUse', 'PostToolUse']);

  const cfg = def.hooks.events;
  const root = {};
  assert.equal(mergeHooksIntoRoot(root, SHELL_SPEC(), cfg), true);
  assert.deepEqual(Object.keys(root.hooks).sort(), ['PostToolUse', 'PreToolUse']);
  assert.equal(root.hooks.PreToolUse[0].hooks[0].command, 'node .agents/hooks/a.cjs');
  assert.equal(root.hooks.PostToolUse[0].hooks[0].command, 'node .agents/hooks/b.cjs');
});

test('external host single-string event stays accepted (normalized to array)', () => {
  assert.deepEqual(hostWithEvents('PreToolUse').hooks.events.event, ['PreToolUse']);
});

test('external host rejects invalid event arrays', () => {
  for (const event of [[], ['PreToolUse', 42], ['PreToolUse', '   '], '   ', 42]) {
    assert.throws(() => hostWithEvents(event), (err) => err.code === 'HOST_MANIFEST'
      && /hooks\.events\.event/.test(err.message), JSON.stringify(event));
  }
});

test('external host installs with a multi-event hooks.events declaration', () => {
  const dir = tmpRepo();
  writeHost(dir, 'demo', {
    ...DEMO,
    hooks: {
      file: 'hooks.json',
      events: {
        event: ['PreToolUse', 'PostToolUse', 'SessionStart'],
        container: 'hooks',
        matchers: { write: 'Write|Edit', shell: 'Bash' },
        tools: ['write', 'shell'],
        timeouts: { write: 120, shell: 600 },
        command: { form: 'relative', template: 'node {script}' },
      },
    },
  });
  writeTemplates(dir, 'demo', { 'hooks.json': '{"hooks":{}}\n' });

  const r = installDemo(dir);
  assert.equal(r.status, 0, r.stderr);
  const hooks = JSON.parse(fs.readFileSync(path.join(dir, '.demo/hooks.json'), 'utf8'));
  // 默认 gates 规格只有 PreToolUse 落在 write/shell 工具面：两条 matcher 分组都接线。
  assert.deepEqual(hooks.hooks.PreToolUse.map((group) => group.matcher), ['Write|Edit', 'Bash']);

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  const check = doctor.checks.find((item) => item.name === 'hooks demo');
  assert.ok(check);
  assert.equal(check.ok, true, check.detail);
});

test('external hosts can opt into the permission compiler', () => {
  const dir = tmpRepo();
  writeHost(dir, 'demo', {
    ...DEMO,
    permissions: { file: 'settings.json', syntax: 'colon', tool: 'Bash', tools: ['shell'] },
  });
  writeTemplates(dir, 'demo', { 'settings.json': '{"permissions":{}}\n' });

  const r = installDemo(dir);
  assert.equal(r.status, 0, r.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(dir, '.demo/settings.json'), 'utf8'));
  assert.ok(config.permissions.allow.includes('Bash(npm run:*)'));
  assert.ok(config.permissions.deny.includes('Bash(git reset --hard:*)'));
  assert.deepEqual(config.permissions.ask, [
    'Bash(git checkout:*)', 'Bash(git clean:*)', 'Bash(git branch -D:*)', 'Bash(rm -rf:*)',
  ]);
});

test('priority is builtin < user < --host-manifest; project layer may only add new hosts', () => {
  const project = tmpRepo();
  const home = tmpDir('flow-kit-home-');
  const env = { HOME: home, USERPROFILE: home };
  const userHosts = path.join(home, '.flow-kit', 'hosts');
  fs.mkdirSync(userHosts, { recursive: true });

  const trae = (label) => ({ name: 'trae', dir: '.trae', label, skills: { mode: 'index' } });
  fs.writeFileSync(path.join(userHosts, 'trae.json'), JSON.stringify(trae('User Trae')), 'utf8');

  const cliFile = path.join(project, 'cli-trae.json');
  fs.writeFileSync(cliFile, JSON.stringify(trae('CLI Trae')), 'utf8');

  const lookup = (args = []) => {
    const r = run(['list-hosts', '--target', '.', '--json', ...args], project, env);
    assert.equal(r.status, 0, r.stderr);
    return jsonArray(r).find((h) => h.name === 'trae');
  };

  // 用户层可覆盖内置宿主
  assert.equal(lookup().label, 'User Trae');
  assert.equal(lookup().source, 'user');

  // 项目层随仓库分发，不允许重定义既有宿主（内置或用户层）
  writeHost(project, 'trae', trae('Project Trae'));
  const rejected = run(['list-hosts', '--target', '.', '--json'], project, env);
  assert.equal(rejected.status, 2, rejected.stderr);
  assert.match(rejected.stderr, /already exists/);
  fs.rmSync(path.join(project, '.flow-kit', 'hosts', 'trae.json'));

  // 显式 --host-manifest 仍可覆盖
  assert.equal(lookup(['--host-manifest', 'cli-trae.json']).label, 'CLI Trae');
  assert.equal(lookup(['--host-manifest', 'cli-trae.json']).source, 'cli');

  fs.rmSync(userHosts, { recursive: true });
  fs.rmSync(cliFile);
  assert.equal(lookup().label, 'Trae');
  assert.equal(lookup().source, 'builtin');
});

test('--host-manifest loads a standalone definition with a sibling template tree', () => {
  const dir = tmpRepo();
  const kitDir = tmpDir('flow-kit-hosts-');
  const file = path.join(kitDir, 'acme.json');
  fs.writeFileSync(file, JSON.stringify({
    name: 'acme', dir: '.acme', commands: { dir: 'commands' }, agents: null, skills: { mode: 'index' },
  }), 'utf8');
  const tpl = path.join(kitDir, 'acme', 'commands');
  fs.mkdirSync(tpl, { recursive: true });
  fs.writeFileSync(path.join(tpl, 'run.md'), '# run\n', 'utf8');

  const r = run(['install', '--agent', 'acme', '--stack', 'node', '--target', '.', '--json', '--host-manifest', file], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.acme/commands/run.md')));
  assert.ok(fs.existsSync(path.join(dir, '.acme/commands/wf-skills.md')));
});

test('invalid host definitions fail with usage exit and a field-level detail', () => {
  const cases = [
    ['missing dir', { name: 'demo' }, /`dir`/],
    ['bad name', { name: 'Demo', dir: '.demo' }, /`name`/],
    ['unknown key', { name: 'demo', dir: '.demo', skils: { mode: 'index' } }, /unknown key `skils`/],
    ['bad skill mode', { name: 'demo', dir: '.demo', skills: { mode: 'auto' } }, /`skills.mode`/],
    ['modelField without inheritValue', { name: 'demo', dir: '.demo', agents: { dir: 'agents', modelField: 'model' } }, /inheritValue/],
    ['missing templates dir', { name: 'demo', dir: '.demo', templates: './nowhere' }, /templates/],
    ['missing skillMeta dir', { name: 'demo', dir: '.demo', skillMeta: './nowhere' }, /skillMeta/],
    ['bad mcp format', { name: 'demo', dir: '.demo', mcp: { file: '.mcp.json', format: 'vscode' } }, /`mcp\.format`/],
    ['mcp.scope not supported', { name: 'demo', dir: '.demo', mcp: { file: '.mcp.json', scope: 'project' } }, /`mcp\.scope`/],
    ['skills.file parent segment', { name: 'demo', dir: '.demo', skills: { mode: 'native', dir: 'skills', file: '../x' } }, /`skills\.file`/],
    ['skills.file backslash traversal', { name: 'demo', dir: '.demo', skills: { mode: 'native', dir: 'skills', file: '..\\..\\evil' } }, /`skills\.file`/],
    ['hookExtras overrides command', {
      name: 'demo', dir: '.demo',
      hooks: { file: 'hooks.json', events: { event: 'PreToolUse', matchers: { shell: 'Bash' }, command: { form: 'relative', template: 'node {script}' }, hookExtras: { command: 'evil' } } },
    }, /`hooks\.events\.hookExtras\.command`/],
    ['hookExtras overrides args', {
      name: 'demo', dir: '.demo',
      hooks: { file: 'hooks.json', events: { event: 'PreToolUse', matchers: { shell: 'Bash' }, command: { form: 'relative', template: 'node {script}' }, hookExtras: { args: ['--evil'] } } },
    }, /`hooks\.events\.hookExtras\.args`/],
  ];
  for (const [label, def, pattern] of cases) {
    const dir = tmpRepo();
    writeHost(dir, 'demo', def);
    const r = installDemo(dir);
    assert.equal(r.status, 2, `${label}: ${r.stderr}`);
    assert.match(r.stderr, pattern, label);
    assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false, label);
  }

  const dir = tmpRepo();
  writeHost(dir, 'demo', DEMO);
  const file = path.join(dir, '.flow-kit', 'hosts', 'demo.json');
  fs.writeFileSync(file, '{ not json', 'utf8');
  const r = installDemo(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /invalid JSON/);
});

// ---- 加载边界：项目层不可重定义既有宿主，定义文件限大小 ----
// 项目内 .flow-kit/hosts/*.json 随仓库分发，属不可信输入：允许新增宿主，但不能
// 改写内置/用户层宿主的权限与门禁能力；显式 --host-manifest 仍是覆盖通道。

test('project-level host JSON cannot redefine a built-in host', () => {
  const dir = tmpRepo();
  writeHost(dir, 'claude', { name: 'claude', dir: '.claude' });
  const r = run(['list-hosts', '--target', '.', '--json'], dir);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /already exists/);
  assert.match(r.stderr, /--host-manifest/);
});

test('user-level host JSON may still override a built-in host', () => {
  const dir = tmpRepo();
  const home = makeTmp('flow-kit-home-');
  const hostsDir = path.join(home, '.flow-kit', 'hosts');
  fs.mkdirSync(hostsDir, { recursive: true });
  fs.writeFileSync(path.join(hostsDir, 'claude.json'),
    JSON.stringify({ name: 'claude', dir: '.claude-alt' }), 'utf8');

  const r = run(['list-hosts', '--target', '.', '--json'], dir, { HOME: home, USERPROFILE: home });
  assert.equal(r.status, 0, r.stderr);
  const claude = jsonArray(r).find((h) => h.name === 'claude');
  assert.equal(claude.source, 'user');
  assert.equal(claude.dir, '.claude-alt');
});

test('oversized host manifest is rejected before parsing', () => {
  const dir = tmpRepo();
  writeHost(dir, 'huge', { name: 'huge', dir: '.huge' });
  const file = path.join(dir, '.flow-kit', 'hosts', 'huge.json');
  fs.writeFileSync(file, JSON.stringify({ name: 'huge', dir: '.huge', pad: 'x'.repeat(1024 * 1024) }), 'utf8');
  const r = run(['list-hosts', '--target', '.', '--json'], dir);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /too large/);
});

test('--probe-models refuses CLI commands from an auto-loaded project manifest', () => {
  const dir = tmpRepo();
  const marker = path.join(dir, 'probe-ran.txt');
  writeHost(dir, 'probe-project', {
    name: 'probe-project',
    dir: '.probe-project',
    agents: null,
    commands: null,
    skills: { mode: 'index' },
    modelProbe: {
      configs: [],
      env: [],
      cli: [{ command: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`] }],
    },
  });

  const r = run(['install', '--agent', 'probe-project', '--stack', 'node', '--target', '.', '--probe-models', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(marker), false, 'project-level probe command must not run');
  assert.doesNotMatch(r.stderr, /将执行宿主 probe-project/, 'refused probe must not be announced as running');
  assert.match(r.stderr, /refused to run model probe commands.*probe-project/);
  assert.match(r.stderr, /--host-manifest/);
});

test('install text mode announces only probes it will run and names the refusal', () => {
  const dir = tmpRepo();
  writeHost(dir, 'probe-text', {
    name: 'probe-text',
    dir: '.probe-text',
    agents: null,
    commands: null,
    skills: { mode: 'index' },
    modelProbe: { configs: [], env: [], cli: [{ command: 'probe-text-cli', args: ['--list'] }] },
  });

  const r = run(['install', '--agent', 'probe-text', '--stack', 'node', '--target', '.', '--probe-models'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /将执行宿主 probe-text/, 'refused probe must not be announced as running');
  assert.match(r.stderr, /refused to run model probe commands.*probe-text/);
  assert.match(r.stderr, /--host-manifest/);
});

test('--probe-models runs CLI commands from a user-level host manifest', () => {
  const dir = tmpRepo();
  const home = makeTmp('flow-kit-home-');
  const hostsDir = path.join(home, '.flow-kit', 'hosts');
  fs.mkdirSync(hostsDir, { recursive: true });
  const marker = path.join(dir, 'user-probe-ran.txt');
  fs.writeFileSync(path.join(hostsDir, 'user-probe.json'), JSON.stringify({
    name: 'user-probe',
    dir: '.user-probe',
    agents: null,
    commands: null,
    skills: { mode: 'index' },
    modelProbe: {
      configs: [],
      env: [],
      cli: [{ command: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`] }],
    },
  }), 'utf8');

  const r = run(['install', '--agent', 'user-probe', '--stack', 'node', '--target', '.', '--probe-models', '--json'],
    dir, { HOME: home, USERPROFILE: home });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(marker), true, 'user-level probe command should run');
});
