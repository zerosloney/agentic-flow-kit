#!/usr/bin/env node
// owner-digest.mjs — owner 视角一页纸摘要（进展 / 待拍板 / 风险，非机制口径）
//
// 背景（BACKLOG #23）：non-engineer-intent.md 给了业务方「入口」（不经 git 产出 intent），
// 但没有「出口」——owner 怎么一眼看到进展、待拍板事项与风险。本脚本从既有台账**只读派生**
// 三个固定段落（复用既有聚合脚本的口径单源，禁第三份实现）：
//
//   - 已完成：时间窗内 git 提交（与 outcome-metrics 同一访问方式 gitSubjects；无 git 显式报空）
//     ＋ 窗口内已了结的验证（.agents/verifications.jsonl，窗口按行 ts 过滤）与评审事件
//     （workflow/reviews.d/，metrics-core.scanReviews 单源；台账行带日期、按月分桶——
//     窗口按月粒度取交集，覆盖到的月整月计入）。
//   - 等我拍板：judgments 台账（.agents/judgments.jsonl ∪ workflow/gate-metrics.d/ 分片，
//     agg-judgments.readAllJudgments 单源合并）与 delegations 台账（workflow/delegations.md
//     ∪ delegations.d/ 分片，agg-delegations.readLedger 单源）。两本台账都无显式状态字段，
//     口径取台账里真实存在的可判定语义（并在此注明）：
//       · judgments「未了结」= 最近有记录月仍报 BLOCK 的规则（WARN 只计数，观察面不列条目）；
//       · delegations「待确认」= 结果列「返工待修」（parseResult kind=pending，未闭环）与
//         结果列无法判读（kind=unknown）的行；未了结项不随时间窗消失，故本段不限窗。
//   - 风险：未关闭 incidents（incidentOpen 与 outcome-metrics 同源）、返工提交占比
//     （reworkStats 同源）、派发报告预算超限月（reportBudgetStats 计量单源，advisory，
//     口径同 outcome-metrics）、数据源缺失清单。
//
// 硬性边界：只读幂等——除 stdout 外零写操作（不写 workflow/ 下任何文件；对比 outcome-metrics
// 可 --out 落盘，本脚本不落盘）；无数据显式报空「（无记录）」，缺源单列不静默吞掉，不造数；
// 台账读失败单列（不中断其余段）。markdown 不含生成时刻——同状态连跑逐字节相同。
//
// 输出：stdout 中文 markdown；--json 输出机器可读（三段 + 时间窗 + 各段空标记 + missing/errors）。
//
// 用法：
//   flow-kit run owner-digest [--days N] [--json]
//   node owner-digest.mjs [--root <项目根>] [--days N] [--json]
//   --days 默认 7（周报口径），须为 ≥1 整数；退出码：成功 0（含全空），用法错误 2。
import fs from 'node:fs';
import path from 'node:path';
import { readText, readJsonl, within, gitSubjects, reworkStats, incidentOpen } from './outcome-metrics.mjs';
import { readLedger, parseResult, reportBudgetStats } from './agg-delegations.mjs';
import { readAllJudgments } from './agg-judgments.mjs';
import { scanReviews } from './metrics-core.mjs';

