#!/usr/bin/env node
// gen-workflow-dashboard.mjs — workflow 仪表盘（2026-10-08，intent workflow-dashboard，L1）
// 一键生成 workflow/DASHBOARD.md：头部红绿灯（质量门 + 关单时长带）+ 时长分布 + 质量月度行。
// 观测面非门禁：红灯是「看」的不是「拦」的（gen-workflow-metrics 同教训——快照拿去做漂移校验只会常红）；
// 想看就跑一行命令，与 INDEX.md「状态变更后重跑」同模式，不挂钩子（post-commit 自动重生成有脏工作区问题）。
// 时长口径：done 态 intents 的立项日（frontmatter 日期）→ confirmations.jsonl 该 doc **最早** done 行 ts
// （多次 done 取首关；无台账行的存量单诚实跳过不虚构）。真实分布基准（2026-10-08 本仓 43 单）：P50=0 / P90=7 / max=8。
// 复用：require('./agg-delegations.cjs') 纯函数（readLedger / metrics / gateMonth / expansionVerdict）——
//   质量判据零重复（N3 教训）；readLedger 的 root 显式参数 + soft 模式为本批使能导出（原签名行为不变）。
// isMain 守卫 + 纯函数导出（board-kb-p1 先例）：closeDurations / pickPct / durationVerdict / normalizeForCheck 供测试 import 直测。
// 用法：node .agents/scripts/gen-workflow-dashboard.mjs [--dry-run | --check]
//   --check  不写盘；与磁盘不一致时 exit 1 并打印差异（供 check-loop 检查 11 漂移告警，2026-10-08 selfmeasure-and-modularize）
//     两道归一缺一不可（均照 gen-workflow-index.mjs 先例）：
//     ① 行尾：fresh clone 检出 CRLF、生成段恒 LF——直接字符串相等会在克隆环境假阳性「漂移」（2026-09-30 该坑已在
//        gen-workflow-index 踩过，本件照抄 normEol）；
//     ② 「生成于 <ISO>」行：每次运行必变，不归一则门禁恒红（不可消退噪声，违反 audit-gate-hardening P3 教训）。
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
    // 门禁噪声返工单列（2026-10-08 selfmeasure-and-modularize）：设计返工与噪声返工分列可诊断——
    // 「平均返工」把两者平均在一起时看不出该改门禁还是改设计。
    out.push(`| ${ym} | ${m.total} | ${pct(m.passRate)} | ${m.reworkSum} | ${m.reworkNoiseSum} | ${avg} | ${pct(m.fallbackRate)} | ${verdict} |`);
  }
  return { rows: out, verdictMap, months };
}

// gateRoiLines：门禁 ROI 节的行（2026-10-08 gate-roi-metrics）
//   口径声明 + 采集/查看入口。**刻意不把运行数据（次数 / 耗时 / 噪声率）铺进 DASHBOARD**——
//   本文件被检查 11（--check）覆盖，而采集数据每跑一次门禁就变一次：铺进去等于
//   「每次采集必产一条漂移 WARN」＝不可消除噪声（audit-gate-hardening P3 的反面教材）。
//   连「有无数据」也不做分支（cache 已 gitignore → 新克隆必然无 cache，一采集文案就翻转 = 又一次漂移）：
//   降级语义交由 CLI 承担——agg-gate-stats.mjs 空数据时自己打印「未采集——跑 check-loop --gate-stats」。
//   故本节恒为静态文案：**任何时候生成本文件，字节恒等**（测试 ⑤ 的两条 --check exit 0 钉的就是这条）。
export function gateRoiLines() {
  return [
    '- 采集：`node .agents/scripts/check-loop.mjs --gate-stats`（数据落 `.agents/cache/gate-stats.jsonl`，该目录已 gitignore；不带 flag 时零写入、输出逐字节不变）',
    '- 看数值：`node .agents/scripts/agg-gate-stats.mjs [--days 30]`——输出成本排序 + 两类决策依据：噪声率 top（该收窄或该修）、死检查（该拆或该降级）；无采集数据时该命令自己提示「未采集」并给出采集命令',
    '- 口径：耗时**含子进程时间**（检查 11 调两个生成器 `--check`、检查 13 调 `sh rule-budget.sh`）——门禁真实成本，不做剔除；样本 <5 次时只作线索，不作决策依据',
    '- 本节为何不铺数值：本文件被检查 11 漂移门覆盖，运行数据每跑一次门禁即变一次，铺进来会让每次采集都产一条漂移 WARN（不可消除噪声）',
  ];
}

const USAGE = '用法：node .agents/scripts/gen-workflow-dashboard.mjs [--dry-run | --check]';

// normalizeForCheck：--check 比对前的双归一（纯函数供测试直测）——行尾 CRLF→LF + 「生成于 <ISO>」行抹平。
//   导出是为了让测试不必 spawn 子进程即可断言「仅时间戳不同 → 归一后相等」（门禁恒红的直接防线）。
export function normalizeForCheck(s) {
  return String(s)
    .replace(/\r\n/g, '\n')
    .replace(/生成于 \d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '生成于 <TS>');
}

function firstDiffLine(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return i + 1;
  }
  return -1;
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const check = args.includes('--check');
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
    '| 月份 | 有效任务 | 一次通过率 | 设计返工 | 门禁噪声返工 | 平均返工 | 主兜底占比 | 扩容门判定 |',
    '|------|----------|------------|---------|-------------|--------|------------|------------|',
    ...(q.rows.length ? q.rows : ['| — | — | — | — | — | — | — | 台账暂无数据 |']),
    '',
    '## 门禁 ROI（门禁自身的度量）',
    '',
    ...gateRoiLines(),
    '',
  ];
  const out = lines.join('\n');
  const target = path.join(ROOT, 'workflow', 'DASHBOARD.md');
  // --check 优先于写盘、--dry-run 优先于 --check（显式不写盘意图最高）：比对模式不改任何盘面。
  if (check) {
    let disk;
    try {
      disk = fs.readFileSync(target, 'utf8');
    } catch {
      console.error(`[check] ❌ ${path.relative(ROOT, target) || 'workflow/DASHBOARD.md'} 不存在或不可读——跑 node .agents/scripts/gen-workflow-dashboard.mjs 生成`);
      process.exitCode = 1;
      return;
    }
    const a = normalizeForCheck(out);
    const b = normalizeForCheck(disk);
    if (a === b) {
      console.log(`[check] ✅ ${path.relative(ROOT, target) || 'workflow/DASHBOARD.md'} 与盘面一致（行尾与「生成于」时间戳已归一）`);
      return;
    }
    const ln = firstDiffLine(a, b);
    console.error(`[check] ❌ ${path.relative(ROOT, target) || 'workflow/DASHBOARD.md'} 与当前事实不一致（首个差异在第 ${ln} 行）——跑 node .agents/scripts/gen-workflow-dashboard.mjs 重新生成`);
    process.exitCode = 1;
    return;
  }
  if (dry) {
    console.log(out);
    console.log(`（--dry-run：未写盘。${USAGE}）`);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, out, 'utf8');
  console.log(`✅ 已生成 ${path.relative(ROOT, target) || 'workflow/DASHBOARD.md'}`);
  console.log(`   红绿灯：${qVerdict.split('｜')[0].trim()} 质量门 ｜ ${dv.text} 关单时长带（P50=${stat(p50)} / P90=${stat(p90)}，样本 ${nums.length}）`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('gen-workflow-dashboard.mjs');
if (isMain) main();
