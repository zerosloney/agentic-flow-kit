#!/usr/bin/env node
// agg-kb-usage — 笔记层置信度衰减聚合（2026-11-11，对照 Anthropic《The components of agent memory》Dreaming「记忆负债」）
// 定位：把 kb-search 的命中遥测（.agents/cache/kb-usage.jsonl）聚合成「冷数据候选」——
//   对 workflow/wiki 文档做「访问/命中 + 内容更新」双维度置信度衰减筛查。只做机械筛查与候选输出，
//   裁决由主智能体/用户执行（归档 archive-sweep / 更新 wiki 技能 / 删除须用户单独指令）。
// 用法：
//   flow-kit run agg-kb-usage.mjs                      # 默认：3 个数据月起步、90 天未命中且未更新
//   flow-kit run agg-kb-usage.mjs --months 6           # 数据月下限（有遥测行的自然月数）
//   flow-kit run agg-kb-usage.mjs --stale-days 180     # 冷数据阈值（天）
// 口径：
//   - 「有数据月」= 遥测文件出现过的自然月；有数据月 < --months → 数据不充分，不产候选
//     （年轻遥测不得制造假候选，与 agg-judgments --retire-candidates 同口径）
//   - 候选 = lastHitDays > stale-days 且 lastTouchDays > stale-days（阈值天数内既未被 kb-search 命中、内容也未更新）
//   - lastTouch 用 git log -1 --format=%cI（cwd=仓库根），无提交记录回退文件 mtime
//   - 扫描范围：workflow 四目录活跃态文档（排除 _TEMPLATE.md，状态单源 workflow-enums.mjs）+ wiki 递归
//     （排除 drafts-archive/、INDEX.md、知识沉淀总览.html、*.visual-check.*、>180KB bulk 文件）
//   - 遥测文件在 .agents/cache/（gitignore），本脚本只读不写；退出码 0 正常（含数据不充分）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ENUMS } from './workflow-enums.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOW_KIT_PROJECT_ROOT || process.env.CHECK_LOOP_ROOT || path.resolve(SCRIPT_DIR, '..', '..');
const CACHE_DIR = path.join(ROOT, '.agents', 'cache');
const TELEMETRY_FILE = path.join(CACHE_DIR, 'kb-usage.jsonl');

const ACTIVE_STATUS = new Set([...ENUMS['doc.status.active'], ...ENUMS['incident.status.active']]);
const DAY_MS = 86400000;
const WORKFLOW_TYPES = ['plans', 'specs', 'intents', 'incidents'];
const WIKI_EXTS = /\.(md|sql|html|txt)$/i;
const WIKI_MAX_KB = 180;

// ---------- 参数 ----------
const args = process.argv.slice(2);
let minMonths = 3;
let staleDays = 90;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--months') minMonths = Number.parseInt(args[++i] ?? '', 10);
  else if (a === '--stale-days') staleDays = Number.parseInt(args[++i] ?? '', 10);
  else if (a === '--help') {
    console.log(`用法: flow-kit run agg-kb-usage.mjs [--months N] [--stale-days N]
  --months N        有数据月下限（默认 3）——遥测月数不足不产候选
  --stale-days N    冷数据阈值（默认 90）：最近 N 天既未被命中、内容也未更新 → 候选`);
    process.exit(0);
  } else {
    console.error(`未知选项: ${a}`);
    process.exit(2);
  }
}
if (!Number.isInteger(minMonths) || minMonths < 1) {
  console.error('--months 须为正整数');
  process.exit(2);
}
if (!Number.isInteger(staleDays) || staleDays < 1) {
  console.error('--stale-days 须为正整数');
  process.exit(2);
}

const now = Date.now();

// ---------- 读遥测 ----------
const rows = [];
if (fs.existsSync(TELEMETRY_FILE)) {
  const raw = fs.readFileSync(TELEMETRY_FILE, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r.ts === 'string' && Array.isArray(r.docs)) rows.push(r);
    } catch { /* 坏行跳过 */ }
  }
}

const dataMonths = new Set(rows.map((r) => r.ts.slice(0, 7)));
if (dataMonths.size < minMonths) {
  console.log(`agg-kb-usage: 遥测数据月仅 ${dataMonths.size} 个（下限 ${minMonths}）——数据不充分，不产冷数据候选。继续积累运行记录。`);
  process.exit(0);
}

