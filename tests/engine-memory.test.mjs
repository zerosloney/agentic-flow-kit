import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appendEvent, readEvents, digestEvents } from '../templates/engine/.agents/scripts/session-log.mjs';
import { buildMemoryWiki, syncMemoryWiki } from '../templates/engine/.agents/scripts/memory-wiki.mjs';
import { auditBudget, suggestPromotions } from '../templates/engine/.agents/scripts/memory-tier.mjs';
import { startFixTask, readFixTask, stopFixTask } from '../templates/engine/.agents/scripts/fix-task.mjs';
import { acquire, release, check, sweep } from '../templates/engine/.agents/scripts/path-lease.mjs';
import { analyze } from '../templates/engine/.agents/scripts/check-pipeline-state.mjs';
import { tierFor, resolveSteering } from '../templates/engine/.agents/scripts/steering.mjs';
import { addClaim } from '../templates/engine/.agents/scripts/claims.mjs';

function tmp() {
  return makeTmp('engine-mem-');
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

test('session-log appends, filters by days, and digests', () => {
  const root = tmp();
  appendEvent(root, { type: 'failure', text: 'cache was not the bottleneck', tag: 'perf', now: new Date() });
  appendEvent(root, { type: 'correction', text: 'reproduce failing test first', tag: 'verify', now: new Date() });
  const rows = readEvents(root, { days: 7 });
  assert.equal(rows.length, 2);
  const md = digestEvents(rows, { days: 7 });
  assert.match(md, /failure=1/);
  assert.match(md, /cache was not the bottleneck/);
  assert.match(digestEvents([], { days: 7 }), /无会话日志输入/);
});

test('memory-wiki is idempotent and reports drift', () => {
  const root = tmp();
  write(root, 'docs/rule.md', 'authority line stays\n');
  addClaim({ root, claim: 'future sessions may trust this line', path: 'docs/rule.md', quote: 'authority line stays' });
  appendEvent(root, { type: 'failure', text: 'assumed cache was the bottleneck', tag: 'perf' });
  write(root, 'workflow/incidents/outage-1.md', '# Outage 1\n\nroot cause\n');

  const built = buildMemoryWiki(root);
  assert.ok(built.files.has('wiki/_memory/INDEX.md'));
  assert.ok([...built.files.keys()].some((k) => k.includes('claims-')));
  assert.ok([...built.files.keys()].some((k) => k.includes('lessons')));

  let res = syncMemoryWiki(root, { check: true });
  assert.ok(res.changed.length > 0, 'first check sees drift (not generated yet)');
  res = syncMemoryWiki(root, {});
  assert.ok(res.changed.length > 0);
  res = syncMemoryWiki(root, { check: true });
  assert.deepEqual(res.changed, [], 'second check is clean');

  appendEvent(root, { type: 'correction', text: 'new lesson', tag: 'verify' });
  res = syncMemoryWiki(root, { check: true });
  assert.ok(res.changed.includes('wiki/_memory/lessons.md'));
});

test('memory-tier budget and promotion candidates', () => {
  const root = tmp();
  write(root, '.agents/config/memory-tiers.json', JSON.stringify({
    version: 1,
    injected: { file: '.agents/notes/injected-memory.md', maxLines: 3, maxBytes: 200 },
    promotion: { candidates: '.agents/cache/memory-promotions.jsonl', minOccurrences: 2, outputDir: 'tmp' },
  }));
  write(root, '.agents/notes/injected-memory.md', 'a\nb\nc\nd\n');
  let res = auditBudget(root);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'over-lines');

  write(root, '.agents/notes/injected-memory.md', 'a\nb\n');
  res = auditBudget(root);
  assert.equal(res.ok, true);

  appendEvent(root, { type: 'failure', text: 'same mistake', tag: 'gate' });
  appendEvent(root, { type: 'failure', text: 'same mistake again', tag: 'gate' });
  const cands = suggestPromotions(root, { days: 90, min: 2 });
  assert.equal(cands.length, 1);
  assert.equal(cands[0].key, 'gate');
});

test('path lease: exclusive, takeover after ttl, release owner check', () => {
  const root = tmp();
  const t0 = new Date('2026-01-01T00:00:00Z');
  const a = acquire(root, { rel: 'wiki/a.md', owner: 'arm-a', ttlMinutes: 1, now: t0 });
  assert.equal(a.ok, true);
  const b = acquire(root, { rel: 'wiki/a.md', owner: 'arm-b', ttlMinutes: 1, now: t0 });
  assert.equal(b.ok, false);
  assert.equal(check(root, { rel: 'wiki/a.md', owner: 'arm-b', now: t0.getTime() }).ok, false);

  const later = new Date(t0.getTime() + 2 * 60000);
  const c = acquire(root, { rel: 'wiki/a.md', owner: 'arm-b', ttlMinutes: 1, now: later });
  assert.equal(c.ok, true);
  assert.equal(c.takeover.owner, 'arm-a');

  assert.equal(release(root, { rel: 'wiki/a.md', owner: 'arm-a' }).ok, false);
  assert.equal(release(root, { rel: 'wiki/a.md', owner: 'arm-b' }).ok, true);
  assert.equal(check(root, { rel: 'wiki/a.md', owner: 'x' }).ok, true);

  acquire(root, { rel: 'wiki/b.md', owner: 'x', ttlMinutes: 1, now: t0 });
  assert.deepEqual(sweep(root, { now: later.getTime() }), ['wiki/b.md']);
});

test('pipeline state closure catches unregistered stages', () => {
  const config = { stages: ['triage', 'done'], stopTypes: ['work-order', 'done'] };
  const src = `
    run.stage = 'triage';
    run.stage = 'done';
    run.stopType = 'work-order';
    run.stopType = 'done';
    const s = run.stage;
    if (s === 'triage') {}
    if (s === 'done') {}
  `;
  assert.equal(analyze(src, config).ok, true);
  const bad = src.replace("run.stage = 'done';", "run.stage = 'mystery';");
  const res = analyze(bad, config);
  assert.equal(res.ok, false);
  assert.ok(res.problems.some((p) => p.includes('mystery')));
});

test('steering resolves model tiers without changing invariants', () => {
  assert.equal(tierFor('claude-opus-5'), 'frontier');
  assert.equal(tierFor('claude-haiku-5'), 'lean');
  assert.equal(tierFor('some-unknown-model'), 'standard');
  const root = tmp();
  write(root, '.agents/config/steering.json', JSON.stringify({
    defaultTier: 'standard',
    tiers: { frontier: { scaffolding: 'goal', judgmentLatitude: 'high', guidance: 'g' } },
    invariants: ['确认门'],
  }));
  const res = resolveSteering(root, 'opus');
  assert.equal(res.tier, 'frontier');
  assert.equal(res.scaffolding, 'goal');
  assert.deepEqual(res.invariants, ['确认门']);
});

test('fix-task marker lifecycle', () => {
  const root = tmp();
  assert.equal(readFixTask(root), null);
  startFixTask(root, { id: 'f1', allowedTests: ['tests/a.test.mjs'] });
  assert.equal(readFixTask(root).id, 'f1');
  stopFixTask(root);
  assert.equal(readFixTask(root), null);
});
