import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-antigravity-');
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

test('install --agent antigravity generates GEMINI.md, skills index, and mcp configuration', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'antigravity', '--lang', 'zh-CN', '--stack', 'node', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);

  // 1. Root memory pointer (GEMINI.md)
  const geminiMd = read(dir, 'GEMINI.md');
  assert.match(geminiMd, /# Repository Guidelines \(Antigravity CLI\)/);
  assert.match(geminiMd, /项目根 `AGENTS\.md`/);
  assert.match(geminiMd, /\.agents\/skills\//);

  // 2. Skills index (.gemini/SKILLS.md)
  const skillsIndex = read(dir, '.gemini/SKILLS.md');
  assert.match(skillsIndex, /# 技能索引/);
  assert.match(skillsIndex, /tfs-pr/);

  // 3. MCP configuration (.gemini/mcp_config.json)
  const mcpConfig = JSON.parse(read(dir, '.gemini/mcp_config.json'));
  assert.ok(mcpConfig.mcpServers);

  // 4. Untracked policy (tracked: false means .gemini is in .gitignore)
  const gitignore = read(dir, '.gitignore');
  assert.ok(gitignore.includes('.gemini'), '.gemini should be ignored in git');

  // 5. Manifest records antigravity
  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  assert.deepEqual(manifest.hosts, ['antigravity']);

  // 6. Doctor runs clean
  const doc = run(['doctor', '--target', '.', '--json'], dir);
  assert.equal(doc.status, 0, doc.stderr);
  const docResult = JSON.parse(doc.stdout);
  assert.equal(docResult.ok, true);
});

test('install --agent gemini resolves alias to antigravity', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'gemini', '--lang', 'zh-CN', '--stack', 'node', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);

  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  assert.deepEqual(manifest.hosts, ['antigravity']);
  assert.ok(fs.existsSync(path.join(dir, 'GEMINI.md')));
  assert.ok(fs.existsSync(path.join(dir, '.gemini', 'SKILLS.md')));
  assert.ok(fs.existsSync(path.join(dir, '.gemini', 'mcp_config.json')));
});

test('install --agent antigravity --lang en applies English overrides', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'antigravity', '--lang', 'en', '--stack', 'node', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);

  const geminiMd = read(dir, 'GEMINI.md');
  assert.match(geminiMd, /# Repository Guidelines \(Antigravity CLI\)/);
  assert.match(geminiMd, /Single source of truth: root `AGENTS\.md`/);
  assert.match(geminiMd, /Antigravity CLI natively discovers and progressively loads skills/);

  const skillsIndex = read(dir, '.gemini/SKILLS.md');
  assert.match(skillsIndex, /# Skills index/);
});

test('remove-host antigravity uninstalls .gemini while keeping root GEMINI.md', () => {
  const dir = tmpRepo();
  run(['install', '--agent', 'antigravity', '--lang', 'zh-CN', '--stack', 'node', '--target', '.', '--json'], dir);
  assert.ok(fs.existsSync(path.join(dir, '.gemini', 'SKILLS.md')));
  assert.ok(fs.existsSync(path.join(dir, 'GEMINI.md')));

  const rm = run(['remove-host', 'antigravity', '--target', '.', '--json'], dir);
  assert.equal(rm.status, 0, rm.stderr);

  assert.equal(fs.existsSync(path.join(dir, '.gemini')), false, '.gemini should be removed');
  assert.equal(fs.existsSync(path.join(dir, 'GEMINI.md')), true, 'root memory file GEMINI.md should be retained');
});
