import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  addRecord, applyDecay, composeInjected, conflictGroups, inspectInjected, loadConfig,
  promote, queryMemory, readStore, recordId, renderInjectedBlock, report, resolveConflicts, writeStore,
} from '../templates/engine/.agents/scripts/memory-lifecycle.mjs';
import { loadConfig as loadTierConfig } from '../templates/engine/.agents/scripts/memory-tier.mjs';

const INJECTED = [
  '# 注入层',
  '',
  '手写内容不受影响。',
  '',
  '<!-- memory:auto:begin -->',
  '<!-- 由 flow-kit run memory-lifecycle.mjs promote 维护；块外手写内容不受影响。 -->',
  '- _（暂无自动上浮记忆）_',
  '<!-- memory:auto:end -->',
  '',
].join('\n');

function tmp() {
  return makeTmp('memory-lifecycle-');
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function fixture({ maxLines = 200, maxBytes = 25600 } = {}) {
  const root = tmp();
  write(root, '.agents/config/memory-tiers.json', JSON.stringify({
    version: 1,
    injected: { file: '.agents/notes/injected-memory.md', maxLines, maxBytes },
    promotion: { candidates: '.agents/cache/memory-promotions.jsonl', minOccurrences: 3, outputDir: 'tmp' },
  }, null, 2));
  write(root, '.agents/notes/injected-memory.md', INJECTED);
  return root;
}

function at(iso) {
  return new Date(iso);
}

function seed(root, text, { key = text, kind = 'manual', ref = '', now = at('2026-01-01T00:00:00.000Z') } = {}) {
  const cfg = loadConfig(root);
  const store = readStore(root, cfg);
  const { record } = addRecord(store.records, { key, text, source: { kind, ref } }, { now, cfg });
  writeStore(root, cfg, store.records);
  return record;
}

test('add is idempotent and id is deterministic', () => {
  const root = fixture();
  const cfg = loadConfig(root);
  const records = [];
  const first = addRecord(records, { text: 'Cache was not the bottleneck', source: { kind: 'session-log', ref: 'a.jsonl' } }, { now: at('2026-01-01T00:00:00.000Z'), cfg });
  assert.equal(first.created, true);
  assert.equal(first.record.state, 'candidate');
  assert.equal(first.record.id, recordId('Cache was not the bottleneck', 'Cache was not the bottleneck'));
  const again = addRecord(records, { text: 'cache was not the bottleneck ', source: { kind: 'claim', ref: 'b.jsonl' } }, { now: at('2026-02-01T00:00:00.000Z'), cfg });
  assert.equal(again.created, false);
  assert.equal(again.record.id, first.record.id);
  assert.deepEqual(again.record.refs, ['a.jsonl', 'b.jsonl']);
});

test('decay transitions are deterministic for fixed now', () => {
  const cfg = loadConfig(fixture());
  const base = {
    key: 'k', text: 't', source: { kind: 'manual', ref: '' }, refs: [], tags: [],
    lastHitAt: null, supersededBy: null, supersedes: [], hits: 0,
  };
  const records = [
    { ...base, id: 'm-a', state: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { ...base, id: 'm-b', state: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastHitAt: '2026-05-30T00:00:00.000Z' },
    { ...base, id: 'm-c', state: 'candidate', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { ...base, id: 'm-d', state: 'dormant', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastHitAt: '2026-01-02T00:00:00.000Z' },
    { ...base, id: 'm-e', state: 'retired', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ];
  const transitions = applyDecay(records, { now: at('2026-06-01T00:00:00.000Z'), cfg });
  assert.deepEqual(transitions.map((t) => `${t.id}:${t.from}->${t.to}`), ['m-a:active->dormant']);
  assert.equal(records.find((r) => r.id === 'm-e').state, 'retired', 'retired is terminal');

  const later = applyDecay(records, { now: at('2026-09-01T00:00:00.000Z'), cfg });
  assert.deepEqual(later.map((t) => `${t.id}:${t.from}->${t.to}`).sort(), [
    'm-a:dormant->retired',
    'm-b:active->dormant',
    'm-c:candidate->retired',
    'm-d:dormant->retired',
  ]);
  assert.equal(records.find((r) => r.id === 'm-e').state, 'retired');
});

test('dormant memory reactivates when hit again within the dormant window', () => {
  const cfg = loadConfig(fixture());
  const records = [{
    id: 'm-x', key: 'k', text: 't', state: 'dormant', source: { kind: 'manual', ref: '' },
    refs: [], tags: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    lastHitAt: '2026-05-25T00:00:00.000Z', hits: 3, supersededBy: null, supersedes: [],
  }];
  const transitions = applyDecay(records, { now: at('2026-06-01T00:00:00.000Z'), cfg });
  assert.deepEqual(transitions, [{ id: 'm-x', from: 'dormant', to: 'active', idleDays: 7 }]);
  assert.equal(records[0].state, 'active');
});

test('conflict resolution is deterministic: source rank, then recency, then id', () => {
  const cfg = loadConfig(fixture());
  const rec = (id, text, kind, createdAt) => ({
    id, key: 'cache policy', text, state: 'candidate', source: { kind, ref: `${kind}.md` },
    refs: [], tags: [], createdAt, updatedAt: createdAt, lastHitAt: null, hits: 0, supersededBy: null, supersedes: [],
  });
  const records = [
    rec('m-1', '缓存可以无限增长', 'claim', '2026-01-01T00:00:00.000Z'),
    rec('m-2', '缓存必须有上限', 'incident', '2025-01-01T00:00:00.000Z'),
    rec('m-3', '缓存必须有上限', 'incident', '2025-01-01T00:00:00.000Z'),
  ];
  assert.equal(conflictGroups(records).length, 1);
  const resolved = resolveConflicts(records, { now: at('2026-06-01T00:00:00.000Z'), cfg });
  assert.equal(resolved.length, 2);
  // sourceRank = manual > incident > claim：incident 的两条（m-2/m-3）胜 claim（m-1）；
  // 同来源同时间按 id 小者胜（m-2 胜 m-3）。
  assert.equal(resolved[0].winner, 'm-2');
  assert.equal(resolved[0].loser, 'm-3');
  assert.equal(resolved[1].winner, 'm-2');
  assert.equal(resolved[1].loser, 'm-1');
  assert.equal(records.find((r) => r.id === 'm-1').state, 'superseded');
  assert.equal(records.find((r) => r.id === 'm-1').supersededBy, 'm-2');
  assert.deepEqual(records.find((r) => r.id === 'm-2').supersedes.sort(), ['m-1', 'm-3']);
});

test('promote respects the use threshold, only edits the managed block, and refuses over budget', () => {
  const now = at('2026-06-01T00:00:00.000Z');
  const root = fixture();
  const cfg = loadConfig(root);
  const tierCfg = loadTierConfig(root);
  seed(root, '先复现失败测试再修', { kind: 'session-log', ref: 'session-logs/2026-05-01.jsonl', now });

  const before = readStore(root, cfg).records[0];
  assert.equal(before.state, 'candidate');

  queryMemory(root, '复现失败', { now, cfg });
  queryMemory(root, '复现失败', { now, cfg });
  assert.equal(readStore(root, cfg).records[0].hits, 2);

  const res = promote(root, { now, cfg, tierCfg });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.promoted.length, 1);

  const text = fs.readFileSync(path.join(root, '.agents/notes/injected-memory.md'), 'utf8');
  assert.match(text, /先复现失败测试再修/);
  assert.match(text, /来源：session-logs\/2026-05-01\.jsonl/);
  assert.match(text, /手写内容不受影响/, 'content outside the managed block must be preserved');
  assert.equal(readStore(root, cfg).records[0].state, 'active');

  const again = promote(root, { now, cfg, tierCfg });
  assert.equal(again.changedInjected, false, 'promote is idempotent');

  const tight = fixture({ maxBytes: 20 });
  const tightCfg = loadConfig(tight);
  const tightTier = loadTierConfig(tight);
  seed(tight, '另一条会撑爆预算的记忆', { now });
  queryMemory(tight, '预算', { now, cfg: tightCfg });
  queryMemory(tight, '预算', { now, cfg: tightCfg });
  const denied = promote(tight, { now, cfg: tightCfg, tierCfg: tightTier });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'over-budget');
  assert.equal(readStore(tight, tightCfg).records[0].state, 'candidate', 'state must not change when the budget is exceeded');
});

test('query unifies store, claims, incidents and papercuts, and logs hits', () => {
  const root = fixture();
  const cfg = loadConfig(root);
  const now = at('2026-06-01T00:00:00.000Z');
  seed(root, '缓存不是瓶颈', { kind: 'session-log', ref: 'session-logs/2026-05-01.jsonl', now });
  write(root, 'workflow/claims.d/2026-05.jsonl', `${JSON.stringify({ id: 'c-1', claim: '缓存必须设上限', path: 'src/cache.js', quote: 'maxSize' })}\n`);
  write(root, 'workflow/incidents/2026-05-01-cache.md', '# 缓存事故复盘\n\n缓存雪崩导致超时。\n');
  write(root, 'workflow/papercuts.d/cache.md', '# 缓存纸割\n\n缓存键没有前缀。\n');

  const res = queryMemory(root, '缓存', { now, cfg });
  const kinds = new Set(res.results.map((r) => r.kind));
  assert.deepEqual([...kinds].sort(), ['claim', 'incident', 'memory', 'papercut']);
  assert.equal(res.logged, true);
  assert.equal(res.results[0].score >= res.results[res.results.length - 1].score, true);
  assert.equal(readStore(root, cfg).records[0].hits, 1);

  const hits = fs.readFileSync(path.join(root, '.agents/cache/memory-hits.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].query, '缓存');
  assert.ok(hits[0].results.every((r) => r.id && r.ref));

  queryMemory(root, '缓存', { now, cfg, log: false });
  assert.equal(readStore(root, cfg).records[0].hits, 1, '--no-log must not touch the store');
});

test('federation is read-only and provenance-labelled', () => {
  const root = fixture();
  const remote = fixture();
  const cfg = loadConfig(root);
  const now = at('2026-06-01T00:00:00.000Z');
  seed(remote, '跨仓共享的缓存约定', { kind: 'incident', ref: 'workflow/incidents/x.md', now });
  const remoteStore = path.join(remote, '.agents/memory/records.jsonl');
  const before = fs.readFileSync(remoteStore, 'utf8');

  const res = queryMemory(root, '缓存约定', { now, cfg, roots: [remote] });
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].origin, remote.replace(/\\/g, '/'));
  assert.equal(fs.readFileSync(remoteStore, 'utf8'), before, 'federated store must not be written');

  const localOnly = queryMemory(root, '缓存约定', { now, cfg, roots: [remote], localOnly: true, log: false });
  assert.equal(localOnly.results.length, 0);

  const data = report(root, { now, cfg, tierCfg: loadTierConfig(root), roots: [remote] });
  assert.equal(data.federation.length, 1);
  assert.equal(data.federation[0].records, 1);
});

test('report is traceable, detects stale injected blocks and writes the audit file', () => {
  const root = fixture();
  const cfg = loadConfig(root);
  const tierCfg = loadTierConfig(root);
  const now = at('2026-06-01T00:00:00.000Z');
  seed(root, '审计必须能追到来源', { kind: 'incident', ref: 'workflow/incidents/2026-05-01-audit.md', now });
  queryMemory(root, '审计', { now, cfg });
  queryMemory(root, '审计', { now, cfg });
  promote(root, { now, cfg, tierCfg });

  const data = report(root, { now, cfg, tierCfg, out: 'tmp/memory-audit.md' });
  assert.equal(data.ok, true, JSON.stringify(data.checks));
  assert.equal(data.injected.state, 'ok');
  assert.equal(data.counts.active, 1);
  assert.equal(data.records[0].source.ref, 'workflow/incidents/2026-05-01-audit.md');
  assert.equal(data.hits.queries, 2);
  assert.equal(data.hits.hitRate, 1);
  const md = fs.readFileSync(path.join(root, 'tmp/memory-audit.md'), 'utf8');
  assert.match(md, /workflow\/incidents\/2026-05-01-audit\.md/);
  assert.match(md, /注入层：一致/);

  const injected = path.join(root, '.agents/notes/injected-memory.md');
  fs.writeFileSync(injected, fs.readFileSync(injected, 'utf8').replace('审计必须能追到来源', '手改的内容'));
  const stale = report(root, { now, cfg, tierCfg });
  assert.equal(stale.ok, false);
  assert.equal(stale.injected.state, 'stale');
});

test('managed block composition is idempotent and preserves user text', () => {
  const cfg = loadConfig(fixture());
  const block = renderInjectedBlock([], cfg);
  const once = composeInjected('用户手写\n', block, cfg, false);
  assert.equal(once, '用户手写\n', 'no markers + no active records must not append');
  const withActive = composeInjected('用户手写\n', block, cfg, true);
  assert.match(withActive, /memory:auto:begin/);
  assert.equal(inspectInjected(withActive, [], cfg).state, 'ok');
  const replaced = composeInjected(withActive, `${block}\n<!-- 新 -->`, cfg, true);
  assert.equal((replaced.match(/memory:auto:begin/g) || []).length, 1, 'markers must not duplicate');
});
