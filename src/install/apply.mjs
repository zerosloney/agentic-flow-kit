import fs from 'node:fs';
import path from 'node:path';
import { render } from '../render/tokens.mjs';
import { setField } from './frontmatter.mjs';
import { sha256Text } from './manifest.mjs';

const GITATTR_BEGIN = '# >>> agentic-flow-kit gitattributes';
const GITATTR_END = '# <<< agentic-flow-kit gitattributes';
const GITIGNORE_BEGIN = '# >>> agentic-flow-kit ignores';
const GITIGNORE_END = '# <<< agentic-flow-kit ignores';

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

export function applyPlan({ plan, vars, manifest, dryRun, force, log }) {
  const stats = { create: 0, update: 0, skip: 0, conflict: 0, merge: 0 };
  const nextFiles = { ...(manifest.files || {}) };
  const writes = [];

  for (const entry of plan.entries) {
    const abs = path.join(plan.target, entry.targetRel);
    const exists = fs.existsSync(abs);
    const currentHash = exists ? sha256Text(readText(abs)) : null;
    const managedHash = manifest.files ? manifest.files[entry.targetRel] : null;

    if (entry.kind === 'merge-gitattributes' || entry.kind === 'merge-gitignore') {
      const text = readPlanEntry(entry, vars) || '';
      const begin = entry.kind === 'merge-gitattributes' ? GITATTR_BEGIN : GITIGNORE_BEGIN;
      const end = entry.kind === 'merge-gitattributes' ? GITATTR_END : GITIGNORE_END;
      const block = `${begin}\n${text.trimEnd()}\n${end}\n`;
      const existing = exists ? readText(abs) : '';
      const merged = exists ? mergeBlock(existing, block, begin, end) : block;
      if (existing === merged) {
        stats.skip += 1;
        log('skip', `${entry.targetRel}（已是最新）`);
        continue;
      }
      writes.push({ abs, text: merged, targetRel: entry.targetRel });
      stats.merge += 1;
      log(exists ? 'update' : 'create', `${entry.targetRel}（合并块）`);
      continue;
    }

    const text = readPlanEntry(entry, vars);
    if (text == null) {
      stats.skip += 1;
      log('skip', `${entry.targetRel}（二进制模板跳过）`);
      continue;
    }

    if (!exists) {
      writes.push({ abs, text, targetRel: entry.targetRel });
      stats.create += 1;
      log('create', entry.targetRel);
      continue;
    }

    if (force || (managedHash && managedHash === currentHash)) {
      writes.push({ abs, text, targetRel: entry.targetRel });
      stats.update += 1;
      log('update', entry.targetRel);
      continue;
    }

    if (managedHash && managedHash !== currentHash) {
      stats.conflict += 1;
      log('conflict', `${entry.targetRel}（已安装后被修改，跳过；--force 可覆盖）`);
      continue;
    }

    stats.skip += 1;
    log('skip', `${entry.targetRel}（已存在且非本工具安装，跳过；--force 可覆盖）`);
  }

  if (!dryRun) {
    for (const w of writes) {
      fs.mkdirSync(path.dirname(w.abs), { recursive: true });
      fs.writeFileSync(w.abs, w.text, 'utf8');
      nextFiles[w.targetRel] = sha256Text(w.text);
    }
  }

  return { stats, files: nextFiles };
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
