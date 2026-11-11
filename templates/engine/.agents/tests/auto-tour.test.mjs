// auto-tour.test.mjs — 自动拉起开发全景看板脚本测试（node:test + node:assert，零新依赖）
// 被测：.agents/scripts/auto-tour.mjs
//
// 测三条本脚本自带的非平凡逻辑（其余是纯 spawn 转发，不测）：
//   1. 参数校验：缺文档 / 文档不存在 → exit 1 且给出可操作的提示；
//   2. 失败降级：ensure-board 起不来时脚本 exit 0 且打印告警——全景图是可选观察面，不是门禁，
//      不得因看板不可用阻断 Build 流程；
//   3. 端口语义：显式 --port 是绝对值、不吃 SHIPYARD_SLOT 槽位偏移（与 ensure-board 同口径）。
//
// 确定性口径：第 2/3 条用一个「快速响应非 200」的桩 HTTP 服务器占住端口——ensure-board 的
//   httpProbe 立即拿到非 200 → 判「他人进程占用槽位口」→ exit 1，走与真实占用同一条分支，
//   但不触发它 25s 的挂起超时（那是「占端口但不响应」的慢路径，真实冷启动环境才有，
//   放到测试里会把本门从 <3s 拉到 30s）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const AUTO_TOUR = path.join(ROOT, '.agents', 'scripts', 'auto-tour.mjs');
const PLAN = 'workflow/plans/2026-11-09-document-attachment.md';

function run(args, env = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [AUTO_TOUR, ...args], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, out, err }));
  });
}

// 起一个立刻回 404 的 HTTP 服务器占端口（非看板身份）
function occupy(port) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => { res.statusCode = 404; res.end('not a board'); });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

describe('auto-tour', () => {
  test('缺文档参数时 exit 1 并打印用法', async () => {
    const r = await run([]);
    assert.equal(r.code, 1);
    assert.match(r.err, /用法/);
  });

  test('文档不存在时 exit 1 并点名文件', async () => {
    const r = await run(['workflow/plans/__not-exist__.md']);
    assert.equal(r.code, 1);
    assert.match(r.err, /找不到文档/);
  });

  test('看板拉不起来时 exit 0 且告警——不阻断 Build 流程', async () => {
    const s = await occupy(18777);
    try {
      const r = await run([PLAN, '--port', '18777']);
      assert.equal(r.code, 0, '看板不可用时必须 exit 0');
      assert.match(r.err + r.out, /未就绪|不影响/);
      assert.match(r.err + r.out, /ensure-board/, '告警须给出手动兜底命令');
    } finally {
      s.close();
    }
  });

  test('显式 --port 是绝对值，不吃 SHIPYARD_SLOT 槽位偏移', async () => {
    const s = await occupy(18778);
    try {
      const r = await run([PLAN, '--port', '18778'], { SHIPYARD_SLOT: '2' });
      // 槽位 2 的偏移是 +20；端口若被偏移到 18798，桩服务器（18778）就拦不住它——失败分支不触发
      assert.match(r.err + r.out, /未就绪|不影响/, '端口应按绝对值使用，未被槽位偏移');
    } finally {
      s.close();
    }
  });
});
