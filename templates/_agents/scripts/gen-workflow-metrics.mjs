#!/usr/bin/env node
// workflow 规模与规则面月度快照（2026-09-21，intent 2026-09-21-workflow-metrics-snapshot）
// 用法：node .agents/scripts/gen-workflow-metrics.mjs [--month YYYY-MM] [--dry-run] [--help]
// 目的：把「语料膨胀 + 常驻面体积」变成可观测趋势——每月（或按需）跑一次，往 workflow/metrics.md 追加/更新一行。
// 口径：文档 = 磁盘（对照 gen-workflow-index / 看板，排除 _TEMPLATE.md）；常驻面 = `.agents/rule-budgets.txt`
//   各条实测（单源，含预算上限），括号内给「预算占用峰值项」。
//   字节口径声明（p2-batch2）：本脚本用工作区 statSync 字节（CRLF 检出态会偏高），rule-budget.sh 用
//   索引 LF 归一字节——趋势观测可对比，但与门禁判定数值存在系统性差异，勿互相替用。
// 不做 --check / 不挂门禁：快照是历史记录——任何文档改动都会让「当前值」漂移，拿它做漂移校验只会常红；
//   规则面的机器约束由 pre-commit 的 rule-budget.sh 负责，本脚本只负责「看见趋势」。
// 测试：node .agents/scripts/gen-workflow-metrics.test.mjs（fixture 回归，须全绿）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnums } from './workflow-enums.mjs';

const USAGE = `用法：node .agents/scripts/gen-workflow-metrics.mjs [--month YYYY-MM] [--dry-run] [--help]

事实源：workflow/{intents,specs,plans,incidents}/*.md（排除 _TEMPLATE.md）+ workflow/INDEX.md + .agents/rule-budgets.txt
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
// 活跃口径单源（board-kb-p1：枚举字面量硬编码退役——workflow-enums.txt 是唯一源）；
// 枚举路径锚定脚本位置（fixture 测试 cwd 在临时目录，按 cwd 解析会 ENOENT）。
// **不能用固定上溯级数**（2026-09-28 修正）：本脚本在两处运行、深度不同——
//   包源 `templates/_agents/scripts/` → 上溯 3 级到仓库根
//   装户 `.agents/scripts/`          → 上溯 2 级到安装根
// 首版硬编码 3 级，故**在每个装户安装里都解析不到枚举文件**（报错路径 `<install>/../.agents/…`）。
// 实测暴露路径：CI 新增「shipped 套件」步骤后，`.agents/scripts/gen-workflow-metrics.test.mjs`
// 场景 1 即 exit 1（workflow-enums 单源文件不可读），而包源侧同字节跑出全绿。
// 改为**逐级上溯探测**：找到含 `.agents/workflow-enums.txt` 的那一级即用，找不到则回退标准位置让
// loadEnums fail-loud（保持「缺失即响亮」的既有纪律，不静默兜底）。
const resolveEnumsPath = () => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const cand = path.join(dir, '.agents', 'workflow-enums.txt');
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break; // 到根
    dir = parent;
  }
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.agents', 'workflow-enums.txt');
};
const ENUMS = loadEnums(resolveEnumsPath());
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
      // 词表约定 glob = 基名内单个 `*`（<前缀>*<后缀>），目录段不支持通配——与 rule-budget.sh 的 shell glob 同口径。
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

// ---- 闭环漏斗（2026-10-02 ledger-funnel-metrics；口径定义式单源 = workflow/specs/2026-10-02-ledger-funnel-metrics.md）----
// 只读台账一手字段（doc/stage/ts/source），坏行跳过（与检查 15/19 同容错）；观测面不挂门禁、不新增文档断言（检查 16 零接触）。
const LEDGER_P = path.join('.agents', 'confirmations.jsonl');
function readLedgerRows() {
  if (!fs.existsSync(LEDGER_P)) return [];
  return fs.readFileSync(LEDGER_P, 'utf8').split(/\r?\n/)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && typeof e === 'object');
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
const funnelRow = `| ${month} | ${funnel.closed} | ${funnel.full} | ${funnel.legacy} | ${funnel.once} | ${funnel.rework} | ${medianDays === null ? '—' : medianDays.toFixed(1)} | ${funnel.ledgerRows} |`;

const docs = scanDocs();
const surf = scanSurface();
const row = `| ${month} | ${docs.files}（活跃 ${docs.active} / 终态 ${docs.terminal}） | ${kb(docs.bytes)} | ${docs.withModule}/${docs.files} | ${kb(surf.total)}（峰值 ${surf.peak ? `${surf.peak.pct.toFixed(1)}% ${surf.peak.label}` : '—'}） | ${kb(idxBytes)}（${Number.isNaN(idxActive) ? '—' : idxActive} 行） |`;

// ---- 明细（stdout，不落表）：类型分布 + 逐条预算占用 ----
console.log(`📅 ${month} 快照`);
console.log(`  文档：${docs.files} 篇 / ${kb(docs.bytes)}（活跃 ${docs.active} / 终态 ${docs.terminal}${docs.invalid ? ` / 状态缺失或非法 ${docs.invalid}` : ''}）；模块已填 ${docs.withModule}/${docs.files}`);
for (const [t, v] of Object.entries(docs.perType)) console.log(`    ${t.padEnd(10)} ${String(v.n).padStart(3)} 篇 / ${kb(v.b)}`);
console.log(`  索引：workflow/INDEX.md ${kb(idxBytes)}（活跃 ${Number.isNaN(idxActive) ? '—' : idxActive} 行）`);
for (const e of surf.entries) console.log(`    ${e.label.padEnd(44)} ${String(e.max).padStart(6)} / ${String(e.lim).padStart(6)} B（${e.pct.toFixed(1)}%）`);
console.log(`  常驻面合计：${kb(surf.total)}`);
console.log(`  闭环漏斗：收口 ${funnel.closed}（完整链 ${funnel.full} = 一次通过 ${funnel.once} + 返工 ${funnel.rework}；协议前 ${funnel.legacy}）｜中位周期 ${medianDays === null ? '—' : `${medianDays.toFixed(1)} 天`}｜台账行 ${funnel.ledgerRows}`);
for (const it of funnel.items) console.log(`    ${String(it.doc).padEnd(58)} ${it.kind.padEnd(7)} ${it.days} 天`);
if (funnel.items.length) console.log('  ℹ️ 机器口径可与 workflow/delegations.md 自做表的人工自报交叉对照（差异即信号，不对账）');
console.log(`  ${DRY ? '（--dry-run，未写盘）' : ''}`);

if (DRY) { console.log(`\n将写入行：\n${row}\n${funnelRow}`); process.exit(0); }

// ---- 组装：GENERATED 区内的月表按月份键 upsert（同月重跑覆盖，行序按月升序）----
const HEADER = `# workflow 规模与规则面月度快照

