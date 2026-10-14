#!/usr/bin/env node
// agg-judgments.test.mjs — 判定流水聚合纯函数套件（2026-10-11 judgment-ledger）
// aggFromRows 进程内断言：按月分桶 / --month 过滤 / WARN·BLOCK 计数 / 坏 rules 字段容忍。
import { aggFromRows } from './agg-judgments.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

const ROWS = [
  { ts: '2026-10-01T01:00:00Z', mode: 'hard', rules: [{ rule: '三件套不全', level: 'WARN', count: 2 }] },
  { ts: '2026-10-02T01:00:00Z', mode: 'hygiene', rules: [{ rule: '三件套不全', level: 'WARN', count: 1 }, { rule: '配对断裂', level: 'BLOCK', count: 1 }] },
  { ts: '2026-09-30T01:00:00Z', mode: 'hard', rules: [{ rule: '归因缺字段', level: 'WARN', count: 3 }] },
  { ts: '2026-10-03T01:00:00Z', mode: 'hard', rules: [] },
  { ts: 'bad-ts', mode: 'hard', rules: [] },
  { ts: '2026-10-04T01:00:00Z', mode: 'hard', rules: 'not-array' },
];

// ---- S1 按月分桶 + 计数 ----
{
  const { byMonth } = aggFromRows(ROWS);
  check('S1 两个月桶（坏 ts 行不计）', Object.keys(byMonth).sort().join(',') === '2026-09,2026-10', JSON.stringify(Object.keys(byMonth)));
  check('S1 2026-10 运行 4 次', byMonth['2026-10'].runs === 4, String(byMonth['2026-10'].runs));
  check('S1 跨行同规则 WARN 累加（2+1=3）', byMonth['2026-10'].rules['三件套不全'].WARN === 3, JSON.stringify(byMonth['2026-10'].rules));
  check('S1 BLOCK 计数独立', byMonth['2026-10'].rules['配对断裂'].BLOCK === 1);
  check('S1 2026-09 归因缺字段 WARN×3', byMonth['2026-09'].rules['归因缺字段'].WARN === 3);
  check('S1 空 rules 行只计 runs', byMonth['2026-10'].runs === 4 && byMonth['2026-10'].rules['配对断裂'].WARN === 0);
}

// ---- S2 month 过滤 ----
{
  const { byMonth } = aggFromRows(ROWS, '2026-09');
  check('S2 过滤单月只留 2026-09', Object.keys(byMonth).join(',') === '2026-09' && byMonth['2026-09'].runs === 1);
  check('S2 过滤无命中 → 空桶', aggFromRows(ROWS, '2025-01').byMonth['2025-01'] === undefined);
}

// ---- S3 空入参 ----
check('S3 空行数组 → 空 byMonth', Object.keys(aggFromRows([]).byMonth).length === 0);
check('S3 null 入参不 throw', Object.keys(aggFromRows(null).byMonth).length === 0);

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
