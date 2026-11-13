import fs from 'node:fs';
import path from 'node:path';
import { STACK_SHELL } from '../render/tokens.mjs';
import { HOOKS_SPEC_REL } from './hooks.mjs';

// 权限编译器：把 gates.json 的 allow / deny / ask（以及 hardened 追加项）编译成
// 各宿主 permissions 数组。与 Hook 编译器共用“中性规格 + registry 能力 + 幂等合并”骨架。
// 宿主不支持的 tool 类别不静默丢弃：编译结果带 unsupported，供 doctor 告警。
const TOOL_KINDS = new Set(['shell', 'read', 'web']);
const BUCKETS = ['allow', 'deny', 'ask'];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEntries(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!isObject(item) || typeof item.pat !== 'string' || !item.pat) continue;
    const tool = item.tool == null ? 'shell' : String(item.tool);
    if (!TOOL_KINDS.has(tool)) continue;
    out.push({ tool, pat: item.pat, reason: typeof item.reason === 'string' ? item.reason : undefined });
  }
  return out;
}

// 解析 gates.json 的权限面；没有任何权限声明时返回 null（回退静态模板）。
export function parsePermissionSpec(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(root)) return null;
  const hardenedRaw = isObject(root.hardened) ? root.hardened : {};
  if (!BUCKETS.some((bucket) => Array.isArray(root[bucket])) && !Object.keys(hardenedRaw).length) return null;
  return {
    allow: normalizeEntries(root.allow),
    deny: normalizeEntries(root.deny),
    ask: normalizeEntries(root.ask),
    hardened: {
      allow: normalizeEntries(hardenedRaw.allow),
      deny: normalizeEntries(hardenedRaw.deny),
      ask: normalizeEntries(hardenedRaw.ask),
    },
  };
}

export function readPermissionSpec(target) {
  try {
    return parsePermissionSpec(fs.readFileSync(path.join(target, HOOKS_SPEC_REL), 'utf8'));
  } catch {
    return null;
  }
}

function shellPattern(cfg, pat) {
  if (pat.includes('*')) return pat;
  return cfg.syntax === 'colon' ? `${pat}:*` : `${pat} *`;
}

function formatEntry(entry, cfg) {
  if (entry.tool === 'shell') return `${cfg.tool}(${shellPattern(cfg, entry.pat)})`;
  if (entry.tool === 'read') return `Read(${entry.pat})`;
  return entry.pat;
}

function stackAllow(stack) {
  return (STACK_SHELL[stack] || []).map((pat) => ({ tool: 'shell', pat }));
}

// 编译成宿主 permissions 数组。extraAllow 是宿主特有的白名单项（如 Shell(dir *)）。
export function compilePermissions(spec, cfg, { stack = 'empty', hardened = false } = {}) {
  const extras = hardened ? spec.hardened : { allow: [], deny: [], ask: [] };
  const source = {
    // 栈相关白名单放在前面，与静态模板的 {{stackAllow*}} 位置一致。
    allow: [...stackAllow(stack), ...spec.allow, ...(cfg.extraAllow || []), ...extras.allow],
    deny: [...spec.deny, ...extras.deny],
    ask: [...spec.ask, ...extras.ask],
  };
  const supported = new Set(cfg.tools || ['shell']);
  const result = { allow: [], deny: [], ask: [], unsupported: [] };
  const unsupported = new Set();
  for (const bucket of BUCKETS) {
    const seen = new Set();
    for (const entry of source[bucket]) {
      if (!supported.has(entry.tool)) {
        const key = `${entry.tool}:${entry.pat}`;
        if (!unsupported.has(key)) {
          unsupported.add(key);
          result.unsupported.push({ tool: entry.tool, pat: entry.pat });
        }
        continue;
      }
      const value = formatEntry(entry, cfg);
      if (seen.has(value)) continue;
      seen.add(value);
      result[bucket].push(value);
    }
  }
  return result;
}

// 卸载：只移除 manifest 记录为托管的条目，保留用户自建权限。
export function stripManagedPermissions(root, recorded, cfg) {
  if (!isObject(root) || !recorded) return false;
  const key = cfg.container || 'permissions';
  const target = root[key];
  if (!isObject(target)) return false;
  let changed = false;
  for (const bucket of BUCKETS) {
    if (!Array.isArray(target[bucket])) continue;
    const managed = new Set(recorded[bucket] || []);
    const next = target[bucket].filter((item) => !managed.has(item));
    if (next.length !== target[bucket].length) changed = true;
    if (next.length) target[bucket] = next;
    else delete target[bucket];
  }
  if (!Object.keys(target).length) {
    delete root[key];
    changed = true;
  }
  return changed;
}

function container(root, cfg) {
  const key = cfg.container || 'permissions';
  if (!isObject(root[key])) root[key] = {};
  return root[key];
}

// 合并策略：保留用户自建条目，只替换“上次由本工具写入”的条目，再补上本次编译项。
// reset=true 用于文件尚不存在、以静态宿主模板打底的场景：模板条目属于工具自身，直接替换。
export function mergePermissionsIntoRoot(root, compiled, cfg, previousManaged = null, { reset = false } = {}) {
  if (!isObject(root) || !compiled) return false;
  const target = container(root, cfg);
  let changed = false;
  for (const bucket of BUCKETS) {
    const current = Array.isArray(target[bucket]) ? [...target[bucket]] : [];
    const managedPrev = new Set(previousManaged?.[bucket] || []);
    const desired = reset ? [] : current.filter((item) => !managedPrev.has(item));
    for (const item of compiled[bucket] || []) {
      if (!desired.includes(item)) desired.push(item);
    }
    if (JSON.stringify(target[bucket] || []) !== JSON.stringify(desired)) {
      target[bucket] = desired;
      changed = true;
    }
  }
  return changed;
}

// doctor：编译项必须全部在位；上次托管但本次已移除的条目属于残留。
// 用户自建条目不在校验范围内。
export function permissionDrift(root, compiled, cfg, previousManaged = null) {
  const target = isObject(root) ? root[cfg.container || 'permissions'] : null;
  const missing = [];
  const stale = [];
  for (const bucket of BUCKETS) {
    const actual = Array.isArray(target?.[bucket]) ? target[bucket] : [];
    const desired = compiled[bucket] || [];
    missing.push(...desired.filter((item) => !actual.includes(item)).map((item) => `${bucket}:${item}`));
    const managedPrev = new Set(previousManaged?.[bucket] || []);
    stale.push(...[...managedPrev].filter((item) => actual.includes(item) && !desired.includes(item))
      .map((item) => `${bucket}:${item}`));
  }
  return { missing, stale };
}
