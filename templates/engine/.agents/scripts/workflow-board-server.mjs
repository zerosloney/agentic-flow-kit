#!/usr/bin/env node
// workflow 实时看板服务：本地只读 http + SSE 文件监听，可视化 AI 执行流程（intents/incidents/plans/specs）。
// 用法：node .agents/scripts/workflow-board-server.mjs [--port 8933]；多 worktree 并行请用 ensure-board.mjs 拉起（按 SHIPYARD_SLOT 槽位派生端口，strict 不漂移——2026-10-22 board-slot-strict）
// 零依赖（node:http/node:fs/node:path/node:url/node:child_process）；只读 workflow/ 与 git，仅绑 127.0.0.1。
// API：GET /（看板页） /marked.min.js（vendor） /api/board /api/doc?file=<相对路径> /api/history?file=<相对路径> /api/events（SSE）
//       /api/runs（pipeline-run 执行器 run 卡片列表） /api/run?file=<runId>.json（单 run 事件流）
// 实时边界：文档内容与状态随落盘实时（fs.watch→SSE 推送）；git 历史仅含已提交记录（git 语义）。
// 执行器面板（2026-10-04 board-run-panel）：只读 .agents/cache/pipeline-runs/*.json（脚本亲写的机器事实），
//   不读 orchestration-runs.jsonl（宿主 AI 自报态，非验证态）；纯只读观测层，不启动/推进/中止 run。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ENUMS } from './workflow-enums.mjs';
import { stageBar } from './pipeline-run.mjs';
import { loadAllConfirmations } from './ledger-loader.mjs';
import { funnelFromLedger, loadFirstAdded, scanReviews, fmtMedianDays, calendarMonthsBetween } from './metrics-core.mjs';
import { buildTour } from './dev-tour-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = path.join(ROOT, 'workflow');
const BOARD_DIR = path.join(ROOT, '.agents', 'board');
const DOC_TYPES = ['intents', 'incidents', 'plans', 'specs'];
const PIPELINE_RUNS = path.join(ROOT, '.agents', 'cache', 'pipeline-runs');
// 引擎台账（2026-10-22 board-engine-views）：判定流水与全量门逐门耗时，append 型 jsonl 机器事实
const JUDGMENTS = path.join(ROOT, '.agents', 'judgments.jsonl');
const VERIFICATIONS = path.join(ROOT, '.agents', 'verifications.jsonl');

const portArg = process.argv.indexOf('--port');
const PORT = portArg > 0 ? Number(process.argv[portArg + 1]) || 8933 : 8933;
const STARTED_AT = Date.now(); // 随 /api/board 自报（startedAt），供 ensure-board.mjs 判定旧代码重启，不碰进程启动时间 API

// ---- front matter + 标题解析（对照 _TEMPLATE.md 受限子集：每行 `键: 值`）----
function parseDoc(text) {
  const meta = {};
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\S+):\s*(.*)$/);
      if (kv) meta[kv[1].trim()] = kv[2].trim();
    }
  }
  const h1 = text.match(/^# (.+)$/m);
  let title = h1 ? h1[1] : '';
  // 去掉 "# INTENT — " 前缀留主题：em/en dash（任意间距）或带空格连字符——裸连字符属 kebab-case，不截断（2026-09-24）
  const dash = title.match(/\S+\s*(?:[—–]+|\s-\s)\s*(.+)$/);
  if (dash) title = dash[1];
  return { meta, title };
}