// ---------- 每文档命中聚合 ----------
// doc -> { lastHit: ms, months: Set<YYYY-MM> }
const hitByDoc = new Map();
for (const r of rows) {
  const ym = r.ts.slice(0, 7);
  const hitMs = new Date(r.ts).getTime();
  if (Number.isNaN(hitMs)) continue;
  for (const d of r.docs) {
    if (typeof d !== 'string' || !d) continue;
    const norm = d.replace(/\\/g, '/');
    if (!hitByDoc.has(norm)) hitByDoc.set(norm, { lastHit: hitMs, months: new Set() });
    const cell = hitByDoc.get(norm);
    if (hitMs > cell.lastHit) cell.lastHit = hitMs;
    cell.months.add(ym);
  }
}

// ---------- 工具 ----------
function lastTouch(relPath) {
  const r = spawnSync('git', ['log', '-1', '--format=%cI', '--', relPath], { encoding: 'utf8', cwd: ROOT, windowsHide: true });
  const iso = r.status === 0 ? (r.stdout || '').trim() : '';
  if (iso) {
    const ms = Date.parse(iso);
    if (!Number.isNaN(ms)) return ms;
  }
  // 回退：文件 mtime（未提交文件 git log 无输出）
  try {
    return fs.statSync(path.join(ROOT, relPath)).mtimeMs;
  } catch {
    return null;
  }
}

function parseStatus(relPath) {
  try {
    const head = fs.readFileSync(path.join(ROOT, relPath), 'utf8').slice(0, 2000);
    const m = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return '';
    const sm = m[1].match(/^status:\s*(.+)$/m);
    return sm ? sm[1].trim() : '';
  } catch {
    return '';
  }
}

// ---------- 扫描候选 ----------
const candidates = [];
let scanned = 0;

const consider = (relPath) => {
  scanned += 1;
  const hit = hitByDoc.get(relPath);
  const lastHitMs = hit ? hit.lastHit : null;
  const lastHitDays = lastHitMs == null ? Infinity : (now - lastHitMs) / DAY_MS;
  const touchMs = lastTouch(relPath);
  const lastTouchDays = touchMs == null ? Infinity : (now - touchMs) / DAY_MS;
  if (lastHitDays > staleDays && lastTouchDays > staleDays) {
    candidates.push({
      doc: relPath,
      lastHit: lastHitMs == null ? '—' : new Date(lastHitMs).toISOString().slice(0, 10),
      lastTouch: touchMs == null ? '—' : new Date(touchMs).toISOString().slice(0, 10),
      hitMonths: hit ? hit.months.size : 0,
    });
  }
};

// workflow 四目录：直下 .md，排除 _TEMPLATE.md，frontmatter 状态须在活跃枚举内
for (const type of WORKFLOW_TYPES) {
  const dir = path.join(ROOT, 'workflow', type);
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch { continue; }
  for (const f of entries.sort()) {
    if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
    const rel = `workflow/${type}/${f}`;
    if (!ACTIVE_STATUS.has(parseStatus(rel))) continue;
    consider(rel);
  }
}

// wiki 递归：排除 drafts-archive/、INDEX.md、知识沉淀总览.html、*.visual-check.*、>180KB
const walkWiki = (dir) => {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch { return; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === 'drafts-archive') continue;
    const abs = path.join(dir, e.name);
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (e.isDirectory()) { walkWiki(abs); continue; }
    if (!WIKI_EXTS.test(e.name)) continue;
    if (e.name === 'INDEX.md' || e.name === '知识沉淀总览.html') continue;
    if (/\.visual-check\./.test(e.name)) continue;
    try {
      if (fs.statSync(abs).size / 1024 > WIKI_MAX_KB) continue;
    } catch { continue; }
    consider(rel);
  }
};
walkWiki(path.join(ROOT, 'wiki'));

// ---------- 输出 ----------
candidates.sort((a, b) => a.doc.localeCompare(b.doc));
console.log(`冷数据候选（${staleDays} 天未命中且未更新）——仅机械筛查，裁决走主智能体/用户（归档/更新/删除须用户指令）：`);
if (candidates.length === 0) {
  console.log('  无');
} else {
  for (const c of candidates) {
    console.log(`  ${c.doc}  末次命中 ${c.lastHit}  末次更新 ${c.lastTouch}  命中月数 ${c.hitMonths}`);
  }
}
console.log(`（扫描 ${scanned} 份 workflow/wiki 文档，候选 ${candidates.length} 份）`);