import fs from 'node:fs';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { buildPlan } from '../install/plan.mjs';
import { buildVars } from '../render/tokens.mjs';
import { readManifest, sha256Text } from '../install/manifest.mjs';
import { readPlanEntry, renderMergeBlock, extractMergeBlock } from '../install/apply.mjs';
import { readInjectedModels } from '../models/resolve.mjs';
import { makeT } from '../i18n.mjs';
import { readKitVersion, resolveTarget } from './install.mjs';

const KIND_ORDER = { missing: 0, 'user-modified': 1, 'kit-updated': 2, orphan: 3, unchanged: 4 };
export const KIND_META = {
  missing: { mark: '+', key: 'diff.kind.missing' },
  'user-modified': { mark: '!', key: 'diff.kind.userModified' },
  'kit-updated': { mark: '~', key: 'diff.kind.kitUpdated' },
  orphan: { mark: '-', key: 'diff.kind.orphan' },
  unchanged: { mark: '=', key: 'diff.kind.unchanged' },
};
const MERGE_KINDS = new Set(['merge-gitattributes', 'merge-gitignore']);

// --strict：任何漂移（用户修改 / 模板更新 / 孤儿 / 缺失）都视为失败。
export function hasDrift(summary) {
  return summary.userModified + summary.kitUpdated + summary.orphan + summary.missing > 0;
}

function strictExit(args, result) {
  return flag(args, 'strict') && hasDrift(result.summary) ? 1 : 0;
}

function normalizeEol(text) {
  return String(text).replace(/\r\n/g, '\n');
}

// engine.json 的 createdAt 是安装时唯一使用 {{installedAt}} 的 token；
// 从已安装文件回读它，避免 diff 把该文件误判为模板更新（manifest.installedAt 是写盘时间）。
function readInstalledAt(target) {
  try {
    const engine = JSON.parse(fs.readFileSync(path.join(target, '.agents/config/engine.json'), 'utf8'));
    return engine.createdAt || null;
  } catch {
    return null;
  }
}

function expectedEntry(entry, vars) {
  if (MERGE_KINDS.has(entry.kind)) {
    const { begin, end, block } = renderMergeBlock(entry, vars);
    return { expectedHash: sha256Text(block), block, begin, end };
  }
  const text = readPlanEntry(entry, vars);
  if (text == null) return null;
  return { expectedHash: sha256Text(text) };
}

export function buildState({ target, manifest }) {
  const hosts = manifest.hosts || [];
  const language = manifest.language || 'zh-CN';
  const stack = manifest.stack || 'empty';
  const projectName = manifest.projectName || path.basename(target);
  const tier = manifest.tier || 'standard';
  const hardened = Boolean(manifest.hardened);
  const kitVersion = readKitVersion();
  // 模型值从已安装子代理回读，使“模板未变”的文件不会被模型注入差异误判。
  const models = readInjectedModels({ target, hosts });
  const plan = buildPlan({
    target, hosts, lang: language, stack, projectName, models, tier, hardened,
    mcp: manifest.mcp === true,
    surfaces: manifest.surfaces || [],
  });
  const vars = buildVars({
    target,
    projectName,
    stack,
    language,
    hosts,
    kitVersion,
    installedAt: readInstalledAt(target) || manifest.installedAt || '',
    trackHosts: manifest.trackHosts === true,
  });
  return { plan, vars, kitVersion };
}

// 单条目分类：diff 与 explain 共用，保证两处判定口径一致。
export function classifyEntry({ target, entry, vars, managedHash, derived = false }) {
  const abs = path.join(target, entry.targetRel);
  const exists = fs.existsSync(abs);
  const actualHash = exists ? sha256Text(fs.readFileSync(abs)) : null;
  if (derived) {
    // 派生工件由脚本按磁盘现状生成，静态模板渲染结果不可作为预期值。
    let kind;
    if (!exists) kind = 'missing';
    else if (managedHash && managedHash !== actualHash) kind = 'user-modified';
    else kind = 'unchanged';
    return { kind, actualHash, expectedHash: null, kitChanged: false, derived: true };
  }
  const expected = expectedEntry(entry, vars);
  const isConfigMerge = entry.kind === 'merge-mcp' || entry.kind === 'merge-host';
  if (!expected) {
    // Hook / MCP 配置损坏无法合并：明确归类为用户修改，doctor / diff 都能看到。
    if (isConfigMerge && exists) {
      return { kind: 'user-modified', actualHash, expectedHash: null, kitChanged: false, derived: false };
    }
    return null;
  }
  // 合并语义：期望值 = 当前内容 + 缺失的托管条目。
  // 期望与现状一致即视为 unchanged（用户自建 server/hook 不应被报成漂移）。
  if (isConfigMerge && expected.expectedHash === actualHash) {
    return { kind: 'unchanged', actualHash, expectedHash: expected.expectedHash, kitChanged: false, derived: false };
  }
  let kitChanged;
  if (expected.block != null) {
    const actualBlock = exists
      ? extractMergeBlock(fs.readFileSync(abs, 'utf8'), expected.begin, expected.end)
      : null;
    kitChanged = !actualBlock
      || normalizeEol(actualBlock) !== normalizeEol(expected.block.trimEnd());
  } else {
    const baseline = managedHash ?? actualHash;
    kitChanged = !exists || expected.expectedHash !== baseline;
  }
  let kind;
  if (!exists) kind = 'missing';
  else if (managedHash && managedHash !== actualHash) kind = 'user-modified';
  else if (kitChanged) kind = 'kit-updated';
  else kind = 'unchanged';
  return { kind, actualHash, expectedHash: expected.expectedHash, kitChanged, derived: false };
}

