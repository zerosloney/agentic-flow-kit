// kernel 门面契约测试（issue #75）：hashText / hashFile / dirtyTreeDigest / mergeThreeWay 四原语
// + exports 自引用契约锚（agentic-flow-kit/kernel 走 package.json exports 解析）。
// 判据 = CRLF 归一超集：文本判据一律 CRLF→LF 归一，Windows CRLF 检出与 LF 手存不产生判据漂移。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hashText, hashFile, dirtyTreeDigest, mergeThreeWay } from '../src/kernel/index.mjs';

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败: ${r.stderr}`);
  return r.stdout;
};

const initRepo = (prefix) => {
  const dir = makeTmp(prefix);
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c0');
  return dir;
};

const toCRLF = (text) => String(text).replace(/\n/g, '\r\n');

test('hashText：同一内容 CRLF 版与 LF 版摘要相等；摘要匹配 64 位小写 hex', () => {
  const lf = 'a\nb\nc\n';
  assert.equal(hashText(toCRLF(lf)), hashText(lf), '仅行尾差异不产生判据漂移');
  assert.match(hashText(lf), /^[0-9a-f]{64}$/);
});

test('hashText：内容差异 → 摘要差异', () => {
  assert.notEqual(hashText('a\nb\n'), hashText('a\nc\n'));
});

test('hashFile：磁盘 CRLF 文件 == 同内容 LF 文件 == hashText(LF 文本)', () => {
  const dir = makeTmp('fk-kernel-hashfile-');
  const lfText = 'line1\nline2\n';
  fs.writeFileSync(path.join(dir, 'crlf.txt'), toCRLF(lfText), 'utf8');
  fs.writeFileSync(path.join(dir, 'lf.txt'), lfText, 'utf8');
  assert.equal(hashFile(path.join(dir, 'crlf.txt')), hashFile(path.join(dir, 'lf.txt')));
  assert.equal(hashFile(path.join(dir, 'lf.txt')), hashText(lfText));
});

test('hashFile：不存在的路径抛异常（fail-loud，不静默 null）', () => {
  const dir = makeTmp('fk-kernel-missing-');
  assert.throws(() => hashFile(path.join(dir, 'no-such-file.txt')));
});

test('dirtyTreeDigest：干净树（README 已提交）→ 空串', () => {
  const dir = initRepo('fk-kernel-clean-');
  assert.equal(dirtyTreeDigest(dir), '');
});

test('dirtyTreeDigest：脏树 → 16 位 hex；改动内容变化 → 摘要变化', () => {
  const dir = initRepo('fk-kernel-dirty-');
  fs.writeFileSync(path.join(dir, 'README.md'), 'v1\n');
  const d1 = dirtyTreeDigest(dir);
  assert.match(d1, /^[0-9a-f]{16}$/);
  fs.writeFileSync(path.join(dir, 'README.md'), 'v2\n');
  const d2 = dirtyTreeDigest(dir);
  assert.match(d2, /^[0-9a-f]{16}$/);
  assert.notEqual(d1, d2, '未提交内容变化 → 摘要随之变化');
});

test('dirtyTreeDigest：非 git 根目录 → null（缺键=未知，不伪造）', () => {
  const dir = makeTmp('fk-kernel-nogit-');
  assert.equal(dirtyTreeDigest(dir), null);
});

test('mergeThreeWay：base/ours/theirs 非重叠改动 → clean 且双方改动都在', () => {
  const merged = mergeThreeWay({ base: 'a\nb\nc\n', ours: 'A\nb\nc\n', theirs: 'a\nb\nC\n' });
  assert.equal(merged.status, 'clean');
  assert.equal(merged.text, 'A\nb\nC\n');
});

test('mergeThreeWay：同一行冲突 → conflict 带 <<<<<<< 标记；CRLF 输入与 LF 输入同 status 且 text 逐字节相同（归一口径直接证明）', () => {
  const lf = { base: 'value\n', ours: 'user value\n', theirs: 'kit value\n' };
  const lfMerged = mergeThreeWay(lf);
  assert.equal(lfMerged.status, 'conflict');
  assert.match(lfMerged.text, /<<<<<<< current/);
  assert.match(lfMerged.text, />>>>>>> kit/);

  const crlfMerged = mergeThreeWay({ base: toCRLF(lf.base), ours: toCRLF(lf.ours), theirs: toCRLF(lf.theirs) });
  assert.equal(crlfMerged.status, lfMerged.status);
  assert.equal(crlfMerged.text, lfMerged.text, 'CRLF 输入与 LF 输入合并结果逐字节相同');
});

test('契约锚：agentic-flow-kit/kernel 经 package.json exports 自引用解析，导出恰为 4 个函数', async () => {
  const kernel = await import('agentic-flow-kit/kernel');
  assert.deepEqual(Object.keys(kernel).sort(), ['dirtyTreeDigest', 'hashFile', 'hashText', 'mergeThreeWay']);
  for (const key of Object.keys(kernel)) assert.equal(typeof kernel[key], 'function', `${key} 应为函数`);
});

test('mergeThreeWay：git 被信号杀死（status 非数值）→ { status: "unavailable" }（尽力而为：POSIX shim 触发，Windows 由 Linux CI 真跑）', (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows 无法以 shim 造出非数值 status（spawn 不走 POSIX shim），由 Linux CI 执行真断言');
    return;
  }
  const shimDir = makeTmp('fk-kernel-signal-shim-');
  fs.writeFileSync(path.join(shimDir, 'git'), '#!/bin/sh\nkill -9 $$\n', { mode: 0o755 });
  const originalPath = process.env.PATH;
  let merged;
  try {
    process.env.PATH = `${shimDir}${path.delimiter}${originalPath}`;
    merged = mergeThreeWay({ base: 'a\n', ours: 'a\n', theirs: 'a\n' });
  } finally {
    process.env.PATH = originalPath;
  }
  assert.deepEqual(merged, { status: 'unavailable' });
});

test('mergeThreeWay：git 不可用（PATH 清空）→ { status: "unavailable" }（尽力而为：本机 PATH 清空后仍能解析 git 则跳过）', (t) => {
  const originalPath = process.env.PATH;
  let probe;
  try {
    process.env.PATH = '';
    probe = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
  } finally {
    process.env.PATH = originalPath;
  }
  if (!probe.error) {
    t.skip('本机 PATH 清空后 spawnSync 仍能解析 git（git 不经 PATH 即可达），unavailable 分支无法稳定触发，不造假断言');
    return;
  }
  let merged;
  try {
    process.env.PATH = '';
    merged = mergeThreeWay({ base: 'a\n', ours: 'a\n', theirs: 'a\n' });
  } finally {
    process.env.PATH = originalPath;
  }
  assert.deepEqual(merged, { status: 'unavailable' });
});