// ---- 验收标准 checkbox 统计：仅「验收标准」节内（至下一个 ## 标题），无该节返回 null ----
// 节匹配对齐 check-loop 检查 8 口径（^\s*##\s[^#]*验收标准，2026-09-27 board-kb-p1——「## 三、验收标准」类标题此前识别不到）
function parseAcceptance(text) {
  const h = text.match(/^\s*##\s[^#]*验收标准.*$/m);
  if (!h) return null;
  const rest = text.slice(h.index + h[0].length);
  const next = rest.match(/^## /m);
  const section = next ? rest.slice(0, next.index) : rest;
  const total = (section.match(/^\s*[-*] \[[ xX]\]/gm) || []).length;
  if (!total) return null;
  const done = (section.match(/^\s*[-*] \[[xX]\]/gm) || []).length;
  return { done, total };
}
export { parseAcceptance };

// ---- 执行器 run 文件解析（2026-10-04 board-run-panel）----
// 只读 pipeline-runs/ 下的 run JSON（脚本亲写的机器事实，含 gate 真实退出码）。坏 JSON / 缺字段容错返回 null，
// 由调用方跳过——run 文件写入原子化（临时文件+rename），读瞬间可能撞上 rename 前状态，不 500。
export function parseRunFile(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || typeof j.runId !== 'string' || !j.runId) return null;
  return j;
}

// 单 run 卡片（/api/runs 载荷元素）：runId / requirement / stage / stopType / updatedAt / triage / 事件数 / 阶段条
export function runCard(run) {
  const events = Array.isArray(run.events) ? run.events : [];
  return {
    runId: run.runId,
    requirement: run.requirement || '',
    stage: run.stage || '',
    stopType: run.stopType || '',
    updatedAt: run.updatedAt || run.createdAt || '',
    triage: run.triage || null,
    eventCount: events.length,
    stageBar: stageBar(run),
  };
}

// 扫 pipeline-runs/ 全部 run → 卡片数组，按 updatedAt 倒序（无目录/空目录 → []）
export function scanRuns() {
  if (!fs.existsSync(PIPELINE_RUNS) || !fs.statSync(PIPELINE_RUNS).isDirectory()) return [];
  const cards = [];
  for (const f of fs.readdirSync(PIPELINE_RUNS)) {
    if (!f.endsWith('.json')) continue;
    try {
      const run = parseRunFile(fs.readFileSync(path.join(PIPELINE_RUNS, f), 'utf8'));
      if (run) cards.push(runCard(run));
    } catch {
      // 读失败（瞬时占用等）跳过，等下次推送
    }
  }
  return cards.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// 路径白名单：resolve 后必须仍在 pipeline-runs/ 内且 .json 后缀（export 供测试直测白名单面）
export function safeRunPath(rel) {
  const abs = path.resolve(PIPELINE_RUNS, rel);
  if (!abs.startsWith(PIPELINE_RUNS + path.sep) || !abs.endsWith('.json')) return null;
  return abs;
}

// ---- 引擎台账聚合（2026-10-22 board-engine-views：A1 门禁成本趋势 / A3 判定流水）----
// 只读聚合、坏行容错跳过（regen/compact 重写瞬间可能读到半行；跳过等下次请求）。
export function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// 判定流水聚合：规则命中（hits / 首末命中 / 静默月数 / 退役候选——连续 6 个月零命中；
// 缺月不算零命中，由 last>0 保证）+ 按日趋势 + 最近原始行（前端流水表用）
export function aggregateJudgments(rows, now = Date.now()) {
  const rules = new Map();
  const days = new Map();
  const valid = []; // 坏 ts 行整行丢弃（不计数、不进趋势/流水——它不是一次真实判定）
  let hard = 0;
  let hygiene = 0;
  for (const r of rows) {
    const ts = Date.parse(r.ts);
    if (!Number.isFinite(ts)) continue;
    valid.push(r);
    const mode = r.mode === 'hygiene' ? 'hygiene' : 'hard';
    if (mode === 'hygiene') hygiene += 1; else hard += 1;
    const day = String(r.ts).slice(0, 10);
    const d = days.get(day) || { runs: 0, warnings: 0, blockers: 0 };
    d.runs += 1;
    d.warnings += r.warnings || 0;
    d.blockers += r.blockers || 0;
    days.set(day, d);
    for (const ru of Array.isArray(r.rules) ? r.rules : []) {
      const key = `${ru.rule}|${ru.level || ''}`;
      const a = rules.get(key) || { rule: ru.rule, level: ru.level || '', hits: 0, first: ts, last: 0 };
      const n = Number(ru.count) || 0;
      a.hits += n;
      if (ts > a.last) a.last = ts;
      if (ts < a.first) a.first = ts;
      rules.set(key, a);
    }
  }
  const ruleAgg = [...rules.values()].map((a) => {
    // 静默窗口按日历整月（2026-10-23 P2）：退役判据是「连续 6 个月」，183 天近似会在月末差出一天。
    const silentMonths = a.last > 0 ? calendarMonthsBetween(a.last, now) : null;
    return {
      ...a,
      silentMonths,
      retireCandidate: silentMonths !== null && silentMonths >= 6,
    };
  }).sort((x, y) => y.hits - x.hits);
  const trend = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, d]) => ({ day, ...d }));
  return {
    total: valid.length, hard, hygiene,
    lastRun: valid.length ? String(valid[valid.length - 1].ts || '') : '',
    ruleAgg, trend,
    recent: valid.slice(-80).reverse(),
  };
}