export function collect(root, { days = 7, now = Date.now() } = {}) {
  const since = now - days * 86400000;
  const missing = [];
  const errors = [];
  const startM = new Date(since).toISOString().slice(0, 7);
  const endM = new Date(now).toISOString().slice(0, 7);
  const out = { days, since: new Date(since).toISOString() };

  // ── 已完成 ──
  const done = { commits: gitSubjects(root, since), verifications: null, reviews: null };

  const verFile = path.join(root, '.agents', 'verifications.jsonl');
  const verRows = readJsonl(verFile).filter((r) => within(r.ts, since));
  const verPass = verRows.filter((r) => Number(r.exitCode) === 0).length;
  done.verifications = { count: verRows.length, pass: verPass, fail: verRows.length - verPass };
  if (!fs.existsSync(verFile)) missing.push('.agents/verifications.jsonl');

  const reviewsDir = path.join(root, 'workflow', 'reviews.d');
  let byMonth;
  try {
    byMonth = scanReviews(path.join(root, 'workflow')); // 坏分片抛错不静默——单列 errors，不中断其余段
  } catch (err) {
    errors.push(`workflow/reviews.d/：${err.message}`);
    byMonth = null;
  }
  if (byMonth === null) {
    done.reviews = { events: 0, adopted: 0, rejected: 0, misreport: 0, months: [] };
  } else {
    if (!fs.existsSync(reviewsDir)) missing.push('workflow/reviews.d/');
    const months = Object.keys(byMonth).filter((m) => m >= startM && m <= endM).sort();
    const acc = { events: 0, adopted: 0, rejected: 0, misreport: 0, months };
    for (const m of months) {
      acc.events += byMonth[m].events;
      acc.adopted += byMonth[m].adopted;
      acc.rejected += byMonth[m].rejected;
      acc.misreport += byMonth[m].misreport;
    }
    done.reviews = acc;
  }
  done.empty = (done.commits === null || done.commits.length === 0)
    && done.verifications.count === 0 && done.reviews.events === 0;
  out.done = done;

  // ── 等我拍板 ──（口径见脚本头注；两本台账均无显式状态字段，用真实可判定语义）
  const decisions = { judgments: [], judgmentLatestMonth: null, judgmentWarn: 0, delegations: [] };
  const j = readAllJudgments(root);
  if (j.missing) {
    missing.push('.agents/judgments.jsonl ∪ workflow/gate-metrics.d/');
  } else {
    const latest = j.rows[j.rows.length - 1]; // mergeJudgmentRows 按月升序——末行 = 最近有记录月
    decisions.judgmentLatestMonth = String(latest.ts).slice(0, 7);
    for (const r of latest.rules || []) {
      if (r.level === 'BLOCK') decisions.judgments.push({ rule: r.rule, count: r.count });
      else if (r.level === 'WARN') decisions.judgmentWarn += r.count || 0;
    }
  }

  const dlgPath = path.join(root, 'workflow', 'delegations.md');
  if (!fs.existsSync(dlgPath)) {
    missing.push('workflow/delegations.md');
  } else {
    try {
      for (const r of readLedger(root)) {
        const kind = parseResult(r.result).kind;
        if (kind === 'pending' || kind === 'unknown') {
          decisions.delegations.push({
            date: r.date,
            scope: r.scope,
            task: r.task,
            result: String(r.result || '').trim() || '（空）',
            kind,
          });
        }
      }
    } catch (err) {
      errors.push(`workflow/delegations.md：${err.message}`);
    }
  }
  decisions.empty = decisions.judgments.length === 0 && decisions.delegations.length === 0;
  out.decisions = decisions;

  // ── 风险 ──
  const incidentDir = path.join(root, 'workflow', 'incidents');
  const incidents = { open: 0, total: 0, openFiles: [] };
  if (!fs.existsSync(incidentDir)) {
    missing.push('workflow/incidents/');
  } else {
    for (const name of fs.readdirSync(incidentDir).filter((n) => n.toLowerCase().endsWith('.md')).sort()) {
      incidents.total += 1;
      if (incidentOpen(readText(path.join(incidentDir, name)))) {
        incidents.open += 1;
        incidents.openFiles.push(name);
      }
    }
  }

  const rb = reportBudgetStats(root);
  const budget = {
    budget: rb.budget,
    shards: rb.byMonth.length,
    overCount: rb.overCount,
    overMonths: rb.byMonth.filter((x) => x.over === true).map((x) => `${x.ym}:${x.chars}`),
  };
  if (!rb.hasShards) missing.push('workflow/delegations.d/');
  if (rb.configMissing) missing.push('.agents/config/dispatch.json');

  const rework = done.commits ? reworkStats(done.commits) : null; // 与 outcome-metrics 同一 git 面、同一口径
  const risks = { incidents, rework, budget };
  risks.empty = incidents.open === 0 && (rework === null || rework.rework === 0) && budget.overCount === 0;
  out.risks = risks;

  out.missing = missing;
  out.errors = errors;
  return out;
}

