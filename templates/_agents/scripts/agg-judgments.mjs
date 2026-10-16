#!/usr/bin/env node
// agg-judgments.mjs — check-loop 判定流水月度聚合（2026-10-11 judgment-ledger）
// 用法：node .agents/scripts/agg-judgments.mjs [--month=YYYY-MM]
//       node .agents/scripts/agg-judgments.mjs --retire-candidates [--months=6]
// 源：.agents/judgments.jsonl（check-loop.mjs 每次真实运行追加一行，本地 gitignore；
//     缺文件 = 尚无运行记录，提示后 exit 0——与 delegations 台账「必在」不同，这是渐积数据）。
// 消费：mechanism-registry 月度对账（.agents/mechanism-registry.md「触发统计口径」列的 WARN/BLOCK 计数）
//     与 advisory→hard 升格 / 退役判定的直接查账面——替代原「人工 grep check-loop 输出」。
// --retire-candidates（2026-10-15 减重手段① 自源仓回灌，规则的死亡机制）：列出「连续 N 个有数据月
//     零命中（WARN+BLOCK 全为 0）」的规则作为退役候选——月度对账时按 mechanism-registry「退役判据」
//     列逐条裁决（安全主干/级别闭环主干等「不退役」行除外；「且 X 停滞」类附加条件由人判）。
//     台账不足 N 个数据月 → 数据不充分，不产候选（年轻遥测不得制造假候选）。判定口径 = 尾部
//     N 个「有运行的月」（非日历月——遥测断档的月不算零命中，防漏跑误判退役）。
// 测试：node .agents/scripts/agg-judgments.test.mjs（纯函数 aggFromRows / retireCandidates 进程内断言）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const LEDGER = path.join(ROOT, '.agents', 'judgments.jsonl');

const argMonth = (process.argv.find((a) => a.startsWith('--month=')) || '').split('=')[1] || null;

// aggFromRows(rows, month)：按月×规则×级别聚合。rows = 已解析的台账行数组；
// month = 'YYYY-MM' 过滤（null = 全部）。输出 { byMonth: { 'YYYY-MM': { runs, rules: { rule: { WARN, BLOCK } } } } }。
export function aggFromRows(rows, month = null) {
  const byMonth = {};
  for (const row of rows || []) {
    if (typeof row.ts !== 'string' || !/^\d{4}-\d{2}/.test(row.ts)) continue;
    const ym = row.ts.slice(0, 7);
    if (month && ym !== month) continue;
    const b = (byMonth[ym] ||= { runs: 0, rules: {} });
    b.runs++;
    for (const r of Array.isArray(row.rules) ? row.rules : []) {
      if (!r || typeof r.rule !== 'string') continue;
      const cell = (b.rules[r.rule] ||= { WARN: 0, BLOCK: 0 });
      if (r.level === 'WARN') cell.WARN += r.count || 0;
      else if (r.level === 'BLOCK') cell.BLOCK += r.count || 0;
    }
  }
  return { byMonth };
}

function readRows() {
  if (!fs.existsSync(LEDGER)) return null;
  const rows = [];
  let bad = 0;
  for (const line of fs.readFileSync(LEDGER, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      bad++;
    }
  }
  return { rows, bad };
}

