#!/usr/bin/env node
/* agg-delegations: 量化证据聚合
 * 读 workflow/delegations.md 两张结果表（按表头签名识别：委派表含「被委派方」列、自做表=日期+任务一句话；不依赖 ## 节标题）+ 扫 workflow/incidents/ 按月计数，
 * 输出各月指标（一次通过率 / 平均返工次数 / 主兜底占比）、并发扩容门判定、可粘贴的月度快照行。
 * 结果取值：一次通过 | 返工×N | 主兜底 | 返工待修（未闭环，不计入率）。
 * 用法：node .agents/scripts/agg-delegations.cjs [--month=YYYY-MM]（默认输出全部月份 + 全量累计）
 * 门槛定义见 workflow/delegations.md §并发扩容门槛，两处须同步改。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const LEDGER = path.join(ROOT, 'workflow', 'delegations.md');
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
    .filter((cols) => cols.length >= 2 && !/^[-: ]+$/.test(cols[1])) // 去表头分隔行
    .filter((cols) => !/^\s*$/.test(cols[0]) && /^\d{4}-\d{2}-\d{2}$/.test(cols[0])); // 只留数据行（首列是日期）
}

function parseResult(raw) {
  const r = (raw || '').trim();
  if (/^一次通过$/.test(r)) return { kind: 'pass', rework: 0 };
  const m = r.match(/^返工×(\d+)$/);
  if (m) return { kind: 'rework', rework: parseInt(m[1], 10) };
  if (/^主兜底$/.test(r)) return { kind: 'fallback', rework: 1 };
  if (/^返工待修$/.test(r)) return { kind: 'pending', rework: 0 };
  return { kind: 'unknown', rework: 0 };
}

// splitTables：按表头签名识别两张结果表——节标题只服务人类阅读，表头才是数据边界
// （2026-09-24 修复：曾按 `## 委派结果` 节标题定位，节结构漂移时已有记录被静默读成「台账为空」）
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

function readLedger() {
  if (!fs.existsSync(LEDGER)) fail(`找不到 ${LEDGER}`);
  const text = fs.readFileSync(LEDGER, 'utf8');
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
    fail(`台账结构漂移：${LEDGER} 存在日期开头的数据行但未识别到结果表（委派表表头须含「被委派方」列，自做表表头须为「日期 | 任务一句话 | 结果 | 备注」）`);
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

// 门槛（与 workflow/delegations.md §并发扩容门槛 同步）
const GATE = { minSample: 20, minPassRate: 0.9, maxAvgRework: 0.3, minDelegated: 5, maxFallbackRate: 0.1 };

function metrics(rows) {
  const valid = rows.filter((r) => parseResult(r.result).kind !== 'pending' && parseResult(r.result).kind !== 'unknown');
  const pending = rows.length - valid.length;
  let pass = 0, reworkSum = 0, fallback = 0;
  for (const r of valid) {
    const p = parseResult(r.result);
    if (p.kind === 'pass') pass += 1;
    if (p.kind === 'fallback') fallback += 1;
    reworkSum += p.rework;
  }
  const delegatedValid = valid.filter((r) => r.scope === '委派');
  return {
    total: valid.length,
    pending,
    pass,
    passRate: valid.length ? pass / valid.length : null,
    reworkSum,
    avgRework: valid.length ? reworkSum / valid.length : null,
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

function gate(m, incidents) {
  const items = [];
  items.push({ no: 1, ok: m.total >= GATE.minSample, desc: `样本量 ${m.total}/${GATE.minSample}` });
  items.push({
    no: 2,
    ok: m.passRate != null && m.passRate >= GATE.minPassRate,
    desc: `一次通过率 ${fmtRate(m.passRate)}≥90%`,
  });
  items.push({
    no: 3,
    ok: m.avgRework != null && m.avgRework <= GATE.maxAvgRework,
    desc: `平均返工 ${fmtNum(m.avgRework)}≤0.3`,
  });
  const delegOk = m.delegatedValid >= GATE.minDelegated && m.fallbackRate != null && m.fallbackRate <= GATE.maxFallbackRate;
  items.push({
    no: 4,
    ok: delegOk,
    desc: `委派样本 ${m.delegatedValid}≥5 且主兜底 ${fmtRate(m.fallbackRate)}≤10%`,
  });
  items.push({ no: 5, ok: null, desc: '门禁不失守（人工对照当月 incident 定性）' });
  const hardOk = items.filter((i) => i.ok !== null).every((i) => i.ok);
  const bad = items.filter((i) => i.ok === false).map((i) => i.no).join('+');
  return { items, verdict: hardOk ? '✅（待人工确认门5）' : `❌ 未达标项:${bad}` };
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
  for (const ym of months) {
    const m = metrics(byMonth[ym]);
    const g = gate(m, incidents[ym] || 0);
    console.log(`## ${ym}`);
    console.log(`  有效任务 ${m.total}（待修 ${m.pending}）｜一次通过 ${m.pass}（${fmtRate(m.passRate)}）｜返工总次数 ${m.reworkSum}（平均 ${fmtNum(m.avgRework)}）｜主兜底 ${m.fallback}/${m.delegatedValid}（${fmtRate(m.fallbackRate)}）｜incident ${incidents[ym] || 0} 起`);
    for (const i of g.items) console.log(`  门${i.no} ${i.ok === null ? '[人工]' : i.ok ? '✅' : '❌'} ${i.desc}`);
    console.log(`  扩容门判定：${g.verdict}\n`);
    snapshotRows.push(`| ${ym} | ${m.total} | ${fmtRate(m.passRate)} | ${fmtNum(m.avgRework)} | ${fmtRate(m.fallbackRate)} | ${incidents[ym] || 0} | ${g.verdict} | 样本含待修${m.pending} |`);
  }

  if (!argMonth && rows.length) {
    const m = metrics(rows);
    console.log(`## 全量累计`);
    console.log(`  有效任务 ${m.total}（待修 ${m.pending}）｜一次通过 ${fmtRate(m.passRate)}｜平均返工 ${fmtNum(m.avgRework)}｜主兜底 ${fmtRate(m.fallbackRate)}｜incident 合计 ${Object.values(incidents).reduce((a, b) => a + b, 0)} 起\n`);
  }

  console.log(`## 可粘贴快照行（粘到 workflow/delegations.md §月度聚合快照）`);
  for (const r of snapshotRows) console.log(r);

  if (!rows.length) {
    console.log('\n（台账为空：尚无记录，扩容门自然未通过）');
  }
}

main();
