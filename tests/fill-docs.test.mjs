import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

// D49a（2026-11-27）：fill-intent / fill-plan / fill-spec 此前静默覆写任意已有文档（含 approved）。
// 本文件锁定：仅 draft 可重生成（pipeline 重试依赖），其余状态拒绝且文件逐字节不变；写盘原子落位。

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(KIT, 'templates', 'engine', '.agents');

const SCRIPTS = [
  ['fill-intent.mjs', ['--topic', 'demo', '--module', 'pipeline', '--level', 'L1']],
  ['fill-spec.mjs', ['--topic', 'demo', '--level', 'L2']],
  ['fill-plan.mjs', ['--topic', 'demo', '--level', 'L1']],
];

function project() {
  const root = makeTmp('fk-fill-docs-');
  fs.cpSync(ENGINE, path.join(root, '.agents'), { recursive: true });
  return root;
}

function run(root, script, args) {
  return spawnSync(process.execPath, [path.join(root, '.agents', 'scripts', script), ...args], { cwd: root, encoding: 'utf8' });
}

function writeOut(root, text) {
  const out = path.join(root, 'out', 'doc.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  return out;
}

for (const [script, args] of SCRIPTS) {
  test(`${script} refuses to overwrite a document that is not draft`, () => {
    const root = project();
    const before = '---\n状态: approved\n级别: L2\n---\nKEEP\n';
    const out = writeOut(root, before);
    const r = run(root, script, [...args, '--output', out]);
    assert.notEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /状态为「approved」/, `${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(out, 'utf8'), before);
  });

  test(`${script} regenerates an existing draft without leaving a temp file`, () => {
    const root = project();
    const out = writeOut(root, '---\n状态: draft\n级别: L1\n---\nOLD\n');
    const r = run(root, script, [...args, '--output', out]);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const text = fs.readFileSync(out, 'utf8');
    assert.match(text, /^---\r?\n状态: draft\r?\n/);
    assert.match(text, /demo/);
    assert.deepEqual(fs.readdirSync(path.dirname(out)), ['doc.md']);
  });
}

test('fill-spec refuses a file with no frontmatter (status missing)', () => {
  const root = project();
  const before = '# SPEC — old\n\nno frontmatter\n';
  const out = writeOut(root, before);
  const r = run(root, 'fill-spec.mjs', ['--topic', 'demo', '--level', 'L2', '--output', out]);
  assert.notEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /状态为「缺失」/, `${r.stdout}\n${r.stderr}`);
  assert.equal(fs.readFileSync(out, 'utf8'), before);
});
