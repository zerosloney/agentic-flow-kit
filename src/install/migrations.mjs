// manifest 迁移框架（R3-9）：schemaVersion 驱动的单向迁移链。
// 约定：migrations/<from>-<to>.mjs 默认导出/命名导出 { from, to, migrate }；
// migrate({ target, manifest, dryRun }) 返回 { manifest, notes? }，只转换 manifest（不改用户文件）。
// 框架在全部步骤成功后才写 manifest；任一步失败不落盘，避免半迁移状态。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CURRENT_SCHEMA_VERSION as SCHEMA_VERSION, writeManifest } from './manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(HERE, '..', '..', 'migrations');
export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION;
const FILE_RE = /^(\d+)-(\d+)\.mjs$/;

function migrationError(message, extra = {}) {
  const error = new Error(message);
  Object.assign(error, extra);
  return error;
}

export async function loadMigrations(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter((name) => FILE_RE.test(name))
    .sort((a, b) => a.localeCompare(b));
  const migrations = [];
  for (const name of files) {
    const match = FILE_RE.exec(name);
    const abs = path.join(dir, name);
    const mod = await import(pathToFileURL(abs).href);
    const from = Number.isInteger(mod.from) ? mod.from : Number(match[1]);
    const to = Number.isInteger(mod.to) ? mod.to : Number(match[2]);
    if (!Number.isInteger(from) || !Number.isInteger(to) || to !== from + 1 || typeof mod.migrate !== 'function') {
      throw migrationError(`迁移文件无效: ${name}`, { code: 'MIGRATION_FAILED', file: name });
    }
    migrations.push({ file: name, from, to, migrate: mod.migrate });
  }
  migrations.sort((a, b) => a.from - b.from);
  return migrations;
}

// migrateManifest：从 manifest.schemaVersion（缺省 0）逐级迁移到当前版本。
// migrations 可注入（测试用）；默认加载 kit 的 migrations/。
export async function migrateManifest({ target, manifest, dryRun = false, migrations, log = () => {} }) {
  const list = migrations || await loadMigrations();
  const from = Number.isInteger(manifest?.schemaVersion) ? manifest.schemaVersion : 0;
  if (from > CURRENT_SCHEMA_VERSION) {
    throw migrationError(
      `manifest schemaVersion ${from} 高于当前支持 ${CURRENT_SCHEMA_VERSION}`,
      { code: 'MANIFEST_SCHEMA', version: from, current: CURRENT_SCHEMA_VERSION },
    );
  }
  let current = { ...manifest, schemaVersion: from };
  let version = from;
  const applied = [];
  const notes = [];
  while (version < CURRENT_SCHEMA_VERSION) {
    const migration = list.find((item) => item.from === version && item.to === version + 1);
    if (!migration) {
      throw migrationError(
        `缺少 manifest 迁移: ${version}-${version + 1}`,
        { code: 'MIGRATION_FAILED', file: `${version}-${version + 1}.mjs` },
      );
    }
    let result;
    try {
      result = await migration.migrate({ target, manifest: current, dryRun });
    } catch (error) {
      throw migrationError(
        `${migration.file} 执行失败: ${error.message}`,
        { code: 'MIGRATION_FAILED', file: migration.file, cause: error },
      );
    }
    const next = result && typeof result === 'object' && result.manifest ? result.manifest : result;
    if (!next || typeof next !== 'object' || next.schemaVersion !== version + 1) {
      throw migrationError(
        `${migration.file} 未返回 schemaVersion=${version + 1} 的 manifest`,
        { code: 'MIGRATION_FAILED', file: migration.file },
      );
    }
    current = next;
    version = next.schemaVersion;
    applied.push(`${migration.from}-${migration.to}`);
    for (const note of result?.notes || []) notes.push(String(note));
    log(`migrate ${migration.file}`);
  }
  const changed = applied.length > 0;
  if (changed && !dryRun) writeManifest(target, current);
  return {
    from,
    to: version,
    changed,
    dryRun,
    applied,
    notes,
    manifest: current,
  };
}