// 门禁成本聚合：逐门 last / 近 10 次均值 / 峰值 / 出场次数 + run 级墙钟趋势（verify-diet 后续观测面）
// 本聚合不消费 attribution；2026-11-10 前存量行该字段可缺，消费侧按未知处理，不回填不追溯。
export function aggregateVerifications(rows) {
  const gates = new Map();
  const wallTrend = [];
  const runs = [];
  for (const r of rows) {
    if (!Number.isFinite(Date.parse(r.ts))) continue;
    wallTrend.push({ ts: r.ts, wallMs: r.wallMs ?? r.totalMs ?? 0, exitCode: r.exitCode });
    runs.push({ ts: r.ts, headShort: r.headShort || '', suite: r.suite || '', gates: r.gates ?? 0, passed: r.passed ?? 0, failed: r.failed ?? 0, wallMs: r.wallMs ?? 0, exitCode: r.exitCode });
    for (const [g, ms] of Object.entries(r.durations || {})) {
      const a = gates.get(g) || { gate: g, ms: [], lastTs: '' };
      a.ms.push(Number(ms) || 0);
      a.lastTs = r.ts; // 末次实执行时刻（diet⑥ 后退役出本地路径的门靠它现形，防历史聚合值误读——gate-diet #5 教训）
      gates.set(g, a);
    }
  }
  const gateAgg = [...gates.values()].map(({ gate, ms, lastTs }) => {
    const last10 = ms.slice(-10);
    return {
      gate, runs: ms.length, lastTs,
      lastMs: ms[ms.length - 1] ?? 0,
      avg10: Math.round(last10.reduce((s, v) => s + v, 0) / (last10.length || 1)),
      maxMs: ms.length ? Math.max(...ms) : 0,
    };
  }).sort((a, b) => b.lastMs - a.lastMs);
  return { total: rows.length, lastRun: rows.length ? String(rows[rows.length - 1].ts || '') : '', wallTrend, gateAgg, runs: runs.slice(-60).reverse() };
}

// ---- 闭环漏斗 + 复核效果聚合（2026-10-23 board-engine-views A2）----
// 口径单源 metrics-core.mjs（gen-workflow-metrics 同款：月度归桶=终态行所在月、legacy/rework/once 分类、
// 中位周期=git 首次加入→终态）。firstAdded 是 64MB buffer 的一次全量 git log——TTL 缓存 5 分钟（预警层容忍陈旧）。
const firstAddedCache = { at: 0, map: null };
function firstAddedCached() {
  if (!firstAddedCache.at || Date.now() - firstAddedCache.at > 300_000) {
    firstAddedCache.map = loadFirstAdded(ROOT);
    firstAddedCache.at = Date.now();
  }
  return firstAddedCache.map;
}

// 近 monthsBack 个月逐月漏斗快照（含当月），升序输出
export function aggregateFunnel(entries, firstAdded, now = Date.now(), monthsBack = 6) {
  const base = new Date(now);
  const months = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const f = funnelFromLedger(entries, ym, firstAdded);
    const sorted = [...f.days].sort((a, b) => a - b);
    const median = sorted.length
      ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
      : null;
    months.push({
      month: ym, closed: f.closed, full: f.full, legacy: f.legacy, once: f.once, rework: f.rework,
      ledgerRows: f.ledgerRows, medianDays: median == null ? null : Number(median.toFixed(2)),
    });
  }
  return months;
}

// ---- 配对断裂检测：按完整文件名（含日期）聚合同族，异常卡附 alerts ----
// 与 check-loop 检查 1 的 basename 同一口径。slug（去掉日期）只给界面分组，不参与配对。
// 规则（看板为预警层、不阻断；枚举读单源 workflow-enums.txt）：
//   孤儿 spec；孤儿 plan（L1 除外——L1 plan 即入口）；入口 done 但 plan 未终态（看板启发式）；
//   入口缺 plan（intent 一律要求；incident 需非 legacy 且级别 L1/L2/L3）；L2/L3 入口缺同名 spec；
//   spec L3 确认三件缺失（确认结果 / 确认时间 / 正文独立复核行）；
//   状态不在全量枚举内或缺失；draft 是合法起点，提示「尚未确认」
const PLAN_TERMINAL = ENUMS['doc.status.terminal'];
const STATUS_ALL = {
  intents: ENUMS['doc.status.all'],
  specs: ENUMS['doc.status.all'],
  plans: ENUMS['doc.status.all'],
  incidents: ENUMS['incident.status.all'],
};
const NO_STATUS = '（未填）';
const L3_REVIEW = /^- 独立复核：[ \t]*[^<\s]/m; // 正文独立复核行须有实质内容（对照 check-loop 锚定）

