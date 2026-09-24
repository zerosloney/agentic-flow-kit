#!/usr/bin/env node
// ensure-board.mjs — workflow 看板按需手动拉起（默认不自动开启；只起不关：OS 重启即天然回收，无需 stop/status）
// 跨平台单入口（零依赖，Windows/Linux/macOS 同一脚本，取代旧 ensure-board.ps1）：
//   基端口（--port 显式 > kit.json boardPort > 8933）向上探测首个可用端口（窗口 10）——
//   端口空闲 → 全新启动；探活 /api/board 比对 root：本项目看板 → 复用（代码文件晚于服务端 startedAt = 旧代码自动 kill 重启）；
//   他人进程（其他项目看板 / 非看板服务）不动手不 kill，跳过试下一端口；全新启动成功后弹浏览器（重启/已运行不弹，SSE 自动重连）
// 身份与陈旧判定全部来自 /api/board 自报（pid/startedAt）——不碰 OS 专属的端口属主 / 进程启动时间 API。
// 用法：node .agents/scripts/ensure-board.mjs [--port 8933] [--no-open]
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../..'); // 与 server 的 ROOT 同口径
const SERVER = path.join(SCRIPT_DIR, 'workflow-board-server.mjs');
const CODE_FILES = [path.join(ROOT, '.agents', 'board', 'index.html'), SERVER]; // 前端 + 服务端：任一更新都算「旧代码」
const WINDOW = 10;

// ---- 参数与基端口 ----
const argv = process.argv;
const flagIdx = argv.indexOf('--port');
const eqArg = argv.find((a) => a.startsWith('--port='));
const portArg = flagIdx > -1 ? argv[flagIdx + 1] : eqArg && eqArg.slice('--port='.length);
const noOpen = argv.includes('--no-open');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let BASE_PORT;
if (portArg && Number(portArg)) {
  BASE_PORT = Number(portArg);
} else {
  // 基端口取 kit 台账（init 询问值，与命令文档 8933 同源）；无台账或解析失败回落 8933
  try { BASE_PORT = Number(JSON.parse(fs.readFileSync(path.join(ROOT, '.agents', 'kit.json'), 'utf8')).options.boardPort) || 8933; }
  catch { BASE_PORT = 8933; }
}

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

// ---- 探活：端口占用用 net.connect；看板身份/属主用 /api/board 自报（isBoard=含 cards 字段；ours=root 指向本项目）----
// 不用全局 fetch：undici 连接池 keep-alive 句柄会拖住/污染退出（Windows 上强退触发 libuv 断言）
function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.setTimeout(800);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(true); }); // 超时从保守视作占用；localhost 上近乎不存在
    s.on('error', () => resolve(false));
  });
}

// /api/board 用 http.get 正规解包（server 响应为 chunked，手工拼包解析不了）；Connection: close + 默认 agent 不进连接池，无残留句柄
function httpProbe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/board', headers: { Connection: 'close' }, timeout: 2000 }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: () => { try { return JSON.parse(buf); } catch { return null; } } }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0 }); });
    req.on('error', () => resolve({ status: 0 }));
  });
}

async function probeBoard(port) {
  const none = { isBoard: false };
  const r = await httpProbe(port);
  if (r.status !== 200) return none;
  const j = r.json();
  if (!j || typeof j !== 'object' || !('cards' in j)) return none;
  return { isBoard: true, ours: !!(j.root && samePath(path.resolve(String(j.root)), ROOT)), pid: j.pid, startedAt: j.startedAt };
}

// 陈旧判定：代码文件最新 mtime 晚于服务端启动时刻（2s 容差）= 旧代码；无 startedAt（旧版服务端）返回 null 无法判定
function staleCode(startedAt) {
  if (!startedAt) return null;
  const newest = Math.max(...CODE_FILES.filter((f) => fs.existsSync(f)).map((f) => fs.statSync(f).mtimeMs));
  return newest > startedAt + 2000;
}

// ---- 动作：kill / 拉起（detached + windowsHide，父进程退出后存活）/ 等监听 / 弹浏览器 ----
function startServer(port) {
  const c = spawn(process.execPath, [SERVER, '--port', String(port)], { detached: true, stdio: 'ignore', windowsHide: true });
  c.unref();
}

async function waitListen(port) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await portBusy(port)) return true;
    await sleep(300);
  }
  return false;
}

// intentional-simple: 弹浏览器 best-effort 三平台分流（win: cmd start / mac: open / linux: xdg-open），失败不打扰——链接已在输出里
function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { }
}

// ---- 主流程（返回退出码，自然排水退出——不用 process.exit：强退在 Windows 上会触发 libuv 断言）----
async function main() {
  const skipped = [];
  let action = null;
  let port = 0;
  let board = null;

  for (let p = BASE_PORT; p < BASE_PORT + WINDOW; p++) {
    if (!(await portBusy(p))) { port = p; action = 'fresh start'; break; }
    const b = await probeBoard(p);
    if (b.ours) {
      port = p;
      board = b;
      const stale = staleCode(b.startedAt);
      if (stale === true) {
        try { process.kill(b.pid); } catch { } // 进程可能已自行退出，忽略
        await sleep(500);
        action = 'restarted (stale code detected)';
      } else if (stale === null) {
        action = 'legacy';
      } else {
        action = 'up-to-date';
      }
      break;
    }
    skipped.push(`端口 ${p}（pid ${b.pid ?? '未知'}）`);
  }
  const url = `http://127.0.0.1:${port}`;

  if (!action) {
    console.log(`board: 端口 ${BASE_PORT}..${BASE_PORT + WINDOW - 1} 均被他人进程占用（未动手不 kill）：${skipped.join('；')}；可 --port 指定其他基端口`);
    return 1;
  }
  if (action === 'legacy') {
    console.log(`board: ${url} 是本项目旧版看板（无 startedAt，无法判定代码新旧），未自动重启；如需更新请手动重启`);
    return 0;
  }
  if (action === 'up-to-date') {
    console.log(`board: already up-to-date at ${url} (pid ${board.pid ?? '未知'})`);
    return 0;
  }
  if (skipped.length) console.log(`board: 基端口段他人进程已跳过：${skipped.join('；')}`);

  startServer(port);
  if (!(await waitListen(port))) {
    console.log(`board: FAILED to start on ${port}`);
    return 1;
  }
  console.log(`board: ${action} -> ${url}`);
  if (!noOpen && action === 'fresh start') openBrowser(url);
  return 0;
}

process.exitCode = await main();
