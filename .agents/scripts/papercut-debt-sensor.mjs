#!/usr/bin/env node
// papercut-debt-sensor.mjs — papercut 存量债传感器（2026-10-07 papercut-debt 回路 Phase D；B10a 自
//   Shipyard.Material 回灌——判定面逐字对齐，出处沿革留痕在包源仓 git 历史与 CHANGELOG）
// 用途：测量设定点误差——workflow/papercuts.md 中未升级条目数（debt）。只读、零子进程、可重复。
// 口径单源：.agents/loop/papercut-debt/DESIGN.md §1/§2（改口径先改设计文件，本脚本只实现）。
//   未升级 = 台账数据行不含 ✅ 字面量。⏸ 暂缓 视为**未升级**（暂缓须带理由，无理由照算债）。
// 零子进程理由（实测留痕在包源仓 git 历史与 CHANGELOG）：曾有托管 Node 环境 spawnSync 对任意 exe
//   返回 EBUSY，依赖 git 历史的传感器在该环境不可用（check-loop.mjs 即因此崩过）。故本脚本只读
//   文件系统——传感器不依赖子进程比依赖更稳，且免受环境回退影响。
// CRLF：台账检出为 CRLF（全局 core.autocrlf=true），按 split(/\r?\n/) 切行，不依赖行尾格式。
// 分片感知（B8 已落 ledger-shards）：读侧走 readLedgerText(root,'papercuts')——主台账 ∪
//   papercuts.d/*.md 自动合并，无分片时等价原读法，传感器零额外逻辑。
// 用法：node .agents/scripts/papercut-debt-sensor.mjs [--json] [--root <仓库根>]
// 退出码恒 0——测量失败不该阻断回路；失败时 stderr 出 [ERROR] 行且 debt 记为 null。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLedgerText } from './ledger-shards.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : ''; };
const asJson = argv.includes('--json');
const ROOT = path.resolve(argOf('--root') || path.join(SCRIPT_DIR, '..', '..'));
const LEDGER = path.join(ROOT, 'workflow', 'papercuts.md');

