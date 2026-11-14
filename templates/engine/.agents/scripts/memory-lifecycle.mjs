#!/usr/bin/env node
// memory-lifecycle.mjs — 记忆生命周期：提升 / 衰减 / 冲突消解 / 跨仓联邦 / 统一查询 / 命中率审计
//
// 背景（Anthropic《The components of agent memory》）：记忆必须能被修剪与升降，
// 否则注入层只会变大；同一事实出现互相矛盾的版本时，需要有确定性的裁决规则，
// 且每条结论都能追到来源。本脚本把“记忆”从只读建议提升为可运营的状态机。
//
// 数据面（全部纯文件、零依赖）：
//   .agents/memory/records.jsonl      记忆记录（candidate → active → dormant → retired；
//                                     冲突败者 superseded）
//   .agents/memory/audit.jsonl        状态迁移审计（每次迁移带 id / 来源 / 原因）
//   .agents/cache/memory-hits.jsonl   查询命中（运行态，gitignore）
//   注入层标记块（.agents/notes/injected-memory.md 内 memory:auto:begin/end）
//                                     只由 promote 维护；块外手写内容不受影响
//   预算单源：.agents/config/memory-tiers.json（200 行 / 25KB）
//
// 状态机（确定性：只依赖记录、config、now）：
//   candidate --uses>=promotion.minUses--> active
//   active    --idle>dormantAfterDays--> dormant
//   active    --idle>retireAfterDays--> retired
//   dormant   --idle>retireAfterDays--> retired
//   dormant   --idle<=dormantAfterDays--> active（再次被命中）
//   candidate --idle>retireAfterDays--> retired
//   retired / superseded 为终态（重复 add 同一 key+text 不复活）
//   idle = now - max(lastHitAt, createdAt)
//
// 冲突消解（同 key、不同 text）：来源权威 rank → createdAt 新者 → id 小者胜；
//   败者置 superseded 并记录 supersededBy；审计保留胜者与败者来源。
//
// 用法：
//   flow-kit run memory-lifecycle.mjs list [--state active] [--json]
//   flow-kit run memory-lifecycle.mjs add --text "..." [--key ...] [--kind manual] [--ref path]
//   flow-kit run memory-lifecycle.mjs decay [--dry-run] [--json]
//   flow-kit run memory-lifecycle.mjs conflict [--dry-run] [--json]
//   flow-kit run memory-lifecycle.mjs promote [--from-suggest] [--dry-run] [--json]
//   flow-kit run memory-lifecycle.mjs cycle [--dry-run] [--json]
//   flow-kit run memory-lifecycle.mjs query "关键词" [--limit N] [--local] [--roots a,b] [--no-log]
//   flow-kit run memory-lifecycle.mjs report [--days 30] [--out tmp/memory-audit-<date>.md] [--check] [--json]
//
// 退出码：0 正常；1 预算溢出 / 注入块陈旧 / 未消解冲突（仅 --check）/ 数据损坏；2 用法。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { auditBudget, loadConfig as loadTierConfig, measureText, suggestPromotions } from './memory-tier.mjs';

export const DEFAULT_CONFIG = {
  version: 1,
  store: '.agents/memory/records.jsonl',
  audit: '.agents/memory/audit.jsonl',
  hits: '.agents/cache/memory-hits.jsonl',
  injected: { begin: '<!-- memory:auto:begin -->', end: '<!-- memory:auto:end -->' },
  promotion: { minUses: 2 },
  decay: { dormantAfterDays: 90, retireAfterDays: 180 },
  conflict: { sourceRank: ['manual', 'incident', 'claim', 'papercut', 'session-log', 'suggest'] },
  federation: { roots: [] },
  query: { limit: 10 },
};

const STATES = ['candidate', 'active', 'dormant', 'retired', 'superseded'];
const TERMINAL = new Set(['retired', 'superseded']);
const TEXT_MAX = 400;
const EPOCH = '1970-01-01T00:00:00.000Z';

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

export function loadConfig(root) {
  const file = path.join(root, '.agents', 'config', 'memory-lifecycle.json');
  try {
    return merge(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function fold(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeKey(s) {
  return fold(s);
}

export function recordId(key, text) {
  // 大小写 / 引号 / 空白差异不算新事实：id 用折叠后的 key+text，避免同一句话产生“假冲突”。
  return `m-${crypto.createHash('sha256').update(`${normalizeKey(key)}\n${normalizeKey(text)}`).digest('hex').slice(0, 12)}`;
}

function iso(now) {
  return (now instanceof Date ? now : new Date(now)).toISOString();
}

function readJsonl(abs) {
  let text = '';
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return { rows: [], problems: [], exists: false };
  }
  const rows = [];
  const problems = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (e) {
      problems.push(`${abs}:${i + 1} ${e.message}`);
    }
  });
  return { rows, problems, exists: true };
}

function writeTextAtomic(abs, text) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, abs);
}

