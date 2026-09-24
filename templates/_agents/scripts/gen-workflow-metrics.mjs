#!/usr/bin/env node
// workflow 规模与规则面月度快照（2026-09-21，intent 2026-09-21-workflow-metrics-snapshot）
// 用法：node .agents/scripts/gen-workflow-metrics.mjs [--month YYYY-MM] [--dry-run] [--help]
// 目的：把「语料膨胀 + 常驻面体积」变成可观测趋势——每月（或按需）跑一次，往 workflow/metrics.md 追加/更新一行。
// 口径：文档 = 磁盘（对照 gen-workflow-index / 看板，排除 _TEMPLATE.md）；常驻面 = `.agents/rule-budgets.txt`
//   各条实测（单源，含预算上限），括号内给「预算占用峰值项」。
// 不做 --check / 不挂门禁：快照是历史记录——任何文档改动都会让「当前值」漂移，拿它做漂移校验只会常红；
//   规则面的机器约束由 pre-commit 的 rule-budget.sh 负责，本脚本只负责「看见趋势」。
// 测试：node .agents/scripts/gen-workflow-metrics.test.mjs（fixture 回归，须全绿）
import fs from 'node:fs';
import path from 'node:path';

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
const ACTIVE_STATUS = ['draft', 'approved', 'open'];
const BEGIN = '<!-- GENERATED:BEGIN — gen-workflow-metrics.mjs 整段重写，手工说明写在本行之前 -->';
const END = '<!-- GENERATED:END -->';

const kb = (b) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`);

// ---- 语料统计：按类型聚合文件数/字节 + 活跃终态 + 模块已填 ----
function scanDocs() {
  const perType = {};
  let files = 0;
  let bytes = 0;
  let active = 0;
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
      if (mod) withModule++;
      n++;
      b += fs.statSync(p).size;
    }
    perType[type] = { n, b };
    files += n;
    bytes += b;
  }
  return { perType, files, bytes, active, terminal: files - active, withModule };
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
      const dir = path.dirname(pat);
      if (!fs.existsSync(dir)) { console.error(`⚠️ 预算目录不存在，跳过该条：${pat}`); continue; }
      const suffix = pat.slice(pat.indexOf('*') + 1);
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(suffix)) continue;
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

const docs = scanDocs();
const surf = scanSurface();
const row = `| ${month} | ${docs.files}（活跃 ${docs.active} / 终态 ${docs.terminal}） | ${kb(docs.bytes)} | ${docs.withModule}/${docs.files} | ${kb(surf.total)}（峰值 ${surf.peak ? `${surf.peak.pct.toFixed(1)}% ${surf.peak.label}` : '—'}） | ${kb(idxBytes)}（${Number.isNaN(idxActive) ? '—' : idxActive} 行） |`;

// ---- 明细（stdout，不落表）：类型分布 + 逐条预算占用 ----
console.log(`📅 ${month} 快照`);
console.log(`  文档：${docs.files} 篇 / ${kb(docs.bytes)}（活跃 ${docs.active} / 终态 ${docs.terminal}）；模块已填 ${docs.withModule}/${docs.files}`);
for (const [t, v] of Object.entries(docs.perType)) console.log(`    ${t.padEnd(10)} ${String(v.n).padStart(3)} 篇 / ${kb(v.b)}`);
console.log(`  索引：workflow/INDEX.md ${kb(idxBytes)}（活跃 ${Number.isNaN(idxActive) ? '—' : idxActive} 行）`);
for (const e of surf.entries) console.log(`    ${e.label.padEnd(44)} ${String(e.max).padStart(6)} / ${String(e.lim).padStart(6)} B（${e.pct.toFixed(1)}%）`);
console.log(`  常驻面合计：${kb(surf.total)}`);
console.log(`  ${DRY ? '（--dry-run，未写盘）' : ''}`);

if (DRY) { console.log(`\n将写入行：\n${row}`); process.exit(0); }

// ---- 组装：GENERATED 区内的月表按月份键 upsert（同月重跑覆盖，行序按月升序）----
const HEADER = `# workflow 规模与规则面月度快照

> 生成器 \`node .agents/scripts/gen-workflow-metrics.mjs\`（每月或有需要时跑；同月重跑即更新该行）。明细（类型分布 / 逐条预算占用）看脚本 stdout，不落表。
> 口径：文档 = 磁盘（排除 \`_TEMPLATE.md\`）；常驻面 = \`.agents/rule-budgets.txt\` 逐条实测，括号内为「预算占用峰值项」。
`;
const TABLE_HEAD = [
  '| 月份 | 文档（活跃/终态） | 文档字节 | 模块已填/总 | 常驻面字节（预算峰值） | INDEX（活跃行） |',
  '|---|---|---|---|---|---|',
];
const existing = fs.existsSync(METRICS_P) ? fs.readFileSync(METRICS_P, 'utf8') : '';
let rows = [];
if (existing.includes(BEGIN) && existing.includes(END)) {
  rows = existing.slice(existing.indexOf(BEGIN), existing.indexOf(END))
    .split(/\r?\n/)
    .filter((l) => /^\|\s*\d{4}-\d{2}\s*\|/.test(l));
}
rows = rows.filter((l) => !l.startsWith(`| ${month} `));
rows.push(row);
rows.sort((a, b) => a.slice(2, 9).localeCompare(b.slice(2, 9)));
const inner = `${BEGIN}\n\n${[...TABLE_HEAD, ...rows].join('\n')}\n\n${END}`;
let out;
if (existing.includes(BEGIN) && existing.includes(END)) {
  out = existing.slice(0, existing.indexOf(BEGIN)) + inner + existing.slice(existing.indexOf(END) + END.length);
} else {
  out = (existing ? existing.replace(/\s*$/, '') + '\n\n' : HEADER) + inner + '\n';
}
fs.writeFileSync(METRICS_P, out, 'utf8');
console.log(`✅ 已更新 workflow/metrics.md（${month} 行；共 ${rows.length} 个月）`);
