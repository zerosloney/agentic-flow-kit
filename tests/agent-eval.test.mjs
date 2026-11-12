import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate, recordEval, treeSignature, isSensitive } from '../templates/engine/.agents/scripts/agent-eval.mjs';
import { listFiles } from '../src/install/plan.mjs';

const AGENT_EVAL = fileURLToPath(new URL('../templates/engine/.agents/scripts/agent-eval.mjs', import.meta.url));

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-eval-'));
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

test('glob matching covers skills recursively', () => {
  assert.equal(isSensitive('.agents/skills/foo/SKILL.md', ['.agents/skills/**']), true);
  assert.equal(isSensitive('.agents/skills/SKILL.md', ['.agents/skills/**']), true);
  assert.equal(isSensitive('src/app.mjs', ['.agents/skills/**']), false);
});

test('no credential -> not ok; record -> ok; changing sensitive content invalidates', () => {
  const root = tmp();
  write(root, '.agents/skills/demo/SKILL.md', '---\nname: demo\n---\nbody\n');

  let res = evaluate(root);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-eval-for-tree');

  recordEval(root, { passRate: 0.9, tasks: 5, model: 'opus' });
  res = evaluate(root);
  assert.equal(res.ok, true);
  assert.equal(res.reason, 'pass');

  write(root, '.agents/skills/demo/SKILL.md', '---\nname: demo\n---\nbody v2\n');
  res = evaluate(root);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-eval-for-tree');
});

test('low pass rate is not accepted', () => {
  const root = tmp();
  write(root, '.agents/skills/demo/SKILL.md', 'x\n');
  recordEval(root, { passRate: 0.5, tasks: 5 });
  const res = evaluate(root);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'eval-below-threshold');
});

test('expired credential is rejected', () => {
  const root = tmp();
  write(root, '.agents/skills/demo/SKILL.md', 'x\n');
  const old = new Date(Date.now() - 60 * 86400000);
  recordEval(root, { passRate: 0.95, tasks: 5, now: old });
  const res = evaluate(root);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'eval-expired');
});

test('signature ignores non-sensitive files', () => {
  const root = tmp();
  write(root, '.agents/skills/demo/SKILL.md', 'x\n');
  const a = treeSignature(root).signature;
  write(root, 'src/app.mjs', 'changed\n');
  const b = treeSignature(root).signature;
  assert.equal(a, b);
});

test('record CLI rejects missing or untraceable credentials', () => {
  const root = tmp();
  write(root, '.agents/skills/demo/SKILL.md', 'x\n');
  const run = (args) => spawnSync(process.execPath, [AGENT_EVAL, 'record', ...args], {
    cwd: root, encoding: 'utf8',
  });

  // 裸 --pass-rate 曾被 argOf 解析成 true → 落账 1.0，这是不可接受的“免测开关”。
  assert.notEqual(run(['--pass-rate']).status, 0);
  assert.notEqual(run(['--tasks', '5', '--model', 'opus']).status, 0);
  assert.notEqual(run(['--pass-rate', '0.9', '--tasks', '2', '--model', 'opus']).status, 0);
  assert.notEqual(run(['--pass-rate', '0.9', '--tasks', '5']).status, 0);
  assert.equal(run(['--pass-rate', '0.9', '--tasks', '5', '--model', 'opus']).status, 0);
  assert.equal(evaluate(root).ok, true);
});

test('installer never ships runtime state or eval credentials', () => {
  const root = tmp();
  write(root, 'keep.md', 'x\n');
  write(root, '.agents/cache/session.jsonl', 'x\n');
  write(root, '.agents/evals/README.md', 'x\n');
  write(root, '.agents/evals/results.jsonl', 'x\n');
  write(root, '.agents/config/model-roles.local.json', '{}');
  const files = listFiles(root);
  assert.ok(files.includes('keep.md'));
  assert.ok(files.includes('.agents/evals/README.md'));
  assert.ok(!files.includes('.agents/evals/results.jsonl'));
  assert.ok(!files.includes('.agents/config/model-roles.local.json'));
  assert.ok(!files.some((f) => f.startsWith('.agents/cache/')));
});

test('agent-eval config is itself sensitive', () => {
  const root = tmp();
  write(root, '.agents/skills/demo/SKILL.md', 'x\n');
  const before = treeSignature(root).signature;
  write(root, '.agents/config/agent-eval.json', JSON.stringify({ threshold: 0.1 }));
  assert.notEqual(treeSignature(root).signature, before);
});