function appendJsonl(abs, row) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, `${JSON.stringify(row)}\n`, 'utf8');
}

function normalizeSource(input) {
  if (typeof input === 'string') return { kind: input || 'manual', ref: '' };
  if (isPlainObject(input)) {
    return { kind: String(input.kind || 'manual'), ref: String(input.ref || '') };
  }
  return { kind: 'manual', ref: '' };
}

export function normalizeRecord(row) {
  const text = String(row.text || '').trim();
  const key = normalizeKey(row.key || text);
  const createdAt = Date.parse(row.createdAt) ? new Date(row.createdAt).toISOString() : EPOCH;
  const updatedAt = Date.parse(row.updatedAt) ? new Date(row.updatedAt).toISOString() : createdAt;
  const lastHitAt = Date.parse(row.lastHitAt) ? new Date(row.lastHitAt).toISOString() : null;
  return {
    id: String(row.id || recordId(key, text)),
    key,
    text,
    state: STATES.includes(row.state) ? row.state : 'candidate',
    source: normalizeSource(row.source),
    refs: Array.isArray(row.refs) ? [...new Set(row.refs.map(String))] : [],
    tags: Array.isArray(row.tags) ? [...new Set(row.tags.map(String))] : [],
    createdAt,
    updatedAt,
    lastHitAt,
    hits: Number.isFinite(row.hits) ? row.hits : 0,
    supersededBy: row.supersededBy ? String(row.supersededBy) : null,
    supersedes: Array.isArray(row.supersedes) ? [...new Set(row.supersedes.map(String))] : [],
  };
}

export function readStore(root, cfg = loadConfig(root)) {
  const abs = path.join(root, cfg.store);
  const { rows, problems, exists } = readJsonl(abs);
  const records = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    if (!isPlainObject(row) || typeof row.text !== 'string' || !row.text.trim()) {
      problems.push(`${cfg.store}:${i + 1} 记录缺少 text`);
      return;
    }
    const rec = normalizeRecord(row);
    if (seen.has(rec.id)) {
      problems.push(`${cfg.store}:${i + 1} 重复 id ${rec.id}`);
      return;
    }
    seen.add(rec.id);
    records.push(rec);
  });
  return { abs, records, problems, exists };
}

export function writeStore(root, cfg, records) {
  const rows = [...records]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => JSON.stringify(r));
  writeTextAtomic(path.join(root, cfg.store), `${rows.join('\n')}${rows.length ? '\n' : ''}`);
}

function requireCleanStore(store) {
  if (store.problems.length) {
    const err = new Error(`记忆库数据损坏，拒绝写入：${store.problems.slice(0, 3).join('；')}`);
    err.code = 'MEMORY_DATA';
    throw err;
  }
}

function auditEvent(root, cfg, row, now) {
  appendJsonl(path.join(root, cfg.audit), { ts: iso(now), ...row });
}

export function addRecord(records, item, { now = new Date(), cfg = DEFAULT_CONFIG } = {}) {
  const text = String(item.text || '').trim();
  if (!text) throw new Error('--text 不能为空');
  if (text.length > TEXT_MAX) throw new Error(`--text 超长（${text.length}/${TEXT_MAX}）`);
  const key = normalizeKey(item.key || text);
  const id = recordId(key, text);
  const source = normalizeSource(item.source || { kind: item.kind, ref: item.ref });
  const existing = records.find((r) => r.id === id);
  if (existing) {
    for (const ref of [...(item.refs || []), source.ref].filter(Boolean)) {
      if (!existing.refs.includes(ref)) existing.refs.push(ref);
    }
    for (const tag of item.tags || []) if (!existing.tags.includes(tag)) existing.tags.push(tag);
    return { record: existing, created: false };
  }
  const ts = iso(now);
  const record = {
    id,
    key,
    text,
    state: 'candidate',
    source,
    refs: [...new Set([...(item.refs || []), source.ref].filter(Boolean).map(String))],
    tags: [...new Set((item.tags || []).map(String))],
    createdAt: ts,
    updatedAt: ts,
    lastHitAt: null,
    hits: 0,
    supersededBy: null,
    supersedes: [],
  };
  records.push(record);
  return { record, created: true };
}

