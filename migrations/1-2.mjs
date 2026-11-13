import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const from = 1;
export const to = 2;

// R5-1b：运行时脚本/hook 实现改为包内能力，不再由 manifest 托管。
// 迁移只改 manifest；磁盘清理由 upgrade 在迁移成功后按 removals 执行（哈希一致才删）。
const RUNTIME_PREFIXES = ['.agents/scripts/', '.agents/tests/'];

function isRuntimePath(rel) {
  const p = String(rel).replace(/\\/g, '/');
  if (RUNTIME_PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
  return p.startsWith('.agents/hooks/') && /\.(cjs|mjs)$/i.test(p);
}

export function migrate({ target, manifest }) {
  const files = { ...(manifest.files || {}) };
  const removals = [];
  const keptLegacy = [];
  for (const [rel, hash] of Object.entries(files)) {
    if (!isRuntimePath(rel)) continue;
    delete files[rel];
    const abs = path.join(target, rel);
    let actual = null;
    try {
      actual = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    } catch {
      actual = null;
    }
    if (actual === null) continue;
    if (actual === hash) removals.push(rel);
    else keptLegacy.push(rel);
  }
  const notes = [];
  if (removals.length) notes.push(`运行时实现转为包内能力：待清理 ${removals.length} 个文件`);
  if (keptLegacy.length) notes.push(`保留用户改过的运行时文件 ${keptLegacy.length} 个（不再托管）`);
  return {
    manifest: { ...manifest, schemaVersion: 2, files },
    notes,
    removals,
    keptLegacy,
  };
}