export function detectAlerts(cards) {
  const byName = new Map();
  for (const c of cards) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
  for (const c of cards) {
    const fam = byName.get(c.name) || [];
    const types = new Set(fam.map((x) => x.type));
    const alerts = [];
    const isEntry = c.type === 'intents' || c.type === 'incidents';
    // legacy 复盘件免配对类告警（口径同 check-loop）；孤儿 spec / 孤儿 plan 两条仍按 spec·plan 自身判定
    const legacyIncident = c.type === 'incidents' && c.flow === 'legacy';
    if (!STATUS_ALL[c.type].includes(c.status))
      alerts.push(`状态不在枚举内：须为 ${STATUS_ALL[c.type].join('/')}（现 ${c.status === NO_STATUS ? '缺失' : c.status}）`);
    else if (c.status === 'draft')
      alerts.push('尚未确认');
    if (c.type === 'specs' && !types.has('intents') && !types.has('incidents'))
      alerts.push('孤儿 spec：无同名 intent/incident 入口');
    if (c.type === 'plans' && c.level !== 'L1' && !types.has('intents') && !types.has('incidents'))
      alerts.push('孤儿 plan：无同名 intent/incident 入口');
    if (c.type === 'plans') {
      const entry = fam.find((x) => x.type === 'intents' || x.type === 'incidents');
      if (entry && entry.status === 'done' && !PLAN_TERMINAL.includes(c.status))
        alerts.push(`入口已 done，本 plan 未终态（现 ${c.status}）`);
    }
    if (isEntry && !legacyIncident && !types.has('plans') && (c.type === 'intents' || ['L1', 'L2', 'L3'].includes(c.level)))
      alerts.push('入口缺 plan：无同名 plan');
    if (isEntry && !legacyIncident && ['L2', 'L3'].includes(c.level) && !types.has('specs'))
      alerts.push(`${c.level} 入口缺同名 spec`);
    if (c.type === 'specs' && c.level === 'L3' && c.status !== 'draft' && !ENUMS['doc.status.abandoned'].includes(c.status)) {
      if (c.confirm !== 'approved') alerts.push(`L3 确认缺失：确认结果须为 approved（现 ${c.confirm || '缺失'}）`);
      if (!c.confirmTime) alerts.push('L3 确认缺失：须记录确认时间');
      if (!c.hasReview) alerts.push('L3 复核缺失：须记录新会话独立复核结论');
    }
    if (alerts.length) c.alerts = alerts;
  }
}

// ---- 文档作者：单次 git log 批量取「文件 → 最早提交者」（--reverse 首次出现即创建者）----
function gitAuthors() {
  return new Promise((resolve) => {
    const GIT = process.platform === 'win32' ? 'git.exe' : 'git';
    execFile(GIT, ['-c', 'core.quotepath=off', 'log', '--reverse', '--pretty=format:%x00%an', '--name-only', '--', 'workflow'], { cwd: ROOT, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) { console.error('git log 取作者失败（卡片 author 置空）:', err.message); return resolve(new Map()); }
      const map = new Map();
      let author = '';
      for (const line of stdout.toString('utf8').split(/\r?\n/)) {
        if (line.startsWith('\0')) author = line.slice(1);
        else if (line.trim() && !map.has(line.trim())) map.set(line.trim(), author);
      }
      resolve(map);
    });
  });
}

// ---- 看板全量数据：每次请求现扫磁盘（数据量小，无缓存即无失效 bug）----
async function scanBoard() {
  const authors = await gitAuthors();
  const cards = [];
  const counts = {};
  for (const type of DOC_TYPES) {
    const dir = path.join(WORKFLOW, type);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_TEMPLATE'));
    counts[type] = files.length;
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; } // watch 触发瞬间可能正被写，跳过等下次推送
      const { meta, title } = parseDoc(text);
      const accept = parseAcceptance(text);
      const name = f.slice(0, -3);
      cards.push({
        type,
        file: `${type}/${f}`,
        name,
        slug: name.replace(/^\d{4}-\d{2}-\d{2}-/, ''),
        date: meta['日期'] || name.slice(0, 10),
        status: meta['状态'] || NO_STATUS,
        level: meta['级别'] || '',
        title: title || name,
        author: authors.get(`workflow/${type}/${f}`) || '',
        ...(accept ? { accept } : {}),
        // 告警规则用到的 frontmatter / 正文锚点（对照 check-loop：legacy 豁免、L3 确认三件）
        ...(meta['流程'] ? { flow: meta['流程'] } : {}),
        ...(meta['确认结果'] ? { confirm: meta['确认结果'] } : {}),
        ...(meta['确认时间'] ? { confirmTime: meta['确认时间'] } : {}),
        ...(L3_REVIEW.test(text) ? { hasReview: true } : {}),
      });
    }
  }
  detectAlerts(cards);
  cards.sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type));
  const loop = loopBlocksSnapshot(); // hard-block 全局告警（单源 check-loop 后台刷新；null = 预热中/不可用）
  return {
    root: ROOT, pid: process.pid, startedAt: STARTED_AT, counts, cards,
    loopHardBlocks: loop.blocks, loopNote: loop.note || undefined,
    activeStatuses: [...ENUMS['doc.status.active'], ...ENUMS['incident.status.active']], // 枚举单源贯通前端（p2-batch2）
  };
}

// ---- 路径白名单：resolve 后必须仍在 workflow/ 内 ----
function safeDocPath(rel) {
  const abs = path.resolve(WORKFLOW, rel);
  if (!abs.startsWith(WORKFLOW + path.sep) || !abs.endsWith('.md')) return null;
  return abs;
}

