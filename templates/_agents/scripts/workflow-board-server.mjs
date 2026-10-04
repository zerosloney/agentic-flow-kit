#!/usr/bin/env node
// workflow 实时看板服务：本地只读 http + SSE 文件监听，可视化 AI 执行流程（intents/incidents/plans/specs）。
// 用法：node .agents/scripts/workflow-board-server.mjs [--port 8933]；多项目并行请用 ensure-board.mjs 拉起（自动上探可用端口）
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
import { execFile, spawnSync } from 'node:child_process';
import { ENUMS } from './workflow-enums.mjs';
import { stageBar } from './pipeline-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = path.join(ROOT, 'workflow');
const BOARD_DIR = path.join(ROOT, '.agents', 'board');
const DOC_TYPES = ['intents', 'incidents', 'plans', 'specs'];
const PIPELINE_RUNS = path.join(ROOT, '.agents', 'cache', 'pipeline-runs');

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

// 路径白名单：resolve 后必须仍在 pipeline-runs/ 内且 .json 后缀
function safeRunPath(rel) {
  const abs = path.resolve(PIPELINE_RUNS, rel);
  if (!abs.startsWith(PIPELINE_RUNS + path.sep) || !abs.endsWith('.json')) return null;
  return abs;
}

// ---- 配对断裂检测：按完整文件名（含日期）聚合同族，异常卡附 alerts ----
// 与 check-loop 检查 1 的 basename 同一口径。slug（去掉日期）只给界面分组，不参与配对。
// 规则（看板为预警层、不阻断；枚举读单源 workflow-enums.txt）：
//   孤儿 spec / 孤儿 plan（无同名 intent·incident 入口）；入口 done 但 plan 未终态（看板启发式）；
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
    if (c.type === 'plans' && !types.has('intents') && !types.has('incidents'))
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
    execFile(GIT, ['-c', 'core.quotepath=off', 'log', '--reverse', '--pretty=format:%x00%an', '--name-only', '--', 'workflow'], { cwd: ROOT, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
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
  const loop = loopHardBlocks(); // hard-block 全局告警（单源 check-loop；null = 校验不可用）
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

function gitLog(rel) {
  return new Promise((resolve) => {
    const GIT = process.platform === 'win32' ? 'git.exe' : 'git'; // Windows spawn 不补 .exe 扩展名
    execFile(GIT, ['log', '--follow', '--date=short', '--pretty=%H|%ad|%s', '--', rel.split('/').join(path.sep)], { cwd: WORKFLOW, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
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
    console.error(`fs.watch 初始化失败（${dir}，前端将走 60s 兜底轮询）:`, e.message);
  }
}
watchDir(WORKFLOW);
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

function loopHardBlocks() {
  // TTL 缓存（复核 P2-2 rider）：check-loop 独跑实测 ~10.5s 且 spawnSync 阻塞事件循环——搜索击键/SSE
  // 连发场景下每请求全跑不可用。60s 内复用上次结果（loopHardBlocks 是预警层非门禁，陈旧 60s 可接受；
  // 前端 loopNote 均如实展示）。进程级缓存，无失效盲区风险（比照 kb 两元组口径弱化声明：预警层容忍）。
  const NOW = Date.now();
  if (loopCache.at && NOW - loopCache.at < 60_000) return loopCache.v;
  const v = (() => {
    try {
      const r = spawnSync(process.execPath, [path.join(ROOT, '.agents', 'scripts', 'check-loop.mjs')], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      if (r.error) return { blocks: null, note: `check-loop 不可执行：${r.error.message}` };
      return { blocks: parseLoopHardBlocks(r.stderr || ''), note: '' };
    } catch (e) {
      return { blocks: null, note: e.message };
    }
  })();
  loopCache.at = NOW; loopCache.v = v;
  return v;
}
const loopCache = { at: 0, v: null };

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

    // 执行器面板（2026-10-04 board-run-panel）：run 卡片列表 + 单 run 事件流
    if (url.pathname === '/api/runs') return sendJson(res, 200, { runs: scanRuns() });
    if (url.pathname === '/api/run') {
      const rel = url.searchParams.get('file') || '';
      const abs = safeRunPath(rel);
      if (!abs) return sendJson(res, 403, { error: '路径不在 pipeline-runs/ 白名单内' });
      try {
        return sendJson(res, 200, { run: parseRunFile(fs.readFileSync(abs, 'utf8')) });
      } catch {
        return sendJson(res, 404, { error: 'run 文件不存在' });
      }
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
  watchDir(PIPELINE_RUNS); // 执行器 run 文件监听仅在作为服务运行时启动（import 不监听，避免测试进程挂起）
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`workflow 看板: http://127.0.0.1:${PORT}  （Ctrl+C 停止；只读 workflow/ 与 pipeline-runs/，不写任何文件）`);
  });
}