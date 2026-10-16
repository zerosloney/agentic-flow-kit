#!/usr/bin/env node
// workflow 规模与规则面月度快照（2026-09-21，intent 2026-09-21-workflow-metrics-snapshot）
// 用法：node .agents/scripts/gen-workflow-metrics.mjs [--month YYYY-MM] [--dry-run] [--help]
// 目的：把「语料膨胀 + 常驻面体积」变成可观测趋势——每月（或按需）跑一次，往 workflow/metrics.md 追加/更新一行。
// 口径：文档 = 磁盘（对照 gen-workflow-index / 看板，排除 _TEMPLATE.md）；常驻面 = `.agents/rule-budgets.txt`
//   各条实测（单源，含预算上限），括号内给「预算占用峰值项」。
//   字节口径声明（p2-batch2）：本脚本用工作区 statSync 字节（CRLF 检出态会偏高），rule-budget.mjs 用
//   索引 LF 归一字节——趋势观测可对比，但与门禁判定数值存在系统性差异，勿互相替用。
// 不做 --check / 不挂门禁：快照是历史记录——任何文档改动都会让「当前值」漂移，拿它做漂移校验只会常红；
//   规则面的机器约束由 pre-commit 的 rule-budget.mjs 负责，本脚本只负责「看见趋势」。
// 测试：node .agents/scripts/gen-workflow-metrics.test.mjs（fixture 回归，须全绿）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnums } from './workflow-enums.mjs';
import { readLedgerRows as loadLedgerRows } from './ledger-loader.mjs';
import { analyze, buildDocList, loadLastTouch, loadLedgerTs, parseStatus, ACTIVE } from './archive-sweep.mjs';

const USAGE = `用法：node .agents/scripts/gen-workflow-metrics.mjs [--month YYYY-MM] [--dry-run] [--help]

事实源：workflow/{intents,specs,plans,incidents}/*.md（排除 _TEMPLATE.md）+ workflow/INDEX.md + .agents/rule-budgets.txt
        + workflow/reviews.d/*.md（独立复核效果台账）+ workflow/specs/*.md 与 workflow/archive/*/specs/*.md（spec 体积观察）
产物：workflow/metrics.md —— 每月一行（同月重跑即更新该行，不重复追加）；明细打印在 stdout，不落表。
选项：
  --month YYYY-MM   指定月份键（默认取当前月；用于补记历史）
  --dry-run         只打印将写入的行与明细，不写盘
  --help            打印本说明`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }
const DRY = args.includes('--dry-run');
let month = '';
for (let i = 0; i < args.length; i++) if (args[i] === '--month') month = args[++i] ?? '';
const unknown = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dry-run' || a === '--help' || a === '-h') continue;
  if (a === '--month') { i++; continue; }
  unknown.push(a);
}
if (unknown.length) { console.error(`❌ 未知参数：${unknown.join(' ')}\n\n${USAGE}`); process.exit(1); }
if (!month) month = new Date().toISOString().slice(0, 7);
if (!/^\d{4}-\d{2}$/.test(month)) { console.error(`--month 须为 YYYY-MM（现 ${month || '空'}）\n\n${USAGE}`); process.exit(1); }

