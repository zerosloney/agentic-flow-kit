import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import {
  computeAiDoraMetrics,
  exportOpenTelemetryMetrics,
  renderMetricsMarkdown,
  checkMetricsThresholds,
} from '../src/install/metrics.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

test('computeAiDoraMetrics handles empty directory gracefully', () => {
  const tmp = makeTmp();
  const res = computeAiDoraMetrics(tmp, { days: 14 });

  assert.equal(res.windowDays, 14);
  assert.equal(typeof res.since, 'string');
  // 安全修复批 2026-11-23：空台账 CFR 为 null 不冒充 0，tier 不评 Elite 标记 Insufficient
  assert.equal(res.dora.changeFailureRate, null);
  assert.equal(res.doraTier, 'Insufficient');
  assert.equal(res.dora.mttrSeconds, null);
  assert.equal(res.aiEngineering.totalVerifications, 0);
  assert.equal(res.aiEngineering.passRate, null);
  assert.equal(res.aiEngineering.openIncidents, 0);
  assert.ok(res.missingSources.includes('.agents/verifications.jsonl'));
  assert.ok(res.missingSources.includes('workflow/incidents/'));
});

test('computeAiDoraMetrics calculates verifications, MTTR, incidents, and DORA tier correctly', () => {
  const tmp = makeTmp();
  const agentsDir = path.join(tmp, '.agents');
  fs.mkdirSync(agentsDir, { recursive: true });

  const now = Date.now();
  const t1 = new Date(now - 3600000).toISOString(); // 1 hour ago: fail
  const t2 = new Date(now - 1800000).toISOString(); // 30 min ago: pass (recovery = 1800s)
  const t3 = new Date(now - 600000).toISOString();  // 10 min ago: pass

  const verifications = [
    { ts: t1, command: 'npm test', exitCode: 1 },
    { ts: t2, command: 'npm test', exitCode: 0 },
    { ts: t3, command: 'npm test', exitCode: 0 },
  ];
  fs.writeFileSync(
    path.join(agentsDir, 'verifications.jsonl'),
    verifications.map((v) => JSON.stringify(v)).join('\n') + '\n',
    'utf8',
  );

  // 事故工单 (1 open, 1 closed)
  const incidentDir = path.join(tmp, 'workflow', 'incidents');
  fs.mkdirSync(incidentDir, { recursive: true });
  fs.writeFileSync(path.join(incidentDir, 'INC-001.md'), '# Incident 1\nStatus: Open\n', 'utf8');
  fs.writeFileSync(path.join(incidentDir, 'INC-002.md'), '# Incident 2\nStatus: Closed\n', 'utf8');

  // 复核采纳率 (2 采纳, 1 拒绝)
  const reviewDir = path.join(tmp, 'workflow', 'reviews.d');
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(
    path.join(reviewDir, 'rev-1.md'),
    '| 建议 | 状态 |\n|---|---|\n| 优化结构 | 采纳 |\n| 补充单测 | 采纳 |\n| 修改依赖 | 拒绝 |\n',
    'utf8',
  );

  const res = computeAiDoraMetrics(tmp, { days: 7, now });

  assert.equal(res.aiEngineering.totalVerifications, 3);
  assert.equal(res.aiEngineering.passedVerifications, 2);
  assert.equal(res.aiEngineering.failedVerifications, 1);
  assert.equal(res.aiEngineering.passRate, 66.7);
  assert.equal(res.dora.mttrSeconds, 1800); // 1800 seconds recovery time

  // CFR: (failedVerifications(1) + openIncidents(1)) / (totalVerifications(3) + openIncidents(1)) = 2 / 4 = 50%
  assert.equal(res.dora.changeFailureRate, 50);
  assert.equal(res.aiEngineering.openIncidents, 1);

  // AI acceptance rate: 2 / (2 + 1) = 66.7%
  assert.equal(res.aiEngineering.aiAcceptanceRate, 66.7);
  assert.equal(res.doraTier, 'Medium');
});

