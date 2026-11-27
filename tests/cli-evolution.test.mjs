import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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

test('cli: timeline --list --run 查询时序而不是打印脚本帮助', () => {
  const run = spawnSync(process.execPath, [BIN, 'timeline', '--list', '--run', 'missing-run'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /用法: node timeline-trace/);
  assert.deepEqual(JSON.parse(run.stdout), []);
});

test('cli: eval --benchmark --record 拒绝把夹具自检写成模型凭证', () => {
  const run = spawnSync(process.execPath, [BIN, 'eval', '--benchmark', '--record'], { encoding: 'utf8' });
  assert.equal(run.status, 2, run.stdout);
  assert.match(run.stderr, /拒绝登记/);
  assert.doesNotMatch(`${run.stdout}${run.stderr}`, /未知命令: --benchmark/);
});

test('cli: optimize-skill --extract 进入提取命令', () => {
  const run = spawnSync(process.execPath, [BIN, 'optimize-skill', '--skill', 'eval', '--extract'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /运行命令: extract/);
  assert.doesNotMatch(run.stdout, /用法: node skill-optimizer/);
});

test('cli: shadow-run --keep 留下影子目录并记下任务', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-shadow-'));
  fs.writeFileSync(path.join(root, 'keep.txt'), 'ok');
  const run = spawnSync(process.execPath, [BIN, 'shadow-run', '--root', root, '--task', 'probe', '--max-steps', '10', '--keep'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(run.stdout);
  assert.equal(report.task, 'probe');
  assert.equal(fs.existsSync(report.shadowDir), true);
  fs.rmSync(report.shadowDir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('cli: eval list --json 正确返回标准基准任务集列表', () => {
  const run = spawnSync(process.execPath, [BIN, 'eval', 'list', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const data = JSON.parse(run.stdout);
  assert.ok(Array.isArray(data));
  assert.ok(data.length >= 5);
  assert.ok(data.some((f) => f.id === 'fix-syntax-bug'));
});
