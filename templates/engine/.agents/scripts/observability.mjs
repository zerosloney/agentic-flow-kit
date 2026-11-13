#!/usr/bin/env node
// observability.mjs — 成本 / 延迟 / 模型质量时间线（R3-7）
//
// 定位：outcome-metrics 看“交付有没有变好”，gen-workflow-metrics 看“机制成本与月度漏斗”；
// 本脚本补第三个视角：**按 run / 角色 / 模型**的成本与延迟，以及可对比两个版本的模型质量时间线。
//
// 数据源（全部只读，缺源单列，不造数）：
//   - .agents/cache/pipeline-runs/*.json       run 事件流（阶段耗时、停止类型）
//   - .agents/verifications.jsonl              verify 凭证（通过率、逐门耗时）
//   - .agents/evals/eval-log.json             评测证据（模型 / 签名 / 通过率时间线）
//   - .agents/usage.jsonl                     角色 / 模型调用凭据（usage-log.mjs 写入）
//   - workflow/reviews.d/artifacts/**/*.json  复核产物（verifier 票的模型与墙钟）
//   - .agents/config/observability.json       窗口 / 回归阈值 / 价格表 / 导出前缀
//
// 用法：
//   flow-kit run observability.mjs [--days 30] [--format md|json|prom|otel] [--out <file>]
//   flow-kit run observability.mjs --json --out observability.json
//   flow-kit run observability.mjs --baseline <old-report.json>      # 对比两个版本
//   flow-kit run observability.mjs --format prom --out metrics.prom  # Prometheus 文本
//   flow-kit run observability.mjs --format otel --out metrics.json  # OTLP JSON（无 SDK）
//
// 口径：
//   - 成本只在行内 costUsd 或 config.pricing 可换算时计入；否则记 unpricedCalls，不按 0 计费。
//   - 报告 JSON 去掉 generatedAt 后应与输入一一对应，可直接重算（--baseline 即依赖这一点）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  diffReports, evalTimeline, percentile, round1, summarizeRuns, summarizeUsage,
} from './metrics-core.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.FLOW_KIT_PROJECT_ROOT || path.resolve(SCRIPT_DIR, '..', '..');
const CONFIG_REL = '.agents/config/observability.json';
const COMPARE_PATHS = [
  'runs.total', 'runs.durationMs.p50', 'runs.durationMs.p90', 'runs.gates.failed',
  'verification.passRate', 'usage.total.calls', 'usage.total.tokens', 'usage.total.costUsd',
  'reviews.runs', 'reviews.confirmed',
];

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function readJsonl(file) {
  const rows = [];
  for (const line of readText(file).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* 跳过坏行：台账可追加，单行损坏不拖垮整份报告 */
    }
  }
  return rows;
}

function listJson(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function walkJson(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJson(abs, out);
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(abs);
  }
  return out;
}

function within(ts, since) {
  const t = Date.parse(String(ts || ''));
  return Number.isFinite(t) && t >= since;
}

export function loadConfig(root) {
  const raw = readJson(path.join(root, CONFIG_REL), {}) || {};
  return {
    windowDays: Number(raw.windowDays) > 0 ? Number(raw.windowDays) : 30,
    passRateDrop: Number.isFinite(raw.regression?.passRateDrop) ? raw.regression.passRateDrop : 0.05,
    pricing: raw.pricing && typeof raw.pricing === 'object' ? raw.pricing : {},
    prefix: String(raw.export?.prefix || 'agentic_flow_kit'),
    serviceName: String(raw.export?.serviceName || 'agentic-flow-kit'),
  };
}