function idleDays(record, now) {
  const last = record.lastHitAt || record.createdAt;
  const ms = new Date(now).getTime() - Date.parse(last);
  return Number.isFinite(ms) ? Math.max(0, ms / 86400000) : Number.POSITIVE_INFINITY;
}

export function applyDecay(records, { now = new Date(), cfg = DEFAULT_CONFIG } = {}) {
  const { dormantAfterDays, retireAfterDays } = cfg.decay;
  const ts = iso(now);
  const transitions = [];
  for (const record of records) {
    if (TERMINAL.has(record.state)) continue;
    const idle = idleDays(record, now);
    let next = record.state;
    if (record.state === 'active') {
      if (idle > retireAfterDays) next = 'retired';
      else if (idle > dormantAfterDays) next = 'dormant';
    } else if (record.state === 'dormant') {
      if (idle > retireAfterDays) next = 'retired';
      else if (idle <= dormantAfterDays) next = 'active';
    } else if (record.state === 'candidate' && idle > retireAfterDays) {
      next = 'retired';
    }
    if (next !== record.state) {
      const from = record.state;
      record.state = next;
      record.updatedAt = ts;
      transitions.push({ id: record.id, from, to: next, idleDays: Math.round(idle * 10) / 10 });
    }
  }
  return transitions;
}