test('exportOpenTelemetryMetrics produces standard OTel ResourceMetrics format', () => {
  const mockMetrics = {
    windowDays: 30,
    since: '2026-11-01T00:00:00.000Z',
    doraTier: 'Elite',
    dora: {
      changeFailureRate: 8.5,
      mttrSeconds: 600,
      deploymentsPerDay: 4.2,
      leadTimeHours: null,
    },
    aiEngineering: {
      totalVerifications: 100,
      passedVerifications: 92,
      failedVerifications: 8,
      passRate: 92.0,
      aiAcceptanceRate: 85.0,
      toolComplianceRate: 99.5,
      reworkRate: 12.0,
      totalCommits: 45,
      openIncidents: 0,
      mcpAuditSummary: { totalCalls: 200, allowedCalls: 199, deniedCalls: 1 },
    },
    missingSources: [],
  };

  const otel = exportOpenTelemetryMetrics(mockMetrics, '2.11.0');
  assert.ok(Array.isArray(otel.resourceMetrics));
  assert.equal(otel.resourceMetrics.length, 1);

  // 默认 service.version 跟随 package.json，发版后不会停在旧值
  const kitVersion = JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8')).version;
  const defaultAttrs = Object.fromEntries(
    exportOpenTelemetryMetrics(mockMetrics).resourceMetrics[0].resource.attributes
      .map((a) => [a.key, a.value.stringValue || a.value.intValue]),
  );
  assert.equal(defaultAttrs['service.version'], kitVersion);

  const rm = otel.resourceMetrics[0];
  const attrs = Object.fromEntries(rm.resource.attributes.map((a) => [a.key, a.value.stringValue || a.value.intValue]));
  assert.equal(attrs['service.name'], 'agentic-flow-kit');
  assert.equal(attrs['service.version'], '2.11.0');
  assert.equal(attrs['dora.tier'], 'Elite');
  assert.equal(attrs['dora.window_days'], 30);

  const metrics = rm.scopeMetrics[0].metrics;
  const names = metrics.map((m) => m.name);
  assert.ok(names.includes('ai_dora.change_failure_rate'));
  assert.ok(names.includes('ai_dora.mttr_seconds'));
  assert.ok(names.includes('ai_dora.deployments_per_day'));
  assert.ok(names.includes('ai_dora.verification_pass_rate'));
  assert.ok(names.includes('ai_dora.ai_acceptance_rate'));
  assert.ok(names.includes('ai_dora.tool_compliance_rate'));
  assert.ok(names.includes('ai_dora.rework_rate'));

  const cfrMetric = metrics.find((m) => m.name === 'ai_dora.change_failure_rate');
  assert.equal(cfrMetric.gauge.dataPoints[0].asDouble, 8.5);
});

