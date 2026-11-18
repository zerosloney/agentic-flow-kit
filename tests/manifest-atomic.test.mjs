import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { writeManifest } from '../src/install/manifest.mjs';

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