// ---- 开发全景（/tour 实时视图 + /api/tour 数据，2026-11-09）----
// 模板单源 .agents/board/dev-tour.html；模型由 dev-tour-model.mjs 现场解析文档 + git 工作树。
// 缓存 2.5s：前端 5s 轮询 + SSE 推送，避免每次请求都跑 git diff（大任务 300 文件时约 0.3~1s）。
const TOUR_TEMPLATE = path.join(BOARD_DIR, 'dev-tour.html');
const TOUR_USAGE = path.join(ROOT, '.agents', 'cache', 'tour-usage.jsonl'); // 视图用量落盘（2026-11-11 tour-usage）
const TOUR_CACHE = new Map();
function tourDocRel(raw) {
  let rel = String(raw || '').replace(/\\/g, '/');
  if (rel.startsWith('workflow/')) rel = rel.slice('workflow/'.length);
  return rel;
}
// 验证台账补注（2026-11-11 P2）：模型只带 ts/suite/exitCode，失败原因在 verifications.jsonl 的 note
// （形如 `exit 1·log tmp\verify-check-loop.log`）。实时 /api/tour 回包补 note/attribution 与日志尾部，
// 让验证 tab 能直接看到失败原因；仅允许读仓库内 tmp/ 与 .agents/ 日志，防路径穿越。
function enrichTourEvidence(model) {
  const rows = model && model.evidence && model.evidence.rows;
  if (!Array.isArray(rows) || !rows.length) return;
  const notes = new Map();
  try {
    for (const line of fs.readFileSync(VERIFICATIONS, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        notes.set(`${j.ts || ''}|${j.suite || ''}`, { note: j.note || '', attribution: j.attribution || '', durations: j.durations || null, scope: j.scope || null, totalMs: j.totalMs ?? null, wallMs: j.wallMs ?? null });
      } catch { /* 坏行跳过 */ }
    }
  } catch { /* 台账读不动不影响页面 */ }
  for (const r of rows) {
    const meta = notes.get(`${r.ts || ''}|${r.suite || ''}`);
    if (!meta) continue;
    if (meta.note) r.note = meta.note;
    if (meta.attribution) r.attribution = meta.attribution;
    if (meta.durations) r.durations = meta.durations;
    if (meta.scope) r.scope = meta.scope;
    if (meta.totalMs != null) r.totalMs = meta.totalMs;
    if (meta.wallMs != null) r.wallMs = meta.wallMs;
    const lm = String(meta.note).match(/(?:^|[·\s])log\s+([^\s]+)/i);
    if (!lm) continue;
    const rel = lm[1].replace(/\\/g, '/').replace(/^\.?\//, '');
    if (rel.includes('..') || !(rel.startsWith('tmp/') || rel.startsWith('.agents/'))) continue;
    r.logPath = rel;
    try {
      const txt = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      r.logTail = (txt.length > 6000 ? '…\n' : '') + txt.slice(-6000);
    } catch { /* 日志缺失 */ }
  }
}

function tourModel(rel) {
  const key = rel;
  const hit = TOUR_CACHE.get(key);
  if (hit && Date.now() - hit.at < 2500) return hit.model;
  const abs = safeDocPath(rel);
  if (!abs) throw new Error('路径不在 workflow/ 白名单内');
  const model = buildTour({ root: ROOT, docPath: abs, base: 'HEAD', withDiff: true, maxDiffLines: 120 });
  enrichTourEvidence(model);
  TOUR_CACHE.set(key, { at: Date.now(), model });
  if (TOUR_CACHE.size > 24) TOUR_CACHE.delete(TOUR_CACHE.keys().next().value);
  return model;
}

function gitLog(rel) {
  return new Promise((resolve) => {
    const GIT = process.platform === 'win32' ? 'git.exe' : 'git'; // Windows spawn 不补 .exe 扩展名
    execFile(GIT, ['log', '--follow', '--date=short', '--pretty=%H|%ad|%s', '--', rel.split('/').join(path.sep)], { cwd: WORKFLOW, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) { console.error('git log 失败:', rel, err.message); return resolve([]); }
      resolve(stdout.toString('utf8').split(/\r?\n/).filter(Boolean).map((l) => {
        const [hash, date, ...rest] = l.split('|');
        return { hash, date, subject: rest.join('|') };
      }));
    });
  });
}

