// model — 规则包模型：JSONC 读取、schema 校验、分层合并（legacy ← stack ← project ← local）、豁免。
// 设计边界（rules v1）：原语闭集（content/require/absence/inventory/env/command），
// 不做表达式语言；超出闭集的能力走插件（Phase 4）。
import fs from 'node:fs';
import path from 'node:path';
import { parseJsonc } from './jsonc.mjs';

export const FACES = ['ui', 'code', 'tests', 'data', 'any'];
export const PHASES = ['pre-commit', 'pre-write', 'pre-push', 'verify', 'local', 'always'];
export const SEVERITIES = ['block', 'warn'];
export const SCOPES = ['repo', 'diff'];
export const ASSERT_KINDS = ['content', 'require', 'absence', 'inventory', 'env', 'command', 'navProperties', 'plugin'];

const RULE_KEYS = new Set([
  'id', 'face', 'phase', 'severity', 'scope', 'when', 'files', 'assert', 'message', 'level', 'enabled', 'timeoutMs', 'waiverFile', '_note',
]);

export class RulesConfigError extends Error {
  constructor(message) {
    super(message);
    this.code = 'RULES_CONFIG';
  }
}

const fail = (at, reason) => {
  throw new RulesConfigError(`${at}: ${reason}`);
};
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const strArray = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : []);

function validateArgs(kind, args, at) {
  if (!isObj(args)) fail(at, 'assert.args 必须是对象');
  switch (kind) {
    case 'content': {
      const hasTargets = strArray(args.targets).length || strArray(args.files).length;
      const diffMode = typeof args.pattern === 'string' && args.pattern && !hasTargets;
      if (!hasTargets && !diffMode) fail(at, 'content 需要 targets（glob 数组）或 diff 模式的 pattern');
      const hit = strArray(args.contains).length || strArray(args.matches).length || (typeof args.pattern === 'string' && args.pattern);
      if (!hit) fail(at, 'content 需要 pattern / contains / matches 之一');
      if (args.matches && !Array.isArray(args.matches)) fail(at, 'content.matches 必须是数组');
      if (args.exclude && !Array.isArray(args.exclude)) fail(at, 'content.exclude 必须是数组');
      if (args.unless !== undefined && typeof args.unless !== 'string') fail(at, 'content.unless 必须是字符串');
      if (args.copyPattern !== undefined && typeof args.copyPattern !== 'string') fail(at, 'content.copyPattern 必须是字符串');
      if (args.allow && (!Array.isArray(args.allow) || args.allow.some((a) => !isObj(a) || typeof a.glob !== 'string'))) {
        fail(at, 'content.allow 必须是 [{glob, pattern?}]');
      }
      if (args.allowFiles && !Array.isArray(args.allowFiles)) fail(at, 'content.allowFiles 必须是数组');
      if (args.allowLines && !Array.isArray(args.allowLines)) fail(at, 'content.allowLines 必须是数组');
      break;
    }
    case 'require': {
      if (!strArray(args.files).length) fail(at, 'require 需要 files（精确路径或 glob 数组）');
      if (typeof args.trigger !== 'string' || !args.trigger) fail(at, 'require 需要 trigger（子串）');
      if (typeof args.require !== 'string' || !args.require) fail(at, 'require 需要 require（子串）');
      break;
    }
    case 'absence':
      if (typeof args.glob !== 'string' || !args.glob) fail(at, 'absence 需要 glob');
      break;
    case 'inventory':
      if (!Array.isArray(args.scan) || args.scan.length === 0) fail(at, 'inventory 需要 scan（数组）');
      for (const [i, entry] of args.scan.entries()) {
        if (!isObj(entry) || typeof entry.dir !== 'string' || !entry.dir) fail(at, `inventory.scan[${i}] 需要 dir`);
        if (entry.ext !== undefined && !Array.isArray(entry.ext)) fail(at, `inventory.scan[${i}].ext 必须是数组`);
        for (const key of ['call', 'ignore']) {
          if (entry[key] !== undefined && typeof entry[key] !== 'string') fail(at, `inventory.scan[${i}].${key} 必须是字符串`);
        }
      }
      if (typeof args.baseline !== 'string' || !args.baseline) fail(at, 'inventory 需要 baseline（豁免清单路径）');
      break;
    case 'env':
      if (typeof args.name !== 'string' || !args.name) fail(at, 'env 需要 name');
      if (args.forbiddenValues && !Array.isArray(args.forbiddenValues)) fail(at, 'env.forbiddenValues 必须是数组');
      break;
    case 'navProperties':
      if (typeof args.dir !== 'string' || !args.dir) fail(at, 'navProperties 需要 dir');
      if (args.extraTypeNames !== undefined && !Array.isArray(args.extraTypeNames)) fail(at, 'navProperties.extraTypeNames 必须是数组');
      break;
    case 'command':
      if (typeof args.run !== 'string' || !args.run) fail(at, 'command 需要 run');
      break;
    case 'plugin':
      if (typeof args.module !== 'string' || !args.module) fail(at, 'plugin 需要 module（.agents/rules/plugins/<module>.mjs）');
      break;
    default:
      fail(at, `未知原语 ${kind}（允许：${ASSERT_KINDS.join(' / ')}）`);
  }
}

