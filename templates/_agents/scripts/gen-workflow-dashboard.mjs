#!/usr/bin/env node
// gen-workflow-dashboard.mjs — workflow 仪表盘（2026-10-08，intent workflow-dashboard，L1）
// 一键生成 workflow/DASHBOARD.md：头部红绿灯（质量门 + 关单时长带）+ 时长分布 + 质量月度行。
// 观测面非门禁：红灯是「看」的不是「拦」的（gen-workflow-metrics 同教训——快照拿去做漂移校验只会常红）；
// 想看就跑一行命令，与 INDEX.md「状态变更后重跑」同模式，不挂钩子（post-commit 自动重生成有脏工作区问题）。
// 时长口径：done 态 intents 的立项日（frontmatter 日期）→ confirmations.jsonl 该 doc **最早** done 行 ts
// （多次 done 取首关；无台账行的存量单诚实跳过不虚构）。真实分布基准（2026-10-08 本仓 43 单）：P50=0 / P90=7 / max=8。
// 复用：require('./agg-delegations.cjs') 纯函数（readLedger / metrics / gateMonth / expansionVerdict）——
//   质量判据零重复（N3 教训）；readLedger 的 root 显式参数 + soft 模式为本批使能导出（原签名行为不变）。
// isMain 守卫 + 纯函数导出（board-kb-p1 先例）：closeDurations / pickPct / durationVerdict 供测试 import 直测。
// 用法：node .agents/scripts/gen-workflow-dashboard.mjs [--dry-run]
// 测试：node templates/_agents/scripts/gen-workflow-dashboard.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CHECK_LOOP_ROOT || path.resolve(SCRIPT_DIR, '..', '..');
const agg = require('./agg-delegations.cjs');

// 关单时长控制带（默认带，数据说话后调）：P50 ≤ 1 天 且 P90 ≤ 10 天为绿——本仓实测 P50=0/P90=7 在带内，
// 留 7 天 P90 余量覆盖跨周单；不带配置文件（YAGNI，真需要项目级调带时再外置）。
export const DURATION_BAND = { p50Max: 1, p90Max: 10 };

// closeDurations：done intents 关单天数（纯函数供测试）——doneMap: Map<rel, 最早 done 行 ISO ts>
export function closeDurations(intents, doneMap) {
  const days = [];
  let skipped = 0;
  for (const it of intents) {
    const ts = doneMap.get(it.rel);
    const t = ts === undefined ? NaN : Date.parse(ts);
    const d0 = Date.parse(`${it.date}T00:00:00Z`);
    if (!Number.isFinite(t) || !Number.isFinite(d0)) { skipped++; continue; }
    days.push({ rel: it.rel, days: Math.max(0, Math.floor((t - d0) / 86400000)) }); // floor=日历天差：同日关门 0.625 天仍记 0（round 会记 1）
  }
  days.sort((a, b) => a.days - b.days || a.rel.localeCompare(b.rel));
  return { days, skipped };
}

// pickPct：百分位（升序数组；与 repo 内实测探针同口径 floor(len*p) 截断）
export function pickPct(sortedNums, p) {
  if (!sortedNums.length) return null;
  return sortedNums[Math.min(sortedNums.length - 1, Math.floor(sortedNums.length * p))];
}

// durationVerdict：时长带判定（三态：无样本 null / 带内 / 超带）
export function durationVerdict(p50, p90) {
  if (p50 === null) return { ok: null, text: '⚪ 暂无关单样本（无带台账 done 行的 done intent）' };
  const ok = p50 <= DURATION_BAND.p50Max && p90 <= DURATION_BAND.p90Max;
  return { ok, text: ok ? '✅ 带内' : '❌ 超带' };
}

