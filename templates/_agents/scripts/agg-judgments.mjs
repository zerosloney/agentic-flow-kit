#!/usr/bin/env node
// agg-judgments.mjs — check-loop 判定流水月度聚合（2026-10-11 judgment-ledger）
// 用法：node .agents/scripts/agg-judgments.mjs [--month=YYYY-MM]
// 源：.agents/judgments.jsonl（check-loop.mjs 每次真实运行追加一行，本地 gitignore；
//     缺文件 = 尚无运行记录，提示后 exit 0——与 delegations 台账「必在」不同，这是渐积数据）。
// 消费：mechanism-registry 月度对账（.agents/mechanism-registry.md「触发统计口径」列的 WARN/BLOCK 计数）
//     与 advisory→hard 升格 / 退役判定的直接查账面——替代原「人工 grep check-loop 输出」。
// 测试：node .agents/scripts/agg-judgments.test.mjs（纯函数 aggFromRows 进程内断言）
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

function main() {
  const read = readRows();
  if (!read) {
    console.error(`agg-judgments: ${path.relative(ROOT, LEDGER)} 不存在——尚无运行记录（check-loop 真实运行一次即有一行）`);
    process.exit(0);
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