// ---- SSE 广播：fs.watch 防抖 500ms（AI 写盘常连发多事件，合并为一次推送）----
const sseClients = new Set();
let debounceTimer = null;
function broadcast(event) {
  for (const res of sseClients) { if (!res.destroyed) res.write(`event: ${event}\ndata: {}\n\n`); }
}
// 统一监听回调：workflow/ 文档 + pipeline-runs/ 执行器 run 文件任一变化 → 500ms 防抖广播 changed
function onWatchChange() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => broadcast('changed'), 500);
}
function watchDir(dir) {
  try {
    const watcher = fs.watch(dir, { recursive: true }, onWatchChange);
    watcher.on('error', (e) => { console.error(`fs.watch 失效（${dir}），已通知前端降级轮询:`, e.message); broadcast('watchdead'); });
  } catch (e) {
    // 同步失败（典型：目录不存在 ENOENT）与异步 error 同口径广播 watchdead——否则前端徽标滞留「实时」而推送已死
    console.error(`fs.watch 初始化失败（${dir}，前端将走 60s 兜底轮询）:`, e.message);
    broadcast('watchdead');
  }
}
watchDir(WORKFLOW);
// 台账 append → 同一 changed 广播（引擎视图实时跟随门禁运行）。regen/compact 是临时文件 + rename
// 重写——rename 事件后旧 inode 监听失效，关掉重挂；文件暂缺（全新装机未跑过门禁）不挂不报错。
function watchLedger(file) {
  let w;
  try {
    w = fs.watch(file, (evt) => {
      onWatchChange();
      if (evt === 'rename') { try { w.close(); } catch { } setTimeout(() => watchLedger(file), 300); }
    });
    w.on('error', () => { try { w.close(); } catch { } });
  } catch { /* 暂缺：不挂，台账生成后进程重启再挂 */ }
}
watchLedger(JUDGMENTS);
watchLedger(VERIFICATIONS);
// 25s 心跳：防半开连接；顺带清理已断开的 client
setInterval(() => { for (const res of sseClients) { if (res.destroyed) sseClients.delete(res); else res.write(': ping\n\n'); } }, 25000).unref();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function sendJson(res, code, obj) {
  // X-Frame-Options（p2-batch2）：本地只读服务拒绝被外站 iframe 嵌套（配合 Host 校验收敛攻击面）
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'X-Frame-Options': 'DENY' });
  res.end(JSON.stringify(obj));
}

// ---- hard-block 告警单源（2026-09-27 board-kb-p1）----
// 看板不再自建与 check-loop 平行的 hard 规则（此前四类缺失：回路断档/验收未对账/确认未对账/确认内容漂移，
// test.md「双跑断言」曾必失败）——scanBoard 时 spawn check-loop.mjs，解析其 stderr hard-block 段为全局告警数组：
// check-loop 未来新增 hard 项看板自动跟随，口径永不分叉。输出 banner 为稳定契约（check-loop 头注释明示
// doctor/pre-push 按输出消费），本解析由双跑断言测试兜底格式漂移。
export function parseLoopHardBlocks(stderrText) {
  const text = String(stderrText || '');
  const start = text.indexOf('HARD-BLOCK:');
  if (start === -1) return [];
  let seg = text.slice(start);
  const warnIdx = seg.indexOf('WARN');
  if (warnIdx > 0) seg = seg.slice(0, warnIdx);
  return seg.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('- ['));
}

// hard-block 后台刷新（2026-10-22 board-cold-start-unblock）：原实现请求路径 spawnSync 跑 check-loop
// （实测 10~17s，check-loop 17.4s）阻塞整个事件循环——闲置 60s 后任何 /api/board（含 SSE changed 触发的
// 刷新）都把 SSE 心跳/静态文件/其他 API 全挂住，ensure-board 身份探测也因此被误判（同日修复）。
// 改 stale-while-revalidate：快照恒即时返回（无缓存 = 「预热中」note，前端 amber 条如实展示）；TTL 过期
// 由快照触发**异步**后台刷新（execFile 不阻塞），完成且内容有变才广播 changed 让前端补拉。预警层容忍
// 陈旧（原口径「陈旧 60s 可接受」延续），单飞标志防重入。
const LOOP_TTL_MS = 60_000;
const loopCache = { at: 0, v: null, running: false };
function refreshLoopBlocks() {
  if (loopCache.running) return;
  loopCache.running = true;
  execFile(process.execPath, [path.join(ROOT, '.agents', 'scripts', 'check-loop.mjs')], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    const prev = loopCache.v;
    loopCache.running = false;
    loopCache.at = Date.now();
    // check-loop 发现 hard-block 时以非零退出码结束——err 非空但 stderr 有货，照常解析；
    // 仅 spawn 本身失败（err 且无输出）才标「不可用」
    loopCache.v = (err && !stderr) ? { blocks: null, note: `check-loop 不可执行：${err.message}` } : { blocks: parseLoopHardBlocks(stderr || ''), note: '' };
    if (JSON.stringify(prev) !== JSON.stringify(loopCache.v)) broadcast('changed');
  });
}
function loopBlocksSnapshot() {
  if (!loopCache.at) return { blocks: null, note: 'check-loop 后台预热中（约 10~20s），完成后自动刷新' };
  if (Date.now() - loopCache.at > LOOP_TTL_MS) refreshLoopBlocks();
  return loopCache.v;
}

