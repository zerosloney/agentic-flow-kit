import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
  const abs = baselinePath(target, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
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

// 三方合并：git merge-file 以 baseline 为 base、磁盘为 ours、新模板为 theirs。
// 返回 clean 时 text 为合并结果；conflict 时 text 带冲突标记；git 不可用返回 unavailable，
// 由调用方回退到旧的哈希冲突跳过语义。
export function mergeThreeWay({ base, ours, theirs }) {
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-merge-'));
    const oursFile = path.join(dir, 'ours');
    const baseFile = path.join(dir, 'base');
    const theirsFile = path.join(dir, 'theirs');
    fs.writeFileSync(oursFile, ours, 'utf8');
    fs.writeFileSync(baseFile, base, 'utf8');
    fs.writeFileSync(theirsFile, theirs, 'utf8');
    const result = spawnSync(
      'git',
      ['merge-file', '-p', '-q', '-L', 'current', '-L', 'baseline', '-L', 'kit', oursFile, baseFile, theirsFile],
      { encoding: 'utf8', windowsHide: true },
    );
    if (result.error || (result.status !== 0 && result.status !== 1)) return { status: 'unavailable' };
    return {
      status: result.status === 0 ? 'clean' : 'conflict',
      text: result.stdout,
    };
  } catch {
    return { status: 'unavailable' };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}
