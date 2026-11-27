import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

// D49b（2026-11-27）：--replace 含换行会先写盘、再被写后行数校验判失败——文件已被破坏。
// 本文件锁定：含换行的 find / replace 在写盘前即拒绝，文件逐字节不变。

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'rewrite-file.mjs');

function fixture(text) {
  const dir = makeTmp('fk-rewrite-file-');
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, text);
  return file;
}

test('rewrite-file refuses a --replace containing a line break before writing', () => {
  const file = fixture('alpha beta\r\n');
  const before = fs.readFileSync(file);
  const r = spawnSync(process.execPath, [SCRIPT, file, '--find', 'beta', '--replace', 'beta\ngamma'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /换行/, `${r.stdout}\n${r.stderr}`);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('rewrite-file refuses a --find containing a line break before writing', () => {
  const file = fixture('alpha beta\r\n');
  const before = fs.readFileSync(file);
  const r = spawnSync(process.execPath, [SCRIPT, file, '--find', 'alpha\nbeta', '--replace', 'gamma'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('rewrite-file still applies an inline replacement', () => {
  const file = fixture('alpha beta\r\ngamma\r\n');
  const r = spawnSync(process.execPath, [SCRIPT, file, '--find', 'beta', '--replace', 'delta'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(fs.readFileSync(file, 'utf8'), 'alpha delta\r\ngamma\r\n');
});
