import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MANIFEST_REL = '.agents/install-manifest.json';
export const CURRENT_SCHEMA_VERSION = 2;

export function readManifest(target) {
  const file = path.join(target, MANIFEST_REL);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeManifest(target, manifest) {
  const file = path.join(target, MANIFEST_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 原子写：先落同目录确定性 tmp 再 rename——rename 前任何失败旧文件字节不动，残留 tmp 会被下次写覆盖（自愈）；不重试，失败上抛 fail-loud。
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
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
