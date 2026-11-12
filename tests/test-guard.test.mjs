import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startFixTask, stopFixTask } from '../templates/engine/.agents/scripts/fix-task.mjs';

const HOOK = path.resolve('templates/engine/.agents/hooks/pre-write-check.cjs');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'test-guard-'));
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function runHook(root, tool, input) {
  const payload = JSON.stringify({ tool_name: tool, cwd: root, tool_input: input });
  const r = spawnSync(process.execPath, [HOOK], { cwd: root, input: payload, encoding: 'utf8' });
  return r;
}

function denied(r) {
  if (!r.stdout.trim()) return false;
  try {
    return JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === 'deny';
  } catch {
    return false;
  }
}

test('fix window blocks editing an existing test', () => {
  const root = tmp();
  write(root, 'tests/foo.test.mjs', 'assert.equal(1, 1);\n');
  startFixTask(root, { id: 'fix-1' });
  const r = runHook(root, 'Write', { file_path: 'tests/foo.test.mjs', content: 'assert.equal(2, 2);\n' });
  assert.equal(denied(r), true, r.stdout + r.stderr);
  assert.match(r.stdout, /测试不可弱化/);
});

test('fix window allows a new reproduction test', () => {
  const root = tmp();
  startFixTask(root, { id: 'fix-2' });
  const r = runHook(root, 'Write', { file_path: 'tests/repro.test.mjs', content: 'assert.fail("repro");\n' });
  assert.equal(denied(r), false, r.stdout + r.stderr);
});

test('fix window allows explicit TEST-GUARD-ALLOW escape hatch', () => {
  const root = tmp();
  write(root, 'tests/foo.test.mjs', 'old\n');
  startFixTask(root, { id: 'fix-3' });
  const r = runHook(root, 'Write', {
    file_path: 'tests/foo.test.mjs',
    content: '// TEST-GUARD-ALLOW: split file during refactor\nnew\n',
  });
  assert.equal(denied(r), false, r.stdout + r.stderr);
});

test('fix window allows pre-registered test paths', () => {
  const root = tmp();
  write(root, 'tests/foo.test.mjs', 'old\n');
  startFixTask(root, { id: 'fix-4', allowedTests: ['tests/foo.test.mjs'] });
  const r = runHook(root, 'Edit', {
    file_path: 'tests/foo.test.mjs',
    old_string: 'old',
    new_string: 'new',
  });
  assert.equal(denied(r), false, r.stdout + r.stderr);
});

test('no fix window means tests are editable', () => {
  const root = tmp();
  write(root, 'tests/foo.test.mjs', 'old\n');
  const r = runHook(root, 'Write', { file_path: 'tests/foo.test.mjs', content: 'new\n' });
  assert.equal(denied(r), false, r.stdout + r.stderr);
});

test('stop closes the window', () => {
  const root = tmp();
  write(root, 'tests/foo.test.mjs', 'old\n');
  startFixTask(root, { id: 'fix-5' });
  stopFixTask(root);
  const r = runHook(root, 'Write', { file_path: 'tests/foo.test.mjs', content: 'new\n' });
  assert.equal(denied(r), false, r.stdout + r.stderr);
});