// 表格列：| 日期 | 位置 | 症状 | 拟修 |  → 切分后 6 段（首尾空串）
const COLS = 4;
// 判定口径（单源，本文件）：台账表格行中含 `✅` 者计为**已消债**（真修完）。
//   `⏸ 暂缓（日期）：理由` 者计为**已定性**——债已被人读过并判失效，不再驱动回路，
//   但与 ✅ 分开计数，避免"暂缓"冒充"修完"。`⏸ 暂缓` 无理由者仍计债（迫使人真读一遍）。
const DONE = '✅';
const DEFER = '⏸';
export const DEFER_REASONED_RE = /⏸\s*暂缓（[^）]*）\s*：\s*\S/;
const DEFER_REASONED = DEFER_REASONED_RE;
// 「位置」列里抽仓库相对路径做存在性检查；只标 stale 不排除（台账记历史事实，路径改名/删除是常态）
const PATH_RE = /(?:^|[\s(（`])([.a-zA-Z0-9_][\w./-]*\/[\w./-]+)(?=[\s)）`:：,，]|$)/g;

function parseRow(line) {
  const parts = line.split('|');
  // 单元格内可能含 | （代码片段）——多于 COLS+2 段时把中间段并回症状列
  let cells;
  if (parts.length > COLS + 2) {
    const head = parts.slice(1, 3);
    const tail = parts.slice(-(COLS - 2));
    cells = [...head, parts.slice(3, parts.length - (COLS - 2)).join('|').trim(), ...tail];
  } else {
    cells = parts.slice(1, 1 + COLS).map((s) => s.trim());
  }
  while (cells.length < COLS) cells.push('');
  return { date: cells[0], location: cells[1], symptom: cells[2], proposedFix: cells[3] };
}

function detectHitCount(text) {
  // 台账约定：复发时在文本里写「第 2 次命中」「第 3 次命中」——控制器的主排序键
  let max = 1;
  for (const m of String(text).matchAll(/第\s*(\d+)\s*次命中/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function extractPaths(location) {
  const out = new Set();
  for (const m of String(location).matchAll(PATH_RE)) {
    const p = m[1].replace(/[.,;:]+$/, '');
    if (p.startsWith('.') || p.startsWith('wiki/') || p.startsWith('tmp/')) out.add(p);
  }
  return [...out];
}

// scan(root) 是控制器 import 的解析面——判定口径单源在此，控制器不复制任何判定正则。
// 「位置」列 [env] 前缀 = 环境约束类（DESIGN §1）：不进债池（scan 不返回），单列 envPending。
export function scan(root = ROOT) {
  return parseLedger(root).rows;
}

// 环境约束挂起（[env] 前缀行）：仅列未 settled 的——写 ⏸ 前提消失 / ✅ 的 env 行已清，不占任何池。
export function envPending(root = ROOT) {
  return parseLedger(root).envRows.filter((r) => !r.settled);
}

function parseLedger(root) {
 const ledger = path.join(root, 'workflow', 'papercuts.md');
 if (!fs.existsSync(ledger)) throw new Error(`台账不存在: ${ledger}`);
 // 分片感知读（B8 ledger-shards）：主台账 ∪ papercuts.d/*.md；无分片时等价原读法
 const raw = readLedgerText(root, 'papercuts');
 const lines = raw.split(/\r?\n/);
  const rows = [];
  const envRows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\|\s*20\d\d-\d\d-\d\d/.test(line)) continue; // 只取数据行（表头/分隔行/说明行自然排除）
    const c = parseRow(line);
    const resolved = line.includes(DONE);
    const deferred = line.includes(DEFER);
    const deferredReasoned = DEFER_REASONED.test(line);
    const paths = extractPaths(c.location);
    const item = {
      line: i + 1,
      date: c.date,
      location: c.location,
      symptom: c.symptom,
      proposedFix: c.proposedFix,
      hits: detectHitCount(`${c.symptom} ${c.proposedFix}`),
      resolved,
      deferred,
      deferredReasoned,
      // 「已消债」= 真修完，或已带理由判失效。驱动回路的是这个口径，不是 resolved。
      settled: resolved || deferredReasoned,
      stale: paths.length > 0 && paths.every((p) => !fs.existsSync(path.join(root, p))),
      paths,
    };
    (/^\s*`?\[env\]/.test(c.location) ? envRows : rows).push(item);
  }
  return { rows, envRows };
}

function main() {
  let rows;
  try {
    rows = scan();
  } catch (e) {
    console.error(`[ERROR] papercut-debt-sensor: ${e.message}`);
    if (asJson) console.log(JSON.stringify({ error: e.message, debt: null, total: null }, null, 2));
    return;
  }
  const resolved = rows.filter((r) => r.resolved);
  const settled = rows.filter((r) => r.settled);
  const unresolved = rows.filter((r) => !r.settled);
  const stale = unresolved.filter((r) => r.stale);
  const env = envPending();

  if (asJson) {
    console.log(JSON.stringify({
      ledger: path.relative(ROOT, LEDGER).split(path.sep).join('/'),
      total: rows.length + env.length,
      resolved: resolved.length,
      deferredReasoned: settled.filter((r) => r.deferredReasoned).length,
      settled: settled.length,
      debt: unresolved.length,
      envPending: env.map(({ line, date, location, symptom }) => ({ line, date, location, symptom })),
      stalePaths: stale.length,
      unresolved: unresolved.map(({ resolved: _r, settled: _s, ...rest }) => rest),
    }, null, 2));
    return;
  }

  console.log(`papercut 存量债 —— ${path.relative(ROOT, LEDGER).split(path.sep).join('/')}`);
  console.log(`条目 ${rows.length + env.length} · 已消债 ${settled.length}（✅ ${resolved.length} / ⏸带理由 ${settled.filter((r) => r.deferredReasoned).length}） · 未消债 ${unresolved.length}（设定点误差 = debt）`);
  if (env.length) console.log(`环境约束挂起 ${env.length} 条（[env] 前缀，不计 debt——环境变化后复测前提：消失则 ⏸，实为代码缺陷则去前缀转正）`);
  if (unresolved.length === 0) {
    console.log('✅ debt = 0，设定点已达成——无需再跑回路。');
    return;
  }
  const noReason = unresolved.filter((r) => r.deferred && !r.deferredReasoned);
  if (noReason.length) console.log(`其中 ⏸ 暂缓但无理由 ${noReason.length} 条（不算消债）`);
  if (stale.length) console.log(`其中位置列路径已不存在 ${stale.length} 条（stale——台账记历史事实，不自动排除）`);
  console.log('');
  for (const r of unresolved) {
    const flags = [r.hits > 1 ? `第${r.hits}次命中` : '', r.deferred ? '暂缓无理由' : '', r.stale ? 'stale' : ''].filter(Boolean).join(' · ');
    console.log(`  L${r.line} [${r.date}] ${r.location}${flags ? `  (${flags})` : ''}`);
  }
  console.log('');
  console.log('下一步：node .agents/scripts/papercut-debt-controller.mjs   # 选本轮目标（--dry-run 只看不改）');
}

// 仅直接执行时跑（被控制器 / 测试 import 时不自跑、不打印——控制器只取 scan()）
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('papercut-debt-sensor.mjs')) main();
