import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collect, renderMarkdown } from '../templates/engine/.agents/scripts/outcome-metrics.mjs';

function tmp() {
  return makeTmp('outcome-');
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const now = new Date();
const iso = (d) => d.toISOString();

test('collects verification, eval, review and incident outcomes', () => {
  const root = tmp();
  write(root, '.agents/verifications.jsonl', [
    JSON.stringify({ ts: iso(now), exitCode: 0, suite: 'all-gates', gates: 20 }),
    JSON.stringify({ ts: iso(now), exitCode: 0, suite: 'all-gates', gates: 20 }),
    JSON.stringify({ ts: iso(now), exitCode: 1, suite: 'all-gates' }),
  ].join('\n') + '\n');
  write(root, '.agents/evals/results.jsonl', [
    JSON.stringify({ ts: iso(now), signature: 'a', passRate: 0.9 }),
    JSON.stringify({ ts: iso(now), signature: 'b', passRate: 0.6 }),
  ].join('\n') + '\n');
  write(root, 'workflow/incidents/outage.md', '---\n状态: open\n---\n# Outage\n');
  write(root, 'workflow/reviews.d/2026-11.md', '| 意见 | 结论 |\n|---|---|\n| x | 采纳 |\n| y | 拒绝 |\n');

  const m = collect(root, { days: 30 });
  assert.equal(m.verification.recent, 3);
  assert.equal(m.verification.pass, 2);
  assert.equal(m.verification.passRate, 66.7);
  assert.equal(m.evals.signatures, 2);
  assert.equal(m.evals.lastPassRate, 0.9);
  assert.equal(m.incidents.open, 1);
  assert.equal(m.review.adopted, 1);
  assert.equal(m.review.rejected, 1);
  assert.equal(m.review.adoptionRate, 50);

  const md = renderMarkdown(m);
  assert.match(md, /验证通过率/);
  assert.match(md, /66.7%/);
});

test('missing sources are reported, not silently zeroed', () => {
  const root = tmp();
  const m = collect(root, { days: 30 });
  assert.ok(m.missing.includes('.agents/verifications.jsonl'));
  assert.ok(m.missing.includes('workflow/incidents/'));
  const md = renderMarkdown(m);
  assert.match(md, /数据缺口/);
});