// retireCandidates(rows, windowMonths)：退役候选 = 「尾部 windowMonths 个有数据月零命中」的规则。
// 口径：数据月 = 该月至少一次运行（断档月不参与，不按零命中计）；候选须在全历史出现过（含只剩
//   零命中的月）且尾部窗口内 WARN+BLOCK 全 0。输出按全历史命中数升序（最冷门在前）。
//   rows 不足 windowMonths 个数据月 → { sufficient:false }——年轻遥测不产候选。
export function retireCandidates(rows, windowMonths = 6) {
  const { byMonth } = aggFromRows(rows);
  const months = Object.keys(byMonth).sort();
  if (months.length < windowMonths) {
    return { sufficient: false, dataMonths: months.length, windowMonths, candidates: [], recentHits: [] };
  }
  const trailing = new Set(months.slice(-windowMonths));
  const allRules = new Set();
  for (const ym of months) for (const r of Object.keys(byMonth[ym].rules)) allRules.add(r);
  const candidates = [];
  const recentHits = [];
  for (const rule of allRules) {
    let total = 0;
    let lastHit = null;
    let inWindow = 0;
    for (const ym of months) {
      const cell = byMonth[ym].rules[rule];
      const n = cell ? (cell.WARN + cell.BLOCK) : 0;
      total += n;
      if (n > 0) {
        lastHit = ym;
        if (trailing.has(ym)) inWindow += n;
      }
    }
    const row = { rule, total, lastHit };
    if (inWindow === 0) candidates.push(row);
    else recentHits.push(row);
  }
  candidates.sort((a, b) => a.total - b.total || a.rule.localeCompare(b.rule));
  recentHits.sort((a, b) => b.total - a.total || a.rule.localeCompare(b.rule));
  return {
    sufficient: true,
    dataMonths: months.length,
    windowMonths,
    windowFrom: months.slice(-windowMonths)[0],
    windowTo: months[months.length - 1],
    candidates,
    recentHits,
  };
}

function printRetireCandidates(read) {
  const wArg = Number((process.argv.find((a) => a.startsWith('--months=')) || '').split('=')[1]);
  const windowMonths = Number.isFinite(wArg) && wArg >= 1 ? Math.floor(wArg) : 6;
  const r = retireCandidates(read.rows, windowMonths);
  if (!r.sufficient) {
    console.log(`agg-judgments: 退役候选窗口 ${windowMonths} 个月——数据月仅 ${r.dataMonths} 个（台账 ${read.rows.length} 行），数据不充分不产候选。继续积累运行记录。`);
    return;
  }
  console.log(`退役候选（零命中窗口 ${r.windowFrom}..${r.windowTo}，共 ${r.windowMonths} 个数据月）——仅机械筛查，裁决走 mechanism-registry「退役判据」列（「不退役」主干除外）：`);
  if (!r.candidates.length) {
    console.log('  （无候选——尾部窗口内所有规则均有命中）');
  }
  for (const c of r.candidates) {
    console.log(`  候选  ${c.rule.padEnd(24)} 全历史命中 ${String(c.total).padStart(4)}  末次命中 ${c.lastHit || '—'}`);
  }
  for (const c of r.recentHits) {
    console.log(`  在役  ${c.rule.padEnd(24)} 全历史命中 ${String(c.total).padStart(4)}  末次命中 ${c.lastHit}`);
  }
  if (read.bad) console.error(`agg-judgments: 跳过坏行 ${read.bad}（JSON 解析失败，不中断聚合）`);
}

function main() {
  const read = readRows();
  if (!read) {
    console.error(`agg-judgments: ${path.relative(ROOT, LEDGER)} 不存在——尚无运行记录（check-loop 真实运行一次即有一行）`);
    process.exit(0);
  }
  if (process.argv.includes('--retire-candidates')) {
    printRetireCandidates(read);
    return;
  }
  const { byMonth } = aggFromRows(read.rows, argMonth);
  const months = Object.keys(byMonth).sort();
  if (!months.length) {
    console.log(`agg-judgments: ${argMonth || '全部月份'} 无记录（台账共 ${read.rows.length} 行）`);
    return;
  }
  for (const ym of months) {
    const b = byMonth[ym];
    console.log(`📅 ${ym}｜运行 ${b.runs} 次`);
    const rules = Object.keys(b.rules).sort();
    if (!rules.length) { console.log('    （无规则判定）'); continue; }
    for (const rule of rules) {
      const { WARN, BLOCK } = b.rules[rule];
      console.log(`    ${rule.padEnd(24)} WARN×${WARN}  BLOCK×${BLOCK}`);
    }
  }
  if (read.bad) console.error(`agg-judgments: 跳过坏行 ${read.bad}（JSON 解析失败，不中断聚合）`);
}

const isMain = process.argv[1] && process.argv[1].endsWith('agg-judgments.mjs');
if (isMain) main();
