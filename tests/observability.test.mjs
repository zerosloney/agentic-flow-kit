import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildReport, renderMarkdown, toOtelJson, toPrometheus,
} from '../templates/engine/.agents/scripts/observability.mjs';
import { diffReports, evalTimeline, percentile, stageLabel, summarizeRuns } from '../templates/engine/.agents/scripts/metrics-core.mjs';
import { appendUsage, buildUsageRow, readUsage } from '../templates/engine/.agents/scripts/usage-log.mjs';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function fixture() {
  const root = makeTmp('observability-');
  const write = (rel, text) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  };
  write('.agents/config/observability.json', JSON.stringify({
    version: 1,
    windowDays: 30,
    regression: { passRateDrop: 0.05 },
    export: { prefix: 'demo_kit', serviceName: 'demo-service' },
    pricing: { alpha: { inputPerMTok: 1, outputPerMTok: 2 } },
  }));
  write('.agents/cache/pipeline-runs/r1.json', JSON.stringify({
    runId: 'r1',
    createdAt: iso(3 * 3600000),
    updatedAt: iso(2 * 3600000),
    stopType: 'done',
    events: [
      { t: iso(3 * 3600000), type: 'run-created' },
      { t: iso(2.9 * 3600000), type: 'gate', cmd: 'flow-kit run check-loop.mjs --full', exit: 0, ms: 1000 },
      { t: iso(2.5 * 3600000), type: 'gate', cmd: 'git status --short', exit: 1, ms: 500 },
      { t: iso(2 * 3600000), type: 'stop', stopType: 'done' },
    ],
  }));
  write('.agents/cache/pipeline-runs/r2.json', JSON.stringify({
    runId: 'r2',
    createdAt: iso(6 * 3600000),
    updatedAt: iso(5 * 3600000),
    events: [
      { t: iso(6 * 3600000), type: 'run-created' },
      { t: iso(5 * 3600000), type: 'stop', stopType: 'aborted' },
    ],
  }));
  write('.agents/verifications.jsonl', [
    JSON.stringify({ ts: iso(3600000), exitCode: 0, suite: 'all-gates', durations: { a: 100, b: 400 }, totalMs: 500 }),
    JSON.stringify({ ts: iso(2 * 3600000), exitCode: 1, suite: 'all-gates' }),
  ].join('\n') + '\n');
  write('.agents/evals/eval-log.json', JSON.stringify({
    version: 1,
    updatedAt: iso(1000),
    entries: [
      { ts: iso(10 * 86400000), signature: 's1', passRate: 0.9, tasks: 5, model: 'alpha', note: '', threshold: 0.8, outcome: 'pass' },
      { ts: iso(2 * 86400000), signature: 's2', passRate: 0.7, tasks: 5, model: 'alpha', note: '', threshold: 0.8, outcome: 'fail' },
      { ts: iso(86400000), signature: 's3', passRate: 0.8, tasks: 5, model: 'beta', note: '', threshold: 0.8, outcome: 'pass' },
    ],
  }));
  write('.agents/usage.jsonl', [
    JSON.stringify({ ts: iso(3600000), role: 'implementer', model: 'alpha', inputTokens: 1000000, outputTokens: 500000, latencyMs: 4000, run: 'r1' }),
    JSON.stringify({ ts: iso(2 * 3600000), role: 'verifier', model: 'alpha', costUsd: 0.25, latencyMs: 8000, outcome: 'fail' }),
    JSON.stringify({ ts: iso(3 * 3600000), role: 'verifier', model: 'beta', inputTokens: 1000, outputTokens: 500, latencyMs: 2000, outcome: 'pass' }),
  ].join('\n') + '\n');
  write('workflow/reviews.d/artifacts/2026-11/run1.json', JSON.stringify({
    schema: 'pr-review/artifact@1',
    run: { runId: 'rev1', createdAt: iso(5 * 3600000) },
    writtenAt: iso(4 * 3600000),
    counts: {},
    findings: [
      { consensus: 'confirmed', votes: [{ model: 'alpha' }, { model: 'beta' }] },
      { consensus: 'rejected', votes: [{ model: 'alpha' }] },
    ],
  }));
  return root;
}

test('percentile and stage labels are stable', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([], 0.5), null);
  assert.equal(stageLabel('flow-kit run check-loop.mjs --full'), 'check-loop');
  assert.equal(stageLabel('git status --short'), 'git status');
});

