import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { queryMcpAudit } from './mcp-gateway.mjs';

// 服务版本跟随包版本，避免发版后 OTel service.version 停留在旧值。
const KIT_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJsonl(file) {
  const rows = [];
  for (const line of readText(file).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // ignore malformed line
    }
  }
  return rows;
}

function within(ts, since) {
  const t = Date.parse(ts);
  return Number.isFinite(t) && t >= since;
}

function pct(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 1000) / 10;
}

function listFiles(dir, re) {
  try {
    return fs.readdirSync(dir).filter((n) => re.test(n)).sort();
  } catch {
    return [];
  }
}

function gitSubjects(root, since) {
  try {
    const git = spawnSync(
      'git',
      ['log', `--since=${new Date(since).toISOString()}`, '--pretty=%s'],
      { encoding: 'utf8', cwd: root },
    );
    if (git.status !== 0) return null;
    return git.stdout.split(/\r?\n/).filter(Boolean);
  } catch {
    return null;
  }
}

function reworkStats(subjects) {
  if (!subjects || !subjects.length) return { commits: 0, rework: 0, rate: 0 };
  const rework = subjects.filter((s) => /^(fix|revert)(\(|:|!)/i.test(s)).length;
  return { commits: subjects.length, rework, rate: pct(rework, subjects.length) || 0 };
}

export function computeAiDoraMetrics(root, options = {}) {
  const days = options.days ? Number(options.days) : 30;
  const now = options.now || Date.now();
  const since = now - days * 86400000;
  const missing = [];

  // 1. 验证台账与自愈耗时 (Verifications & MTTR)
  const verFile = path.join(root, '.agents', 'verifications.jsonl');
  const verRows = readJsonl(verFile);
  if (!verRows.length) missing.push('.agents/verifications.jsonl');

  const verRecent = verRows.filter((r) => within(r.ts, since));
  const totalVerifications = verRecent.length;
  const passedVerifications = verRecent.filter((r) => Number(r.exitCode) === 0).length;
  const failedVerifications = totalVerifications - passedVerifications;
  const passRate = pct(passedVerifications, totalVerifications);

  // 计算自愈平均耗时 MTTR (秒)：从 failed 行到随后的首个 passed 行的时间跨度
  const sortedVers = [...verRecent].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const recoveryTimes = [];
  for (let i = 0; i < sortedVers.length; i += 1) {
    if (Number(sortedVers[i].exitCode) !== 0) {
      const failTime = Date.parse(sortedVers[i].ts);
      for (let j = i + 1; j < sortedVers.length; j += 1) {
        if (Number(sortedVers[j].exitCode) === 0) {
          const passTime = Date.parse(sortedVers[j].ts);
          const diffSec = (passTime - failTime) / 1000;
          if (diffSec >= 0 && diffSec <= 86400) {
            recoveryTimes.push(diffSec);
            i = j; // 跳至恢复点
          }
          break;
        }
      }
    }
  }
  const mttrSeconds = recoveryTimes.length
    ? Math.round(recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length)
    : null;

  // 2. 事故与逃逸缺陷 (Incidents)
  const incidentDir = path.join(root, 'workflow', 'incidents');
  const incidents = listFiles(incidentDir, /\.md$/).map((n) => readText(path.join(incidentDir, n)));
  if (!fs.existsSync(incidentDir)) missing.push('workflow/incidents/');
  const openIncidents = incidents.filter((t) => !/closed|done|已关闭/i.test(t)).length;

  // 3. 变更失败率 (Change Failure Rate - CFR)
  const denominator = totalVerifications + openIncidents;
  const cfr = denominator > 0
    ? Math.round(((failedVerifications + openIncidents) / denominator) * 1000) / 10
    : 0;

  // 4. 交付与合流频次 (Deployment Frequency - DF)
  const subjects = gitSubjects(root, since);
  const commits = subjects ? subjects.length : 0;
  const deploymentsPerDay = Math.round((commits / Math.max(1, days)) * 10) / 10;
  const rework = subjects ? reworkStats(subjects) : null;

  // 5. 复核意见采纳率 (AI Acceptance Rate)
  const reviewDir = path.join(root, 'workflow', 'reviews.d');
  let adopted = 0;
  let rejected = 0;
  for (const name of listFiles(reviewDir, /\.md$/)) {
    const text = readText(path.join(reviewDir, name));
    for (const line of text.split(/\r?\n/)) {
      if (!/^\|/.test(line)) continue;
      if (/采纳/.test(line) && !/拒绝/.test(line)) adopted += 1;
      if (/拒绝/.test(line)) rejected += 1;
    }
  }
  if (!fs.existsSync(reviewDir)) missing.push('workflow/reviews.d/');
  const aiAcceptanceRate = pct(adopted, adopted + rejected);

  // 6. MCP 工具合规率 (Tool Compliance Rate)
  const auditRes = queryMcpAudit(root, { days });
  const toolComplianceRate = auditRes.summary.totalCalls > 0
    ? pct(auditRes.summary.allowedCalls, auditRes.summary.totalCalls)
    : 100;

  // 7. 综合评级 (DORA Performance Tier)
  let doraTier = 'Medium';
  if (cfr <= 15 && (passRate == null || passRate >= 80) && (mttrSeconds == null || mttrSeconds <= 3600)) {
    doraTier = 'Elite';
  } else if (cfr <= 30 && (passRate == null || passRate >= 65)) {
    doraTier = 'High';
  } else if (cfr > 50 || (passRate != null && passRate < 40)) {
    doraTier = 'Low';
  }

  return {
    windowDays: days,
    since: new Date(since).toISOString(),
    doraTier,
    dora: {
      changeFailureRate: cfr,
      mttrSeconds,
      deploymentsPerDay,
      leadTimeHours: null,
    },
    aiEngineering: {
      totalVerifications,
      passedVerifications,
      failedVerifications,
      passRate,
      aiAcceptanceRate,
      toolComplianceRate,
      reworkRate: rework ? rework.rate : null,
      totalCommits: commits,
      openIncidents,
      mcpAuditSummary: auditRes.summary,
    },
    missingSources: missing,
  };
}

export function exportOpenTelemetryMetrics(metrics, serviceVersion = KIT_VERSION) {
  const nowNano = `${Date.now()}000000`;
  const m = metrics;

  const dataPoints = [];

  const addGauge = (name, desc, unit, val) => {
    if (val != null && Number.isFinite(Number(val))) {
      dataPoints.push({
        name,
        description: desc,
        unit,
        gauge: {
          dataPoints: [
            {
              asDouble: Number(val),
              timeUnixNano: nowNano,
            },
          ],
        },
      });
    }
  };

  addGauge('ai_dora.change_failure_rate', 'Change failure rate percentage', '%', m.dora.changeFailureRate);
  addGauge('ai_dora.mttr_seconds', 'Mean time to recover in seconds', 's', m.dora.mttrSeconds);
  addGauge('ai_dora.deployments_per_day', 'Deployments and commits per day', '1/d', m.dora.deploymentsPerDay);
  addGauge('ai_dora.verification_pass_rate', 'Verification pass rate percentage', '%', m.aiEngineering.passRate);
  addGauge('ai_dora.ai_acceptance_rate', 'AI review and human touch acceptance rate', '%', m.aiEngineering.aiAcceptanceRate);
  addGauge('ai_dora.tool_compliance_rate', 'MCP tool security compliance rate', '%', m.aiEngineering.toolComplianceRate);
  addGauge('ai_dora.rework_rate', 'Rework commit rate percentage', '%', m.aiEngineering.reworkRate);

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'agentic-flow-kit' } },
            { key: 'service.version', value: { stringValue: serviceVersion } },
            { key: 'dora.tier', value: { stringValue: m.doraTier } },
            { key: 'dora.window_days', value: { intValue: m.windowDays } },
          ],
        },
        scopeMetrics: [
          {
            scope: {
              name: 'flow-kit.ai-dora',
              version: '1.0.0',
            },
            metrics: dataPoints,
          },
        ],
      },
    ],
  };
}

