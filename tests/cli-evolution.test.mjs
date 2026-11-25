import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

test('cli: timeline 命令顶层支持 --help', () => {
  const run = spawnSync(process.execPath, [BIN, 'timeline', '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /flow-kit timeline/);
  assert.match(run.stdout, /--export-html/);
});

test('cli: shadow-run 命令顶层支持 --help', () => {
  const run = spawnSync(process.execPath, [BIN, 'shadow-run', '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /flow-kit shadow-run/);
  assert.match(run.stdout, /--max-steps/);
});

test('cli: eval 命令顶层支持 --help', () => {
  const run = spawnSync(process.execPath, [BIN, 'eval', '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /flow-kit eval/);
  assert.match(run.stdout, /--benchmark/);
});

test('cli: optimize-skill 命令顶层支持 --help', () => {
  const run = spawnSync(process.execPath, [BIN, 'optimize-skill', '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /flow-kit optimize-skill/);
  assert.match(run.stdout, /--arbitrate/);
});

test('cli: eval list --json 正确返回标准基准任务集列表', () => {
  const run = spawnSync(process.execPath, [BIN, 'eval', 'list', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const data = JSON.parse(run.stdout);
  assert.ok(Array.isArray(data));
  assert.ok(data.length >= 5);
  assert.ok(data.some((f) => f.id === 'fix-syntax-bug'));
});
