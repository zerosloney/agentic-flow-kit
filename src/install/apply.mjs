import fs from 'node:fs';
import path from 'node:path';
import { render } from '../render/tokens.mjs';
import { setField } from './frontmatter.mjs';
import { sha256Text } from './manifest.mjs';
import { isBinaryPath, mergeThreeWay, readBaseline, writeBaseline } from './baseline.mjs';

export const GITATTR_BEGIN = '# >>> agentic-flow-kit gitattributes';
export const GITATTR_END = '# <<< agentic-flow-kit gitattributes';
export const GITIGNORE_BEGIN = '# >>> agentic-flow-kit ignores';
export const GITIGNORE_END = '# <<< agentic-flow-kit ignores';

const BINARY_EXT = new Set(['.exe', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.ttf', '.woff', '.woff2', '.zip', '.gz', '.pdf']);

function isBinary(file) {
  return BINARY_EXT.has(path.extname(file).toLowerCase());
}

function readText(abs) {
  return fs.readFileSync(abs, 'utf8');
}

function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function mergeBlock(existing, block, begin, end) {
  const eol = eolOf(existing);
  const normalized = block.replace(/\r?\n/g, eol);
  const beginIdx = existing.indexOf(begin);
  const endIdx = existing.indexOf(end);
  if (beginIdx >= 0 && endIdx > beginIdx) {
    const after = endIdx + end.length;
    return existing.slice(0, beginIdx) + normalized + existing.slice(after);
  }
  const sep = existing.length && !existing.endsWith(eol) ? eol : '';
  const gap = existing.length ? eol : '';
  return `${existing}${sep}${gap}${normalized}${eol}`;
}

export function readPlanEntry(entry, vars) {
  let text;
  if (typeof entry.getText === 'function') {
    text = entry.getText(vars);
  } else {
    if (!entry.srcAbs || isBinary(entry.srcAbs)) return null;
    text = render(readText(entry.srcAbs), vars);
  }

  // 模型注入必须在语言覆盖/渲染之后：manifest 记录的是最终文本哈希。
  if (entry.modelField && entry.modelRole && typeof entry.modelValue === 'string') {
    const value = entry.modelValue.trim();
    if (value && (value !== 'inherit' || entry.modelInherit)) {
      text = setField(text, entry.modelField, value);
    }
  }
  return text;
}

export function renderMergeBlock(entry, vars) {
  const text = readPlanEntry(entry, vars) || '';
  const begin = entry.kind === 'merge-gitattributes' ? GITATTR_BEGIN : GITIGNORE_BEGIN;
  const end = entry.kind === 'merge-gitattributes' ? GITATTR_END : GITIGNORE_END;
  return { begin, end, block: `${begin}\n${text.trimEnd()}\n${end}\n` };
}

// 从已安装文件中取出托管块（含标记行，不含块尾换行），用于 diff 的模板更新判定。
export function extractMergeBlock(text, begin, end) {
  const beginIdx = text.indexOf(begin);
  const endIdx = text.indexOf(end);
  if (beginIdx < 0 || endIdx <= beginIdx) return null;
  return text.slice(beginIdx, endIdx + end.length);
}

// 就地替换托管块，保留块外用户内容与文件 EOL；块不存在时原样返回。
export function replaceMergeBlock(existing, block, begin, end) {
  const beginIdx = existing.indexOf(begin);
  const endIdx = existing.indexOf(end);
  if (beginIdx < 0 || endIdx <= beginIdx) return existing;
  const eol = eolOf(existing);
  const normalized = block.replace(/\r?\n/g, eol);
  return existing.slice(0, beginIdx) + normalized + existing.slice(endIdx + end.length);
}

// 移除托管块及其后的换行；块前由插入逻辑补的空行一并回收。
export function stripMergeBlock(text, begin, end) {
  const beginIdx = text.indexOf(begin);
  const endIdx = text.indexOf(end);
  if (beginIdx < 0 || endIdx <= beginIdx) return text;
  let start = beginIdx;
  if (text.startsWith('\r\n\r\n', start - 4)) start -= 2;
  else if (text.startsWith('\n\n', start - 2)) start -= 1;
  let stop = endIdx + end.length;
  if (text.startsWith('\r\n', stop)) stop += 2;
  else if (text[stop] === '\n') stop += 1;
  return text.slice(0, start) + text.slice(stop);
}

export function applyPlan({ plan, vars, manifest, dryRun, force, log, baseline = false, benignUnchanged = false }) {
  const stats = { create: 0, update: 0, skip: 0, conflict: 0, merge: 0 };
  const target = plan.target;
  const nextFiles = { ...(manifest.files || {}) };
  const nextMcp = { ...(manifest.mcp || {}) };
  const writes = [];
  const conflicts = [];

  for (const entry of plan.entries) {
    const abs = path.join(plan.target, entry.targetRel);
    const exists = fs.existsSync(abs);
    const currentHash = exists ? sha256Text(readText(abs)) : null;
    const managedHash = manifest.files ? manifest.files[entry.targetRel] : null;

    if (entry.kind === 'merge-gitattributes' || entry.kind === 'merge-gitignore') {
      const { block, begin, end } = renderMergeBlock(entry, vars);
      const existing = exists ? readText(abs) : '';
      const merged = exists ? mergeBlock(existing, block, begin, end) : block;
      if (existing === merged) {
        stats.skip += 1;
        log('skip', `${entry.targetRel}（已是最新）`);
        continue;
      }
      writes.push({ abs, text: merged, targetRel: entry.targetRel, kind: entry.kind });
      stats.merge += 1;
      log(exists ? 'update' : 'create', `${entry.targetRel}（合并块）`);
      continue;
    }

    const text = readPlanEntry(entry, vars);
    const isConfigMerge = entry.kind === 'merge-mcp' || entry.kind === 'merge-host';
    if (text == null) {
      stats.skip += 1;
      log('skip', isConfigMerge
        ? `${entry.targetRel}（${entry.kind === 'merge-host' ? '宿主配置' : 'MCP'} 不是合法 JSON，已保留原文件）`
        : `${entry.targetRel}（二进制模板跳过）`);
      continue;
    }
    if (entry.mcpNames) nextMcp[entry.targetRel] = entry.mcpNames;

    // Hook / MCP 配置以“合并”为语义：用户对文件的其它修改不影响托管条目，
    // 因此不走 user-modified 冲突分支；内容已一致时跳过。
    if (isConfigMerge) {
      if (exists && text === readText(abs)) {
        stats.skip += 1;
        log('skip', `${entry.targetRel}（${entry.kind === 'merge-host' ? '宿主配置' : 'MCP'} 已是最新）`);
        continue;
      }
      writes.push({ abs, text, targetRel: entry.targetRel, kind: entry.kind });
      stats.merge += 1;
      log(exists ? 'update' : 'create', entry.targetRel);
      continue;
    }

    if (!exists) {
      writes.push({ abs, text, targetRel: entry.targetRel, kind: entry.kind });
      stats.create += 1;
      log('create', entry.targetRel);
      continue;
    }

    if (force || (managedHash && managedHash === currentHash)) {
      writes.push({ abs, text, targetRel: entry.targetRel, kind: entry.kind });
      stats.update += 1;
      log('update', entry.targetRel);
      continue;
    }

    if (managedHash && managedHash !== currentHash) {
      const rel = entry.targetRel;
      // 三方合并：baseline 为 base、磁盘为 ours、新模板为 theirs。
      // 仅文本文件、且模板相对基线确有变化时尝试；git 不可用或二进制回退旧语义。
      if (baseline && !isBinaryPath(rel)) {
        const base = readBaseline(target, rel);
        if (base != null && base === text && benignUnchanged) {
          // 升级时模板侧没变：保留用户改动，不算冲突。
          stats.skip += 1;
          log('skip', `${rel}（模板未变，保留用户修改）`);
          continue;
        }
        if (base != null && base !== text) {
          const merged = mergeThreeWay({ base, ours: readText(abs), theirs: text });
          if (merged.status === 'clean') {
            // manifest 哈希记录模板侧文本；合并结果含用户内容，不刷新哈希。
            writes.push({
              abs,
              text: merged.text,
              targetRel: rel,
              kind: entry.kind,
              baselineText: text,
              templateText: text,
            });
            stats.merge += 1;
            log('merge', `${rel}（三方合并）`);
            continue;
          }
          if (merged.status === 'conflict') {
            // 冲突标记写入磁盘供用户处理；manifest 保留旧哈希，下次仍视为未解决。
            writes.push({ abs, text: merged.text, targetRel: rel, kind: entry.kind, baselineText: null, conflict: true });
            stats.conflict += 1;
            conflicts.push(rel);
            log('conflict', `${rel}（三方合并冲突，已写入冲突标记；--force 可覆盖）`);
            continue;
          }
        }
      }
      stats.conflict += 1;
      conflicts.push(rel);
      log('conflict', `${rel}（已安装后被修改，跳过；--force 可覆盖）`);
      continue;
    }

    stats.skip += 1;
    log('skip', `${entry.targetRel}（已存在且非本工具安装，跳过；--force 可覆盖）`);
  }

  if (!dryRun) {
    for (const w of writes) {
      fs.mkdirSync(path.dirname(w.abs), { recursive: true });
      fs.writeFileSync(w.abs, w.text, 'utf8');
      if (!w.conflict) nextFiles[w.targetRel] = sha256Text(w.templateText ?? w.text);
    }
    // 基线只保存文本直写结果：合并块 / MCP / hooks 配置有各自的合并语义，
    // 冲突文件保留旧基线（下次升级继续视为未解决）。
    if (baseline) {
      for (const w of writes) {
        if (w.conflict || (w.kind !== 'file' && w.kind !== 'generated')) continue;
        const content = w.baselineText !== undefined ? w.baselineText : w.text;
        if (content != null) writeBaseline(plan.target, w.targetRel, content);
      }
    }
  }

  return {
    stats,
    files: nextFiles,
    mcp: nextMcp,
    written: writes.map((w) => w.targetRel),
    conflictPaths: writes.filter((w) => w.conflict).map((w) => w.targetRel),
    // 合并/冲突文件的磁盘文本不等于 manifest 记录的模板哈希，安装器派生扫描不得重算。
    skipRehash: writes.filter((w) => w.conflict || w.templateText != null).map((w) => w.targetRel),
    conflicts,
  };
}

export function summaryLine(stats, t) {
  return t('install.summary', {
    create: stats.create,
    update: stats.update,
    merge: stats.merge,
    skip: stats.skip,
    conflict: stats.conflict,
  });
}
