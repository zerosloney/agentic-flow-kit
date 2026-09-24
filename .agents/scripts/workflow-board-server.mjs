#!/usr/bin/env node
// workflow 实时看板服务：本地只读 http + SSE 文件监听，可视化 AI 执行流程（intents/incidents/plans/specs）。
// 用法：node .agents/scripts/workflow-board-server.mjs [--port 8933]
// 零依赖（node:http/node:fs/node:path/node:url/node:child_process）；只读 workflow/ 与 git，仅绑 127.0.0.1。
// API：GET /（看板页） /marked.min.js（vendor） /api/board /api/doc?file=<相对路径> /api/history?file=<相对路径> /api/events（SSE）
// 实时边界：文档内容与状态随落盘实时（fs.watch→SSE 推送）；git 历史仅含已提交记录（git 语义）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = path.join(ROOT, 'workflow');
const BOARD_DIR = path.join(ROOT, '.agents', 'board');
const DOC_TYPES = ['intents', 'incidents', 'plans', 'specs'];

const portArg = process.argv.indexOf('--port');
const PORT = portArg > 0 ? Number(process.argv[portArg + 1]) || 8933 : 8933;

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

// ---- 验收标准 checkbox 统计：仅「## 验收标准」节内（至下一个 ## 标题），无该节返回 null ----
function parseAcceptance(text) {
  const h = text.match(/^## 验收标准.*$/m);
  if (!h) return null;
  const rest = text.slice(h.index + h[0].length);
  const next = rest.match(/^## /m);
  const section = next ? rest.slice(0, next.index) : rest;
  const total = (section.match(/^\s*[-*] \[[ xX]\]/gm) || []).length;
  if (!total) return null;
  const done = (section.match(/^\s*[-*] \[[xX]\]/gm) || []).length;
  return { done, total };
}

// ---- 配对断裂检测：按 slug 聚合同族（同名 intent/incident/plan/spec），异常卡附 alerts ----
// 规则（口径对齐 check-loop.sh 的硬断档 + 状态枚举，看板为预警层、不阻断）：
//   孤儿 spec / 孤儿 plan（无同名 intent·incident 入口）；入口 done 但 plan 未终态（看板启发式）；
//   入口缺 plan（intent 一律要求；incident 需非 legacy 且级别 L1/L2/L3）；L2/L3 入口缺同名 spec；
//   spec L3 确认三件缺失（确认结果 / 确认时间 / 正文独立复核行）；
//   状态不在枚举内或缺失（intent·spec·plan: approved/done/superseded/cancelled；incident: open/fixed/closed）
const PLAN_TERMINAL = ['done', 'superseded', 'cancelled'];
const STATUS_ENUM = {
  intents: ['approved', 'done', 'superseded', 'cancelled'],
  specs: ['approved', 'done', 'superseded', 'cancelled'],
  plans: ['approved', 'done', 'superseded', 'cancelled'],
  incidents: ['open', 'fixed', 'closed'],
};
const NO_STATUS = '（未填）';
const L3_REVIEW = /^- 独立复核：[ \t]*[^<\s]/m; // 正文独立复核行须有实质内容（对照 check-loop 锚定）

function detectAlerts(cards) {
  const bySlug = new Map();
  for (const c of cards) {
    if (!bySlug.has(c.slug)) bySlug.set(c.slug, []);
    bySlug.get(c.slug).push(c);
  }
  for (const c of cards) {
    const fam = bySlug.get(c.slug) || [];
    const types = new Set(fam.map((x) => x.type));
    const alerts = [];
    const isEntry = c.type === 'intents' || c.type === 'incidents';
    // legacy 复盘件免配对类告警（口径同 check-loop）；孤儿 spec / 孤儿 plan 两条仍按 spec·plan 自身判定
    const legacyIncident = c.type === 'incidents' && c.flow === 'legacy';
    if (!STATUS_ENUM[c.type].includes(c.status))
      alerts.push(`状态不在枚举内：须为 ${STATUS_ENUM[c.type].join('/')}（现 ${c.status === NO_STATUS ? '缺失' : c.status}）`);
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
    if (c.type === 'specs' && c.level === 'L3' && !['superseded', 'cancelled'].includes(c.status)) {
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
  return { root: ROOT, counts, cards };
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
try {
  const watcher = fs.watch(WORKFLOW, { recursive: true }, () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => broadcast('changed'), 500);
  });
  // watch 中途失效（目录被动/杀软锁）：显式告知前端降级轮询，避免假实时
  watcher.on('error', (e) => { console.error('fs.watch 失效，已通知前端降级轮询:', e.message); broadcast('watchdead'); });
} catch (e) {
  console.error('fs.watch 初始化失败（前端将走 60s 兜底轮询）:', e.message);
}
// 25s 心跳：防半开连接；顺带清理已断开的 client
setInterval(() => { for (const res of sseClients) { if (res.destroyed) sseClients.delete(res); else res.write(': ping\n\n'); } }, 25000).unref();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (url.pathname === '/api/board') return sendJson(res, 200, await scanBoard());

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
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`workflow 看板: http://127.0.0.1:${PORT}  （Ctrl+C 停止；只读 workflow/，不写任何文件）`);
});