export function loadEvidence(root, { days = 30, now = Date.now(), usageFile = null } = {}) {
  const since = now - days * 86400000;
  const missing = [];
  const config = loadConfig(root);

  const runFiles = listJson(path.join(root, '.agents', 'cache', 'pipeline-runs'));
  const runs = runFiles.map((file) => readJson(file)).filter(Boolean).filter((run) => within(run.createdAt, since));
  if (!runFiles.length) missing.push('.agents/cache/pipeline-runs');

  const verifications = readJsonl(path.join(root, '.agents', 'verifications.jsonl'))
    .filter((row) => within(row.ts, since));
  if (!verifications.length) missing.push('.agents/verifications.jsonl');

  const evalLogPath = path.join(root, '.agents', 'evals', 'eval-log.json');
  const evalLog = readJson(evalLogPath, null);
  let evalEntries = Array.isArray(evalLog?.entries) ? evalLog.entries : null;
  if (!evalEntries) {
    evalEntries = readJsonl(path.join(root, '.agents', 'evals', 'results.jsonl'));
    if (!evalEntries.length) missing.push('.agents/evals/eval-log.json');
  }

  const usagePath = usageFile ? path.resolve(root, usageFile) : path.join(root, '.agents', 'usage.jsonl');
  const usage = readJsonl(usagePath).filter((row) => within(row.ts, since));
  if (!usage.length) missing.push(path.relative(root, usagePath).replace(/\\/g, '/') || '.agents/usage.jsonl');

  const reviewFiles = walkJson(path.join(root, 'workflow', 'reviews.d', 'artifacts'));
  const reviews = reviewFiles.map((file) => readJson(file)).filter((a) => a?.run && within(a.run.createdAt, since));
  if (!reviewFiles.length) missing.push('workflow/reviews.d/artifacts');

  return { root, days, since, config, runs, verifications, evalEntries, usage, reviews, missing };
}

function summarizeVerification(rows) {
  const pass = rows.filter((row) => Number(row.exitCode) === 0).length;
  const gateMs = new Map();
  let gateCount = 0;
  for (const row of rows) {
    if (Number(row.exitCode) !== 0 || !row.durations) continue;
    gateCount += 1;
    for (const [id, ms] of Object.entries(row.durations)) {
      if (!Number.isFinite(ms)) continue;
      if (!gateMs.has(id)) gateMs.set(id, []);
      gateMs.get(id).push(ms);
    }
  }
  const gates = [...gateMs.entries()]
    .map(([id, values]) => ({
      gate: id,
      runs: values.length,
      medianMs: round1(percentile(values, 0.5)),
      p90Ms: round1(percentile(values, 0.9)),
    }))
    .sort((a, b) => (b.p90Ms || 0) - (a.p90Ms || 0))
    .slice(0, 10);
  return {
    runs: rows.length,
    pass,
    passRate: rows.length ? Math.round((pass / rows.length) * 1000) / 1000 : null,
    timedRuns: gateCount,
    gates,
  };
}

function summarizeReviews(artifacts) {
  const votesByModel = new Map();
  const latencies = [];
  let findings = 0;
  let confirmed = 0;
  for (const art of artifacts) {
    const start = Date.parse(art.run?.createdAt || '');
    const end = Date.parse(art.writtenAt || '');
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) latencies.push(end - start);
    for (const finding of art.findings || []) {
      findings += 1;
      if (finding.consensus === 'confirmed') confirmed += 1;
      for (const vote of finding.votes || []) {
        const model = String(vote.model || 'unknown');
        votesByModel.set(model, (votesByModel.get(model) || 0) + 1);
      }
    }
  }
  return {
    runs: artifacts.length,
    findings,
    confirmed,
    votes: [...votesByModel.values()].reduce((sum, n) => sum + n, 0),
    votesByModel: [...votesByModel.entries()]
      .map(([model, votes]) => ({ model, votes }))
      .sort((a, b) => b.votes - a.votes),
    latencyMs: { p50: round1(percentile(latencies, 0.5)), p90: round1(percentile(latencies, 0.9)) },
  };
}

