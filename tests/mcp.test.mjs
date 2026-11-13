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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-mcp-'));
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

function install(dir, hosts, extra = []) {
  const agents = hosts.flatMap((host) => ['--agent', host]);
  const r = run(['install', ...agents, '--stack', 'node', '--lang', 'zh-CN', '--target', '.', '--json', ...extra], dir);
  assert.equal(r.status, 0, r.stderr);
  return json(r);
}

function readJson(dir, rel) {
  return JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
}

test('compiles the neutral server list into Claude, OpenCode and Qwen configs', () => {
  const dir = tmpRepo();
  install(dir, ['claude', 'opencode', 'qwen']);

  const claude = readJson(dir, '.mcp.json');
  assert.equal(claude.mcpServers['flow-kit-wiki'].command, 'node');
  assert.deepEqual(claude.mcpServers['flow-kit-wiki'].args, ['.agents/scripts/wiki-mcp.mjs']);

  const opencode = readJson(dir, 'opencode.json');
  assert.deepEqual(opencode.mcp['flow-kit-wiki'], {
    type: 'local',
    command: ['node', '.agents/scripts/wiki-mcp.mjs'],
    enabled: true,
  });

  const qwen = readJson(dir, '.qwen/settings.json');
  assert.equal(qwen.mcpServers['flow-kit-wiki'].command, 'node');
  // Qwen 的 settings.json 同时承载 hooks/permissions：MCP 合并不能丢掉静态宿主模板。
  assert.ok(qwen.hooks, 'qwen hooks preserved');
  assert.ok(qwen.permissions, 'qwen permissions preserved');

  const manifest = readJson(dir, '.agents/install-manifest.json');
  assert.equal(manifest.mcp, true);
  assert.deepEqual(Object.keys(manifest.mcpServers).sort(), ['.mcp.json', '.qwen/settings.json', 'opencode.json']);

  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.unchanged, diff.summary.total);

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.summary.failed, 0, JSON.stringify(doctor.checks.filter((c) => !c.ok)));
  assert.ok(doctor.checks.some((c) => c.name === 'mcp claude' && c.ok));
});

test('repeated install is idempotent and preserves user servers', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, '.mcp.json'), `${JSON.stringify({
    mcpServers: { mine: { command: 'mine', args: ['--flag'] } },
    permissions: { allow: ['Bash'] },
  }, null, 2)}\n`, 'utf8');

  install(dir, ['claude']);
  let claude = readJson(dir, '.mcp.json');
  assert.deepEqual(claude.mcpServers.mine, { command: 'mine', args: ['--flag'] });
  assert.deepEqual(claude.permissions, { allow: ['Bash'] });
  assert.ok(claude.mcpServers['flow-kit-wiki']);

  const before = fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8');
  install(dir, ['claude']);
  assert.equal(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'), before);

  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.unchanged, diff.summary.total);
});

test('--no-mcp writes no MCP config and records the choice', () => {
  const dir = tmpRepo();
  install(dir, ['claude', 'opencode'], ['--no-mcp']);

  assert.equal(fs.existsSync(path.join(dir, '.mcp.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'opencode.json')), false);

  const manifest = readJson(dir, '.agents/install-manifest.json');
  assert.equal(manifest.mcp, false);
  assert.deepEqual(manifest.mcpServers, {});

  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.missing, 0);
  assert.equal(diff.summary.unchanged, diff.summary.total);

  // upgrade 重放既有选择，不会擅自打开
  const upgrade = json(run(['upgrade', '--target', '.', '--json'], dir));
  assert.equal(upgrade.mcp, false);
  assert.equal(fs.existsSync(path.join(dir, '.mcp.json')), false);
});

test('upgrade wires MCP for manifests created before the feature', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  const manifestPath = path.join(dir, '.agents/install-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  delete manifest.mcp;
  delete manifest.mcpServers;
  delete manifest.files['.mcp.json'];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.rmSync(path.join(dir, '.mcp.json'));

  const upgrade = json(run(['upgrade', '--target', '.', '--json'], dir));
  assert.equal(upgrade.mcp, true);
  assert.ok(fs.existsSync(path.join(dir, '.mcp.json')));
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).mcp, true);
});

test('doctor reports missing and malformed MCP configs', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);

  fs.rmSync(path.join(dir, '.mcp.json'));
  let doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.ok(doctor.checks.some((c) => c.name === 'mcp claude' && !c.ok));

  fs.writeFileSync(path.join(dir, '.mcp.json'), '{ nope', 'utf8');
  doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  const invalid = doctor.checks.find((c) => c.name === 'mcp claude');
  assert.equal(invalid.ok, false);
  assert.match(invalid.detail, /JSON/);
});

test('uninstall removes managed MCP configs but keeps user servers', () => {
  const dir = tmpRepo();
  install(dir, ['claude', 'opencode']);
  const claudePath = path.join(dir, '.mcp.json');
  const claude = JSON.parse(fs.readFileSync(claudePath, 'utf8'));
  claude.mcpServers.mine = { command: 'mine' };
  fs.writeFileSync(claudePath, `${JSON.stringify(claude, null, 2)}\n`, 'utf8');

  const out = json(run(['uninstall', '--target', '.', '--json'], dir));
  assert.equal(out.skipped, 0);

  const kept = JSON.parse(fs.readFileSync(claudePath, 'utf8'));
  assert.deepEqual(kept.mcpServers.mine, { command: 'mine' });
  assert.equal('flow-kit-wiki' in kept.mcpServers, false);
  assert.equal(fs.existsSync(path.join(dir, 'opencode.json')), false);
});

test('wiki MCP server speaks initialize / tools/list / tools/call', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  fs.mkdirSync(path.join(dir, 'wiki'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'wiki', 'note.md'), '# note\n\nunique-needle\n', 'utf8');

  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'wiki_search', arguments: { query: 'unique-needle' } } },
  ].map((request) => JSON.stringify(request)).join('\n');

  const r = spawnSync(process.execPath, [path.join(dir, '.agents/scripts/wiki-mcp.mjs')], {
    cwd: dir,
    input: `${requests}\n`,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const replies = r.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(replies.length, 3, 'notifications must not be answered');
  assert.equal(replies.find((m) => m.id === 1).result.serverInfo.name, 'flow-kit-wiki');
  assert.equal(replies.find((m) => m.id === 2).result.tools[0].name, 'wiki_search');
  const text = replies.find((m) => m.id === 3).result.content[0].text;
  assert.match(text, /wiki\/note\.md:3: unique-needle/);
});
