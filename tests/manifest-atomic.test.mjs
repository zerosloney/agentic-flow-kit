import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readManifest, writeManifest } from '../src/install/manifest.mjs';
import { writeAtomicSync } from '../src/install/atomic.mjs';
import { baselinePath, writeBaseline } from '../src/install/baseline.mjs';
import { writeUserHooksConfig } from '../src/install/user-hooks.mjs';

const OLD_BYTES = '{"kit":"agentic-flow-kit","marker":"old-bytes"}\n';

function manifestPath(dir) {
  return path.join(dir, '.agents', 'install-manifest.json');
}

function newManifest() {
  return { kit: 'agentic-flow-kit', version: '9.9.9', files: { 'a.md': { hash: 'x' } } };
}

test('writeManifest：rename 前失败（.tmp 被目录占位）时抛错且旧 manifest 逐字节不动', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  fs.mkdirSync(path.dirname(manifestPath(dir)), { recursive: true });
  fs.writeFileSync(manifestPath(dir), OLD_BYTES, 'utf8');
  // 崩溃窗口模拟：占住 tmp 路径，迫使写入在触碰最终文件之前失败
  fs.mkdirSync(`${manifestPath(dir)}.tmp`);

  // Windows 对「向目录路径写文件」报 EPERM，POSIX 报 EISDIR
  assert.throws(() => writeManifest(dir, newManifest()), (err) => ['EISDIR', 'EPERM'].includes(err.code));

  assert.equal(fs.readFileSync(manifestPath(dir), 'utf8'), OLD_BYTES);
});

test('writeManifest：正常写入内容正确、无 .tmp 残留、旧内容被完整替换', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  fs.mkdirSync(path.dirname(manifestPath(dir)), { recursive: true });
  fs.writeFileSync(manifestPath(dir), OLD_BYTES, 'utf8');

  const manifest = newManifest();
  writeManifest(dir, manifest);

  assert.equal(fs.readFileSync(manifestPath(dir), 'utf8'), `${JSON.stringify(manifest, null, 2)}\n`);
  assert.equal(fs.existsSync(`${manifestPath(dir)}.tmp`), false);
});

test('readManifest：文件缺失返回 null', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  assert.equal(readManifest(dir), null);
});

test('readManifest：坏 JSON 抛错，消息含文件路径与修复指引', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  fs.mkdirSync(path.dirname(manifestPath(dir)), { recursive: true });
  fs.writeFileSync(manifestPath(dir), '{"kit":"agentic-flow-kit",', 'utf8');

  assert.throws(() => readManifest(dir), (err) => err instanceof Error
    && err.message.includes(manifestPath(dir))
    && err.message.includes('reinstall'));
});

test('readManifest：解析成功但根不是对象（数组）抛错', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  fs.mkdirSync(path.dirname(manifestPath(dir)), { recursive: true });
  fs.writeFileSync(manifestPath(dir), '[]', 'utf8');

  assert.throws(() => readManifest(dir));
});

test('writeAtomicSync：父目录不存在时递归创建、无 .tmp 残留', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  const file = path.join(dir, 'nested', 'file.txt');

  writeAtomicSync(file, 'new');

  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('writeBaseline：tmp 被目录占位时抛错且旧基线字节不动', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  const abs = baselinePath(dir, 'AGENTS.md');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'OLD-BASELINE\n', 'utf8');
  fs.mkdirSync(`${abs}.tmp`);

  // Windows 对「向目录路径写文件」报 EPERM，POSIX 报 EISDIR
  assert.throws(() => writeBaseline(dir, 'AGENTS.md', 'NEW\n'), (err) => ['EISDIR', 'EPERM'].includes(err.code));

  assert.equal(fs.readFileSync(abs, 'utf8'), 'OLD-BASELINE\n');
});

test('writeUserHooksConfig：tmp 被目录占位时抛错且旧配置字节不动', () => {
  const dir = makeTmp('flow-kit-manifest-atomic-');
  const file = path.join(dir, '.codex', 'hooks.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"hooks":{"x":1}}\n', 'utf8');
  fs.mkdirSync(`${file}.tmp`);

  // Windows 对「向目录路径写文件」报 EPERM，POSIX 报 EISDIR
  assert.throws(() => writeUserHooksConfig(file, { hooks: {} }), (err) => ['EISDIR', 'EPERM'].includes(err.code));

  assert.equal(fs.readFileSync(file, 'utf8'), '{"hooks":{"x":1}}\n');
});
