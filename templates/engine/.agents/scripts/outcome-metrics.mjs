#!/usr/bin/env node
// outcome-metrics.mjs — 交付结果指标（而不是机制成本）
//
// 背景（Anthropic《The AI-native SDLC playbook》）：每个 play 都应回答
// “是否真的变好”，指标分 leading / lagging。既有 mechanism-registry 记的是
// 门禁触发量与退役阈值（成本面），本脚本补结果面：
//
//   - 首次过门率 / 验证通过率（verifications.jsonl）
//   - 逃逸缺陷与复盘量（workflow/incidents）
//   - 复核意见采纳率（workflow/reviews.d）——事件级近似
//   - 行为评测通过率与陈旧面（.agents/evals/results.jsonl）
//   - 返工提交占比（git log，可选）
//   - 派发报告预算超限月（workflow/delegations.d 分片正文字数，advisory）——计量单源
//     = agg-delegations.reportBudgetStats（口径：月合计 vs 报告数×单报告预算，分片去空白字符，不造数）
//
// 输出：workflow/metrics/outcome.md；--json 输出机器可读。
// 诚实边界：只聚合已有台账；缺源在报告末尾单列，不造数、不把 0 当“很好”。
//
// 用法：
//   flow-kit run outcome-metrics.mjs [--days 30] [--json] [--out <path>]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { reportBudgetStats } from './agg-delegations.mjs';

export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

export function readJsonl(file) {
  const rows = [];
  for (const line of readText(file).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* ignore */
    }
  }
  return rows;
}

