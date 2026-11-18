import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeAtomicSync } from './atomic.mjs';

export const MANIFEST_REL = '.agents/install-manifest.json';
export const CURRENT_SCHEMA_VERSION = 2;

// 两态：文件不存在 → null（未安装）；存在但坏 JSON / 根非对象 → 抛错（fail-loud，
// 不再把损坏 manifest 静默当未安装）。修复指引：git 恢复，或确认废弃后删除重装。
function invalidManifest(file, detail) {
  const err = new Error(`invalid install manifest: ${file} (${detail}) — restore it from git, or confirm it is abandoned, delete this file and reinstall`);
  err.code = 'BAD_MANIFEST';
  return err;
}

export function readManifest(target) {
  const file = path.join(target, MANIFEST_REL);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw invalidManifest(file, err.message);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidManifest(file, 'root must be an object');
  }
  return parsed;
}

export function writeManifest(target, manifest) {
  const file = path.join(target, MANIFEST_REL);
  writeAtomicSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

export function emptyManifest({ kitVersion, language, hosts, stack }) {
  return {
    kit: 'agentic-flow-kit',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    version: kitVersion,
    installedAt: new Date().toISOString(),
    language,
    hosts,
    stack,
    files: {},
  };
}
