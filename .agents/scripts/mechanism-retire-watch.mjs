#!/usr/bin/env node
// mechanism-retire-watch.mjs — 机制退役催办自动化（2026-10-14 源仓 L5 自举接线 1b/1c；2026-10-16 回灌 kit）
// 用途：读机制台账「退役阈值/最近触发」+ judgments 聚合，阈值触达自动产动作项——让机制的「死」与「生」同样强制。
//   自动化的是**感知/排序**（谁触达了阈值），处置仍人放行（改状态/删代码走人 + 一进一出）。
// 口径单源：.agents/mechanism-registry.md 列序（机制|门禁位置|触发统计口径|退役阈值|最近触发|状态|处置期限）
//   与 .agents/judgments.jsonl（check-loop 每次真实运行落账，per-rule WARN/BLOCK 计数）。
// 判定（确定性，无 LLM）：
//   ① 现役行 + 阈值形态「连续 N 月 = 0」+ 口径列含「规则名」→ 以有数据的末月为终点取 N 个日历月，缺月不算零命中，全 0 即触达 → 动作项。
//   ② 待退役行 + 处置期限为日期且已过 → 动作项（逾期）。
//   ③ 其余阈值形态（不退役主干 / 使用率型 / 数据源型）→ 非自动可判，仅计数，交人工月判。
//   缺月不算零命中（2026-10-15 源仓修正）：漏跑数月后陈旧月份不得凑成「连续」——日历窗口内有缺月即
//   交人工判，不产触达动作（与 agg-judgments --retire-candidates 的「数据月」口径互补：彼按有数据月，
//   此按日历连续）。
// 退出码恒 0（催办报告不该阻断调度器；测量失败打 [ERROR] 行）。
// 用法：node .agents/scripts/mechanism-retire-watch.mjs [--json] [--root <仓库根>] [--now <ISO 日期>]
// 测试：node .agents/scripts/mechanism-retire-watch.test.mjs（纯函数 evaluate 进程内断言）
// kit 适配（源仓→kit）：台账路径 `.agents/config/mechanism-registry.md` → kit 平铺
//   `.agents/mechanism-registry.md`（同 check-registry.mjs 检查 22 口径）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { aggFromRows } from './agg-judgments.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : ''; };
const asJson = argv.includes('--json');
const ROOT = path.resolve(argOf('--root') || path.join(SCRIPT_DIR, '..', '..'));
const NOW = argOf('--now') ? new Date(argOf('--now')) : new Date();

const REGISTRY_REL = path.join('.agents', 'mechanism-registry.md');
const LEDGER_REL = path.join('.agents', 'judgments.jsonl');

// parseRegistry(text)：7 列管道表 → 行对象数组。列序固定（check-loop §22 按此解析）。
export function parseRegistry(text) {
  const rows = [];
  for (const l of String(text).split(/\r?\n/)) {
    if (!/^\|/.test(l)) continue;
    if (/^\|[\s:|-]+\|?\s*$/.test(l)) continue; // 分隔行
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 7) continue;
    if (cells[0] === '机制') continue; // 表头
    const [name, gate, criterion, threshold, lastTrigger, status, deadline] = cells;
    rows.push({ name, gate, criterion, threshold, lastTrigger, status, deadline });
  }
  return rows;
}

// ruleNamesOf(criterion)：从「触发统计口径」列抽「」内规则名（/ 分隔）。无「」= 无法自动映射。
export function ruleNamesOf(criterion) {
  const names = [];
  for (const m of String(criterion).matchAll(/「([^」]+)」/g)) {
    for (const n of m[1].split('/')) {
      const t = n.trim();
      if (t) names.push(t);
    }
  }
  return names;
}

// zeroMonthsOf(threshold)：阈值形态「连续 N 月 = 0」→ N；否则 null（非自动可判）。
export function zeroMonthsOf(threshold) {
  const m = String(threshold).match(/连续\s*(\d+)\s*月\s*=\s*0/);
  return m ? Number(m[1]) : null;
}