test('builds a recomputable cost / latency / model timeline report', () => {
  const root = fixture();
  const a = buildReport(root, { now: NOW });
  const b = buildReport(root, { now: NOW });
  assert.deepEqual(a, b, 'same evidence must produce identical reports');

  assert.equal(a.runs.total, 2);
  assert.equal(a.runs.completed, 1);
  assert.equal(a.runs.aborted, 1);
  assert.equal(a.runs.gates.total, 2);
  assert.equal(a.runs.gates.failed, 1);
  assert.equal(a.runs.durationMs.p50, 3600000);
  assert.ok(a.runs.byStage.some((s) => s.stage === 'check-loop'));
  assert.equal(a.verification.passRate, 0.5);
  assert.equal(a.reviews.runs, 1);
  assert.equal(a.reviews.confirmed, 1);
  assert.equal(a.reviews.latencyMs.p50, 3600000);

  const alpha = a.usage.byModel.find((m) => m.key === 'alpha');
  assert.equal(alpha.calls, 2);
  assert.equal(alpha.tokens, 1500000);
  assert.equal(alpha.costUsd, 2.25, 'pricing-derived cost + row-level costUsd');
  assert.equal(alpha.unpricedCalls, 0);
  assert.equal(alpha.latencyMs.p50, 6000);
  const beta = a.usage.byModel.find((m) => m.key === 'beta');
  assert.equal(beta.unpricedCalls, 1);
  assert.equal(a.cost.totalUsd, 2.25);
  assert.ok(a.usage.byRole.some((r) => r.key === 'verifier' && r.calls === 2));

  assert.equal(a.timeline.models.length, 2);
  assert.equal(a.timeline.regressions.length, 1);
  assert.equal(a.timeline.regressions[0].model, 'alpha');
  assert.equal(a.timeline.regressions[0].from, 0.9);
  assert.equal(a.timeline.regressions[0].to, 0.7);

  const md = renderMarkdown(a);
  assert.match(md, /可观测与成本/);
  assert.match(md, /alpha/);
  assert.match(md, /回归明细/);
});

test('exports Prometheus text and OTLP JSON without dependencies', () => {
  const report = buildReport(fixture(), { now: NOW });
  const prom = toPrometheus(report, { prefix: 'demo_kit' });
  assert.match(prom, /^# TYPE demo_kit_runs gauge$/m);
  assert.match(prom, /^demo_kit_runs 2$/m);
  assert.match(prom, /demo_kit_model_cost_usd_total\{model="alpha"\} 2\.25/);
  assert.match(prom, /demo_kit_model_eval_pass_rate\{model="alpha"\} 0\.7/);
  const otel = toOtelJson(report, { serviceName: 'demo-service' });
  assert.equal(otel.resourceMetrics.length, 1);
  const metrics = otel.resourceMetrics[0].scopeMetrics[0].metrics;
  assert.ok(metrics.some((m) => m.name === 'runs' && m.gauge.dataPoints[0].asDouble === 2));
  assert.ok(metrics.some((m) => m.name === 'model.cost'));
});

test('baseline comparison surfaces deltas and regressions', () => {
  const root = fixture();
  const current = buildReport(root, { now: NOW });
  const baseline = JSON.parse(JSON.stringify(current));
  baseline.generatedAt = iso(30 * 86400000);
  baseline.runs.total = 5;
  baseline.usage.total.costUsd = 9;
  baseline.timeline.models.find((m) => m.model === 'alpha').latest.passRate = 0.9;
  const diff = diffReports(current, baseline, ['runs.total', 'usage.total.costUsd']);
  assert.equal(diff.length, 2);
  assert.equal(diff.find((d) => d.path === 'runs.total').delta, -3);
  const md = renderMarkdown(current, { baseline });
  assert.match(md, /对比基线/);
  assert.match(md, /模型 \| 基线通过率/);
  assert.match(md, /⚠ 是/);
});

test('usage-log appends validated rows and reads them back', () => {
  const root = makeTmp('usage-');
  const row = buildUsageRow({ role: 'verifier', model: 'alpha', inputTokens: 10, latencyMs: 5, outcome: 'pass', now: new Date(NOW) });
  appendUsage(root, row);
  const rows = readUsage(root, { now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'verifier');
  assert.throws(() => buildUsageRow({ role: '', model: 'alpha' }), /--role/);
  assert.throws(() => buildUsageRow({ role: 'code', model: 'alpha', latencyMs: -1 }), /latency-ms/);
  assert.throws(() => buildUsageRow({ role: 'code', model: 'alpha', outcome: 'maybe' }), /--outcome/);
});

test('run summarization ignores out-of-window runs and exposes failures', () => {
  const runs = [
    { createdAt: iso(3600000), updatedAt: iso(0), stopType: 'done', events: [{ t: iso(3600000), type: 'gate', cmd: 'flow-kit run a.mjs', exit: 0, ms: 10 }, { t: iso(0), type: 'stop', stopType: 'done' }] },
    { createdAt: iso(90 * 86400000), updatedAt: iso(89 * 86400000), events: [] },
  ];
  const out = summarizeRuns(runs, { since: NOW - 30 * 86400000 });
  assert.equal(out.total, 1);
  assert.equal(out.completed, 1);
  assert.equal(out.gates.failed, 0);
  assert.equal(evalTimeline([], {}).models.length, 0);
});