export function conflictGroups(records) {
  const byKey = new Map();
  for (const record of records) {
    if (TERMINAL.has(record.state)) continue;
    if (!byKey.has(record.key)) byKey.set(record.key, []);
    byKey.get(record.key).push(record);
  }
  return [...byKey.entries()]
    .filter(([, list]) => new Set(list.map((r) => fold(r.text))).size > 1)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function sourceRank(record, cfg) {
  const rank = cfg.conflict.sourceRank.indexOf(record.source.kind);
  return rank < 0 ? cfg.conflict.sourceRank.length : rank;
}

export function resolveConflicts(records, { now = new Date(), cfg = DEFAULT_CONFIG } = {}) {
  const ts = iso(now);
  const resolved = [];
  for (const [key, list] of conflictGroups(records)) {
    const ordered = [...list].sort((a, b) =>
      sourceRank(a, cfg) - sourceRank(b, cfg)
      || Date.parse(b.createdAt) - Date.parse(a.createdAt)
      || a.id.localeCompare(b.id));
    const winner = ordered[0];
    for (const loser of ordered.slice(1)) {
      loser.state = 'superseded';
      loser.supersededBy = winner.id;
      loser.updatedAt = ts;
      if (!winner.supersedes.includes(loser.id)) winner.supersedes.push(loser.id);
      resolved.push({
        key,
        winner: winner.id,
        loser: loser.id,
        winnerSource: winner.source,
        loserSource: loser.source,
      });
    }
  }
  return resolved;
}

export function renderInjectedBlock(records, cfg = DEFAULT_CONFIG) {
  const { begin, end } = cfg.injected;
  const active = records
    .filter((r) => r.state === 'active')
    .sort((a, b) => b.hits - a.hits || a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
  const lines = [begin, '<!-- 由 flow-kit run memory-lifecycle.mjs promote 维护；块外手写内容不受影响。 -->'];
  if (!active.length) lines.push('- _（暂无自动上浮记忆）_');
  for (const record of active) {
    const text = record.text.replace(/\s+/g, ' ').trim();
    const ref = record.source.ref || record.refs[0] || '';
    lines.push(`- ${text}${ref ? `（来源：${ref}）` : ''}`);
  }
  lines.push(end);
  return lines.join('\n');
}

export function composeInjected(current, block, cfg = DEFAULT_CONFIG, hasActive = true) {
  const { begin, end } = cfg.injected;
  const b = current.indexOf(begin);
  const e = current.indexOf(end);
  if (b >= 0 && e > b) return current.slice(0, b) + block + current.slice(e + end.length);
  if (!hasActive) return current;
  if (!current) return `${block}\n`;
  const sep = current.endsWith('\n') ? '' : '\n';
  return `${current}${sep}\n${block}\n`;
}

export function inspectInjected(text, records, cfg = DEFAULT_CONFIG) {
  const expected = renderInjectedBlock(records, cfg);
  const { begin, end } = cfg.injected;
  const b = text.indexOf(begin);
  const e = text.indexOf(end);
  if (b < 0 || e < b) return { state: 'missing-markers', expected };
  const actual = text.slice(b, e + end.length);
  return actual === expected
    ? { state: 'ok', expected }
    : { state: 'stale', expected, actual };
}

function readInjected(root, tierCfg) {
  const rel = tierCfg.injected.file;
  const abs = path.join(root, rel);
  try {
    return { rel, text: fs.readFileSync(abs, 'utf8'), exists: true };
  } catch {
    return { rel, text: '', exists: false };
  }
}

export function promote(root, { now = new Date(), cfg = loadConfig(root), tierCfg = loadTierConfig(root), fromSuggest = false, dryRun = false, minUses = null } = {}) {
  const store = readStore(root, cfg);
  requireCleanStore(store);
  const records = store.records.map((r) => normalizeRecord(r));
  const ts = iso(now);
  const added = [];
  const pendingAudit = [];

  if (fromSuggest) {
    const suggestions = suggestPromotions(root, { days: 90, now });
    for (const s of suggestions) {
      const text = String(s.samples[0] || s.key).trim().slice(0, TEXT_MAX) || s.key;
      const { record, created } = addRecord(records, {
        key: s.key,
        text,
        source: { kind: 'suggest', ref: s.sources.join(',') },
        tags: s.sources,
      }, { now, cfg });
      if (created) {
        added.push(record);
        pendingAudit.push({ action: 'add', id: record.id, source: record.source, origin: 'suggest' });
      }
    }
  }

  const threshold = Number.isFinite(Number(minUses)) && minUses !== true ? Number(minUses) : cfg.promotion.minUses;
  const promoted = [];
  for (const record of records) {
    if (record.state !== 'candidate' || record.hits < threshold) continue;
    const from = record.state;
    record.state = 'active';
    record.updatedAt = ts;
    promoted.push({ id: record.id, from, to: 'active', hits: record.hits });
  }

  const block = renderInjectedBlock(records, cfg);
  const injected = readInjected(root, tierCfg);
  const nextText = composeInjected(injected.text, block, cfg, records.some((r) => r.state === 'active'));
  const budget = measureText(nextText, tierCfg);
  if (!budget.ok) {
    return { ok: false, reason: 'over-budget', budget, promoted: [], added, block, injected: injected.rel };
  }

  const changedInjected = nextText !== injected.text;
  if (!dryRun) {
    if (records.length) writeStore(root, cfg, records);
    if (changedInjected) writeTextAtomic(path.join(root, injected.rel), nextText);
    for (const row of pendingAudit) auditEvent(root, cfg, row, now);
    for (const p of promoted) auditEvent(root, cfg, { action: 'promote', ...p }, now);
  }
  return { ok: true, budget, promoted, added, block, changedInjected, dryRun, injected: injected.rel };
}

function federationRoots(root, cfg, override = null) {
  const list = override && override.length ? override : cfg.federation.roots;
  const out = [];
  const seen = new Set([path.resolve(root)]);
  for (const item of list) {
    const abs = path.resolve(root, item);
    if (seen.has(abs)) continue;
    seen.add(abs);
    let label = path.relative(root, abs).replace(/\\/g, '/');
    if (!label || label.startsWith('..')) label = abs.replace(/\\/g, '/');
    out.push({ abs, label });
  }
  return out;
}

function readFederated(root, cfg, override = null) {
  return federationRoots(root, cfg, override).map(({ abs, label }) => {
    const store = readStore(abs, cfg);
    return {
      label,
      abs,
      exists: store.exists,
      records: store.records.filter((r) => !TERMINAL.has(r.state)),
      problems: store.problems,
    };
  });
}

function sha8(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8);
}

function readClaims(root) {
  const entries = [];
  const problems = [];
  const dir = path.join(root, 'workflow', 'claims.d');
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)).sort();
  } catch {
    return { entries, problems };
  }
  for (const name of names) {
    const rel = `workflow/claims.d/${name}`;
    const { rows, problems: bad } = readJsonl(path.join(root, rel));
    problems.push(...bad);
    rows.forEach((row, i) => {
      if (!row || typeof row.claim !== 'string' || !row.claim.trim()) return;
      entries.push({
        id: `claim-${sha8(`${rel}:${i}`)}`,
        kind: 'claim',
        origin: 'local',
        state: null,
        ref: `${rel}#L${i + 1}`,
        key: row.claim,
        text: row.claim,
        tags: [row.path || '', row.id || ''].filter(Boolean),
      });
    });
  }
  return { entries, problems };
}