export function validateRule(rule, at) {
  if (!isObj(rule)) fail(at, '规则必须是对象');
  for (const key of Object.keys(rule)) {
    if (!RULE_KEYS.has(key)) fail(at, `未知字段「${key}」`);
  }
  if (typeof rule.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(rule.id)) fail(at, 'id 缺失或不合规（[a-z0-9._-]）');
  // 只读禁用条目：{ id, enabled: false } 即可，无需复制整条规则（覆盖层最常见的用法）。
  if (rule.enabled === false) {
    const extra = Object.keys(rule).filter((k) => !['id', 'enabled', '_note'].includes(k));
    if (extra.length) fail(at, `禁用条目只允许 id/enabled，其他字段请删掉（多余：${extra.join(', ')}）`);
    return rule;
  }
  if (!FACES.includes(rule.face)) fail(at, `face 非法（${FACES.join(' / ')}）`);
  if (!PHASES.includes(rule.phase)) fail(at, `phase 非法（${PHASES.join(' / ')}）`);
  if (!SEVERITIES.includes(rule.severity)) fail(at, `severity 非法（${SEVERITIES.join(' / ')}）`);
  if (rule.scope !== undefined && !SCOPES.includes(rule.scope)) fail(at, `scope 非法（${SCOPES.join(' / ')}）`);
  if (rule.when !== undefined) {
    if (!Array.isArray(rule.when) || rule.when.some((w) => typeof w !== 'string' || !w)) fail(at, 'when 必须是字符串数组');
  }
  if (rule.files !== undefined) {
    if (!isObj(rule.files)) fail(at, 'files 必须是对象');
    for (const key of ['ext', 'prefix', 'glob']) {
      if (rule.files[key] !== undefined && !Array.isArray(rule.files[key])) fail(at, `files.${key} 必须是数组`);
    }
  }
  if (!isObj(rule.assert)) fail(at, 'assert 必须是 {kind,args}');
  const kind = rule.assert.kind;
  if (!ASSERT_KINDS.includes(kind)) fail(at, `assert.kind 非法（${ASSERT_KINDS.join(' / ')}）`);
  validateArgs(kind, rule.assert.args, at);
  if (!isObj(rule.message) || typeof rule.message.zh !== 'string' || typeof rule.message.en !== 'string') {
    fail(at, 'message 必须是 {zh,en}');
  }
  if (rule.waiverFile !== undefined && typeof rule.waiverFile !== 'string') fail(at, 'waiverFile 必须是字符串');
  if (rule.timeoutMs !== undefined && (!Number.isInteger(rule.timeoutMs) || rule.timeoutMs <= 0)) fail(at, 'timeoutMs 必须是正整数');
  return rule;
}

export function readRulesFile(root, rel) {
  const abs = path.join(root, rel);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new RulesConfigError(`${rel}: 读取失败（${e.message}）`);
  }
  const data = parseJsonc(text, rel);
  if (!isObj(data)) throw new RulesConfigError(`${rel}: 顶层必须是对象`);
  return data;
}