test('renderMetricsMarkdown generates readable dashboard table', () => {
  const mockMetrics = {
    windowDays: 30,
    since: '2026-11-01T00:00:00.000Z',
    doraTier: 'Elite',
    dora: {
      changeFailureRate: 10.0,
      mttrSeconds: 1200,
      deploymentsPerDay: 5.0,
      leadTimeHours: null,
    },
    aiEngineering: {
      totalVerifications: 20,
      passedVerifications: 18,
      failedVerifications: 2,
      passRate: 90.0,
      aiAcceptanceRate: 80.0,
      toolComplianceRate: 100.0,
      reworkRate: 5.0,
      totalCommits: 25,
      openIncidents: 0,
      mcpAuditSummary: { totalCalls: 50, allowedCalls: 50, deniedCalls: 0 },
    },
    missingSources: ['workflow/incidents/'],
  };

  const md = renderMetricsMarkdown(mockMetrics);
  assert.match(md, /AI-DORA 研发效能度量大盘/);
  assert.match(md, /Elite/);
  assert.match(md, /10%/);
  assert.match(md, /1200s/);
  assert.match(md, /数据源缺口提示/);
  assert.match(md, /workflow\/incidents\//);
});

test('checkMetricsThresholds evaluates thresholds and detects violations', () => {
  const mockMetrics = {
    doraTier: 'Medium',
    dora: {
      changeFailureRate: 25.0,
      mttrSeconds: 4000,
    },
    aiEngineering: {
      passRate: 75.0,
      reworkRate: 30.0,
    },
  };

  // Pass case
  const okRes = checkMetricsThresholds(mockMetrics, {
    maxCfr: 30,
    maxMttr: 5000,
    minPassRate: 70,
    maxRework: 35,
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.violations.length, 0);

  // Failure case
  const failRes = checkMetricsThresholds(mockMetrics, {
    maxCfr: 20,
    maxMttr: 3600,
    minPassRate: 80,
    maxRework: 25,
  });
  assert.equal(failRes.ok, false);
  assert.equal(failRes.violations.length, 4);
});

test('checkMetricsThresholds flags declared thresholds when metric data is missing', () => {
  // 安全修复批 2026-11-23：阈值已声明而指标为 null/缺失时计 violation，不再静默跳过
  const emptyMetrics = {
    doraTier: 'Insufficient',
    dora: { changeFailureRate: null, mttrSeconds: null },
    aiEngineering: { passRate: null, reworkRate: null },
  };

  const res = checkMetricsThresholds(emptyMetrics, {
    maxCfr: 15,
    maxMttr: 3600,
    minPassRate: 80,
    maxRework: 25,
  });
  assert.equal(res.ok, false);
  assert.equal(res.violations.length, 4);
  assert.ok(res.violations.every((v) => /data missing/.test(v)));

  // 未声明阈值的指标不因数据缺失报 violation
  const partial = checkMetricsThresholds(emptyMetrics, { maxCfr: 15 });
  assert.equal(partial.ok, false);
  assert.equal(partial.violations.length, 1);
  assert.match(partial.violations[0], /CFR data missing/);

  // 有真实数据时行为不变：阈值内判过
  const withData = checkMetricsThresholds({
    dora: { changeFailureRate: 10, mttrSeconds: 1200 },
    aiEngineering: { passRate: 90, reworkRate: 5 },
  }, { maxCfr: 15, maxMttr: 3600, minPassRate: 80, maxRework: 25 });
  assert.equal(withData.ok, true);
  assert.equal(withData.violations.length, 0);
});

test('CLI flow-kit metrics report, export, and check integration', () => {
  const tmp = makeTmp();
  const agentsDir = path.join(tmp, '.agents');
  fs.mkdirSync(agentsDir, { recursive: true });

  fs.writeFileSync(
    path.join(agentsDir, 'verifications.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), command: 'check', exitCode: 0 }) + '\n',
    'utf8',
  );

  // 1. report --json
  const rJson = run(['metrics', 'report', '--target', tmp, '--json'], KIT);
  assert.equal(rJson.status, 0);
  const parsedReport = JSON.parse(rJson.stdout);
  assert.equal(parsedReport.aiEngineering.passedVerifications, 1);
  assert.equal(parsedReport.aiEngineering.passRate, 100);

  // 2. report --markdown --out
  const rMd = run(['metrics', 'report', '--target', tmp, '--out', 'report.md'], KIT);
  assert.equal(rMd.status, 0);
  assert.ok(fs.existsSync(path.join(tmp, 'report.md')));
  const mdContent = fs.readFileSync(path.join(tmp, 'report.md'), 'utf8');
  assert.match(mdContent, /AI-DORA 研发效能度量大盘/);

  // 3. export --format otel --out
  const rOtel = run(['metrics', 'export', '--target', tmp, '--format', 'otel', '--out', 'metrics.json'], KIT);
  assert.equal(rOtel.status, 0);
  assert.ok(fs.existsSync(path.join(tmp, 'metrics.json')));
  const otelContent = JSON.parse(fs.readFileSync(path.join(tmp, 'metrics.json'), 'utf8'));
  assert.ok(otelContent.resourceMetrics);

  // 4. check --max-cfr 15 (pass)
  const rCheckPass = run(['metrics', 'check', '--target', tmp, '--max-cfr', '15', '--min-pass-rate', '90'], KIT);
  assert.equal(rCheckPass.status, 0);

  // 5. check --min-pass-rate 101 (fail)
  const rCheckFail = run(['metrics', 'check', '--target', tmp, '--min-pass-rate', '101', '--json'], KIT);
  assert.notEqual(rCheckFail.status, 0);
  const parsedCheckFail = JSON.parse(rCheckFail.stdout);
  assert.equal(parsedCheckFail.ok, false);
  assert.ok(parsedCheckFail.violations.length > 0);
});