const server = http.createServer(async (req, res) => {
  try {
    // Host 校验（DNS rebinding 缓解，2026-09-27 board-kb-p1）：本地只读服务只认本机 Host
    const host = String(req.headers.host || '');
    if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) {
      return sendJson(res, 403, { error: `Host 不受信任（仅接受 127.0.0.1:${PORT} / localhost:${PORT}）` });
    }
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`); // 畸形请求行抛错 → 400（P1-3：原在 try 外，单包可杀进程）
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (url.pathname === '/api/board') return sendJson(res, 200, await scanBoard());

    // 引擎视图（2026-10-22 board-engine-views）：两本台账只读聚合（A1 门禁成本趋势 / A3 判定流水）
    //   + A2（2026-10-23）：闭环漏斗（metrics-core 单源口径，近 6 月）与复核效果（reviews.d 按月）。
    if (url.pathname === '/api/engine') {
      let funnelMonths = null; let funnelNote; let reviews = null; let reviewsNote;
      try {
        funnelMonths = aggregateFunnel(loadAllConfirmations(ROOT), firstAddedCached(), Date.now());
      } catch (e) { funnelNote = e.message; }
      try {
        reviews = scanReviews(path.join(ROOT, 'workflow'));
      } catch (e) { reviewsNote = e.message; }
      return sendJson(res, 200, {
        judgments: aggregateJudgments(readJsonl(JUDGMENTS)),
        verifications: aggregateVerifications(readJsonl(VERIFICATIONS)),
        funnel: { months: funnelMonths, note: funnelNote },
        reviews: { byMonth: reviews, note: reviewsNote },
      });
    }

    // 执行器面板（2026-10-04 board-run-panel）：run 卡片列表 + 单 run 事件流
    if (url.pathname === '/api/runs') return sendJson(res, 200, { cards: scanRuns() }); // 键名 cards 对齐 intent 2026-10-04-board-run-panel 验收#1
    if (url.pathname === '/api/run') {
      const rel = url.searchParams.get('file') || '';
      const abs = safeRunPath(rel);
      if (!abs) return sendJson(res, 403, { error: '路径不在 pipeline-runs/ 白名单内' });
      try {
        return sendJson(res, 200, { run: parseRunFile(fs.readFileSync(abs, 'utf8')) });
      } catch (e) {
        if (e && e.code === 'ENOENT') return sendJson(res, 404, { error: 'run 文件不存在' });
        console.error(`读 run 失败（${rel}）:`, e.message); // 权限/占用等如实 500 留痕，不并成 404
        return sendJson(res, 500, { error: `读 run 失败：${e.message}` });
      }
    }

    // 开发全景：/api/tour 返回模型；/tour 返回单页模板（模板内 __TOUR_FILE__ 指向当前文档）
    if (url.pathname === '/api/tour') {
      const rel = tourDocRel(url.searchParams.get('file'));
      if (!rel) return sendJson(res, 400, { error: '缺少 file 参数（workflow/<type>/<name>.md）' });
      try {
        return sendJson(res, 200, tourModel(rel));
      } catch (e) {
        const status = /白名单/.test(e.message) ? 403 : /不存在/.test(e.message) ? 404 : 500;
        return sendJson(res, status, { error: e.message });
      }
    }
    if (url.pathname === '/tour') {
      const rel = tourDocRel(url.searchParams.get('file'));
      if (!rel || !safeDocPath(rel)) return sendJson(res, 400, { error: '缺少或非法的 file 参数（workflow/<type>/<name>.md）' });
      try {
        let html = fs.readFileSync(TOUR_TEMPLATE, 'utf8');
        html = html.replace('__TOUR_DATA__', 'null')
          .replace('__TOUR_FILE__', JSON.stringify(rel))
          .replace('__TOUR_MODE__', '"live"');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(html);
      } catch (e) {
        return sendJson(res, 500, { error: `全景模板读取失败：${e.message}` });
      }
    }
    // 开发全景视图用量（2026-11-11 tour-usage）：唯一写路由——append 一行 JSON 到
    // .agents/cache/tour-usage.jsonl（gitignored，本机数据不外发）；一个迭代后按使用率裁剪
    // 低用视图（口径见 dev-tour SKILL 边界节），刻意不建查询聚合页。读写失败如实 500，不吞异常。
    if (url.pathname === '/api/tour/usage') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '仅接受 POST' });
      const chunks = [];
      let total = 0;
      for await (const c of req) {
        total += c.length;
        if (total > 8192) return sendJson(res, 400, { error: 'body 超过 8KB（用量埋点只需一行 JSON）' });
        chunks.push(c);
      }
      let row;
      try {
        row = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch (e) {
        return sendJson(res, 400, { error: `body 非合法 JSON：${e.message}` });
      }
      const rec = {
        ts: String(row.ts || new Date().toISOString()).slice(0, 32),
        doc: String(row.doc || '').slice(0, 200),
        view: String(row.view || '').slice(0, 40),
      };
      try {
        fs.mkdirSync(path.dirname(TOUR_USAGE), { recursive: true });
        fs.appendFileSync(TOUR_USAGE, JSON.stringify(rec) + '\n', 'utf8');
      } catch (e) {
        return sendJson(res, 500, { error: `用量落盘失败：${e.message}` });
      }
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/doc' || url.pathname === '/api/history') {
      const rel = url.searchParams.get('file') || '';
      const abs = safeDocPath(rel);
      if (!abs) return sendJson(res, 403, { error: '路径不在 workflow/ 白名单内' });
      if (url.pathname === '/api/doc') {
        try { return sendJson(res, 200, { text: fs.readFileSync(abs, 'utf8') }); }
        catch { return sendJson(res, 404, { error: '文件不存在' }); }
      }
      return sendJson(res, 200, { commits: await gitLog(rel) });
    }

    // 静态文件：/ 与 /marked.min.js，同样防穿越
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const abs = path.resolve(BOARD_DIR, rel);
    if (!abs.startsWith(BOARD_DIR + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    if (e && e.code === 'ERR_INVALID_URL') {
      return sendJson(res, 400, { error: `请求行/URL 非法：${e.message}` }); // 畸形请求不杀进程（P1-3）；只认 URL 错误码——其余 TypeError 是服务端缺陷，如实 500（复核 P2-1）
    }
    sendJson(res, 500, { error: e.message });
  }
});

// 绑定失败明确退出（EADDRINUSE 常见于直跑撞端口；ensure-board 会先探活选端口，这里兜底可读报错）
server.on('error', (e) => {
  console.error(`workflow 看板启动失败（端口 ${PORT}${e.code === 'EADDRINUSE' ? ' 已被占用' : ''}）：${e.code || e.message}`);
  process.exit(1);
});

// isMain 守卫（board-kb-p1）：parseLoopHardBlocks 可被测试 import（import 不 listen）
const isMain = process.argv[1] && process.argv[1].endsWith('workflow-board-server.mjs');
if (isMain) {
  // 供应商资产钉扎（2026-10-11 D1，fail-closed）：vendored marked.min.js 供应链完整性——版本与 sha256
  // 双钉，替换/篡改即拒启动（看板渲染 workflow 内容，防供应链注入；「hash everything」自洽补全）。
  // CRLF 容差（2026-10-22 board-slot-strict 冒烟实测踩坑）：钉扎哈希按 git 规范内容（LF）取——
  // core.autocrlf=true 的 Windows 检出会把 6 处换行转 CRLF，按原始字节比对恒不符 → 看板自钉扎落地起
  // 在检出机 fail-closed 拒启。校验前 \r\n → \n 归一：换行形态不敏感，防篡改语义不变（任何真实
  // 内容替换仍改变归一后字节；实测 git blob 哈希 15fabce5… 与钉扎一致，文件本身正版未动）。
  {
    const MARKED_SHA256 = '15fabce5b65898b32b03f5ed25e9f891a729ad4c0d6d877110a7744aa847a894'; // marked v12.0.2
    let actual = '';
    try {
      actual = createHash('sha256').update(fs.readFileSync(path.join(BOARD_DIR, 'marked.min.js')).toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
    } catch (e) {
      console.error(`workflow 看板启动失败：vendored marked.min.js 不可读（${e.code || e.message}）——供应链钉扎 fail-closed`);
      process.exit(1);
    }
    if (actual !== MARKED_SHA256) {
      console.error(`workflow 看板启动失败：vendored marked.min.js sha256 与钉扎不符（期望 ${MARKED_SHA256.slice(0, 16)}…，实际 ${actual.slice(0, 16)}…）——疑似替换/篡改/升级未更新钉扎，拒启动`);
      process.exit(1);
    }
  }
  // run 目录缺失（.agents/cache/ 被 gitignore，全新装机无此目录）时 fs.watch 同步抛 ENOENT 且无重试——
  // 补建空目录启用监听（pipeline-run 首跑本会建；失败不阻启动，由 watchDir catch 兜底广播 watchdead）
  try { fs.mkdirSync(PIPELINE_RUNS, { recursive: true }); } catch { /* 竞态/权限等交给 watchDir 降级 */ }
  watchDir(PIPELINE_RUNS); // 执行器 run 文件监听仅在作为服务运行时启动（import 不监听，避免测试进程挂起）
  refreshLoopBlocks(); // hard-block 后台预热（board-cold-start-unblock：冷启动首包即有告警，预热中如实展示）
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`workflow 看板: http://127.0.0.1:${PORT}  （Ctrl+C 停止；只读 workflow/ 与 pipeline-runs/；仅有的写入：视图用量埋点追加 .agents/cache/tour-usage.jsonl（本机、gitignored）、run 目录缺失时补建空目录以启用监听）`);
  });
}