// localDay(d)：本地日历日 YYYY-MM-DD。期限比较不用 UTC 零点，避免北京时 08:00 后把当天判逾期。
export function localDay(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${m}-${day}`;
}

// calendarWindow(endYm, n)：以有数据的末月为终点，向前取 n 个日历月（含终点）。
export function calendarWindow(endYm, n) {
  const [y, m] = String(endYm).split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// evaluate(registryRows, judgmentRows, now)：纯函数——产动作项。测试进程内断言。
export function evaluate(registryRows, judgmentRows, now = new Date()) {
  const { byMonth } = aggFromRows(judgmentRows || [], null);
  const months = Object.keys(byMonth).sort(); // 升序
  const actions = [];
  const notAuto = [];

  for (const r of registryRows) {
    if (r.status === '已退役') continue;

    if (r.status === '待退役') {
      const d = String(r.deadline).match(/\d{4}-\d{2}-\d{2}/);
      if (d && localDay(now) > d[0]) {
        actions.push({ kind: 'overdue', name: r.name, detail: `待退役处置期限 ${d[0]} 已过（今 ${localDay(now)}）——按台账维护纪律「退役动作」当日删代码+测试+更新本表` });
      } else if (!d) {
        actions.push({ kind: 'no-deadline', name: r.name, detail: `待退役但处置期限非日期（${r.deadline || '空'}）——补时间表或改回现役` });
      }
      continue;
    }

    // 现役
    const n = zeroMonthsOf(r.threshold);
    const rules = ruleNamesOf(r.criterion);
    if (n === null) { notAuto.push({ name: r.name, reason: '阈值形态非「连续 N 月 = 0」' }); continue; }
    if (!rules.length) { notAuto.push({ name: r.name, reason: '口径列未列规则名（无法映射 judgments）' }); continue; }
    if (months.length < n) { notAuto.push({ name: r.name, reason: `judgments 仅 ${months.length} 月 < 阈值 ${n} 月（数据不足）` }); continue; }

    // 日历连续：缺月不算零命中（漏跑数月后陈旧月份不得凑成「连续」）。
    const window = calendarWindow(months[months.length - 1], n);
    const missing = window.filter((ym) => !byMonth[ym]);
    if (missing.length) {
      notAuto.push({ name: r.name, reason: `日历窗口 ${window.join(' / ')} 缺月 ${missing.join(' / ')}（断档不算零命中）` });
      continue;
    }
    const hits = window.map((ym) => {
      const cell = byMonth[ym].rules;
      let c = 0;
      for (const rule of rules) {
        const e = cell[rule];
        if (e) c += (e.WARN || 0) + (e.BLOCK || 0);
      }
      return { ym, count: c };
    });
    const total = hits.reduce((s, h) => s + h.count, 0);
    if (total === 0) {
      actions.push({ kind: 'threshold', name: r.name, detail: `连续 ${n} 月零触发（${window.join(' / ')}；规则 ${rules.join('、')}）——阈值触达，评估退役（改状态「待退役」并填处置期限）` });
    }
  }
  return { actions, notAuto, months, monthCount: months.length };
}

function readJudgments(root) {
  const p = path.join(root, LEDGER_REL);
  if (!fs.existsSync(p)) return { rows: [], missing: true };
  const rows = [];
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* 坏行跳过，不中断 */ }
  }
  return { rows, missing: false };
}

function main() {
  const regPath = path.join(ROOT, REGISTRY_REL);
  if (!fs.existsSync(regPath)) {
    console.error(`[ERROR] mechanism-retire-watch: 台账不存在 ${REGISTRY_REL}`);
    if (asJson) console.log(JSON.stringify({ error: 'registry-missing', actions: [] }, null, 2));
    process.exit(0);
  }
  const registryRows = parseRegistry(fs.readFileSync(regPath, 'utf8'));
  const { rows: judgmentRows, missing } = readJudgments(ROOT);
  const { actions, notAuto, monthCount } = evaluate(registryRows, judgmentRows, NOW);

  if (asJson) {
    console.log(JSON.stringify({ registryRows: registryRows.length, judgmentMonths: monthCount, judgmentsMissing: missing, actions, notAuto }, null, 2));
    return;
  }

  console.log(`# 机制退役催办（${NOW.toISOString()}）`);
  console.log('');
  console.log(`台账 ${REGISTRY_REL}｜机制行 ${registryRows.length}｜judgments 月数 ${monthCount}${missing ? '（台账缺失——尚无运行记录）' : ''}`);
  console.log('');
  if (!actions.length) {
    console.log('✅ 无阈值触达 / 无逾期——本轮无动作项。');
  } else {
    console.log(`## 动作项 ${actions.length} 条`);
    for (const a of actions) console.log(`- [${a.kind}] ${a.name}：${a.detail}`);
  }
  if (notAuto.length) {
    console.log('');
    console.log(`## 非自动可判（${notAuto.length} 条，交人工月判）`);
    for (const x of notAuto) console.log(`- ${x.name}：${x.reason}`);
  }
  console.log('');
  console.log('> 处置仍人放行：改状态/删代码走人 + 一进一出（台账维护纪律）。本报告不自动改文件。');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