// fmField：frontmatter 单行「键: 值」最小提取（check-loop fmGet 无 isMain 守卫不可 import——本件够用）
function fmField(text, key) {
  const m = String(text).match(new RegExp(`^${key}: (.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

// collectDoneIntents：done 态 intents（排除 _TEMPLATE）→ [{rel, date}]
function collectDoneIntents(root) {
  const dir = path.join(root, 'workflow', 'intents');
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md') || f.startsWith('_TEMPLATE')) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (fmField(text, '状态') !== 'done') continue;
    const date = fmField(text, '日期');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({ rel: `workflow/intents/${f}`, date });
  }
  return out;
}

// collectDoneMap：台账 earliest done 行（坏行容忍，doc 正斜杠根相对——沿检查 14/15 口径）
function collectDoneMap(root) {
  const doneMap = new Map();
  const ledgerPath = path.join(root, '.agents', 'confirmations.jsonl');
  if (!fs.existsSync(ledgerPath)) return doneMap;
  for (const line of fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && e.stage === 'done' && typeof e.doc === 'string' && e.doc.startsWith('workflow/intents/')) {
        const prev = doneMap.get(e.doc);
        if (prev === undefined || e.ts < prev) doneMap.set(e.doc, e.ts);
      }
    } catch { /* 坏行容忍跳过 */ }
  }
  return doneMap;
}

// qualityRows：月度质量行（判据全部复用 agg——本函数只做分组与格式化）
export function qualityRows(root) {
  const rows = agg.readLedger(root, { soft: true });
  const byMonth = {};
  for (const r of rows) (byMonth[r.date.slice(0, 7)] ||= []).push(r);
  const months = Object.keys(byMonth).sort();
  const verdictMap = new Map();
  const monthOkMap = new Map();
  const out = [];
  for (const ym of months) {
    const m = agg.metrics(byMonth[ym]);
    const { items, monthOk } = agg.gateMonth(m);
    monthOkMap.set(ym, monthOk);
    const [y, mo] = ym.split('-').map(Number);
    const pd = new Date(Date.UTC(y, mo - 2, 1));
    const prev = `${pd.getUTCFullYear()}-${String(pd.getUTCMonth() + 1).padStart(2, '0')}`;
    const verdict = agg.expansionVerdict(monthOk, monthOkMap.get(prev), !months.includes(prev), items);
    verdictMap.set(ym, verdict);
    const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—');
    const avg = Number.isFinite(m.avgRework) ? m.avgRework.toFixed(2) : '—';
    out.push(`| ${ym} | ${m.total} | ${pct(m.passRate)} | ${avg} | ${pct(m.fallbackRate)} | ${verdict} |`);
  }
  return { rows: out, verdictMap, months };
}

const USAGE = '用法：node .agents/scripts/gen-workflow-dashboard.mjs [--dry-run]';

function main() {
  const dry = process.argv.includes('--dry-run');
  const intents = collectDoneIntents(ROOT);
  const doneMap = collectDoneMap(ROOT);
  const { days, skipped } = closeDurations(intents, doneMap);
  const nums = days.map((d) => d.days);
  const p50 = pickPct(nums, 0.5);
  const p90 = pickPct(nums, 0.9);
  const mx = nums.length ? nums[nums.length - 1] : null;
  const dv = durationVerdict(p50, p90);
  const q = qualityRows(ROOT);
  const curYm = q.months[q.months.length - 1];
  const qVerdict = curYm ? q.verdictMap.get(curYm) : '⚪ 台账暂无数据（delegations.md 无结果表行）';

  const slowest = days.slice(-3).reverse().map((d) => `${d.rel.split('/').pop()}=${d.days}天`).join('、') || '—';
  const stat = (x) => (x === null ? '—' : `${x} 天`);
  const lines = [
    '# workflow 仪表盘（生成物，勿手改）',
    '',
    `> 生成器 \`node .agents/scripts/gen-workflow-dashboard.mjs\`；生成于 ${new Date().toISOString()}`,
    '> 观测面非门禁：红灯提示看，不拦提交；想看就跑一行命令（与 INDEX.md「状态变更后重跑」同模式）。',
    '',
    '## 红绿灯',
    '',
    `- ${qVerdict}｜质量门（门槛权威 = workflow/delegations.md §并发扩容门槛：一次通过率 ≥90%、月度返工 0、无主兜底、样本 ≥5）${curYm ? `——当月 ${curYm}` : ''}`,
    `- ${dv.text}｜关单时长带（P50 ≤ ${DURATION_BAND.p50Max} 天 且 P90 ≤ ${DURATION_BAND.p90Max} 天）：P50=${stat(p50)} / P90=${stat(p90)} / max=${stat(mx)}（样本 ${nums.length}，无台账行跳过 ${skipped}）`,
    '',
    '## 关单时长（done intents：立项日 → 台账最早 done 行）',
    '',
    '| 指标 | 值 |',
    '|------|----|',
    `| P50 | ${stat(p50)} |`,
    `| P90 | ${stat(p90)} |`,
    `| max | ${stat(mx)} |`,
    `| 样本数 | ${nums.length} |`,
    `| 无台账行跳过（存量单） | ${skipped} |`,
    '',
    `最慢 3 单：${slowest}`,
    '',
    '## 质量 / 返工（月度，判据复用 agg-delegations）',
    '',
    '| 月份 | 有效任务 | 一次通过率 | 平均返工 | 主兜底占比 | 扩容门判定 |',
    '|------|----------|------------|----------|------------|------------|',
    ...(q.rows.length ? q.rows : ['| — | — | — | — | — | 台账暂无数据 |']),
    '',
  ];
  const out = lines.join('\n');
  if (dry) {
    console.log(out);
    console.log(`（--dry-run：未写盘。${USAGE}）`);
    return;
  }
  const target = path.join(ROOT, 'workflow', 'DASHBOARD.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, out, 'utf8');
  console.log(`✅ 已生成 ${path.relative(ROOT, target) || 'workflow/DASHBOARD.md'}`);
  console.log(`   红绿灯：${qVerdict.split('｜')[0].trim()} 质量门 ｜ ${dv.text} 关单时长带（P50=${stat(p50)} / P90=${stat(p90)}，样本 ${nums.length}）`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('gen-workflow-dashboard.mjs');
if (isMain) main();
