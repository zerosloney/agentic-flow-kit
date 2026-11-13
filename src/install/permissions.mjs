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

function container(root, cfg) {
  const key = cfg.container || 'permissions';
  if (!isObject(root[key])) root[key] = {};
  return root[key];
}

// 精确替换 allow / deny / ask（权限面是托管策略），保留 defaultMode 等其它键。
export function mergePermissionsIntoRoot(root, compiled, cfg) {
  if (!isObject(root) || !compiled) return false;
  const target = container(root, cfg);
  let changed = false;
  for (const bucket of BUCKETS) {
    const desired = compiled[bucket] || [];
    if (JSON.stringify(target[bucket] || []) !== JSON.stringify(desired)) {
      target[bucket] = desired;
      changed = true;
    }
  }
  return changed;
}

// doctor：对账编译结果与文件实际数组。
export function permissionDrift(root, compiled, cfg) {
  const target = isObject(root) ? root[cfg.container || 'permissions'] : null;
  const missing = [];
  const extra = [];
  for (const bucket of BUCKETS) {
    const actual = Array.isArray(target?.[bucket]) ? target[bucket] : [];
    const desired = compiled[bucket] || [];
    missing.push(...desired.filter((item) => !actual.includes(item)).map((item) => `${bucket}:${item}`));
    extra.push(...actual.filter((item) => !desired.includes(item)).map((item) => `${bucket}:${item}`));
  }
  return { missing, extra };
}