export function buildReport(root, { days, now = Date.now(), usageFile = null, config = null } = {}) {
  const cfg = config || loadConfig(root);
  const windowDays = Number(days) > 0 ? Number(days) : cfg.windowDays;
  const evidence = loadEvidence(root, { days: windowDays, now, usageFile });
  evidence.config = cfg;
  const runs = summarizeRuns(evidence.runs, { since: evidence.since });
  const verification = summarizeVerification(evidence.verifications);
  const usage = summarizeUsage(evidence.usage, { since: evidence.since, pricing: cfg.pricing });
  const timeline = evalTimeline(evidence.evalEntries, {
    since: evidence.since, regressionDrop: cfg.passRateDrop,
  });
  const reviews = summarizeReviews(evidence.reviews);
  const cost = {
    currency: 'USD',
    totalUsd: usage.total.pricedCalls ? usage.total.costUsd : null,
    pricedCalls: usage.total.pricedCalls,
    unpricedCalls: usage.total.unpricedCalls,
    byModel: usage.byModel.map((m) => ({ model: m.key, costUsd: m.costUsd, calls: m.calls })),
    byRole: usage.byRole.map((r) => ({ role: r.key, costUsd: r.costUsd, calls: r.calls })),
  };
  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    window: { days: windowDays, since: new Date(evidence.since).toISOString() },
    config: { prefix: cfg.prefix, serviceName: cfg.serviceName, passRateDrop: cfg.passRateDrop },
    runs,
    verification,
    reviews,
    usage,
    cost,
    timeline,
    missing: evidence.missing,
  };
}

// ── 渲染 ─────────────────────────────────────────────────────────────

const fmt = (v, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(digits).replace(/\.0$/, ''));
const pct = (v) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
const usd = (v) => (v == null ? '—' : `$${Number(v).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`);

