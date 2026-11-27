import fs from 'node:fs';
import path from 'node:path';
import { writeAtomicSync } from './atomic.mjs';
import { mergeThreeWay as kernelMergeThreeWay } from '../kernel/index.mjs';

// 基线留存：保存上次由工具写入的文本内容，供升级时做三方合并。
// 目录默认被 .gitignore 忽略（.agents/.kit/）；可用 --no-baseline 关闭。
export const BASELINE_DIR = '.agents/.kit/baseline';

const BINARY_EXT = new Set(['.exe', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.ttf', '.woff', '.woff2', '.zip', '.gz', '.pdf']);

export function isBinaryPath(rel) {
  return BINARY_EXT.has(path.extname(String(rel)).toLowerCase());
}

export function baselinePath(target, rel) {
  return path.join(target, BASELINE_DIR, ...String(rel).replace(/\\/g, '/').split('/'));
}

export function readBaseline(target, rel) {
  try {
    return fs.readFileSync(baselinePath(target, rel), 'utf8');
  } catch {
    return null;
  }
}

export function writeBaseline(target, rel, text) {
  if (isBinaryPath(rel)) return false;
  writeAtomicSync(baselinePath(target, rel), text);
  return true;
}

export function removeBaseline(target, rel) {
  const abs = baselinePath(target, rel);
  try {
    fs.rmSync(abs, { force: true });
  } catch {
    return false;
  }
  // 向上清理空目录，止于 .agents/.kit 目录。
  const root = path.join(target, BASELINE_DIR);
  let dir = path.dirname(abs);
  while (dir.startsWith(root) && dir !== root) {
    try {
      if (fs.readdirSync(dir).length) break;
      fs.rmdirSync(dir);
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }
  return true;
}

export function listBaselines(target) {
  const root = path.join(target, BASELINE_DIR);
  const out = [];
  const walk = (abs, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile()) out.push(childRel);
    }
  };
  walk(root, '');
  return out.sort();
}

// 删除没有对应托管文件的基线；dryRun 只报告不落盘。
export function pruneBaselines(target, keepRels, { dryRun = false } = {}) {
  const keep = keepRels instanceof Set ? keepRels : new Set(keepRels || []);
  const removed = [];
  for (const rel of listBaselines(target)) {
    if (keep.has(rel)) continue;
    removed.push(rel);
    if (!dryRun) removeBaseline(target, rel);
  }
  return removed;
}

// 三方合并单源在 kernel.mergeThreeWay（CRLF 归一、信号退出 unavailable）。
export function mergeThreeWay(input) {
  return kernelMergeThreeWay(input);
}
