// upgrade --explain-policy：对比磁盘上的策略面与本次升级将写入的文本。
// 只做语义差分（门禁接线 / 预算 / 枚举 / 角色与模型引用），避免把注释或格式变化当成策略变化。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPlanEntry } from './apply.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.resolve(HERE, '..', '..', 'templates');
export const POLICY_REL = '.agents/config/policy.json';

function readText(abs) {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function valueOf(value) {
  return value === undefined ? null : value;
}

function addChange(changes, category, rel, op, key, from, to) {
  changes.push({
    category,
    path: rel,
    op,
    key,
    from: valueOf(from),
    to: valueOf(to),
  });
}

function diffPrimitive(changes, category, rel, key, before, after) {
  if (!same(before, after)) addChange(changes, category, rel, 'changed', key, before, after);
}

function diffStringSet(changes, category, rel, key, before, after, label = (value) => value) {
  const a = new Set((before || []).map(label));
  const b = new Set((after || []).map(label));
  for (const item of [...a].filter((value) => !b.has(value)).sort()) {
    addChange(changes, category, rel, 'removed', key, item, null);
  }
  for (const item of [...b].filter((value) => !a.has(value)).sort()) {
    addChange(changes, category, rel, 'added', key, null, item);
  }
}

function diffMap(changes, category, rel, key, before, after) {
  const a = before && typeof before === 'object' ? before : {};
  const b = after && typeof after === 'object' ? after : {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const name of keys) {
    diffPrimitive(changes, category, rel, `${key}.${name}`, a[name], b[name]);
  }
}

function diffJson(changes, category, rel, before, after, prefix = '') {
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) {
      diffPrimitive(changes, category, rel, prefix || rel, before, after);
      return;
    }
    diffStringSet(changes, category, rel, prefix || rel, before, after, (item) => JSON.stringify(item));
    return;
  }
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      diffJson(changes, category, rel, before[key], after[key], prefix ? `${prefix}.${key}` : key);
    }
    return;
  }
  diffPrimitive(changes, category, rel, prefix || rel, before, after);
}

function gateChanges(changes, rel, beforeText, afterText) {
  const before = parseJson(beforeText) || {};
  const after = parseJson(afterText) || {};
  const hookEntries = (root) => (root.hooks || []).map((hook) => [
    `${hook.event}|${hook.tool || ''}|${hook.script || ''}`,
    hook.timeout ?? null,
  ]);
  const beforeHooks = hookEntries(before);
  const afterHooks = hookEntries(after);
  diffStringSet(changes, 'gates', rel, 'hooks', beforeHooks.map(([key]) => key), afterHooks.map(([key]) => key));
  const beforeTimeouts = Object.fromEntries(beforeHooks);
  const afterTimeouts = Object.fromEntries(afterHooks);
  for (const key of Object.keys(beforeTimeouts)) {
    if (key in afterTimeouts) {
      diffPrimitive(changes, 'gates', rel, `hooks.${key}.timeout`, beforeTimeouts[key], afterTimeouts[key]);
    }
  }

  const permissionKeys = (root) => {
    const out = [];
    for (const group of ['allow', 'deny', 'ask']) {
      for (const item of root[group] || []) out.push(`${group}:${item.tool}:${item.pat}`);
    }
    for (const item of root.hardened?.deny || []) out.push(`hardened.deny:${item.tool}:${item.pat}`);
    return out;
  };
  diffStringSet(changes, 'gates', rel, 'permissions', permissionKeys(before), permissionKeys(after));
  diffStringSet(changes, 'gates', rel, 'exempt', (before.exempt || []).map((item) => item.item), (after.exempt || []).map((item) => item.item));
}

function gateBudgetChanges(changes, rel, beforeText, afterText) {
  const before = parseJson(beforeText) || {};
  const after = parseJson(afterText) || {};
  for (const key of ['fullMs', 'scopeMs']) diffPrimitive(changes, 'budgets', rel, key, before[key], after[key]);
}

function ruleBudgetChanges(changes, rel, beforeText, afterText) {
  const parse = (text) => {
    const out = {};
    for (const line of String(text || '').split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const cut = line.lastIndexOf(' ');
      if (cut < 1) continue;
      out[line.slice(0, cut).trim()] = line.slice(cut + 1).trim();
    }
    return out;
  };
  diffMap(changes, 'budgets', rel, 'limits', parse(beforeText), parse(afterText));
}

function enumChanges(changes, rel, beforeText, afterText) {
  const parse = (text) => {
    const out = {};
    for (const line of String(text || '').split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('#')) continue;
      const match = line.match(/^([a-z][a-z0-9.]*)=(\S.*)$/);
      if (match) out[match[1]] = match[2].trim();
    }
    return out;
  };
  diffMap(changes, 'enums', rel, 'keys', parse(beforeText), parse(afterText));
}