export function renderMetricsMarkdown(m) {
  const fmtPct = (v) => (v == null ? '—' : `${v}%`);
  const fmtSec = (v) => (v == null ? '—' : `${v}s`);

  const lines = [
    `# AI-DORA 研发效能度量大盘（过去 ${m.windowDays} 天）`,
    '',
    `> **综合效能评级**：**${m.doraTier}** | 评估窗口自：${m.since.slice(0, 10)}`,
    '',
    '## 1. 核心 DORA 工程四指标',
    '',
    '| DORA 维度 | 指标定义 | 当前值 | 评级基准 |',
    '|---|---|---|---|',
    `| 变更失败率 (CFR) | 验证中断与未关闭缺陷占比 | **${fmtPct(m.dora.changeFailureRate)}** | Elite ≤ 15% / High ≤ 30% |`,
    `| 自愈平均耗时 (MTTR) | 失败红灯到重新验证绿灯耗时 | **${fmtSec(m.dora.mttrSeconds)}** | Elite ≤ 3600s / High ≤ 14400s |`,
    `| 交付/合流频次 (DF) | 日均成功交付与合流提交 | **${m.dora.deploymentsPerDay} 次/日** | 按日持续交付 |`,
    '| 前置准备时间 (Lead Time) | 意图提出到验收归档平均周期 | — | 视任务复杂度 |',
    '',
    '## 2. AI 原生人机协同与质量深度指标',
    '',
    '| 指标项 | 统计口径 | 当前表现 |',
    '|---|---|---|',
    `| 验证首次通过率 | 机器流水线门禁一次全通率 | ${fmtPct(m.aiEngineering.passRate)} (${m.aiEngineering.passedVerifications}/${m.aiEngineering.totalVerifications}) |`,
    `| AI 建议采纳率 | 人件门/复核意见采纳比率 | ${fmtPct(m.aiEngineering.aiAcceptanceRate)} |`,
    `| MCP 工具安全合规率 | 网关放行 vs 越权/危险调用拦截 | ${fmtPct(m.aiEngineering.toolComplianceRate)} |`,
    `| 返工提交占比 | fix/revert 修复型提交占比 | ${fmtPct(m.aiEngineering.reworkRate)} |`,
    `| 活跃未关闭缺陷 | incidents/ 待关闭工单 | ${m.aiEngineering.openIncidents} 个 |`,
    '',
  ];

  if (m.missingSources.length) {
    lines.push('## 数据源缺口提示', '');
    for (const src of m.missingSources) {
      lines.push(`- 缺 \`${src}\`：该项指标回退或近似计算。`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function checkMetricsThresholds(metrics, thresholds = {}) {
  const violations = [];

  if (thresholds.maxCfr != null && metrics.dora.changeFailureRate > Number(thresholds.maxCfr)) {
    violations.push(`CFR (${metrics.dora.changeFailureRate}%) exceeds threshold (${thresholds.maxCfr}%)`);
  }

  if (thresholds.maxMttr != null && metrics.dora.mttrSeconds != null && metrics.dora.mttrSeconds > Number(thresholds.maxMttr)) {
    violations.push(`MTTR (${metrics.dora.mttrSeconds}s) exceeds threshold (${thresholds.maxMttr}s)`);
  }

  if (thresholds.minPassRate != null && metrics.aiEngineering.passRate != null && metrics.aiEngineering.passRate < Number(thresholds.minPassRate)) {
    violations.push(`Pass Rate (${metrics.aiEngineering.passRate}%) below required minimum (${thresholds.minPassRate}%)`);
  }

  if (thresholds.maxRework != null && metrics.aiEngineering.reworkRate != null && metrics.aiEngineering.reworkRate > Number(thresholds.maxRework)) {
    violations.push(`Rework rate (${metrics.aiEngineering.reworkRate}%) exceeds threshold (${thresholds.maxRework}%)`);
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