// 只读：对比 manifest 账本、磁盘现状与当前模板渲染结果。
// kind 优先级：missing > user-modified > kit-updated > orphan > unchanged。
export function buildDiff({ target, manifest }) {
  const { plan, vars, kitVersion } = buildState({ target, manifest });
  const planByRel = new Map(plan.entries.map((entry) => [entry.targetRel, entry]));
  const managed = manifest.files || {};
  const derived = new Set(manifest.derived || []);
  const paths = new Set([...Object.keys(managed), ...planByRel.keys()]);
  const items = [];
  for (const targetRel of paths) {
    const entry = planByRel.get(targetRel);
    const managedHash = managed[targetRel] ?? null;
    if (!entry) {
      const abs = path.join(target, targetRel);
      const actualHash = fs.existsSync(abs) ? sha256Text(fs.readFileSync(abs)) : null;
      items.push({
        targetRel,
        category: null,
        kind: 'orphan',
        managedHash,
        actualHash,
        expectedHash: null,
        managed: managedHash != null,
        kitChanged: false,
        derived: false,
      });
      continue;
    }
    const classified = classifyEntry({
      target,
      entry,
      vars,
      managedHash,
      derived: derived.has(targetRel),
    });
    if (!classified) continue; // 二进制模板不落 manifest，也不参与 diff
    items.push({
      targetRel,
      category: entry.category || null,
      managedHash,
      managed: managedHash != null,
      ...classified,
    });
  }
  items.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.targetRel.localeCompare(b.targetRel));
  const summary = { total: items.length, unchanged: 0, userModified: 0, kitUpdated: 0, orphan: 0, missing: 0 };
  for (const item of items) {
    if (item.kind === 'user-modified') summary.userModified += 1;
    else if (item.kind === 'kit-updated') summary.kitUpdated += 1;
    else if (item.kind === 'orphan') summary.orphan += 1;
    else if (item.kind === 'missing') summary.missing += 1;
    else summary.unchanged += 1;
  }
  return {
    target,
    kitVersion,
    manifest: {
      version: manifest.version || null,
      installedAt: manifest.installedAt || null,
      language: manifest.language || null,
      hosts: manifest.hosts || [],
      stack: manifest.stack || null,
      tier: manifest.tier || 'standard',
      hardened: Boolean(manifest.hardened),
    },
    summary,
    items,
  };
}

function requireManifest(target, t) {
  const manifest = readManifest(target);
  if (!manifest) {
    const err = new Error(t('error.noManifest'));
    err.code = 'NO_MANIFEST';
    throw err;
  }
  return manifest;
}

export function diffCommand({ args, t }) {
  const target = resolveTarget(args);
  const manifest = requireManifest(target, t);
  // 未显式 --lang 时跟随已安装语言，避免英文项目输出中文。
  const tt = args.lang ? t : makeT(manifest.language || 'zh-CN');
  const result = buildDiff({ target, manifest });
  if (flag(args, 'json')) {
    console.log(JSON.stringify(result, null, 2));
    return strictExit(args, result);
  }
  console.log(tt('diff.title', { target }));
  const shown = flag(args, 'all')
    ? result.items
    : result.items.filter((item) => item.kind !== 'unchanged');
  if (!shown.length) console.log(tt('diff.clean'));
  for (const item of shown) {
    const meta = KIND_META[item.kind];
    const line = `${meta.mark} ${tt(meta.key)} ${item.targetRel}`;
    console.log(item.kind === 'user-modified' && item.kitChanged
      ? `${line} ${tt('diff.alsoKitChanged')}`
      : line);
  }
  console.log(tt('diff.summary', result.summary));
  return strictExit(args, result);
}

export function statusCommand({ args, t }) {
  const target = resolveTarget(args);
  const manifest = requireManifest(target, t);
  const tt = args.lang ? t : makeT(manifest.language || 'zh-CN');
  const result = buildDiff({ target, manifest });
  if (flag(args, 'json')) {
    console.log(JSON.stringify({
      target: result.target,
      kitVersion: result.kitVersion,
      manifest: result.manifest,
      summary: result.summary,
    }, null, 2));
    return strictExit(args, result);
  }
  const m = result.manifest;
  console.log(tt('status.title', { target }));
  console.log(tt('status.kit', { version: result.kitVersion }));
  console.log(tt('status.manifest', { version: m.version || '?', installedAt: m.installedAt || '?' }));
  console.log(tt('status.project', {
    language: m.language || '?',
    stack: m.stack || '?',
    tier: m.tier,
    hardened: tt(m.hardened ? 'tui.yes' : 'tui.no'),
  }));
  console.log(tt('status.hosts', { hosts: (m.hosts || []).join(', ') || '-' }));
  console.log(tt('status.counts', result.summary));
  return strictExit(args, result);
}
