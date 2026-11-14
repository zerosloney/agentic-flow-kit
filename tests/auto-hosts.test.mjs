import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectHosts } from '../src/hosts/detect.mjs';
import { HOSTS, HOST_NAMES } from '../src/hosts/registry.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-auto-');
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

function json(r) {
  return JSON.parse(r.stdout);
}

test('every host directory is detected', () => {
  const dir = tmpRepo();
  for (const name of HOST_NAMES) fs.mkdirSync(path.join(dir, HOSTS[name].dir), { recursive: true });
  assert.deepEqual(detectHosts(dir), HOST_NAMES);
});

test('root config and memory files are detection signals', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'QWEN.md'), '# qwen\n', 'utf8');
  const hosts = detectHosts(dir);
  assert.ok(hosts.includes('opencode'));
  assert.ok(hosts.includes('qwen'));
  assert.equal(hosts.includes('claude'), false);

  fs.writeFileSync(path.join(dir, '.mcp.json'), '{}\n', 'utf8');
  assert.ok(detectHosts(dir).includes('claude'));
});

test('install --auto-hosts adopts detected hosts and reports them in JSON', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.claude'));

  const r = run(['install', '--auto-hosts', '--lang', 'zh-CN', '--stack', 'node', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.deepEqual(out.detectedHosts, ['claude']);
  assert.deepEqual(out.hosts, ['claude']);
  assert.ok(fs.existsSync(path.join(dir, '.claude/commands/wf-new-task.md')));

  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  assert.deepEqual(manifest.hosts, ['claude']);
  assert.equal('detectedHosts' in manifest, false, '探测结果不写 manifest');
});

test('explicit --agent wins over --auto-hosts', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.claude'));

  const r = run(['install', '--agent', 'trae', '--auto-hosts', '--lang', 'zh-CN', '--stack', 'node', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.deepEqual(out.detectedHosts, ['claude']);
  assert.deepEqual(out.hosts, ['trae']);
  assert.deepEqual(JSON.parse(read(dir, '.agents/install-manifest.json')).hosts, ['trae']);
});

test('--auto-hosts with no signals fails clearly and writes nothing', () => {
  const dir = tmpRepo();
  const r = run(['install', '--auto-hosts', '--target', '.'], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /未探测到任何宿主/);
  assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false);
});

test('install without --agent or --auto-hosts still requires a host', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.claude'));
  const r = run(['install', '--target', '.'], dir);
  assert.equal(r.status, 2);
  assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false);
});
