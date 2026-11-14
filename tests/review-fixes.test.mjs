import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeThreeWay } from '../src/install/baseline.mjs';
import { mergeHooksIntoRoot, parseHookSpec } from '../src/install/hooks.mjs';
import { HOSTS } from '../src/hosts/registry.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-review-');
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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('remove-host strips managed entries but keeps pre-existing user content', () => {
  const dir = tmpRepo();
  writeJson(path.join(dir, '.claude/settings.json'), {
    env: { KEEP: '1' },
    permissions: { allow: ['Bash(make:*)'] },
  });
  writeJson(path.join(dir, '.mcp.json'), { mcpServers: { mine: { command: 'mine' } } });

  assert.equal(install(dir, 'claude').status, 0);
  const remove = json(run(['remove-host', 'claude', '--target', '.', '--json'], dir));
  assert.equal(remove.skipped, 0);

  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(settings.env, { KEEP: '1' });
  assert.ok(settings.permissions.allow.includes('Bash(make:*)'));
  assert.equal('hooks' in settings, false);
  assert.equal(JSON.stringify(settings).includes('.agents/hooks/'), false);

  const mcp = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers.mine, { command: 'mine' });
  assert.equal('flow-kit-wiki' in mcp.mcpServers, false);

  // 重新安装后完整卸载同样保留安装前内容。
  assert.equal(install(dir, 'claude').status, 0);
  assert.equal(run(['uninstall', '--target', '.', '--json'], dir).status, 0);
  const afterUninstall = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(afterUninstall.env, { KEEP: '1' });
  assert.ok(afterUninstall.permissions.allow.includes('Bash(make:*)'));
  assert.equal('hooks' in afterUninstall, false);
});

test('three-way merge reports every multi-hunk conflict as conflict, not unavailable', () => {
  const base = 'a\nb\nc\nd\ne\nf\n';
  const ours = 'A\nb\nc\nd\ne\nF\n';
  const theirs = 'K\nb\nc\nd\ne\nZ\n';
  const merged = mergeThreeWay({ base, ours, theirs });
  assert.equal(merged.status, 'conflict');
  assert.match(merged.text, /<<<<<<< current/);
  assert.equal((merged.text.match(/<<<<<<< current/g) || []).length, 2);
});

test('remote MCP servers use host-native schema (Claude http, OpenCode remote)', () => {
  const dir = tmpRepo();
  writeJson(path.join(dir, '.flow-kit/mcp/servers.json'), {
    servers: { remote: { url: 'https://example.com/mcp' } },
  });
  assert.equal(install(dir, 'claude').status, 0);
  assert.equal(install(dir, 'opencode').status, 0);

  const claude = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
  assert.deepEqual(claude.mcpServers.remote, { type: 'http', url: 'https://example.com/mcp' });
  const opencode = JSON.parse(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'));
  assert.equal(opencode.mcp.remote.type, 'remote');
});

test('adopt records Qwen MCP servers and skips the baseline tree', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'qwen').status, 0);
  assert.equal(fs.existsSync(path.join(dir, '.agents/.kit/baseline')), true);
  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));

  const adopt = json(run(['adopt', '--target', '.', '--json'], dir));
  assert.deepEqual(adopt.modified, []);
  assert.equal(adopt.unrecognized.some((rel) => rel.startsWith('.agents/.kit/')), false);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.mcpServers['.qwen/settings.json'], ['flow-kit-wiki']);
  assert.ok(manifest.managedPermissions['.qwen/settings.json'].deny.length > 0);
});

test('invalid MCP server declarations exit with the usage code', () => {
  const dir = tmpRepo();
  writeJson(path.join(dir, '.flow-kit/mcp/servers.json'), { servers: { bad: {} } });
  const r = install(dir, 'claude');
  assert.equal(r.status, 2, r.stderr);
});

test('doctor validates wiring against the same gates source the installer compiles from', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'claude').status, 0);
  const gatesFile = path.join(dir, '.agents/hooks/gates.json');
  const gates = JSON.parse(fs.readFileSync(gatesFile, 'utf8'));
  gates.deny.push({ tool: 'shell', pat: 'project-local-rule', reason: 'test' });
  writeJson(gatesFile, gates);

  assert.equal(run(['upgrade', '--target', '.', '--json'], dir).status, 0);
  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.summary.failed, 0, JSON.stringify(doctor.checks.filter((c) => !c.ok)));
  assert.equal(doctor.checks.find((c) => c.name === 'permissions claude').ok, true);
  assert.equal(doctor.checks.find((c) => c.name === 'hooks claude').ok, true);
});

test('wiki MCP does not index the baseline tree', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'claude').status, 0);
  const hidden = path.join(dir, '.agents/.kit/baseline/wiki/hidden.md');
  fs.mkdirSync(path.dirname(hidden), { recursive: true });
  fs.writeFileSync(hidden, '# hidden\n\nBASELINEONLYTOKEN\n', 'utf8');

  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'wiki_search', arguments: { query: 'BASELINEONLYTOKEN' } } },
  ].map((request) => JSON.stringify(request)).join('\n');
  const r = spawnSync(process.execPath, [BIN, 'run', 'wiki-mcp', '--root', '.'], {
    cwd: dir,
    input: `${requests}\n`,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No matches\./);
  assert.equal(r.stdout.includes('BASELINEONLYTOKEN'), false);
});

test('managed hook detection uses path boundaries, so wrapper hooks are preserved', () => {
  const spec = parseHookSpec(fs.readFileSync(path.join(KIT, 'templates/engine/.agents/hooks/gates.json'), 'utf8'));
  const cfg = HOSTS.claude.hooks.events;
  const wrapper = {
    matcher: 'Bash',
    hooks: [{ type: 'command', command: 'node .agents/hooks/pre-shell-check.cjs.bak' }],
  };
  const root = { hooks: { PreToolUse: [wrapper] } };
  mergeHooksIntoRoot(root, spec, cfg);
  assert.ok(root.hooks.PreToolUse.some((group) => group.hooks
    .some((hook) => hook.command === 'node .agents/hooks/pre-shell-check.cjs.bak')));
  assert.equal(JSON.stringify(root).split('flow-kit hook pre-shell-check').length - 1, 1);
});
