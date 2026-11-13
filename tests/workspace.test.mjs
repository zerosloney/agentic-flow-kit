import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-workspace-'));
  return dir;
}

function gitRepo(root, rel) {
  const abs = path.join(root, rel);
  fs.mkdirSync(abs, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: abs });
  return abs;
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

test('workspace init records repo install summaries and status aggregates them', () => {
  const root = tmpWorkspace();
  gitRepo(root, 'api');
  gitRepo(root, 'web');
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--target', 'api', '--json'], root).status, 0);

  const init = json(run(['workspace', 'init', '--repos', 'api', 'web', '--target', '.', '--json'], root));
  assert.equal(init.command, 'workspace init');
  assert.equal(init.repos.length, 2);
  const api = init.repos.find((repo) => repo.path === 'api');
  assert.equal(api.installed, true);
  assert.deepEqual(api.hosts, ['claude']);
  assert.equal(api.stack, 'node');
  assert.equal(init.repos.find((repo) => repo.path === 'web').installed, false);

  const configPath = path.join(root, '.flow-kit/workspace.json');
  assert.equal(fs.existsSync(configPath), true);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.kit, 'agentic-flow-kit');
  assert.equal(config.createdAt, init.createdAt);

  const status = json(run(['workspace', 'status', '--target', '.', '--json'], root));
  assert.equal(status.command, 'workspace status');
  assert.deepEqual(status.summary, { repos: 2, installed: 1, missing: 1 });
  assert.equal(status.repos.find((repo) => repo.path === 'api').installed, true);
});

test('workspace init is idempotent and preserves createdAt', () => {
  const root = tmpWorkspace();
  gitRepo(root, 'api');
  const first = json(run(['workspace', 'init', '--repos', 'api', '--target', '.', '--json'], root));
  const second = json(run(['workspace', 'init', '--repos', 'api', '--target', '.', '--json'], root));
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.repos.length, 1);
});

test('workspace status flags a repo path that disappeared after init', () => {
  const root = tmpWorkspace();
  const web = gitRepo(root, 'web');
  json(run(['workspace', 'init', '--repos', 'web', '--target', '.', '--json'], root));
  fs.rmSync(web, { recursive: true, force: true });

  const status = json(run(['workspace', 'status', '--target', '.', '--json'], root));
  assert.equal(status.repos[0].missingPath, true);
  assert.equal(status.repos[0].installed, false);
  assert.equal(status.summary.missing, 1);
});

test('workspace rejects invalid repos and missing configuration', () => {
  const root = tmpWorkspace();
  fs.mkdirSync(path.join(root, 'plain'));
  const noGit = run(['workspace', 'init', '--repos', 'plain', '--target', '.', '--json'], root);
  assert.equal(noGit.status, 2);
  assert.match(noGit.stderr, /git/);

  const outside = run(['workspace', 'init', '--repos', '../outside', '--target', '.', '--json'], root);
  assert.equal(outside.status, 2);

  const noRepos = run(['workspace', 'init', '--target', '.', '--json'], root);
  assert.equal(noRepos.status, 2);

  const missing = run(['workspace', 'status', '--target', '.', '--json'], root);
  assert.equal(missing.status, 3);
  assert.match(missing.stderr, /workspace/i);
});

test('workspace human output is localized', () => {
  const root = tmpWorkspace();
  gitRepo(root, 'api');
  const r = run(['workspace', 'init', '--repos', 'api', '--target', '.', '--lang', 'en'], root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Initialized workspace/);
  assert.match(r.stdout, /api/);
  const status = run(['workspace', 'status', '--target', '.', '--lang', 'en'], root);
  assert.match(status.stdout, /Workspace:/);
});
