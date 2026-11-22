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
  const dir = makeTmp('flow-kit-cursor-');
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

test('install --agent cursor generates rules, skills index, and mcp configuration', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'cursor', '--lang', 'zh-CN', '--stack', 'node', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);

  // 1. Rules files (.cursor/rules/*.mdc)
  const workflowRule = read(dir, '.cursor/rules/workflow.mdc');
  assert.match(workflowRule, /description: AI-Native 开发工作流指引与全局红线/);
  assert.match(workflowRule, /globs: \*/);
  assert.match(workflowRule, /alwaysApply: true/);
  assert.match(workflowRule, /\.cursor\/SKILLS\.md/);
  assert.match(workflowRule, /根 `AGENTS\.md`/);

  const backendRule = read(dir, '.cursor/rules/backend-scope.mdc');
  assert.match(backendRule, /globs: backend\/\*\*/);
  assert.match(backendRule, /backend\/AGENTS\.md/);

  const frontendRule = read(dir, '.cursor/rules/frontend-scope.mdc');
  assert.match(frontendRule, /globs: frontend\/\*\*/);
  assert.match(frontendRule, /frontend\/AGENTS\.md/);

  // 2. Skills index (.cursor/SKILLS.md)
  const skillsIndex = read(dir, '.cursor/SKILLS.md');
  assert.match(skillsIndex, /# 技能索引/);

  // 3. MCP configuration (.cursor/mcp.json)
  const mcpJson = JSON.parse(read(dir, '.cursor/mcp.json'));
  assert.ok(mcpJson.mcpServers);

  // 4. Tracked policy (tracked: true means .cursor is NOT in .gitignore)
  const gitignore = read(dir, '.gitignore');
  assert.equal(gitignore.includes('.cursor'), false, '.cursor should be tracked in git, not ignored');

  // 5. Manifest records cursor
  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  assert.deepEqual(manifest.hosts, ['cursor']);

  // 6. Doctor runs clean
  const doc = run(['doctor', '--target', '.', '--json'], dir);
  assert.equal(doc.status, 0, doc.stderr);
  const docResult = JSON.parse(doc.stdout);
  assert.equal(docResult.ok, true);
});

test('install --agent cursor --lang en applies English overrides', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'cursor', '--lang', 'en', '--stack', 'node', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);

  const workflowRule = read(dir, '.cursor/rules/workflow.mdc');
  assert.match(workflowRule, /AI-Native development workflow guidance/);
  assert.match(workflowRule, /This file is a pointer shell/);

  const backendRule = read(dir, '.cursor/rules/backend-scope.mdc');
  assert.match(backendRule, /Read backend\/AGENTS\.md before changing backend files/);
  assert.match(backendRule, /globs: backend\/\*\*/);

  const skillsIndex = read(dir, '.cursor/SKILLS.md');
  assert.match(skillsIndex, /# Skills index/);
});
