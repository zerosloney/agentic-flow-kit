import fs from 'node:fs';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { readManifest, requireManifest, writeManifest } from '../install/manifest.mjs';
import { acquireInstallLock } from '../install/lock.mjs';
import { makeT } from '../i18n.mjs';
import { resolveTarget } from '../install/target.mjs';
import { buildDiff } from './diff.mjs';
import { pruneBaselines } from '../install/baseline.mjs';
import { resolveInside } from '../install/path-guard.mjs';

// 删除空目录，向上冒泡到 target 根为止；遇到非空目录或根目录即停止。
export function cleanEmptyDirs(target, absFile) {
  const root = path.resolve(target);
  let dir = path.dirname(absFile);
  while (dir.startsWith(`${root}${path.sep}`)) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    if (entries.length) return;
    try {
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

// prune：删孤儿文件/空目录并改写 manifest，与并发安装互斥（空目录删除也可能误删刚建的托管目录）。
// 整个流程持安装锁：入口取锁，finally 释放。
export function pruneCommand({ args, t }) {
  const target = resolveTarget(args);
  const releaseInstallLock = acquireInstallLock(target, { label: 'prune', t });
  try {
    return pruneUnlocked({ args, t });
  } finally {
    releaseInstallLock();
  }
}

function pruneUnlocked({ args, t }) {
  const target = resolveTarget(args);
  const manifest = requireManifest(target, t);
  const dryRun = flag(args, 'dry-run');
  const force = flag(args, 'force');
  const asJson = flag(args, 'json');
  const print = asJson ? () => {} : (...line) => console.log(...line);
  // 未显式 --lang 时跟随已安装语言，避免英文项目输出中文。
  const tt = args.lang ? t : makeT(manifest.language || 'zh-CN');
  // manifest 可被篡改：解析到 target 之外的 key 绝不能进入删除流程。
  const unsafeRel = Object.keys(manifest.files || {}).find((rel) => !resolveInside(target, rel));
  if (unsafeRel) {
    const err = new Error(tt('error.prunePathOutside', { path: unsafeRel }));
    err.code = 'BAD_MANIFEST';
    throw err;
  }
  const result = buildDiff({ target, manifest });
  const orphans = result.items.filter((item) => item.kind === 'orphan');
  const items = [];

  // --strict：保留用户修改的孤儿视为失败（未清理干净）。
  const finish = (deleted, cleaned, skipped, baselines) => {
    if (asJson) {
      console.log(JSON.stringify({
        target, dryRun, deleted, cleaned, skipped, baselines, items,
      }, null, 2));
    } else {
      print(tt('prune.summary', { deleted, cleaned, skipped }));
    }
    return flag(args, 'strict') && skipped > 0 ? 1 : 0;
  };

  print(tt('prune.title', { target }));
  if (dryRun) print(tt('prune.dryRun'));
  if (!orphans.length) print(tt('prune.none'));

  const nextFiles = { ...(manifest.files || {}) };
  let deleted = 0;
  let cleaned = 0;
  let skipped = 0;
  let changed = false;

  for (const item of orphans) {
    const abs = path.join(target, item.targetRel);
    // 文件已不存在：只清理 manifest 记录，无需删除。
    if (item.actualHash == null) {
      delete nextFiles[item.targetRel];
      cleaned += 1;
      changed = true;
      items.push({ path: item.targetRel, action: 'clean' });
      print(tt('prune.clean', { path: item.targetRel }));
      continue;
    }
    // 用户改过的孤儿默认保留，避免误删；--force 才覆盖。
    if (item.actualHash !== item.managedHash && !force) {
      skipped += 1;
      items.push({ path: item.targetRel, action: 'skip' });
      print(tt('prune.skip', { path: item.targetRel }));
      continue;
    }
    if (!dryRun) {
      fs.rmSync(abs, { force: true });
      cleanEmptyDirs(target, abs);
    }
    delete nextFiles[item.targetRel];
    deleted += 1;
    changed = true;
    items.push({ path: item.targetRel, action: 'delete' });
    print(tt('prune.delete', { path: item.targetRel }));
  }

  let baselines = 0;
  if (flag(args, 'baseline')) {
    const removed = pruneBaselines(target, new Set(Object.keys(nextFiles)), { dryRun });
    baselines = removed.length;
    for (const rel of removed) {
      items.push({ path: rel, action: 'baseline-delete' });
      print(tt('prune.baseline', { path: rel }));
    }
    print(tt('prune.baselineSummary', { count: baselines }));
  }

  if (!dryRun && changed) {
    const derived = (manifest.derived || []).filter((rel) => nextFiles[rel]);
    const managedPermissions = Object.fromEntries(
      Object.entries(manifest.managedPermissions || {}).filter(([rel]) => nextFiles[rel]),
    );
    const mergeOrigins = Object.fromEntries(
      Object.entries(manifest.mergeOrigins || {}).filter(([rel]) => nextFiles[rel]),
    );
    writeManifest(target, { ...manifest, files: nextFiles, derived, managedPermissions, mergeOrigins });
  }
  return finish(deleted, cleaned, skipped, baselines);
}
