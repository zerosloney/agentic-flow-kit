#!/usr/bin/env node
/* agg-delegations: 量化证据聚合
 * 读 workflow/delegations.md 两张结果表（按表头签名识别：委派表含「被委派方」列、自做表=日期+任务一句话；不依赖 ## 节标题）+ 扫 workflow/incidents/ 按月计数，
 * 输出各月指标（一次通过率 / 平均返工次数 / 主兜底占比）、并发扩容门判定、可粘贴的月度快照行。
 * 结果取值：一次通过 | 返工×N | 返工×N（门禁噪声）| 主兜底 | 返工待修（未闭环，不计入率）。
 *   门禁噪声档（2026-10-08 selfmeasure-and-modularize）：剥离「返工由门禁面而非设计面触发」的形态——
 *   扩容门第 3 项只对设计返工判 =0，门禁噪声返工单列观测。存量行零回填（旧四档解析逐条不变）。
 *   取值定义与边界（何为门禁噪声 / 不得用于给设计返工贴标签）以 workflow/delegations.md 头部记法为准。
 * 用法：node .agents/scripts/agg-delegations.cjs [--month=YYYY-MM]（默认输出全部月份 + 全量累计）
 * 门槛定义见 workflow/delegations.md §并发扩容门槛（doc 为权威，脚本向文档对齐——2026-09-27 board-kb-p1）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INCIDENTS = path.join(ROOT, 'workflow', 'incidents');

const argMonth = (process.argv.find((a) => a.startsWith('--month=')) || '').split('=')[1] || null;

function fail(msg) {
  console.error(`agg-delegations: ${msg}`);
  process.exit(1);
}

function parseTableRows(sectionText) {
  return sectionText
    .split(/\r?\n/)
    .filter((l) => /^\|/.test(l.trim()))
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
    .filter((cols) => !/^\s*$/.test(cols[0]) && /^\d{4}-\d{2}-\d{2}$/.test(cols[0])); // 只留数据行（首列是日期；表头/分隔行随之滤除）
}

// parseResult：结果列解析。返回值统一为 { kind, rework, reworkNoise } 两个分量。
// 三个返工格式（2026-10-08 rework-attribution-split 补第三种）：
//   返工×N                  → 纯设计返工        { kind:'rework',       rework:N,  reworkNoise:0 }
//   返工×N（门禁噪声）      → 纯门禁面噪声      { kind:'rework-noise', rework:0,  reworkNoise:N }
//   返工×N + 门禁噪声×M     → 行内双值（混合）  { kind:'rework-mixed', rework:N,  reworkNoise:M }
// 动机：存量逐行审计（29 行含返工）证实前两种单值格式**无法表达混合归因**——一行只记一个返工
// 总数时，「1 次设计 + 1 次噪声」只能整行倒向某一侧。行内双值是作者写入时确定已知的归因事实，
// 不从返工点数量反推（batch-ledger-audit 结论：判据读写入时事实，不猜）。
// ⚠️ 顺序约束：新分支须排在两个单值分支之前（`$` 锚定使三者互斥，此处按语义就近声明）。
function parseResult(raw) {
  const r = (raw || '').trim();
  // 行内双值（混合归因）：宽容空格（`返工×1+门禁噪声×1` 亦可解析）
  const mx = r.match(/^返工×(\d+)\s*\+\s*门禁噪声×(\d+)$/);
  if (mx) return { kind: 'rework-mixed', rework: parseInt(mx[1], 10), reworkNoise: parseInt(mx[2], 10) };
  if (/^一次通过$/.test(r)) return { kind: 'pass', rework: 0, reworkNoise: 0 };
  // 门禁噪声档（2026-10-08 selfmeasure-and-modularize）：剥离「返工由门禁面（预算超限 / 双源漏刷 /
  // 节名不一致 / 门禁自身误报）触发、而非设计面」的形态。动机：本仓 DASHBOARD 自报质量门连续两月红
  // （一次通过率 55% / 61%，门槛 ≥90%），根因是两档混列——指标永远红且不指示该改什么。
  const mn = r.match(/^返工×(\d+)（门禁噪声）$/);
  if (mn) return { kind: 'rework-noise', rework: 0, reworkNoise: parseInt(mn[1], 10) };
  const m = r.match(/^返工×(\d+)$/);
  if (m) return { kind: 'rework', rework: parseInt(m[1], 10), reworkNoise: 0 };
  if (/^主兜底$/.test(r)) return { kind: 'fallback', rework: 1, reworkNoise: 0 };
  if (/^返工待修$/.test(r)) return { kind: 'pending', rework: 0, reworkNoise: 0 };
  return { kind: 'unknown', rework: 0, reworkNoise: 0 };
}

// splitTables：按表头签名识别两张结果表——节标题只服务人类阅读，表头才是数据边界
// （2026-09-24 修复：曾按 `## 委派结果` 节标题定位，节结构漂移时已有记录被静默读成「台账为空」）
// ⚠️ 互引（2026-10-08 papercuts-cleanup-batch 修 2）：check-loop.mjs delegationResultRows 已对齐本签名
// 口径（委派表头=含「被委派方」列 / 自做表头=首列「日期」且含「任务一句话」列）——一边改另一边须跟；
// 差异保留：本函数按「连续 | 行」断表（聚合需分行归属），check-loop 按「## 节」终止收集（对账只需并集）
function splitTables(text) {
  const tables = { delegated: [], self: [] };
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) { cur = null; continue; } // 表体边界：连续 | 行；断开即出表
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.some((c) => c.startsWith('被委派方'))) { cur = 'delegated'; continue; } // 委派表表头
    if (cells[0] === '日期' && cells.some((c) => c.startsWith('任务一句话'))) { cur = 'self'; continue; } // 自做表表头（委派表已被上一行截走）
    if (cur) tables[cur].push(line); // 表体行（含分隔行——parseTableRows 会滤掉）
  }
  return tables;
}

// readLedger：root 显式参数 + soft 模式（2026-10-08 workflow-dashboard 使能导出，判据单源复用——
// 仪表盘 require 本函数取行，不重写表解析；缺省 root/无 soft 行为与原签名完全一致，main() 零变化）
function readLedger(root = ROOT, opts = {}) {
  const ledger = path.join(root, 'workflow', 'delegations.md');
  if (!fs.existsSync(ledger)) {
    if (opts.soft) return [];
    fail(`找不到 ${ledger}`);
  }
  const text = fs.readFileSync(ledger, 'utf8');
  const tables = splitTables(text);
  const delegated = parseTableRows(tables.delegated.join('\n')).map((c) => ({
    scope: '委派',
    date: c[0],
    actor: c[1],
    result: c[3] || '',
  }));
  const selfDone = parseTableRows(tables.self.join('\n')).map((c) => ({
    scope: '自做',
    date: c[0],
    actor: '主智能体',
    result: c[2] || '',
  }));
  const rows = delegated.concat(selfDone);
  // 零数据行时区分「台账真空」与「结构漂移」：有日期开头的数据行却识别不到表 → fail-loud，不再静默「台账为空」
  if (!rows.length && /^\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|/m.test(text)) {
    if (opts.soft) return [];
    fail(`台账结构漂移：${ledger} 存在日期开头的数据行但未识别到结果表（委派表表头须含「被委派方」列，自做表表头须为「日期 | 任务一句话 | 结果 | 备注」）`);
  }
  return rows;
}

function countIncidents() {
  const byMonth = {};
  if (!fs.existsSync(INCIDENTS)) return byMonth;
  for (const f of fs.readdirSync(INCIDENTS)) {
    const m = f.match(/^(\d{4}-\d{2})-\d{2}.*\.md$/);
    if (m) byMonth[m[1]] = (byMonth[m[1]] || 0) + 1;
  }
  return byMonth;
}

// 门槛（2026-09-27 board-kb-p1 对齐 workflow/delegations.md §并发扩容门槛声明——doc 为权威）：
//   月度口径项：一次完成率 ≥90% ｜ 月度**设计**返工次数 = 0（2026-10-08 起门禁噪声返工剥离单列）｜ 无主兜底信号（=0）（旧「平均返工≤0.3 / 兜底≤10%」为宽松分叉，退役）
//   样本护栏项（脚本侧统计可信度门槛，非口径分叉）：月样本量 ≥20 ｜ 委派样本 ≥5
//   连续性：扩容需「本月 + 上一自然月」连续两月月度口径全达标（delegations.md「连续两个月」）
const GATE = { minSample: 20, minPassRate: 0.9, minDelegated: 5 };

function metrics(rows) {
  // 未知结果（结果列拼错/漏填）单列计数，不混进「待修」——待修=未闭环，未知=记录本身有问题（2026-09-24 口径分离）
  const kinds = rows.map((r) => parseResult(r.result).kind);
  const valid = rows.filter((_, i) => kinds[i] !== 'pending' && kinds[i] !== 'unknown');
  const pending = kinds.filter((k) => k === 'pending').length;
  const unknown = kinds.filter((k) => k === 'unknown').length;
  let pass = 0, reworkSum = 0, reworkNoiseSum = 0, fallback = 0;
  for (const r of valid) {
    const p = parseResult(r.result);
    if (p.kind === 'pass') pass += 1;
    if (p.kind === 'fallback') fallback += 1;
    // 双列累计：设计返工与门禁噪声返工分列（2026-10-08 selfmeasure-and-modularize 引入分列，
    // 2026-10-08 rework-attribution-split 加行内混合档）。
    // 显式列 kind 而非 `reworkSum += p.rework`——否则后续新增 kind 会被静默并入设计返工，
    // 且混合档的两个分量必须各走各的累加器（只加 rework 会漏掉噪声）。
    if (p.kind === 'rework' || p.kind === 'rework-mixed') reworkSum += p.rework;
    if (p.kind === 'rework-noise' || p.kind === 'rework-mixed') reworkNoiseSum += p.reworkNoise;
  }
  const delegatedValid = valid.filter((r) => r.scope === '委派');
  return {
    total: valid.length,
    pending,
    unknown,
    pass,
    passRate: valid.length ? pass / valid.length : null,
    reworkSum,
    reworkNoiseSum,
    avgRework: valid.length ? (reworkSum + reworkNoiseSum) / valid.length : null,
    delegatedValid: delegatedValid.length,
    fallback,
    fallbackRate: delegatedValid.length ? fallback / delegatedValid.length : null,
  };
}

function fmtRate(x, digits = 0) {
  return x == null ? '—' : `${(x * 100).toFixed(digits)}%`;
}
function fmtNum(x) {
  return x == null ? '—' : x.toFixed(2);
}

// gateMonth：单月门槛判定（pure，供测试）——口径项 + 样本护栏项分开列
function gateMonth(m) {
  const items = [];
  items.push({ no: 1, ok: m.total >= GATE.minSample, desc: `样本量 ${m.total}/${GATE.minSample}`, kind: '样本护栏' });
  items.push({ no: 2, ok: m.passRate != null && m.passRate >= GATE.minPassRate, desc: `一次完成率 ${fmtRate(m.passRate)}≥90%`, kind: '口径' });
  // 第 3 项判据 2026-10-08 语义变更：只对**设计返工**判 =0；门禁噪声返工单列在描述里（数字仍可见不隐藏，
  // 但不参与 ok 判定——两类混判是本仓质量门连续两月红的根因）。⚠️ 不可据此给设计返工贴噪声标签洗白指标：
  // 该取值由作者手写、机器无法判真伪（同 --delegated 信任边界），口径约束见 delegations.md 头部。
  items.push({ no: 3, ok: m.reworkSum === 0, desc: `月度设计返工 ${m.reworkSum}=0（门禁噪声返工 ${m.reworkNoiseSum || 0} 次已剥离单列）`, kind: '口径' });
  items.push({ no: 4, ok: m.fallback === 0, desc: `主兜底 ${m.fallback}=0（无主兜底信号）`, kind: '口径' });
  items.push({ no: 5, ok: m.delegatedValid >= GATE.minDelegated, desc: `委派样本 ${m.delegatedValid}≥5`, kind: '样本护栏' });
  items.push({ no: 6, ok: null, desc: '门禁不失守（人工对照当月 incident 定性）', kind: '人工' });
  return { items, monthOk: items.filter((i) => i.ok !== null).every((i) => i.ok) };
}

// expansionVerdict：连续两个月扩容判定（pure，供测试）——本月与上一自然月 monthOk 均真才「可扩容」；
// prevMissing = 无上月数据（首月/断档）；items 供未达标项列出
function expansionVerdict(monthOk, prevOk, prevMissing, items) {
  if (monthOk && prevOk) return '✅ 连续两月达标（可扩容，待人工确认门6）';
  if (monthOk && prevMissing) return '⚠️ 本月达标（连续性 1/2——上月无数据）';
  if (monthOk) return '⚠️ 本月达标（连续性 1/2——上月未达标）';
  const bad = (items || []).filter((i) => i.ok === false).map((i) => i.no).join('+');
  return `❌ 未达标（连续性中断）：${bad || '月度口径项未全过'}`;
}

function main() {
  const rows = readLedger();
  const incidents = countIncidents();

  const byMonth = {};
  for (const r of rows) {
    const ym = r.date.slice(0, 7);
    (byMonth[ym] = byMonth[ym] || []).push(r);
  }
  const months = Object.keys(byMonth).sort().filter((m) => !argMonth || m === argMonth);

  console.log(`# 量化证据聚合（${argMonth || '全部月份'}） 生成于 ${new Date().toISOString().slice(0, 10)}\n`);

  const snapshotRows = [];
  const monthResults = new Map(); // ym → { monthOk }（连续两月判定用）
  for (const ym of months) {
    const m = metrics(byMonth[ym]);
    const { items, monthOk } = gateMonth(m);
    monthResults.set(ym, monthOk);
    const prevYm = (() => { const [y, mo] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
    const verdict = expansionVerdict(monthOk, monthResults.get(prevYm), !months.includes(prevYm), items);
    console.log(`## ${ym}`);
    console.log(`  有效任务 ${m.total}（待修 ${m.pending}${m.unknown ? `、未知结果 ${m.unknown}` : ''}）｜一次通过 ${m.pass}（${fmtRate(m.passRate)}）｜设计返工 ${m.reworkSum} 次 / 门禁噪声返工 ${m.reworkNoiseSum} 次（合计返工 ${m.reworkSum + m.reworkNoiseSum}，平均 ${fmtNum(m.avgRework)}）｜主兜底 ${m.fallback}/${m.delegatedValid}（${fmtRate(m.fallbackRate)}）｜incident ${incidents[ym] || 0} 起`);
    for (const i of items) console.log(`  门${i.no}[${i.kind}] ${i.ok === null ? '[人工]' : i.ok ? '✅' : '❌'} ${i.desc}`);
    console.log(`  扩容门判定：${verdict}\n`);
    snapshotRows.push(`| ${ym} | ${m.total} | ${fmtRate(m.passRate)} | ${fmtNum(m.avgRework)} | ${fmtRate(m.fallbackRate)} | ${incidents[ym] || 0} | ${verdict} | 样本含待修${m.pending}${m.unknown ? `、未知${m.unknown}` : ''} |`);
  }

  if (!argMonth && rows.length) {
    const m = metrics(rows);
    console.log(`## 全量累计`);
    console.log(`  有效任务 ${m.total}（待修 ${m.pending}${m.unknown ? `、未知结果 ${m.unknown}` : ''}）｜一次通过 ${fmtRate(m.passRate)}｜平均返工 ${fmtNum(m.avgRework)}｜主兜底 ${fmtRate(m.fallbackRate)}｜incident 合计 ${Object.values(incidents).reduce((a, b) => a + b, 0)} 起\n`);
  }

  console.log(`## 可粘贴快照行（粘到 workflow/delegations.md §月度聚合快照）`);
  for (const r of snapshotRows) console.log(r);

  if (!rows.length) {
    console.log('\n（台账为空：尚无记录，扩容门自然未通过）');
  }
}

// isMain 守卫 + 纯函数导出（board-kb-p1：gateMonth / expansionVerdict 供测试 import，import 不执行 main）
if (require.main === module) {
  main();
} else {
  module.exports = { parseResult, metrics, gateMonth, expansionVerdict, GATE, readLedger };
}
