#!/usr/bin/env node
// ensure-board.mjs — workflow 看板按需手动拉起（默认不自动开启；只起不关：OS 重启即天然回收，无需 stop/status）
// 跨平台单入口（零依赖，Windows/Linux/macOS 同一脚本，取代旧 ensure-board.ps1）：
//   端口语义（2026-10-22 board-slot-strict，与前端/端到端同式）：基端口 = --port 显式（绝对值，不吃槽位偏移）
//   > 配置基线（init 询问值，存于 engine.json）> 8933，再按 SHIPYARD_SLOT 偏移 slot×10（缺省 0 = 8933）；
//   strict——只绑槽位端口（不漂移）：活的本项目看板 → 复用（代码文件晚于服务端 startedAt = 旧代码自动 kill 重启）；
//   他人进程（其他项目看板 / 非看板服务）不动手不 kill，直接失败退出并提示（旧上探窗口 10 会漂进相邻槽位服务口）。
//   端口解析单源 board-port.mjs（本文件 import；槽位派生仍单源 scripts/verify/e2e/ports.mjs，端口字面量不落脚本）。
// 身份与陈旧判定全部来自 /api/board 自报（pid/startedAt）——不碰 OS 专属的端口属主 / 进程启动时间 API。
// 用法：flow-kit run ensure-board.mjs [--port 8933] [--no-open]（多 worktree 并行设 SHIPYARD_SLOT=<n>）
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { resolveBoardPort } from './board-port.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.FLOW_KIT_PROJECT_ROOT || path.join(SCRIPT_DIR, '../..')); // 与 server 的 ROOT 同口径
const SERVER = path.join(SCRIPT_DIR, 'workflow-board-server.mjs');
const CODE_FILES = [
  path.join(ROOT, '.agents', 'board', 'index.html'),
  SERVER,
  path.join(SCRIPT_DIR, 'workflow-enums.mjs'),   // server import 即加载（p2-batch2：枚举更新不触发重启的盲区）
  path.join(ROOT, '.agents', 'board', 'marked.min.js'), // 前端运行时依赖（同盲区）
  path.join(SCRIPT_DIR, 'dev-tour-model.mjs'),   // server import 即加载（dev-tour 模型）
]; // 任一更新都算「旧代码」
const WINDOW = 1; // strict（2026-10-22 board-slot-strict）：只试槽位端口一口；旧上探窗口 10 会漂进相邻槽位服务口（如 8942=槽位1 API）

// ---- 参数与基端口 ----
const argv = process.argv;
const flagIdx = argv.indexOf('--port');
const eqArg = argv.find((a) => a.startsWith('--port='));
const portArg = flagIdx > -1 ? argv[flagIdx + 1] : eqArg && eqArg.slice('--port='.length);
const noOpen = argv.includes('--no-open');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE_PORT = resolveBoardPort({ explicit: portArg, root: ROOT }); // 基端口解析单源 board-port.mjs（含显式端口绝对值不吃槽位偏移语义）

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
// 超时 25s（board-slot-strict 实测踩坑×2）：**旧版服务端**（去阻塞改造前）的 /api/board 在请求路径
// 同步跑 check-loop（全量门实测 17.4s）——闲置后首包阻塞整个事件循环，探测窗口必须盖过旧版最坏冷启动
// 才能把自己人认出来（15s 实测仍不够）。新版服务端 /api/board 恒即时返回，25s 仅为旧版兼容余量。
function httpProbe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/board', headers: { Connection: 'close' }, timeout: 25000 }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: () => { try { return JSON.parse(buf); } catch { return null; } } }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0 }); });
    req.on('error', () => { resolve({ status: 0 }); });
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
  return c; // 返回 child 供竞态复验比对 pid（p2-batch2）
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
    console.log(`board: 槽位端口 ${BASE_PORT} 被他人进程占用（strict 不漂移不 kill）：${skipped.join('；')}；换 SHIPYARD_SLOT 槽位或 --port 显式指定`);
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

  const child = startServer(port);
  if (!(await waitListen(port))) {
    console.log(`board: FAILED to start on ${port}`);
    return 1;
  }
  // 竞态复验（2026-09-27 p2-batch2；同日复核 P1-1 收窄）：waitListen 只见「端口有人听」——spawn 与
  // listen 之间他人进程抢先绑定同端口时自家子进程已 EADDRINUSE 退出。复验 /api/board 自报 pid 与
  // 自家子进程一致。判定顺序（复核实测教训：冷启动首包可达 12s，2s 硬超时会误杀 fresh start 主路径；
  //   2026-10-22 board-slot-strict 再实测：闲置后冷跑 check-loop spawnSync 阻塞事件循环可达 ~17s
  //   （全量门实测 check-loop 17.4s），15s 窗口仍会误报「未能确认为本项目」——扩至 25s）：
  //   ① 子进程已退出（EADDRINUSE 自杀）→ 端口确被抢占，如实报告；
  //   ② 25s 内轮询 probeBoard 直到自报 pid === 自家 pid（长超时容忍冷启动）；
  //   ③ 轮询超时仍不一致 → 如实报告未确认为本项目（不误称他人抢占）。
  const deadline = Date.now() + 25000;
  let mine = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      console.log(`board: 端口 ${port} 在启动窗口被他人进程抢占（本项目进程已退出 exitCode=${child.exitCode}）——本轮未拉起本项目看板，重跑 ensure-board 即可（strict：不自动换端口）`);
      return 1;
    }
    mine = await probeBoard(port);
    if (mine.ours && mine.pid === child.pid) break;
    await sleep(400);
  }
  if (!mine || !mine.ours || mine.pid !== child.pid) {
    console.log(`board: 端口 ${port} 上的服务未能确认为本项目（pid ${child.pid}，自报 ${mine?.pid ?? '未知'}）——冷启动超时或被抢占；可重跑 ensure-board`);
    return 1;
  }
  console.log(`board: ${action} -> ${url}`);
  if (!noOpen && action === 'fresh start') openBrowser(url);
  return 0;
}

process.exitCode = await main();