function pipelineChanges(changes, rel, beforeText, afterText) {
  const before = parseJson(beforeText) || {};
  const after = parseJson(afterText) || {};
  diffStringSet(changes, 'enums', rel, 'stages', before.stages, after.stages);
  diffStringSet(changes, 'enums', rel, 'stopTypes', before.stopTypes, after.stopTypes);
}

function modelRoleChanges(changes, rel, beforeText, afterText) {
  const before = parseJson(beforeText) || {};
  const after = parseJson(afterText) || {};
  diffPrimitive(changes, 'roles', rel, 'fallback', before.fallback, after.fallback);
  const roles = (root) => Object.fromEntries(Object.entries(root.roles || {}).map(([role, entry]) => [role, entry?.model ?? null]));
  diffMap(changes, 'roles', rel, 'model', roles(before), roles(after));
}

function prReviewChanges(changes, rel, beforeText, afterText) {
  const before = parseJson(beforeText) || {};
  const after = parseJson(afterText) || {};
  diffMap(changes, 'roles', rel, 'modelRoles', before.modelRoles, after.modelRoles);
}

function steeringChanges(changes, rel, beforeText, afterText) {
  const before = parseJson(beforeText) || {};
  const after = parseJson(afterText) || {};
  diffPrimitive(changes, 'roles', rel, 'defaultTier', before.defaultTier, after.defaultTier);
  diffStringSet(changes, 'roles', rel, 'tiers', Object.keys(before.tiers || {}), Object.keys(after.tiers || {}));
}

function evalChanges(changes, rel, beforeText, afterText) {
  const before = parseJson(beforeText) || {};
  const after = parseJson(afterText) || {};
  for (const key of ['threshold', 'maxAgeDays', 'minTasks']) {
    diffPrimitive(changes, 'roles', rel, key, before[key], after[key]);
  }
}

function policyChanges(changes, rel, beforeText, afterText) {
  diffJson(changes, 'policy', rel, parseJson(beforeText), parseJson(afterText));
}

const HANDLERS = new Map([
  ['gates.json', gateChanges],
  ['gate-budgets.json', gateBudgetChanges],
  ['rule-budgets.txt', ruleBudgetChanges],
  ['workflow-enums.txt', enumChanges],
  ['pipeline.json', pipelineChanges],
  ['model-roles.json', modelRoleChanges],
  ['pr-review.json', prReviewChanges],
  ['steering.json', steeringChanges],
  ['agent-eval.json', evalChanges],
  ['policy.json', policyChanges],
]);

function templatePolicy() {
  return parseJson(readText(path.join(TEMPLATES, 'engine', POLICY_REL))) || {};
}

function policySurfaces() {
  const surfaces = templatePolicy().surfaces || {};
  return [
    ['gates', surfaces.gates],
    ['budgets', surfaces.gateBudgets],
    ['budgets', surfaces.ruleBudgets],
    ['enums', surfaces.workflowEnums],
    ['enums', surfaces.pipeline],
    ['roles', surfaces.modelRoles],
    ['roles', surfaces.prReview],
    ['roles', surfaces.steering],
    ['roles', surfaces.agentEval],
    ['policy', POLICY_REL],
  ].filter(([, rel]) => typeof rel === 'string' && rel);
}

// explainPolicyDiff({ target, plan, vars }) → { changed, changes, surfaces }
// changes[].category ∈ gates|budgets|enums|roles|policy；不返回内容未变的文件。
export function explainPolicyDiff({ target, plan, vars }) {
  const changes = [];
  const seen = new Set();
  for (const [, rel] of policySurfaces()) {
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    const entry = plan.entries.find((item) => item.targetRel === rel);
    if (!entry) continue;
    const next = readPlanEntry(entry, vars);
    if (typeof next !== 'string') continue;
    const before = readText(path.join(target, rel));
    if (before === next) continue;
    const handler = HANDLERS.get(path.basename(rel));
    if (handler) handler(changes, rel, before, next);
  }
  return { changed: changes.length > 0, changes, surfaces: [...seen] };
}

const categoryLabel = (change) => {
  if (change.op === 'changed') return `${change.key}: ${format(change.from)} → ${format(change.to)}`;
  const sign = change.op === 'added' ? '+' : '-';
  return `${change.key}: ${sign} ${format(change.to ?? change.from)}`;
};

function format(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function renderPolicyDiff(changes, t) {
  if (!changes.length) return [];
  const lines = [t('install.policyDiffTitle')];
  for (const change of changes) lines.push(`  [${change.category}] ${change.path}: ${categoryLabel(change)}`);
  return lines;
}