export function within(ts, since) {
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

export function frontmatterStatus(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return '';
  const s = m[1].match(/^\s*状态:\s*(\S+)/m);
  return s ? s[1] : '';
}

// gitSubjects(root, since)：时间窗内提交主题列表（outcome-metrics 与 owner-digest 的同一 git 访问方式，
// 禁第三份实现；非 git / 命令失败返回 null——调用方显式报「无 git」，不静默当 0）。
export function gitSubjects(root, since) {
  const git = spawnSync('git', ['log', `--since=${new Date(since).toISOString()}`, '--pretty=%s'], { encoding: 'utf8', cwd: root });
  if (git.status !== 0) return null;
  return git.stdout.split(/\r?\n/).filter(Boolean);
}

// reworkStats(subjects)：返工提交占比口径单源（fix/revert 前缀；collect 与 owner-digest 共用，禁复制第三份正则）。
export function reworkStats(subjects) {
  const rework = subjects.filter((s) => /^(fix|revert)(\(|:|!)/i.test(s)).length;
  return { commits: subjects.length, rework, rate: pct(rework, subjects.length) };
}

// incidentOpen(text)：事故未关闭口径单源（frontmatter 状态不属 closed/done/已关闭；collect 与 owner-digest 共用）。
export function incidentOpen(text) {
  return !/closed|done|已关闭/i.test(frontmatterStatus(text));
}

export function collect(root, { days = 30, now = Date.now()} = {}) {
  const since = now - days * 86400000;
  const missing = [];
  const out = { days, since: new Date(since).toISOString() };

  // 1) 验证通过率
  const verifications = readJsonl(path.join(root, '.agents', 'verifications.jsonl'));
  if (!verifications.length) missing.push('.agents/verifications.jsonl');
  const verRecent = verifications.filter((r) => within(r.ts, since));
  out.verification = {
    total: verifications.length,
    recent: verRecent.length,
    pass: verRecent.filter((r) => Number(r.exitCode) === 0).length,
    passRate: pct(verRecent.filter((r) => Number(r.exitCode) === 0).length, verRecent.length),
    gateAvg: (() => {
      const gs = verRecent.filter((r) => Number.isFinite(Number(r.gates))).map((r) => Number(r.gates));
      return gs.length ? Math.round((gs.reduce((a, b) => a + b, 0) / gs.length) * 10) / 10 : null;
    })(),
  };

  // 2) 事故 / 逃逸缺陷
  const incidentDir = path.join(root, 'workflow', 'incidents');
  const incidents = listFiles(incidentDir, /\.md$/).map((n) => readText(path.join(incidentDir, n)));
  if (!fs.existsSync(incidentDir)) missing.push('workflow/incidents/');
  const open = incidents.filter((t) => incidentOpen(t)).length;
  out.incidents = { total: incidents.length, open, closed: incidents.length - open };

  // 3) 复核意见采纳率（事件级近似：数 reviews.d 表格里的采纳/拒绝/误报单元格）
  const reviewDir = path.join(root, 'workflow', 'reviews.d');
  let adopted = 0; let rejected = 0; let misreport = 0;
  for (const name of listFiles(reviewDir, /\.md$/)) {
    const text = readText(path.join(reviewDir, name));
    for (const line of text.split(/\r?\n/)) {
      if (!/^\|/.test(line)) continue;
      if (/采纳/.test(line) && !/拒绝/.test(line)) adopted += 1;
      if (/拒绝/.test(line)) rejected += 1;
      if (/误报/.test(line)) misreport += 1;
    }
  }
  if (!fs.existsSync(reviewDir)) missing.push('workflow/reviews.d/');
  out.review = { adopted, rejected, misreport, adoptionRate: pct(adopted, adopted + rejected) };

  // 4) 行为评测
  const evalRows = readJsonl(path.join(root, '.agents', 'evals', 'results.jsonl'));
  if (!evalRows.length) missing.push('.agents/evals/results.jsonl');
  const bySig = new Map();
  for (const r of evalRows) {
    if (!r || !r.signature) continue;
    const prev = bySig.get(r.signature);
    if (!prev || Date.parse(r.ts) > Date.parse(prev.ts)) bySig.set(r.signature, r);
  }
  const latest = [...bySig.values()];
  const fresh = latest.filter((r) => within(r.ts, since));
  out.evals = {
    signatures: latest.length,
    fresh: fresh.length,
    lastPassRate: latest.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0]?.passRate ?? null,
    stale: latest.length - fresh.length,
  };

  // 5) 返工提交占比（可选：无 git 时省略——gitSubjects/reworkStats 单源，owner-digest 同源引用）
  const subjects = gitSubjects(root, since);
  if (subjects) out.rework = reworkStats(subjects);

  // 6) 派发报告预算（dispatch-budget，advisory）：超限月进入聚合面。只加字段不加门禁；缺源入 missing。
  //    overCount/overMonths 口径（2026-11-16 修正）：按月·报告数加权——月合计 > 该月报告数×单报告预算
  //    才计超限月（旧口径月合计直比单报告预算，多报告月结构性误报）。字段形状不变，仅语义修正。
  const rb = reportBudgetStats(root);
  out.reportBudget = {
    budget: rb.budget,
    shards: rb.byMonth.length,
    overCount: rb.overCount,
    overMonths: rb.byMonth.filter((x) => x.over === true).map((x) => `${x.ym}:${x.chars}`),
  };
  if (!rb.hasShards) missing.push('workflow/delegations.d/');
  if (rb.configMissing) missing.push('.agents/config/dispatch.json');

  out.missing = missing;
  return out;
}

export function renderMarkdown(m) {
  const fmt = (v) => (v == null ? '—' : `${v}%`);
  const lines = [
    `# 交付结果指标（近 ${m.days} 天）`,
    '',
    `> 生成时间 ${new Date().toISOString()}；来源为本地台账，缺源单列，不把 0 当“很好”。`,
    '',
    '| 面 | Leading / Lagging | 值 |',
    '|---|---|---|',
    `| 验证通过率 | Leading | ${fmt(m.verification.passRate)}（${m.verification.pass}/${m.verification.recent} 次，均门数 ${m.verification.gateAvg ?? '—'}） |`,
    `| 行为评测陈旧面 | Leading | ${m.evals.stale}/${m.evals.signatures} 个签名过期；最新通过率 ${fmt(m.evals.lastPassRate)} |`,
    `| 复核采纳率 | Leading | ${fmt(m.review.adoptionRate)}（采纳 ${m.review.adopted} / 拒绝 ${m.review.rejected} / 误报 ${m.review.misreport}） |`,
    `| 返工提交占比 | Lagging | ${m.rework ? `${fmt(m.rework.rate)}（${m.rework.rework}/${m.rework.commits}）` : '—（无 git）'} |`,
    `| 派发报告预算超限 | Leading | ${m.reportBudget && m.reportBudget.budget != null ? `预算 ${m.reportBudget.budget} 字符（advisory）；delegations.d 分片正文超限 ${m.reportBudget.overCount}/${m.reportBudget.shards} 月${m.reportBudget.overMonths.length ? `（${m.reportBudget.overMonths.join('、')}）` : ''}（口径：月合计 vs 报告数×单报告预算，分片去空白字符）` : '—'} |`,
    `| 未关闭事故 | Lagging | ${m.incidents.open}/${m.incidents.total} |`,
    '',
  ];
  if (m.missing.length) {
    lines.push('## 数据缺口', '');
    for (const x of m.missing) lines.push(`- 缺 \`${x}\`：该行指标为空/近似，不据此下结论。`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

function main() {
  const argv = process.argv.slice(2);
  const root = path.resolve(argOf(argv, 'root', process.cwd()));
  const days = Number(argOf(argv, 'days', 30)) || 30;
  const m = collect(root, { days });
  if (argv.includes('--json')) {
    console.log(JSON.stringify(m, null, 2));
    return 0;
  }
  const md = renderMarkdown(m);
  const outArg = argOf(argv, 'out');
  if (outArg && outArg !== true) {
    const file = path.resolve(root, outArg);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, md, 'utf8');
    console.log(file);
  } else {
    process.stdout.write(md);
  }
  return 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith('outcome-metrics.mjs');
if (isMain) process.exit(main());