const WORKFLOW = 'workflow';
const METRICS_P = path.join(WORKFLOW, 'metrics.md');
const BUDGETS = path.join('.agents', 'rule-budgets.txt');
const DOC_TYPES = ['intents', 'specs', 'plans', 'incidents'];
// 活跃口径单源（workflow-enums.txt）。与脚本同层的上一级：
// 包源 templates/_agents/workflow-enums.txt，装户副本 .agents/workflow-enums.txt。
// 拷贝后相对位置不变，不按仓库根猜测另一套目录。
const ENUMS = loadEnums(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workflow-enums.txt'));
const ACTIVE_STATUS = [...ENUMS['doc.status.active'], ...ENUMS['incident.status.active']];
const BEGIN = '<!-- GENERATED:BEGIN — gen-workflow-metrics.mjs 整段重写，手工说明写在本行之前 -->';
const END = '<!-- GENERATED:END -->';

const kb = (b) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`);

// ---- 语料统计：按类型聚合文件数/字节 + 活跃终态 + 模块已填 ----
function scanDocs() {
  const perType = {};
  let files = 0;
  let bytes = 0;
  let active = 0;
  let invalid = 0;
  let withModule = 0;
  for (const type of DOC_TYPES) {
    let n = 0;
    let b = 0;
    const dir = path.join(WORKFLOW, type);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
      const p = path.join(dir, f);
      const text = fs.readFileSync(p, 'utf8');
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      let status = '';
      let mod = '';
      if (fm) {
        for (const line of fm[1].split(/\r?\n/)) {
          const kv = line.match(/^(\S+):\s*(.*)$/);
          if (!kv) continue;
          if (kv[1] === '状态') status = kv[2].trim();
          if (kv[1] === '模块') mod = kv[2].trim();
        }
      }
      if (ACTIVE_STATUS.includes(status)) active++;
      else if (!status || ![...ENUMS['doc.status.all'], ...ENUMS['incident.status.all']].includes(status)) invalid++; // 状态缺失/非法单列（board-kb-p1：不再吞进终态桶）
      if (mod) withModule++;
      n++;
      b += fs.statSync(p).size;
    }
    perType[type] = { n, b };
    files += n;
    bytes += b;
  }
  return { perType, files, bytes, active, terminal: files - active - invalid, invalid, withModule };
}

// ---- 常驻面：按预算表逐条实测（<glob|dir/> <上限>）----
// 峰值口径：逐文件条取「该文件」，glob 条取「单篇最大」，目录条取「合计」——三者不混（曾把目录合计除以单篇上限得出 548%）
function scanSurface() {
  if (!fs.existsSync(BUDGETS)) return { entries: [], total: 0, peak: null };
  const entries = [];
  for (const raw of fs.readFileSync(BUDGETS, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [pat, limRaw] = line.split(/\s+/);
    const lim = Number(limRaw);
    if (!pat || !Number.isFinite(lim)) continue;
    let sum = 0;
    let max = 0;
    let label = pat;
    if (pat.endsWith('/')) {
      const dir = pat.slice(0, -1);
      if (!fs.existsSync(dir)) { console.error(`⚠️ 预算目录不存在，跳过该条：${pat}`); continue; }
      for (const f of fs.readdirSync(dir)) sum += fs.statSync(path.join(dir, f)).size;
      max = sum;
      label = `${pat}（合计）`;
    } else if (pat.includes('*')) {
      // 词表约定 glob = 基名内单个 `*`（<前缀>*<后缀>），目录段不支持通配——与 rule-budget.mjs 的 glob 展开同口径。
      // 多 `*` / 目录段含 `*` 出词表：警告跳过，不做「只按后缀 endsWith」的放宽式匹配（2026-09-24 收口：
      // 曾按首个 * 取后缀，`pl*.md` 会误吃目录内全部 .md、`a*b` 会误吃一切 b 结尾文件）
      const stars = pat.split('*').length - 1;
      const starIdx = pat.indexOf('*');
      const lastSlash = pat.lastIndexOf('/');
      if (stars !== 1 || starIdx < lastSlash) {
        console.error(`⚠️ 预算表 glob 仅支持基名内单个 *（<前缀>*<后缀>），跳过该条：${pat}`);
        continue;
      }
      const dir = lastSlash >= 0 ? pat.slice(0, lastSlash + 1) : '.';
      const basePrefix = pat.slice(lastSlash + 1, starIdx);
      const baseSuffix = pat.slice(starIdx + 1);
      if (!fs.existsSync(dir)) { console.error(`⚠️ 预算目录不存在，跳过该条：${pat}`); continue; }
      for (const f of fs.readdirSync(dir)) {
        if (!f.startsWith(basePrefix) || !f.endsWith(baseSuffix)) continue;
        const s = fs.statSync(path.join(dir, f)).size;
        sum += s;
        if (s > max) max = s;
      }
      label = `${pat}（单篇最大）`;
    } else {
      if (!fs.existsSync(pat)) { console.error(`⚠️ 预算文件不存在，跳过该条：${pat}`); continue; }
      sum = max = fs.statSync(pat).size;
    }
    entries.push({ pat, label, sum, max, lim, pct: (max / lim) * 100, isDir: pat.endsWith('/') });
  }
  const total = entries.filter((e) => !e.isDir).reduce((n, e) => n + e.sum, 0);
  const peak = entries.slice().sort((a, b) => b.pct - a.pct)[0] || null;
  return { entries, total, peak };
}

const idxText = fs.existsSync(path.join(WORKFLOW, 'INDEX.md')) ? fs.readFileSync(path.join(WORKFLOW, 'INDEX.md'), 'utf8') : '';
const idxBytes = Buffer.byteLength(idxText, 'utf8');
const idxActive = Number((idxText.match(/^## 活跃（(\d+)）/m) || [])[1] ?? NaN);

// ---- 闭环漏斗（2026-10-02 ledger-funnel-metrics 立法）----
// 只读台账一手字段（doc/stage/ts/source），坏行跳过（与检查 15/19 同容错）；观测面不挂门禁、不新增文档断言（检查 16 零接触）。
// 台账读取收敛 ledger-loader 单源（2026-10-12 ledger-loader-p1）——口径不变（只读一手字段 doc/stage/ts/source、
// 坏行跳过，与检查 15/19 同容错）。**本步刻意保留「全量行不去重」**：去重会改漏斗 ledgerRows 计数口径，
// 属口径变更，须随分片功能同批生效，不得混入单源化本步。
function readLedgerRows() {
  return loadLedgerRows();
}

function funnelFromLedger(entries, month) {
  const byDoc = new Map();
  for (const e of entries) {
    if (typeof e.doc !== 'string' || typeof e.ts !== 'string') continue;
    if (!byDoc.has(e.doc)) byDoc.set(e.doc, []);
    byDoc.get(e.doc).push(e);
  }
  const res = { closed: 0, full: 0, legacy: 0, once: 0, rework: 0, ledgerRows: 0, days: [], items: [] };
  for (const e of entries) if (typeof e.ts === 'string' && e.ts.slice(0, 7) === month) res.ledgerRows++;
  for (const [doc, rs] of byDoc) {
    rs.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    const nonRevert = rs.filter((r) => !/^revert-/.test(String(r.stage || '')));
    const terminals = nonRevert.filter((r) => r.stage === 'done' || r.stage === 'closed');
    if (!terminals.length) continue; // 未收口件不进漏斗桶（仍计台账行数）
    const lastTerm = terminals[terminals.length - 1];
    if (String(lastTerm.ts).slice(0, 7) !== month) continue; // 月度归桶 = 终态行所在月
    // 确认阶段按件型（复核 P2-3 收口）：docs=approved；incidents=fixed（两跳确认门 fixed→closed，
    // 永无 approved 行——按 approved 判会把已走确认门的 incident 误归协议前）
    const isInc = doc.includes('/incidents/');
    const confirmStage = isInc ? 'fixed' : 'approved';
    const confirms = nonRevert.filter((r) => r.stage === confirmStage);
    const hasChain = confirms.length >= 1;
    const hasRevert = rs.some((r) => /^revert-/.test(String(r.stage || '')));
    const kind = !hasChain ? 'legacy' : (hasRevert || confirms.length >= 2 || terminals.length >= 2 ? 'rework' : 'once');
    const firstTs = hasChain ? confirms[0].ts : rs[0].ts; // 协议前件首行起算
    const days = (Date.parse(lastTerm.ts) - Date.parse(firstTs)) / 86400000;
    res.closed++;
    if (kind === 'legacy') res.legacy++;
    else { res.full++; res[kind === 'once' ? 'once' : 'rework']++; }
    if (Number.isFinite(days) && days >= 0) res.days.push(days);
    res.items.push({ doc, kind, days: Number.isFinite(days) && days >= 0 ? days.toFixed(1) : '—' });
  }
  return res;
}

const ledgerRows = readLedgerRows();
const funnel = funnelFromLedger(ledgerRows, month);
const sortedDays = [...funnel.days].sort((a, b) => a - b);
const medianDays = sortedDays.length
  ? (sortedDays.length % 2 ? sortedDays[(sortedDays.length - 1) / 2] : (sortedDays[sortedDays.length / 2 - 1] + sortedDays[sortedDays.length / 2]) / 2)
  : null;
// 中位周期渲染：**真实的极小值不得被印成 `0.0`**。建件与确认常在同一会话内完成时，真实周期可 < 0.05 天，
// `toFixed(1)` 会把它印成 `0.0`——读者无法区分「真实的亚小时周期」与「口径失效」。
// 修法（最小）：仅当四舍五入会得到 `0.0` 且值 > 0 时改写 `<0.1`；null 写 `—`；恰好为 0 仍写 `0.0`。
function fmtMedianDays(v) {
  if (v == null) return '—';
  const s = v.toFixed(1);
  return s === '0.0' && v > 0 ? '<0.1' : s;
}
const funnelRow = `| ${month} | ${funnel.closed} | ${funnel.full} | ${funnel.legacy} | ${funnel.once} | ${funnel.rework} | ${fmtMedianDays(medianDays)} | ${funnel.ledgerRows} |`;

const docs = scanDocs();
const surf = scanSurface();
const row = `| ${month} | ${docs.files}（活跃 ${docs.active} / 终态 ${docs.terminal}） | ${kb(docs.bytes)} | ${docs.withModule}/${docs.files} | ${kb(surf.total)}（峰值 ${surf.peak ? `${surf.peak.pct.toFixed(1)}% ${surf.peak.label}` : '—'}） | ${kb(idxBytes)}（${Number.isNaN(idxActive) ? '—' : idxActive} 行） |`;

// ---- 复核效果（独立复核效果台账）：workflow/reviews.d/ 意见级处置分片按月聚合 ----
// 口径：一行 = 一次独立复核事件；自洽不变式 = 采纳+拒绝+误报 = 意见数。台账是「门禁制造返工 vs 拦下问题」
// 的意见级信号源，脏行比缺行更有害——字段非法 / 自洽破坏一律 throw（文案点名分片与行），不做静默跳过
// （同本脚本 fail-loud 纪律）。目录不存在 = 合法零数据（机制先于数据建账，出占位行）。
function scanReviews() {
  const dir = path.join(WORKFLOW, 'reviews.d');
  if (!fs.existsSync(dir)) return {};
  const byMonth = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const p = path.join(dir, f);
    let text;
    try {
      text = fs.readFileSync(p, 'utf8');
    } catch (e) {
      throw new Error(`复核效果台账分片不可读：${p}（${e.message}）——坏分片不静默跳过`);
    }
    for (const line of text.split(/\r?\n/)) {
      if (!/^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(line)) continue; // 表头/分隔线/注记行跳过
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      const bad = cells.length < 8 || [3, 4, 5, 6].some((i) => !/^\d+$/.test(cells[i]));
      if (bad) throw new Error(`复核效果台账行字段非法（8 列起，意见数/采纳/拒绝/误报须为非负整数）：${p}\n  行：${line.trim()}`);
      const [total, adopted, rejected, misreport] = [3, 4, 5, 6].map((i) => Number(cells[i]));
      if (adopted + rejected + misreport !== total) {
        throw new Error(`复核效果台账自洽破坏（采纳 ${adopted} + 拒绝 ${rejected} + 误报 ${misreport} = ${adopted + rejected + misreport} ≠ 意见数 ${total}）：${p}\n  行：${line.trim()}`);
      }
      const b = (byMonth[cells[0].slice(0, 7)] ||= { events: 0, total: 0, adopted: 0, rejected: 0, misreport: 0 });
      b.events++;
      b.total += total;
      b.adopted += adopted;
      b.rejected += rejected;
      b.misreport += misreport;
    }
  }
  return byMonth;
}
const reviews = scanReviews();
// 复核效果表头（第三表）。源 = workflow/reviews.d/ 意见级处置分片（一行 = 一次独立复核事件，
// 采纳+拒绝+误报 = 意见数），整表确定性再生、历史行不落盘保留；区分「门禁制造返工 vs 拦下问题」。
// 声明须在 DRY 出口之前（--dry-run 也打印该表）。
const REVIEW_HEAD = [
  '## 复核效果（源：workflow/reviews.d/ 意见级处置台账；存量未建账期无数据）',
  '',
  '| 月份 | 复核事件 | 意见数 | 采纳 | 拒绝 | 误报 | 采纳率 | 误报率 |',
  '|---|---|---|---|---|---|---|---|',
];
// 整表由分片确定性再生（历史行不落盘保留，分片即真源）；率列 = 采纳（误报）÷ 意见数，意见数为 0 写 —。
const reviewRows = Object.keys(reviews).sort().map((ym) => {
  const b = reviews[ym];
  const rate = (n) => (b.total ? `${((n / b.total) * 100).toFixed(0)}%` : '—');
  return `| ${ym} | ${b.events} | ${b.total} | ${b.adopted} | ${b.rejected} | ${b.misreport} | ${rate(b.adopted)} | ${rate(b.misreport)} |`;
});
if (!reviewRows.length) reviewRows.push('| （无记录） | 0 | 0 | 0 | 0 | — | — |'); // 零数据占位——表始终输出，机制可见

// ---- spec 体积观察（spec 生命周期口径）：活跃 specs + 归档 specs 分开统计，先观察后设限 ----
// advisory 上限显式延后（先让体积可见）：本表只出数、不判限。
// 口径：份数 = .md 数（排除 _TEMPLATE.md，与 scanDocs 一致）；行数 = 换行数（尾换行不生幻影行，对齐 wc -l）；
//   验收条数 = `- [ ]`/`- [x]` checkbox 行总数（不区分勾选）；中位 = 升序取中，偶数取中间两数均值（可为 x.5）；
//   归档 = workflow/archive/<月>/specs/ 各月合并。目录不存在 = 合法（该行出全 0，不报错）。
const medianOf = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
function collectSpecMetrics(dir) {
  if (!fs.existsSync(dir)) return null;
  const lines = [];
  const checks = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const ls = text.split(/\r?\n/);
    if (ls[ls.length - 1] === '') ls.pop();
    lines.push(ls.length);
    checks.push((text.match(/^\s*- \[( |x)\]/gm) || []).length);
  }
  return { lines, checks };
}
const specStats = (m) => (m ? {
  n: m.lines.length,
  medLines: medianOf(m.lines),
  maxLines: m.lines.length ? Math.max(...m.lines) : 0,
  medChecks: medianOf(m.checks),
  maxChecks: m.checks.length ? Math.max(...m.checks) : 0,
} : null);
const specActiveStats = specStats(collectSpecMetrics(path.join(WORKFLOW, 'specs')));
const specArchiveMetrics = { lines: [], checks: [] };
const archiveRoot = path.join(WORKFLOW, 'archive');
if (fs.existsSync(archiveRoot)) {
  for (const ent of fs.readdirSync(archiveRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const sub = collectSpecMetrics(path.join(archiveRoot, ent.name, 'specs'));
    if (sub) {
      specArchiveMetrics.lines.push(...sub.lines);
      specArchiveMetrics.checks.push(...sub.checks);
    }
  }
}
const specArchiveStats = specStats(specArchiveMetrics);
const fmtSpecNum = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const specRow = (label, st) => st
  ? `| ${label} | ${st.n} | ${fmtSpecNum(st.medLines)} | ${st.maxLines} | ${fmtSpecNum(st.medChecks)} | ${st.maxChecks} |`
  : `| ${label} | 0 | 0 | 0 | 0 | 0 |`;
// spec 体积表头（第四表。先观察后设限：advisory 上限延后、不设门——口径单源 = workflow/README.md
// 「spec 生命周期口径」条目）。整表每次确定性再生。
const SPEC_HEAD = [
  '## spec 体积观察（源：specs 活跃+归档全量扫描；advisory 上限延后——口径见 workflow/README.md「spec 生命周期口径」）',
  '',
  '| 范围 | 份数 | 行数中位 | 行数最大 | 验收条数中位 | 验收条数最大 |',
  '|---|---|---|---|---|---|',
];
const specRows = [specRow('活跃', specActiveStats), specRow('归档', specArchiveStats)];


// ---- 明细（stdout，不落表）：类型分布 + 逐条预算占用 ----
console.log(`📅 ${month} 快照`);
console.log(`  文档：${docs.files} 篇 / ${kb(docs.bytes)}（活跃 ${docs.active} / 终态 ${docs.terminal}${docs.invalid ? ` / 状态缺失或非法 ${docs.invalid}` : ''}）；模块已填 ${docs.withModule}/${docs.files}`);
for (const [t, v] of Object.entries(docs.perType)) console.log(`    ${t.padEnd(10)} ${String(v.n).padStart(3)} 篇 / ${kb(v.b)}`);
console.log(`  索引：workflow/INDEX.md ${kb(idxBytes)}（活跃 ${Number.isNaN(idxActive) ? '—' : idxActive} 行）`);
for (const e of surf.entries) console.log(`    ${e.label.padEnd(44)} ${String(e.max).padStart(6)} / ${String(e.lim).padStart(6)} B（${e.pct.toFixed(1)}%）`);
console.log(`  常驻面合计：${kb(surf.total)}`);
console.log(`  闭环漏斗：收口 ${funnel.closed}（完整链 ${funnel.full} = 一次通过 ${funnel.once} + 返工 ${funnel.rework}；协议前 ${funnel.legacy}）｜中位周期 ${fmtMedianDays(medianDays)} 天｜台账行 ${funnel.ledgerRows}`);
for (const it of funnel.items) console.log(`    ${String(it.doc).padEnd(58)} ${it.kind.padEnd(7)} ${it.days} 天`);
if (funnel.items.length) console.log('  ℹ️ 机器口径可与 workflow/delegations.md 自做表的人工自报交叉对照（差异即信号，不对账）');
// 归档积压提醒（2026-10-15 减重手段⑥ 自源仓回灌，回路别等人喊）：滚动归档已随确认门自动跑
// （confirm-doc archive-on-close），历史积压走 archive-sweep 手工批次——月度 stdout 报候选数使积压可见。
// 判定单源 = archive-sweep.analyze（21 天窗，禁第二套口径）；analyze/loadLastTouch 抛错（如
// 浅克隆无 git 历史）fail-open 静默——观测提醒不挡快照。
try {
  const allDocs = buildDocList(process.cwd());
  const arch = analyze({
    docs: allDocs,
    ledgerTs: loadLedgerTs(process.cwd()),
    lastTouch: loadLastTouch(process.cwd()),
    activeTexts: allDocs.filter((d) => ACTIVE.has(parseStatus(d.text))).map((d) => d.text),
    windowDays: 21,
  });
  const fams = new Set(arch.candidates.map((x) => x.file));
  console.log(`  归档积压：候选 ${arch.candidates.length} 篇 / ${fams.size} 族（21 天窗）${arch.candidates.length ? '——node .agents/scripts/archive-sweep.mjs 查看，--execute 执行' : ''}`);
} catch { /* fail-open */ }
console.log(`  ${DRY ? '（--dry-run，未写盘）' : ''}`);

if (DRY) {
  console.log(`\n将写入行：\n${row}\n${funnelRow}`);
  console.log(`\n复核效果表（整表再生）：\n${[...REVIEW_HEAD, ...reviewRows].join('\n')}`);
  console.log(`\nspec 体积观察表（整表再生）：\n${[...SPEC_HEAD, ...specRows].join('\n')}`);
  process.exit(0);
}

// ---- 组装：GENERATED 区内的月表按月份键 upsert（同月重跑覆盖，行序按月升序）----
const HEADER = `# workflow 规模与规则面月度快照

> 生成器 \`node .agents/scripts/gen-workflow-metrics.mjs\`（每月或有需要时跑；同月重跑即更新该行）。明细（类型分布 / 逐条预算占用）看脚本 stdout，不落表。
> 口径：文档 = 磁盘（排除 \`_TEMPLATE.md\`）；常驻面 = \`.agents/rule-budgets.txt\` 逐条实测，括号内为「预算占用峰值项」。
`;
const TABLE_HEAD = [
  '| 月份 | 文档（活跃/终态） | 文档字节 | 模块已填/总 | 常驻面字节（预算峰值） | INDEX（活跃行） |',
  '|---|---|---|---|---|---|',
];
// 漏斗表头（第二表）。中位渲染契约：取不到写 —；恰好 0 写 0.0；四舍五入会得 0.0 的真实极小值写 <0.1
//（建件与确认常在同会话内完成时该列常态即亚小时级，勿读作口径失效）。
const FUNNEL_HEAD = [
  '## 闭环漏斗（机器口径，源：.agents/confirmations.jsonl。中位周期 = 该文件首次进入 git 到终态确认；取不到写 —，不写 0.0；真实极小值写 <0.1）',
  '',
  '| 月份 | 收口 | 完整链 | 协议前 | 一次通过 | 返工件 | 中位周期(天) | 台账行数 |',
  '|---|---|---|---|---|---|---|---|',
];
const existing = fs.existsSync(METRICS_P) ? fs.readFileSync(METRICS_P, 'utf8') : '';
let rows = [];
let funnelRows = [];
if (existing.includes(BEGIN) && existing.includes(END)) {
  const section = existing.slice(existing.indexOf(BEGIN), existing.indexOf(END));
  // 分段标记用短语而非表头全文——表头措辞会随口径演进，回吸判据须与之解耦（旧文件的旧表头也能正确分段）
  const funnelMarker = '## 闭环漏斗';
  const reviewMarker = '## 复核效果'; // 复核行同为 `| YYYY-MM |` 形态，不切出会被误吸进漏斗行
  const bodyPart = section.includes(funnelMarker) ? section.slice(0, section.indexOf(funnelMarker)) : section;
  const restPart = section.includes(funnelMarker) ? section.slice(section.indexOf(funnelMarker)) : '';
  const funnelPart = restPart.includes(reviewMarker) ? restPart.slice(0, restPart.indexOf(reviewMarker)) : restPart;
  rows = bodyPart.split(/\r?\n/).filter((l) => /^\|\s*\d{4}-\d{2}\s*\|/.test(l));
  funnelRows = funnelPart.split(/\r?\n/).filter((l) => /^\|\s*\d{4}-\d{2}\s*\|/.test(l));
}
rows = rows.filter((l) => !l.startsWith(`| ${month} `));
rows.push(row);
rows.sort((a, b) => a.slice(2, 9).localeCompare(b.slice(2, 9)));
funnelRows = funnelRows.filter((l) => !l.startsWith(`| ${month} `));
funnelRows.push(funnelRow);
funnelRows.sort((a, b) => a.slice(2, 9).localeCompare(b.slice(2, 9)));
const inner = `${BEGIN}\n\n${[...TABLE_HEAD, ...rows].join('\n')}\n\n${[...FUNNEL_HEAD, ...funnelRows].join('\n')}\n\n${[...REVIEW_HEAD, ...reviewRows].join('\n')}\n\n${[...SPEC_HEAD, ...specRows].join('\n')}\n\n${END}`;
let out;
if (existing.includes(BEGIN) && existing.includes(END)) {
  out = existing.slice(0, existing.indexOf(BEGIN)) + inner + existing.slice(existing.indexOf(END) + END.length);
} else {
  out = (existing ? existing.replace(/\s*$/, '') + '\n\n' : HEADER) + inner + '\n';
}

// ---- 趋势序列 + 确认负担（2026-10-09 engine-quality-round3 W4）----
// ① 确认负担：本月 confirmations.jsonl 行数（stage=void 除外）与上月比（口径：每次 confirm-doc 调用
//    落一行——「确认门调用次数」即确认负担的机器事实；void 为作废标记不计）。
// ② 趋势序列：.agents/cache/metrics-history.jsonl 每日一行幂等（同日重跑覆盖）——metrics.md「趋势」
//    行对比昨日 docsTotal/confirmCalls；history 损坏重建（fail-open）。
const HISTORY_P = path.join('.agents', 'cache', 'metrics-history.jsonl');
const voidExcluded = ledgerRows.filter((e) => e.stage !== 'void');
const monthOf = (e) => (typeof e.ts === 'string' ? e.ts.slice(0, 7) : '');
const thisMonth = month.slice(0, 7); // month 变量 = 生成锚月（YYYY-MM）
const prevMonthDate = new Date(thisMonth + '-01T00:00:00Z');
prevMonthDate.setUTCMonth(prevMonthDate.getUTCMonth() - 1);
const prevMonth = prevMonthDate.toISOString().slice(0, 7);
const confirmThis = voidExcluded.filter((e) => monthOf(e) === thisMonth).length;
const confirmPrev = voidExcluded.filter((e) => monthOf(e) === prevMonth).length;
const confirmDelta = confirmPrev > 0 ? Math.round(((confirmThis - confirmPrev) / confirmPrev) * 100) : null;

// docsTotal：metrics 主表本月行的文档数列（第一数值列）——从 row 提取，避免重复统计逻辑
const docsTotal = docs.files; // 直取作用域变量（正则提取曾因「287（活跃…）」复合列失配——round3 实测修正）

// history 读写（fail-open：损坏重建）
let history = [];
try {
  if (fs.existsSync(HISTORY_P)) {
    history = fs.readFileSync(HISTORY_P, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
} catch { history = []; }
const today = new Date().toISOString().slice(0, 10);
history = history.filter((h) => h && h.date !== today); // 同日幂等：覆盖当日行
history.push({ date: today, docsTotal, passRate: funnel.closed ? Math.round((funnel.once / funnel.closed) * 100) + '%' : '', confirmCalls: confirmThis, savedAt: new Date().toISOString() });
try {
  fs.mkdirSync(path.dirname(HISTORY_P), { recursive: true });
  const tmpH = HISTORY_P + '.tmp';
  fs.writeFileSync(tmpH, history.map((h) => JSON.stringify(h)).join('\n') + '\n');
  fs.renameSync(tmpH, HISTORY_P);
} catch { /* history 写失败不影响 metrics.md 主产物 */ }

// 趋势行（对比昨日快照）
const yesterday = history.filter((h) => h.date !== today).slice(-1)[0];
const trendParts = [];
if (yesterday) {
  trendParts.push('docs ' + docsTotal + '（昨日 ' + (yesterday.docsTotal ?? '?') + '）');
  trendParts.push('确认调用 ' + confirmThis + '（昨日 ' + (yesterday.confirmCalls ?? '?') + '）');
} else {
  trendParts.push('无前值（history 首日）');
}
const trendLine = '> 趋势（环比昨日）：' + trendParts.join('；') + '；确认调用本月 ' + confirmThis + ' 次（上月 ' + confirmPrev + ' 次' + (confirmDelta === null ? '' : '，' + (confirmDelta >= 0 ? '+' : '') + confirmDelta + '%') + '；void 不计）';

// 注入「闭环漏斗」节尾（inner 的 FUNNEL 段之后、END 之前）

fs.writeFileSync(METRICS_P, out.replace(END, trendLine + '\n\n' + END), 'utf8');
console.log(`✅ 已更新 workflow/metrics.md（${month} 行；共 ${rows.length} 个月）`);