export function renderMarkdown(d) {
  const lines = [
    `# Owner 摘要（近 ${d.days} 天）`,
    '',
    '> owner 视角一页纸：进展 / 待拍板 / 风险。只读派生自既有台账——不写任何文件；无数据显式写「（无记录）」，缺源在文末单列，不造数。',
    '',
    '## 已完成',
    '',
  ];
  const c = d.done.commits;
  if (c === null) lines.push('- 提交：—（无 git）');
  else if (!c.length) lines.push('- 提交（git）：窗口内无提交');
  else {
    lines.push(`- 提交（git）：${c.length} 条`);
    for (const s of c) lines.push(`  - ${s}`);
  }
  const v = d.done.verifications;
  lines.push(v.count
    ? `- 验证（.agents/verifications.jsonl，窗口内 ${v.count} 次）：通过 ${v.pass} / 未过 ${v.fail}`
    : '- 验证（.agents/verifications.jsonl）：（无记录）');
  const rv = d.done.reviews;
  lines.push(rv.events
    ? `- 评审（workflow/reviews.d/，窗口覆盖月份整月计入：${rv.months.join('、')}）：事件 ${rv.events} 起（采纳 ${rv.adopted} / 拒绝 ${rv.rejected} / 误报 ${rv.misreport}）`
    : '- 评审（workflow/reviews.d/）：（无记录）');
  lines.push(
    '',
    '## 等我拍板',
    '',
    '> 口径：judgments 台账无逐条状态字段——「未了结」= 最近有记录月仍报 BLOCK 的规则（.agents/judgments.jsonl ∪ workflow/gate-metrics.d/，agg-judgments 单源合并；WARN 只计数不列）；delegations 台账无显式确认字段——「待确认」= 结果列「返工待修」（未闭环，agg-delegations.parseResult kind=pending）与结果列无法判读（kind=unknown）的行；未了结项不随时间窗消失，本段不限窗。',
    '',
  );
  if (d.decisions.judgments.length) {
    const items = d.decisions.judgments.map((x) => `${x.rule} BLOCK×${x.count}`).join('、');
    const warn = d.decisions.judgmentWarn ? `（另有 WARN 命中 ${d.decisions.judgmentWarn}，观察面不列）` : '';
    lines.push(`- judgments 未了结（最近记录月 ${d.decisions.judgmentLatestMonth}）：${items}${warn}`);
  } else {
    lines.push('- judgments 未了结：（无记录）');
  }
  if (d.decisions.delegations.length) {
    for (const x of d.decisions.delegations) {
      lines.push(`- delegations 待确认（${x.date}，${x.scope}）：${x.task}（结果：${x.result}）`);
    }
  } else {
    lines.push('- delegations 待确认：（无记录）');
  }
  lines.push('', '## 风险', '');
  const inc = d.risks.incidents;
  lines.push(inc.open
    ? `- 未关闭 incidents：${inc.open}/${inc.total}（${inc.openFiles.join('、')}）`
    : (inc.total ? `- 未关闭 incidents：0/${inc.total}（无未关闭件）` : '- 未关闭 incidents：（无记录）'));
  const rw = d.risks.rework;
  lines.push(rw
    ? `- 返工提交占比：${rw.rate}%（${rw.rework}/${rw.commits}，fix|revert 前缀，口径同 outcome-metrics）`
    : '- 返工提交占比：—（无 git）');
  const b = d.risks.budget;
  const over = b.overMonths.length ? b.overMonths.join('、') : '无超限月';
  lines.push(b.budget != null
    ? `- 派发报告预算超限月（advisory，口径同 outcome-metrics：月合计 vs 报告数×单报告预算）：${over}（预算 ${b.budget} 字符/报告）`
    : '- 派发报告预算超限月（advisory，口径同 outcome-metrics）：预算单源缺失/非法——只计量不判超限');
  if (d.missing.length) {
    lines.push('', '## 数据源缺失', '');
    for (const x of d.missing) lines.push(`- 缺 \`${x}\`：该面为空/近似，不据此下结论。`);
  }
  if (d.errors.length) {
    lines.push('', '## 台账读取失败', '');
    for (const x of d.errors) lines.push(`- ${x}`);
  }
  return `${lines.join('\n')}\n`;
}

const USAGE = [
  'owner-digest — owner 视角一页纸摘要（进展 / 待拍板 / 风险，只读不落盘）',
  '',
  '用法：',
  '  flow-kit run owner-digest [--days N] [--json]',
  '  node owner-digest.mjs [--root <项目根>] [--days N] [--json]',
  '',
  '  --days N   时间窗天数，默认 7（周报口径），须为 ≥1 整数',
  '  --json     输出机器可读结构（三段 + 时间窗 + 各段空标记 + missing/errors）',
  '  --root     项目根（直接 node 执行时用；flow-kit run 会注入）',
  '',
  '退出码：成功 0（含全空）；用法错误 2。',
].join('\n');

function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  const root = path.resolve(argOf(argv, 'root', process.cwd()));
  const daysRaw = argOf(argv, 'days', 7);
  const days = Number(daysRaw);
  if (daysRaw === true || !Number.isInteger(days) || days < 1) {
    console.error('owner-digest: --days 须为 ≥1 的整数（默认 7）');
    return 2;
  }
  const d = collect(root, { days });
  if (argv.includes('--json')) {
    console.log(JSON.stringify(d, null, 2));
    return 0;
  }
  process.stdout.write(renderMarkdown(d));
  return 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith('owner-digest.mjs');
if (isMain) process.exit(main());