> 生成器 \`node .agents/scripts/gen-workflow-metrics.mjs\`（每月或有需要时跑；同月重跑即更新该行）。明细（类型分布 / 逐条预算占用）看脚本 stdout，不落表。
> 口径：文档 = 磁盘（排除 \`_TEMPLATE.md\`）；常驻面 = \`.agents/rule-budgets.txt\` 逐条实测，括号内为「预算占用峰值项」。
`;
const TABLE_HEAD = [
  '| 月份 | 文档（活跃/终态） | 文档字节 | 模块已填/总 | 常驻面字节（预算峰值） | INDEX（活跃行） |',
  '|---|---|---|---|---|---|',
];
// 漏斗表头（第二表；口径定义式单源 = workflow/specs/2026-10-02-ledger-funnel-metrics.md）
const FUNNEL_HEAD = [
  '## 闭环漏斗（机器口径，源：.agents/confirmations.jsonl——定义式见 specs/2026-10-02-ledger-funnel-metrics.md）',
  '',
  '| 月份 | 收口 | 完整链 | 协议前 | 一次通过 | 返工件 | 中位周期(天) | 台账行数 |',
  '|---|---|---|---|---|---|---|---|',
];
const existing = fs.existsSync(METRICS_P) ? fs.readFileSync(METRICS_P, 'utf8') : '';
let rows = [];
let funnelRows = [];
if (existing.includes(BEGIN) && existing.includes(END)) {
  const section = existing.slice(existing.indexOf(BEGIN), existing.indexOf(END));
  const marker = FUNNEL_HEAD[0];
  const bodyPart = section.includes(marker) ? section.slice(0, section.indexOf(marker)) : section;
  const funnelPart = section.includes(marker) ? section.slice(section.indexOf(marker)) : '';
  rows = bodyPart.split(/\r?\n/).filter((l) => /^\|\s*\d{4}-\d{2}\s*\|/.test(l));
  funnelRows = funnelPart.split(/\r?\n/).filter((l) => /^\|\s*\d{4}-\d{2}\s*\|/.test(l));
}
rows = rows.filter((l) => !l.startsWith(`| ${month} `));
rows.push(row);
rows.sort((a, b) => a.slice(2, 9).localeCompare(b.slice(2, 9)));
funnelRows = funnelRows.filter((l) => !l.startsWith(`| ${month} `));
funnelRows.push(funnelRow);
funnelRows.sort((a, b) => a.slice(2, 9).localeCompare(b.slice(2, 9)));
const inner = `${BEGIN}\n\n${[...TABLE_HEAD, ...rows].join('\n')}\n\n${[...FUNNEL_HEAD, ...funnelRows].join('\n')}\n\n${END}`;
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