/** 读取一层规则文件：{version, faces?, rules?, waivers?}。 */
export function loadLayer(root, rel, name) {
  const data = readRulesFile(root, rel);
  if (!data) return null;
  if (data.version !== undefined && data.version !== 1) {
    throw new RulesConfigError(`${rel}: 不支持的 version ${data.version}（v1 只认 1）`);
  }
  const rules = Array.isArray(data.rules) ? data.rules : [];
  rules.forEach((rule, i) => validateRule(rule, `${rel}: rules[${i}]`));
  const waivers = Array.isArray(data.waivers) ? data.waivers : [];
  waivers.forEach((w, i) => {
    if (!isObj(w) || typeof w.rule !== 'string' || !w.rule) throw new RulesConfigError(`${rel}: waivers[${i}] 缺 rule`);
    if (w.glob !== undefined && typeof w.glob !== 'string') throw new RulesConfigError(`${rel}: waivers[${i}] glob 必须是字符串`);
    if (w.expires !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(w.expires))) throw new RulesConfigError(`${rel}: waivers[${i}] expires 必须是 YYYY-MM-DD`);
    if (w.reason !== undefined && typeof w.reason !== 'string') throw new RulesConfigError(`${rel}: waivers[${i}] reason 必须是字符串`);
  });
  // 插件条目（子进程扩展点）：{ id, module, face, phase, severity?, timeoutMs?, message? }
  const plugins = Array.isArray(data.plugins) ? data.plugins : [];
  plugins.forEach((p, i) => {
    const at = `${rel}: plugins[${i}]`;
    if (!isObj(p)) throw new RulesConfigError(`${at} 必须是对象`);
    for (const key of Object.keys(p)) {
      if (!['id', 'module', 'face', 'phase', 'severity', 'timeoutMs', 'message', '_note'].includes(key)) throw new RulesConfigError(`${at} 未知字段「${key}」`);
    }
    if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(p.id)) throw new RulesConfigError(`${at} id 缺失或不合规`);
    if (typeof p.module !== 'string' || !/^[A-Za-z0-9._-]+$/.test(p.module)) throw new RulesConfigError(`${at} module 缺失或不合规`);
    if (!FACES.includes(p.face)) throw new RulesConfigError(`${at} face 非法（${FACES.join(' / ')}）`);
    if (!PHASES.includes(p.phase)) throw new RulesConfigError(`${at} phase 非法（${PHASES.join(' / ')}）`);
    if (p.severity !== undefined && !SEVERITIES.includes(p.severity)) throw new RulesConfigError(`${at} severity 非法`);
    if (p.timeoutMs !== undefined && (!Number.isInteger(p.timeoutMs) || p.timeoutMs <= 0)) throw new RulesConfigError(`${at} timeoutMs 必须是正整数`);
    if (p.message !== undefined && (!isObj(p.message) || typeof p.message.zh !== 'string' || typeof p.message.en !== 'string')) {
      throw new RulesConfigError(`${at} message 必须是 {zh,en}`);
    }
  });
  const faces = isObj(data.faces) ? data.faces : {};
  for (const key of Object.keys(faces)) {
    if (!['ui', 'code', 'tests', 'data'].includes(key)) throw new RulesConfigError(`${rel}: faces.${key} 未知面`);
    if (!Array.isArray(faces[key]) || faces[key].some((s) => typeof s !== 'string' || !s)) throw new RulesConfigError(`${rel}: faces.${key} 必须是字符串数组`);
  }
  return { name, rules, waivers, faces, plugins };
}

/** 分层合并：同 id 后者整条替换；faces 按键替换；waivers 追加（同 rule+glob 后者覆盖）。 */
export function mergeLayers(layers) {
  const byId = new Map();
  const faces = {};
  const waivers = new Map();
  const provenance = new Map();
  for (const layer of layers || []) {
    if (!layer) continue;
    for (const [key, list] of Object.entries(layer.faces || {})) faces[key] = [...list];
    for (const rule of layer.rules) {
      byId.set(rule.id, rule);
      provenance.set(rule.id, layer.name);
    }
    // 插件条目（可选）折算成 plugin 规则：列表是「显式白名单」，不自动加载目录。
    for (const p of layer.plugins || []) {
      byId.set(p.id, {
        id: p.id,
        face: p.face,
        phase: p.phase,
        severity: p.severity || 'warn',
        scope: 'repo',
        assert: { kind: 'plugin', args: { module: p.module } },
        message: p.message || { zh: p.id, en: p.id },
        ...(p.timeoutMs ? { timeoutMs: p.timeoutMs } : {}),
      });
      provenance.set(p.id, layer.name);
    }
    for (const w of layer.waivers) {
      waivers.set(`${w.rule}::${w.glob || '*'}`, w);
    }
  }
  const rules = [...byId.values()].map((rule) => ({ ...rule, source: provenance.get(rule.id) }));
  return { faces, rules, waivers: [...waivers.values()] };
}

/** 过滤过期豁免；返回 { active, expired }。 */
export function splitWaivers(waivers, today = new Date()) {
  const iso = today.toISOString().slice(0, 10);
  const active = [];
  const expired = [];
  for (const w of waivers) {
    if (w.expires && w.expires < iso) expired.push(w);
    else active.push(w);
  }
  return { active, expired };
}
