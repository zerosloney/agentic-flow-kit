#!/usr/bin/env node
// papercut-debt-controller.mjs — 回路控制器（2026-10-07 papercut-debt 回路 Phase D；B10a 自
//   Shipyard.Material 回灌——排序键与 scope gate 逐字对齐，出处沿革留痕在包源仓 git 历史与 CHANGELOG）
// 用途：把传感器的测量变成"本轮修哪一条"。确定性选取，无随机、无 LLM 判断。
// 口径单源：.agents/loop/papercut-debt/DESIGN.md §3（改排序键先改设计文件）。
// 排序键（依次比较）：① 命中次数降序（台账文件头自身规则：第 2 次命中须升级为 docs 修复）
//                ② 日期降序（近期痛点更可能仍成立）      ③ 原行序升序（完全平手时保可复现）
// Scope gate：拟修明确指向 backend/ frontend/ tests/ wiki/ sqlcmd/ db_tool，或含 数据库/DDL/DROP 字样的条目本轮跳过
//   （执行器边界＝文档面，见 DESIGN §4）。跳过的条目照列，供人工决定是否单独授权。
// 单轮只取 1 条：独立复核有成本（L2/L3 须独立复核），一次给 3 条审不动。
// 用法：node .agents/scripts/papercut-debt-controller.mjs [--json] [--top <n>] [--root <仓库根>]
// 退出码：0 正常（含"无目标"与"全部被 scope gate 拦"）；2 = 测量不可用（debt 未知）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : ''; };
const asJson = argv.includes('--json');
const TOP = Math.max(1, Number(argOf('--top')) || 3);
const ROOT = path.resolve(argOf('--root') || path.join(SCRIPT_DIR, '..', '..'));

// Scope gate 关键词：命中即视为「要改源码 / 连库」，超出文档面授权
const OUT_OF_SCOPE = /(^|[^\w/])(backend|frontend|tests|wiki)\/|sqlcmd|db_tool\.py|数据库|DDL|\bDROP\b/i;
// 「同上 X」承接上一行的路径，无法独立判定存在性——需人读后定性，不作为自动目标
const STALE_RE = /^同上两处|^同上/;

// 口径单源在传感器（settled = ✅ 或 ⏸带理由；stale 判定也在传感器）。
//   本脚本刻意**不复制**任何判定正则，而是 import 传感器复用其扫描面——两处各判一次必然漂移
//   （首轮实证：传感器按 ✅ 判债、控制器也按 ✅ 选目标，⏸ 暂缓条目被反复选中导致空转——
//   留痕在包源仓 git 历史与 CHANGELOG）。
//   传感器 main() 仅在直接执行时运行，import 时只导出 scan()。
import { scan as sensorScan } from './papercut-debt-sensor.mjs';

function measure() {
  const ledger = path.join(ROOT, 'workflow', 'papercuts.md');
  if (!fs.existsSync(ledger)) throw new Error(`台账不存在: ${ledger}`);
  // 复用传感器解析面（含 ✅ / ⏸带理由 / 命中次数 / stale 判定），此处只做排序与 scope gate。
  const rows = sensorScan(ROOT).map((r) => ({
    ...r,
    // scope gate 需读全文：location + proposedFix（拟修列可能含管道符，传感器已并回）
    fullText: `${r.location} ${r.proposedFix}`,
  }));
  return { ledger, rows };
}

function rank(a, b) {
  if (a.hits !== b.hits) return b.hits - a.hits;
  if (a.date !== b.date) return a.date < b.date ? 1 : -1; // 日期降序
  return a.line - b.line;                                   // 原行序升序
}

function gateReason(r) {
  const m = r.fullText.match(OUT_OF_SCOPE);
  if (!m) return null;
  return `拟修触及源码/数据库面（命中「${(m[2] || m[1] || m[0]).trim()}」）`;
}

function main() {
  let m;
  try {
    m = measure();
  } catch (e) {
    console.error(`[ERROR] papercut-debt-controller: 测量不可用——${e.message}`);
    if (asJson) console.log(JSON.stringify({ error: e.message, target: null }, null, 2));
    process.exit(2);
  }

  const unresolved = m.rows.filter((r) => !r.settled);
  const debt = unresolved.length;
  const inScope = [];
  const skipped = [];
  const needsHuman = [];
  for (const r of unresolved) {
    const why = gateReason(r);
    if (why) { skipped.push({ ...r, skipReason: why }); continue; }
    // stale 与「同上 X」承接行：需要人读后定性（已失效 / 或需重定位），不作为自动修复目标
    const isStale = r.stale;
    const isDangling = STALE_RE.test(r.location);
    if (isStale || isDangling) {
      needsHuman.push({ ...r, needReason: isStale ? '位置列路径已不存在，需确认是否已失效' : '「同上」承接行，路径需从上条解析后才能判定' });
      continue;
    }
    inScope.push(r);
  }
  inScope.sort(rank);
  const target = inScope[0] || null;
  const queue = inScope.slice(0, TOP);

  if (asJson) {
    console.log(JSON.stringify({
      ledger: path.relative(ROOT, m.ledger).split(path.sep).join('/'),
      debt, total: m.rows.length,
      target, queue,
      skippedOutOfScope: skipped,
      needsHuman,
      achieved: debt === 0,
    }, null, 2));
    return;
  }

  console.log(`控制器 —— debt ${debt} · 在选 ${inScope.length} · scope-gate 拦下 ${skipped.length} · 待人工定性 ${needsHuman.length}`);
  if (debt === 0) {
    console.log('✅ debt = 0，设定点已达成——本轮无目标，执行器不应动手。');
    return;
  }
  if (!target) {
    console.log('⚠️ 所有未升级条目均被 scope gate 拦下（执行器边界＝文档面）——需人工决定是否单独授权。');
    for (const s of skipped) console.log(`  L${s.line} [${s.date}] ${s.location} —— ${s.skipReason}`);
    return;
  }

  console.log('');
  console.log('本轮目标（top-1）:');
  console.log(`  行号      L${target.line}（workflow/papercuts.md）`);
  console.log(`  日期      ${target.date}`);
  console.log(`  命中次数  ${target.hits}`);
  console.log(`  位置      ${target.location}`);
  console.log(`  症状      ${target.symptom.slice(0, 200)}${target.symptom.length > 200 ? '…' : ''}`);
  console.log(`  拟修      ${target.proposedFix.slice(0, 300)}${target.proposedFix.length > 300 ? '…' : ''}`);
  console.log('');
  console.log(`后续候选（本轮不做，供你改指令时直接点名）:`);
  for (const q of queue.slice(1)) {
    console.log(`  L${q.line} [${q.date}] hits=${q.hits} ${q.location}`);
  }
  if (skipped.length) {
    console.log('');
    console.log('已按 scope gate 跳过（要改源码/连库，需你单独授权）:');
    for (const s of skipped) console.log(`  L${s.line} [${s.date}] ${s.location} —— ${s.skipReason}`);
  }
  if (needsHuman.length) {
    console.log('');
    console.log('待人工定性（不作为自动目标——请读后定性：判失效则标 ⏸ 暂缓+理由，判仍成立则补出可执行拟修）:');
    for (const h of needsHuman) console.log(`  L${h.line} [${h.date}] ${h.location} —— ${h.needReason}`);
  }
  console.log('');
  console.log('下一步：按 .agents/skills/papercut-fix/SKILL.md 执行（改完跑验证门，debt 应恰好 -1）。');
}

main();