export function renderMarkdown(report, { baseline = null } = {}) {
  const lines = [
    `# 可观测与成本（近 ${report.window.days} 天）`,
    '',
    `> 生成时间 ${report.generatedAt}；来源为本机台账，缺源单列，不把缺失当 0。`,
    '',
    '## Run / 门禁',
    '',
    '| 指标 | 值 |',
    '|---|---|',
    `| pipeline run 数 | ${report.runs.total}（完成 ${report.runs.completed} / 中止 ${report.runs.aborted}） |`,
    `| run 时长 p50 / p90 | ${fmt(report.runs.durationMs.p50, 0)} ms / ${fmt(report.runs.durationMs.p90, 0)} ms |`,
    `| 门事件 | ${report.runs.gates.total}（失败 ${report.runs.gates.failed}） |`,
    `| verify 通过率 | ${pct(report.verification.passRate)}（${report.verification.pass}/${report.verification.runs}） |`,
    `| 复核 run / 确认发现 | ${report.reviews.runs} / ${report.reviews.confirmed}（投票 ${report.reviews.votes}，p90 ${fmt(report.reviews.latencyMs.p90, 0)} ms） |`,
    '',
  ];
  if (report.runs.byStage.length) {
    lines.push('| 阶段（pipeline） | 次数 | 失败 | p50 | p90 |', '|---|---|---|---|---|');
    for (const s of report.runs.byStage.slice(0, 8)) {
      lines.push(`| ${s.stage} | ${s.count} | ${s.failed} | ${fmt(s.medianMs, 0)} ms | ${fmt(s.p90Ms, 0)} ms |`);
    }
    lines.push('');
  }
  lines.push('## 角色 / 模型', '');
  const costCell = (b) => (b.pricedCalls ? usd(b.costUsd) : '—');
  lines.push('| 维度 | 调用 | token | 成本 | 延迟 p50 | p90 | 失败 |', '|---|---|---|---|---|---|---|');
  for (const r of report.usage.byRole) {
    lines.push(`| 角色 ${r.key} | ${r.calls} | ${r.tokens} | ${costCell(r)} | ${fmt(r.latencyMs.p50, 0)} ms | ${fmt(r.latencyMs.p90, 0)} ms | ${r.failures} |`);
  }
  for (const m of report.usage.byModel) {
    lines.push(`| 模型 ${m.key} | ${m.calls} | ${m.tokens} | ${costCell(m)} | ${fmt(m.latencyMs.p50, 0)} ms | ${fmt(m.latencyMs.p90, 0)} ms | ${m.failures} |`);
  }
  if (!report.usage.byRole.length && !report.usage.byModel.length) {
    lines.push('| — | 无 usage 台账 | — | — | — | — | — |');
  }
  lines.push('');
  if (report.usage.total.unpricedCalls > 0) {
    lines.push(`> 成本口径：${report.usage.total.unpricedCalls}/${report.usage.total.calls} 次调用缺 token 或价格，未按 0 计费；补 \`${CONFIG_REL}\` 的 pricing 或行内 costUsd。`, '');
  }
  lines.push('## 模型质量时间线', '');
  if (!report.timeline.models.length) {
    lines.push('- 无评测证据（`.agents/evals/eval-log.json`）。', '');
  } else {
    lines.push('| 模型 | 评测点 | 最新通过率 | 首→末 | 回归 |', '|---|---|---|---|---|');
    for (const m of report.timeline.models) {
      const flag = m.regressed ? '⚠ 是' : '否';
      lines.push(`| ${m.model} | ${m.points.length} | ${pct(m.latest?.passRate)} | ${pct(m.points[0]?.passRate)} → ${pct(m.latest?.passRate)}（Δ ${fmt((m.delta ?? 0) * 100, 1)} pt） | ${flag} |`);
    }
    lines.push('');
    if (report.timeline.regressions.length) {
      lines.push('回归明细：', '');
      for (const r of report.timeline.regressions) {
        lines.push(`- ${r.ts} ${r.model}：${pct(r.from)} → ${pct(r.to)}（${r.fromSignature.slice(0, 12)} → ${r.toSignature.slice(0, 12)}）`);
      }
      lines.push('');
    }
  }
  if (baseline) {
    const diff = diffReports(report, baseline, COMPARE_PATHS);
    lines.push('## 对比基线', '');
    lines.push(`> 基线生成时间 ${baseline.generatedAt || 'unknown'}`, '');
    if (!diff.length) {
      lines.push('- 无可比数值键（基线可能来自不同版本）。', '');
    } else {
      lines.push('| 指标 | 基线 | 当前 | Δ | Δ% |', '|---|---|---|---|---|');
      for (const d of diff) {
        lines.push(`| ${d.path} | ${fmt(d.before, 2)} | ${fmt(d.after, 2)} | ${d.delta > 0 ? '+' : ''}${fmt(d.delta, 2)} | ${d.pct == null ? '—' : `${d.pct > 0 ? '+' : ''}${fmt(d.pct, 1)}%`} |`);
      }
      lines.push('');
    }
    const timelineDiff = report.timeline.models
      .map((m) => {
        const before = (baseline.timeline?.models || []).find((b) => b.model === m.model);
        if (!before?.latest) return null;
        const delta = Math.round((m.latest.passRate - before.latest.passRate) * 1000) / 1000;
        return { model: m.model, before: before.latest.passRate, after: m.latest.passRate, delta, regressed: delta <= -report.config.passRateDrop };
      })
      .filter(Boolean);
    if (timelineDiff.length) {
      lines.push('| 模型 | 基线通过率 | 当前通过率 | Δ | 回归 |', '|---|---|---|---|---|');
      for (const d of timelineDiff) {
        lines.push(`| ${d.model} | ${pct(d.before)} | ${pct(d.after)} | ${d.delta > 0 ? '+' : ''}${fmt(d.delta * 100, 1)} pt | ${d.regressed ? '⚠ 是' : '否'} |`);
      }
      lines.push('');
    }
  }
  if (report.missing.length) {
    lines.push('## 数据缺口', '');
    for (const rel of report.missing) lines.push(`- 缺 \`${rel}\`：对应行仅反映已有证据，不据此下结论。`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function label(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function toPrometheus(report, { prefix = 'agentic_flow_kit' } = {}) {
  const p = String(prefix).replace(/[^a-zA-Z0-9_:]/g, '_');
  const lines = [];
  const metric = (name, type, help) => {
    lines.push(`# HELP ${p}_${name} ${help}`);
    lines.push(`# TYPE ${p}_${name} ${type}`);
  };
  metric('runs', 'gauge', 'pipeline runs in window');
  lines.push(`${p}_runs ${report.runs.total}`);
  metric('runs_total', 'gauge', 'pipeline runs by stop type');
  for (const [stop, count] of Object.entries(report.runs.byStopType)) {
    lines.push(`${p}_runs_total{stop="${label(stop)}"} ${count}`);
  }
  metric('run_duration_ms', 'gauge', 'pipeline run wall time quantiles');
  for (const q of ['p50', 'p90']) {
    if (report.runs.durationMs[q] != null) lines.push(`${p}_run_duration_ms{quantile="${q === 'p50' ? '0.5' : '0.9'}"} ${report.runs.durationMs[q]}`);
  }
  metric('gate_duration_ms', 'gauge', 'pipeline stage duration quantiles');
  for (const s of report.runs.byStage) {
    if (s.medianMs != null) lines.push(`${p}_gate_duration_ms{stage="${label(s.stage)}",quantile="0.5"} ${s.medianMs}`);
    if (s.p90Ms != null) lines.push(`${p}_gate_duration_ms{stage="${label(s.stage)}",quantile="0.9"} ${s.p90Ms}`);
  }
  metric('verify_pass_rate', 'gauge', 'verify pass rate in window');
  if (report.verification.passRate != null) lines.push(`${p}_verify_pass_rate ${report.verification.passRate}`);
  metric('review_votes_total', 'gauge', 'review verifier votes by model');
  for (const m of report.reviews.votesByModel) {
    lines.push(`${p}_review_votes_total{model="${label(m.model)}"} ${m.votes}`);
  }
  metric('model_calls_total', 'gauge', 'usage calls by model');
  for (const m of report.usage.byModel) {
    lines.push(`${p}_model_calls_total{model="${label(m.key)}"} ${m.calls}`);
    lines.push(`${p}_model_tokens_total{model="${label(m.key)}"} ${m.tokens}`);
    // 无价格/无 token 的模型不导 0 成本，避免把“未知”读成“免费”。
    if (m.pricedCalls) lines.push(`${p}_model_cost_usd_total{model="${label(m.key)}"} ${m.costUsd}`);
    if (m.latencyMs.p90 != null) lines.push(`${p}_model_latency_ms{model="${label(m.key)}",quantile="0.9"} ${m.latencyMs.p90}`);
  }
  metric('role_calls_total', 'gauge', 'usage calls by role');
  for (const r of report.usage.byRole) lines.push(`${p}_role_calls_total{role="${label(r.key)}"} ${r.calls}`);
  metric('model_eval_pass_rate', 'gauge', 'latest eval pass rate by model');
  for (const m of report.timeline.models) {
    if (m.latest?.passRate != null) lines.push(`${p}_model_eval_pass_rate{model="${label(m.model)}"} ${m.latest.passRate}`);
  }
  return `${lines.join('\n')}\n`;
}

function otelAttr(key, value) {
  return { key, value: { stringValue: String(value) } };
}

function otelGauge(name, unit, points, timeUnixNano) {
  return {
    name,
    unit,
    gauge: {
      dataPoints: points.map((pt) => ({
        asDouble: Number(pt.value),
        timeUnixNano,
        ...(pt.attrs?.length ? { attributes: pt.attrs.map(([k, v]) => otelAttr(k, v)) } : {}),
      })),
    },
  };
}

export function toOtelJson(report, { serviceName = 'agentic-flow-kit', timeUnixNano = null } = {}) {
  const nanos = timeUnixNano || String(BigInt(Date.parse(report.generatedAt)) * 1000000n);
  const metrics = [
    otelGauge('runs', '{run}', [{ value: report.runs.total }], nanos),
  ];
  if (report.runs.durationMs.p50 != null) {
    metrics.push(otelGauge('run.duration', 'ms', [
      { value: report.runs.durationMs.p50, attrs: [['quantile', 'p50']] },
      ...(report.runs.durationMs.p90 != null ? [{ value: report.runs.durationMs.p90, attrs: [['quantile', 'p90']] }] : []),
    ], nanos));
  }
  for (const s of report.runs.byStage) {
    if (s.medianMs == null) continue;
    metrics.push(otelGauge('stage.duration', 'ms', [
      { value: s.medianMs, attrs: [['stage', s.stage], ['quantile', 'p50']] },
      ...(s.p90Ms != null ? [{ value: s.p90Ms, attrs: [['stage', s.stage], ['quantile', 'p90']] }] : []),
    ], nanos));
  }
  if (report.verification.passRate != null) metrics.push(otelGauge('verify.pass_rate', '1', [{ value: report.verification.passRate }], nanos));
  if (report.usage.byModel.length) {
    metrics.push(otelGauge('model.calls', '{call}', report.usage.byModel.map((m) => ({ value: m.calls, attrs: [['model', m.key]] })), nanos));
    metrics.push(otelGauge('model.tokens', '{token}', report.usage.byModel.map((m) => ({ value: m.tokens, attrs: [['model', m.key]] })), nanos));
    const priced = report.usage.byModel.filter((m) => m.pricedCalls);
    if (priced.length) {
      metrics.push(otelGauge('model.cost', 'USD', priced.map((m) => ({ value: m.costUsd, attrs: [['model', m.key]] })), nanos));
    }
  }
  if (report.usage.byRole.length) {
    metrics.push(otelGauge('role.calls', '{call}', report.usage.byRole.map((r) => ({ value: r.calls, attrs: [['role', r.key]] })), nanos));
  }
  for (const m of report.timeline.models) {
    if (m.latest?.passRate == null) continue;
    metrics.push(otelGauge('model.eval.pass_rate', '1', [{ value: m.latest.passRate, attrs: [['model', m.model]] }], nanos));
  }
  return {
    resourceMetrics: [{
      resource: {
        attributes: [
          otelAttr('service.name', serviceName),
          otelAttr('service.version', '1'),
        ],
      },
      scopeMetrics: [{
        scope: { name: 'agentic-flow-kit/observability', version: '1' },
        metrics,
      }],
    }],
  };
}

// ── CLI ──────────────────────────────────────────────────────────────

function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

function textArg(argv, name, fallback) {
  const value = argOf(argv, name, null);
  return value == null || value === true ? fallback : value;
}

const FORMATS = new Set(['md', 'json', 'prom', 'otel']);

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('用法：flow-kit run observability.mjs [--days N] [--root <dir>] [--usage <file>] [--format md|json|prom|otel] [--out <file>] [--baseline <report.json>]');
    return 0;
  }
  const root = path.resolve(argOf(argv, 'root', process.env.FLOW_KIT_PROJECT_ROOT || process.cwd()));
  const format = String(argOf(argv, 'format', argv.includes('--json') ? 'json' : 'md'));
  if (!FORMATS.has(format)) {
    console.error(`observability: 未知格式 ${format}（md|json|prom|otel）`);
    return 2;
  }
  const daysRaw = argOf(argv, 'days', null);
  const daysArg = daysRaw == null || daysRaw === true ? 0 : Number(daysRaw);
  if (daysArg < 0 || !Number.isFinite(daysArg)) {
    console.error(`observability: --days 必须是非负整数：${daysRaw}`);
    return 2;
  }
  const usageFile = argOf(argv, 'usage', null);
  const baselineArg = argOf(argv, 'baseline', null);
  const report = buildReport(root, { days: daysArg > 0 ? daysArg : undefined, usageFile: usageFile === true ? null : usageFile });
  let payload;
  if (format === 'json') payload = JSON.stringify(report, null, 2);
  else if (format === 'prom') payload = toPrometheus(report, { prefix: textArg(argv, 'prefix', report.config.prefix) });
  else if (format === 'otel') payload = JSON.stringify(toOtelJson(report, { serviceName: textArg(argv, 'service-name', report.config.serviceName) }), null, 2);
  else {
    let baseline = null;
    if (baselineArg && baselineArg !== true) {
      baseline = readJson(path.resolve(root, baselineArg));
      if (!baseline || !baseline.version) {
        console.error(`observability: 基线不可读或不是本脚本的报告 JSON：${baselineArg}`);
        return 2;
      }
    }
    payload = renderMarkdown(report, { baseline });
  }
  const outArg = argOf(argv, 'out', null);
  if (outArg && outArg !== true) {
    const file = path.resolve(root, outArg);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, payload.endsWith('\n') ? payload : `${payload}\n`);
    console.log(file);
  } else {
    process.stdout.write(payload.endsWith('\n') ? payload : `${payload}\n`);
  }
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exit(main());