function readMarkdownSource(root, dirRel, kind, re = /\.md$/) {
  const entries = [];
  const dir = path.join(root, dirRel);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => re.test(n)).sort();
  } catch {
    return entries;
  }
  for (const name of names) {
    const rel = `${dirRel}/${name}`;
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const title = (text.match(/^#\s+(.+)$/m) || [])[1] || name.replace(/\.md$/, '');
    entries.push({
      id: `${kind}-${sha8(rel)}`,
      kind,
      origin: 'local',
      state: null,
      ref: rel,
      key: title.trim(),
      text,
      tags: [],
    });
  }
  return entries;
}

export function collectQueryEntries(root, { cfg = loadConfig(root), localOnly = false, roots = null } = {}) {
  const store = readStore(root, cfg);
  const problems = [...store.problems];
  const entries = store.records
    .filter((r) => !TERMINAL.has(r.state))
    .map((r) => ({
      id: r.id,
      kind: 'memory',
      origin: 'local',
      state: r.state,
      ref: r.source.ref || r.refs[0] || r.source.kind,
      key: r.key,
      text: r.text,
      tags: r.tags,
    }));

  const claims = readClaims(root);
  problems.push(...claims.problems);
  entries.push(...claims.entries);
  entries.push(...readMarkdownSource(root, 'workflow/incidents', 'incident'));
  entries.push(...readMarkdownSource(root, 'workflow/papercuts.d', 'papercut'));
  if (fs.existsSync(path.join(root, 'workflow', 'papercuts.md'))) {
    const rel = 'workflow/papercuts.md';
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    entries.push({
      id: `papercut-${sha8(rel)}`,
      kind: 'papercut',
      origin: 'local',
      state: null,
      ref: rel,
      key: (text.match(/^#\s+(.+)$/m) || [])[1] || 'papercuts',
      text,
      tags: [],
    });
  }

  const federation = [];
  if (!localOnly) {
    for (const remote of readFederated(root, cfg, roots)) {
      federation.push({ label: remote.label, exists: remote.exists, records: remote.records.length, problems: remote.problems });
      for (const r of remote.records) {
        entries.push({
          id: `${remote.label}#${r.id}`,
          kind: 'memory',
          origin: remote.label,
          state: r.state,
          ref: r.source.ref || r.refs[0] || r.source.kind,
          key: r.key,
          text: r.text,
          tags: r.tags,
        });
      }
    }
  }
  return { entries, problems, federation };
}

function scoreEntry(qn, tokens, entry) {
  const key = fold(entry.key);
  const text = fold(entry.text);
  const tags = (entry.tags || []).map(fold);
  let score = 0;
  if (key === qn) score += 6;
  else if (key.includes(qn)) score += 4;
  if (text.includes(qn)) score += 2;
  if (tags.some((t) => t === qn)) score += 3;
  for (const token of tokens) {
    if (token.length < 2) continue;
    if (key.includes(token)) score += 1;
    if (text.includes(token)) score += 1;
    if (tags.some((t) => t.includes(token))) score += 1;
  }
  return score;
}

export function queryMemory(root, query, { now = new Date(), cfg = loadConfig(root), limit = null, localOnly = false, roots = null, log = true } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('query 关键词不能为空');
  const qn = fold(q);
  const tokens = qn.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
  const { entries, problems, federation } = collectQueryEntries(root, { cfg, localOnly, roots });
  const ranked = entries
    .map((entry) => ({ entry, score: scoreEntry(qn, tokens, entry) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.ref.localeCompare(b.entry.ref) || a.entry.id.localeCompare(b.entry.id))
    .slice(0, Number(limit) > 0 ? Number(limit) : cfg.query.limit)
    .map(({ entry, score }) => ({
      id: entry.id,
      kind: entry.kind,
      origin: entry.origin,
      state: entry.state,
      ref: entry.ref,
      key: entry.key,
      text: entry.text,
      score,
    }));

  let logged = false;
  if (log) {
    const store = readStore(root, cfg);
    requireCleanStore(store);
    appendJsonl(path.join(root, cfg.hits), {
      ts: iso(now),
      query: q,
      results: ranked.map((r) => ({ id: r.id, kind: r.kind, origin: r.origin, ref: r.ref })),
    });
    let changed = false;
    for (const hit of ranked) {
      if (hit.kind !== 'memory' || hit.origin !== 'local') continue;
      const record = store.records.find((r) => r.id === hit.id);
      if (!record || TERMINAL.has(record.state)) continue;
      record.hits += 1;
      record.lastHitAt = iso(now);
      record.updatedAt = iso(now);
      changed = true;
    }
    if (changed) writeStore(root, cfg, store.records);
    logged = true;
  }
  return { query: q, results: ranked, problems, federation, logged };
}

function readHitStats(root, cfg, now, days) {
  const cutoff = new Date(now).getTime() - days * 86400000;
  const { rows, problems } = readJsonl(path.join(root, cfg.hits));
  const recent = rows.filter((r) => r && r.ts && Date.parse(r.ts) >= cutoff);
  const withResults = recent.filter((r) => Array.isArray(r.results) && r.results.length > 0);
  const ids = new Set();
  for (const r of withResults) for (const hit of r.results) if (hit && hit.id) ids.add(`${hit.origin || 'local'}#${hit.id}`);
  return {
    days,
    queries: recent.length,
    withResults: withResults.length,
    hitRate: recent.length ? withResults.length / recent.length : null,
    uniqueRecords: ids.size,
    problems,
  };
}

function readAuditStats(root, cfg, now, days) {
  const cutoff = new Date(now).getTime() - days * 86400000;
  const { rows, problems } = readJsonl(path.join(root, cfg.audit));
  const recent = rows.filter((r) => r && r.ts && Date.parse(r.ts) >= cutoff);
  const counts = {};
  for (const row of recent) counts[row.action || 'unknown'] = (counts[row.action || 'unknown'] || 0) + 1;
  return { days, counts, problems };
}

export function report(root, { now = new Date(), cfg = loadConfig(root), tierCfg = loadTierConfig(root), days = 30, roots = null, out = null, dryRun = false } = {}) {
  const store = readStore(root, cfg);
  const counts = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const record of store.records) counts[record.state] = (counts[record.state] || 0) + 1;
  const conflicts = conflictGroups(store.records).map(([key, list]) => ({
    key,
    records: list.map((r) => ({ id: r.id, state: r.state, text: r.text, source: r.source })),
  }));
  const tier = auditBudget(root, tierCfg);
  const injected = readInjected(root, tierCfg);
  const injectedCheck = inspectInjected(injected.text, store.records, cfg);
  const hits = readHitStats(root, cfg, now, days);
  const audit = readAuditStats(root, cfg, now, days);
  const federation = readFederated(root, cfg, roots).map((r) => ({
    label: r.label,
    exists: r.exists,
    records: r.records.length,
    problems: r.problems,
  }));

  const checks = [];
  checks.push({ name: 'budget', ok: tier.ok, detail: `${tier.lines}/${tier.maxLines} 行，${tier.bytes}/${tier.maxBytes} 字节` });
  checks.push({ name: 'injected', ok: injectedCheck.state === 'ok', detail: injectedCheck.state });
  checks.push({ name: 'conflicts', ok: conflicts.length === 0, detail: `${conflicts.length} 组` });
  checks.push({ name: 'store', ok: store.problems.length === 0, detail: store.problems.length ? `${store.problems.length} 处损坏` : 'ok' });
  const ok = checks.every((c) => c.ok);

  const data = {
    ok,
    generatedAt: iso(now),
    days,
    checks,
    counts,
    total: store.records.length,
    conflicts,
    tier,
    injected: { rel: injected.rel, state: injectedCheck.state, exists: injected.exists },
    hits,
    audit,
    federation,
    records: [...store.records]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ({
        id: r.id,
        state: r.state,
        key: r.key,
        text: r.text,
        hits: r.hits,
        lastHitAt: r.lastHitAt,
        createdAt: r.createdAt,
        source: r.source,
        refs: r.refs,
        supersededBy: r.supersededBy,
      })),
  };

  if (out && !dryRun) {
    writeTextAtomic(path.isAbsolute(out) ? out : path.join(root, out), `${renderReportMarkdown(data)}\n`);
    data.out = out;
  }
  return data;
}

export function renderReportMarkdown(data) {
  const date = data.generatedAt.slice(0, 10);
  const lines = [
    `# 记忆生命周期审计（${date}）`,
    '',
    `> 生成：\`flow-kit run memory-lifecycle.mjs report\`；范围：近 ${data.days} 天。`,
    '',
    `- 记录 ${data.total}：` + STATES.map((s) => `${s} ${data.counts[s] || 0}`).join(' / '),
    `- 注入层：${data.injected.state === 'ok' ? '一致' : data.injected.state}（${data.injected.rel}；${data.tier.lines}/${data.tier.maxLines} 行，${data.tier.bytes}/${data.tier.maxBytes} 字节）`,
    `- 未消解冲突：${data.conflicts.length} 组（同 key 多文本；跑 \`conflict\` 消解）`,
    `- 查询命中：queries ${data.hits.queries} / 有结果 ${data.hits.withResults}${data.hits.hitRate == null ? '' : ` / 命中率 ${(data.hits.hitRate * 100).toFixed(0)}%`} / 唯一命中 ${data.hits.uniqueRecords}`,
    `- 审计事件：` + (Object.keys(data.audit.counts).length ? Object.entries(data.audit.counts).map(([k, v]) => `${k} ${v}`).join(' / ') : '无'),
    '',
    '## 记录（来源可追溯）',
    '',
    '| id | state | key | hits | lastHitAt | 来源 |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of data.records) {
    const ref = r.source.ref ? `${r.source.kind}:${r.source.ref}` : r.source.kind;
    lines.push(`| ${r.id} | ${r.state} | ${r.key.replace(/\|/g, '\\|')} | ${r.hits} | ${r.lastHitAt || '—'} | ${String(ref).replace(/\|/g, '\\|')} |`);
  }
  if (!data.records.length) lines.push('| — | — | — | — | — | — |');
  lines.push('', '## 跨仓联邦', '');
  if (!data.federation.length) lines.push('_未配置联邦仓库（`memory-lifecycle.json` 的 `federation.roots` 或 `--roots`）。_');
  else {
    lines.push('| 仓库 | 记录 | 状态 |', '|---|---|---|');
    for (const f of data.federation) {
      lines.push(`| ${f.label.replace(/\|/g, '\\|')} | ${f.records} | ${f.exists ? (f.problems.length ? `${f.problems.length} 处损坏` : 'ok') : 'missing'} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

function rootsArg(argv) {
  const v = argOf(argv, 'roots', null);
  if (v == null || v === true) return null;
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

// 位置参数与选项混排解析（query 需要把关键词原样拼回，不能被值参数污染）。
function parsePosOptions(args, flags = []) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (flags.includes(name) || name === 'json') {
      opts[name] = true;
      continue;
    }
    const v = args[i + 1];
    if (v == null || v.startsWith('--')) {
      opts[name] = true;
      continue;
    }
    opts[name] = v;
    i += 1;
  }
  return { positional, opts };
}

function printList(records, json) {
  if (json) {
    console.log(JSON.stringify({ records }, null, 2));
    return;
  }
  if (!records.length) {
    console.log('（记忆库为空）');
    return;
  }
  for (const r of records) {
    console.log(`${r.id}  ${r.state.padEnd(9)}  hits=${r.hits}  ${r.key}`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list';
  const root = path.resolve(String(argOf(argv, 'root', process.cwd())));
  const cfg = loadConfig(root);
  const tierCfg = loadTierConfig(root);
  const dryRun = argv.includes('--dry-run');
  const json = argv.includes('--json');
  const nowArg = argOf(argv, 'now', null);
  const now = nowArg && nowArg !== true ? new Date(String(nowArg)) : new Date();

  try {
    if (cmd === 'list') {
      const store = readStore(root, cfg);
      if (store.problems.length) {
        console.error(`✗ 记忆库数据损坏：\n  ${store.problems.join('\n  ')}`);
        return 1;
      }
      const state = argOf(argv, 'state', null);
      const records = state ? store.records.filter((r) => r.state === state) : store.records;
      printList(records, json);
      return 0;
    }

    if (cmd === 'add') {
      const store = readStore(root, cfg);
      requireCleanStore(store);
      const text = String(argOf(argv, 'text', '') || '');
      const tags = String(argOf(argv, 'tags', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
      const { record, created } = addRecord(store.records, {
        key: argOf(argv, 'key', '') || text,
        text,
        source: { kind: String(argOf(argv, 'kind', 'manual') || 'manual'), ref: String(argOf(argv, 'ref', '') || '') },
        tags,
      }, { now, cfg });
      if (!dryRun) {
        writeStore(root, cfg, store.records);
        if (created) auditEvent(root, cfg, { action: 'add', id: record.id, source: record.source, origin: 'manual' }, now);
      }
      if (json) console.log(JSON.stringify({ created, record }, null, 2));
      else console.log(`${created ? '已新增' : '已存在'} ${record.id}  ${record.state}  ${record.key}`);
      return 0;
    }

    if (cmd === 'decay') {
      const store = readStore(root, cfg);
      requireCleanStore(store);
      const transitions = applyDecay(store.records, { now, cfg });
      if (!dryRun) {
        if (transitions.length) writeStore(root, cfg, store.records);
        for (const t of transitions) auditEvent(root, cfg, { action: 'decay', ...t }, now);
      }
      if (json) console.log(JSON.stringify({ transitions, dryRun }, null, 2));
      else if (!transitions.length) console.log('无状态迁移');
      else for (const t of transitions) console.log(`${t.id}  ${t.from} → ${t.to}（idle ${t.idleDays} 天）`);
      return 0;
    }

    if (cmd === 'conflict') {
      const store = readStore(root, cfg);
      requireCleanStore(store);
      const resolved = resolveConflicts(store.records, { now, cfg });
      if (!dryRun) {
        if (resolved.length) writeStore(root, cfg, store.records);
        for (const row of resolved) auditEvent(root, cfg, { action: 'conflict', ...row }, now);
      }
      if (json) console.log(JSON.stringify({ resolved, dryRun }, null, 2));
      else if (!resolved.length) console.log('无冲突');
      else for (const row of resolved) console.log(`${row.key}：${row.winner} 胜出，${row.loser} superseded`);
      return 0;
    }

    if (cmd === 'promote') {
      const res = promote(root, {
        now,
        cfg,
        tierCfg,
        fromSuggest: argv.includes('--from-suggest'),
        dryRun,
        minUses: argOf(argv, 'min-uses', null),
      });
      if (!res.ok) {
        console.error(`✗ 注入层超预算（${res.budget.lines}/${res.budget.maxLines} 行，${res.budget.bytes}/${res.budget.maxBytes} 字节），未写入。先 decay 或手工下沉细节。`);
        if (json) console.log(JSON.stringify(res, null, 2));
        return 1;
      }
      if (json) console.log(JSON.stringify(res, null, 2));
      else {
        console.log(`新增候选 ${res.added.length}，上浮 ${res.promoted.length}${res.dryRun ? '（dry-run）' : ''}`);
        if (res.changedInjected) console.log(`注入层标记块${res.dryRun ? '将更新' : '已更新'}：${res.injected}`);
        else console.log('注入层无需变更');
        console.log(`预算 ${res.budget.lines}/${res.budget.maxLines} 行，${res.budget.bytes}/${res.budget.maxBytes} 字节`);
      }
      return 0;
    }

    if (cmd === 'cycle') {
      const store = readStore(root, cfg);
      requireCleanStore(store);
      const transitions = applyDecay(store.records, { now, cfg });
      const resolved = resolveConflicts(store.records, { now, cfg });
      if (!dryRun) {
        if (transitions.length || resolved.length) writeStore(root, cfg, store.records);
        for (const t of transitions) auditEvent(root, cfg, { action: 'decay', ...t }, now);
        for (const row of resolved) auditEvent(root, cfg, { action: 'conflict', ...row }, now);
      }
      const res = promote(root, { now, cfg, tierCfg, dryRun });
      if (!res.ok) {
        console.error(`✗ 注入层超预算，cycles 的 decay/conflict${dryRun ? '（dry-run 未写）' : ' 已写入'}；promote 未写。`);
        return 1;
      }
      if (json) console.log(JSON.stringify({ transitions, resolved, promote: res, dryRun }, null, 2));
      else console.log(`decay ${transitions.length}，conflict ${resolved.length}，promote ${res.promoted.length}${dryRun ? '（dry-run）' : ''}`);
      return 0;
    }

    if (cmd === 'query') {
      const { positional, opts } = parsePosOptions(argv.slice(1), ['local', 'no-log', 'json']);
      const q = positional.join(' ');
      const res = queryMemory(root, q, {
        now,
        cfg,
        limit: opts.limit && opts.limit !== true ? Number(opts.limit) : null,
        localOnly: Boolean(opts.local),
        roots: opts.roots && opts.roots !== true ? String(opts.roots).split(',').map((s) => s.trim()).filter(Boolean) : null,
        log: !opts['no-log'],
      });
      if (json || opts.json) console.log(JSON.stringify(res, null, 2));
      else if (!res.results.length) console.log('未命中');
      else {
        for (const r of res.results) {
          const origin = r.origin === 'local' ? '' : `${r.origin} · `;
          console.log(`${r.score}  [${r.kind}] ${origin}${r.ref}`);
          console.log(`     ${r.text.replace(/\s+/g, ' ').slice(0, 160)}`);
        }
      }
      return 0;
    }

    if (cmd === 'report') {
      const daysArg = argOf(argv, 'days', null);
      const outArg = argOf(argv, 'out', null);
      const data = report(root, {
        now,
        cfg,
        tierCfg,
        days: daysArg && daysArg !== true ? Number(daysArg) : 30,
        roots: rootsArg(argv),
        out: outArg && outArg !== true ? String(outArg) : null,
        dryRun,
      });
      if (json) console.log(JSON.stringify(data, null, 2));
      else console.log(renderReportMarkdown(data));
      if (data.out) console.error(`报告已写入 ${data.out}`);
      if (argv.includes('--check') && !data.ok) return 1;
      return 0;
    }

    console.error('用法: memory-lifecycle.mjs list|add|decay|conflict|promote|cycle|query|report [选项]');
    return 2;
  } catch (e) {
    console.error(`✗ ${e.message}`);
    return e.code === 'MEMORY_DATA' ? 1 : 2;
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('memory-lifecycle.mjs');
if (isMain) process.exit(main());
