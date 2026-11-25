import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { makeTmp } from './helpers/tmp.mjs';
import { BASE_BOARD_PORT, shiftPort, resolveBoardPort } from '../templates/engine/.agents/scripts/board-port.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const BIN = path.join(REPO, 'bin', 'flow-kit.mjs');

// 槽位环境变量全量受控：两个名字都删，防开发机残留 SHIPYARD_SLOT 污染断言
function clearSlotEnv() {
  delete process.env.FLOW_KIT_BOARD_SLOT;
  delete process.env.SHIPYARD_SLOT;
}

test('BASE_BOARD_PORT 基线 8933；无槽位变量不偏移', () => {
  clearSlotEnv();
  assert.equal(BASE_BOARD_PORT, 8933);
  assert.equal(shiftPort(BASE_BOARD_PORT), 8933, 'shiftPort 无槽位环境变量时原样返回');
});

test('resolveBoardPort：无配置空目录回落基线 8933', () => {
  clearSlotEnv();
  assert.equal(resolveBoardPort({ root: makeTmp('board-port-empty-') }), 8933);
});

test('显式 --port 是绝对值，不吃槽位偏移', () => {
  process.env.FLOW_KIT_BOARD_SLOT = '3';
  process.env.SHIPYARD_SLOT = '3';
  try {
    assert.equal(resolveBoardPort({ explicit: '9999', root: REPO }), 9999, '设了槽位变量也返回 9999');
  } finally {
    clearSlotEnv();
  }
});

test('engine.json options.boardPort 作配置基线；非法配置回落 8933', () => {
  clearSlotEnv();
  const dir = makeTmp('board-port-cfg-');
  fs.mkdirSync(path.join(dir, '.agents', 'config'), { recursive: true });
  const cfg = path.join(dir, '.agents', 'config', 'engine.json');
  fs.writeFileSync(cfg, JSON.stringify({ options: { boardPort: 9000 } }));
  assert.equal(resolveBoardPort({ root: dir }), 9000);

  fs.writeFileSync(cfg, '{ broken');
  assert.equal(resolveBoardPort({ root: dir }), 8933, 'engine.json 非法时回落基线');
});

test('槽位偏移：新名 +20、旧名 +10、都设新名优先、非数字按 0', () => {
  clearSlotEnv();
  process.env.FLOW_KIT_BOARD_SLOT = '2';
  assert.equal(shiftPort(BASE_BOARD_PORT), 8953, 'FLOW_KIT_BOARD_SLOT=2 → +20');
  assert.equal(resolveBoardPort({ root: makeTmp('board-port-slot-') }), 8953, 'resolveBoardPort 同口径叠加偏移');
  clearSlotEnv();

  process.env.SHIPYARD_SLOT = '1';
  assert.equal(shiftPort(BASE_BOARD_PORT), 8943, '旧名 SHIPYARD_SLOT=1 → +10');
  clearSlotEnv();

  process.env.FLOW_KIT_BOARD_SLOT = '2';
  process.env.SHIPYARD_SLOT = '1';
  assert.equal(shiftPort(BASE_BOARD_PORT), 8953, '两个都设时新名优先（+20 而非 +10）');
  clearSlotEnv();

  process.env.FLOW_KIT_BOARD_SLOT = 'abc';
  assert.equal(shiftPort(BASE_BOARD_PORT), 8933, '新名非数字按 0 不偏移');
  clearSlotEnv();

  process.env.SHIPYARD_SLOT = 'abc';
  assert.equal(shiftPort(BASE_BOARD_PORT), 8933, '旧名非数字同样按 0');
  clearSlotEnv();
});

test('端到端：装好的项目里 ensure-board 撞上他人服务 → 报占用退出非 0，不再 ERR_MODULE_NOT_FOUND', async () => {
  // 他人服务：net 监听随机端口，HTTP 层回 404（probeBoard 即刻判定非本项目看板，不拖探测超时）
  const impostor = net.createServer((socket) => {
    socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  await new Promise((resolve) => impostor.listen(0, '127.0.0.1', resolve));
  try {
    const port = impostor.address().port;
    const dir = makeTmp('board-port-e2e-');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const inst = spawnSync(process.execPath, [BIN, 'install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, FLOW_KIT_TEST: '1' },
    });
    assert.equal(inst.status, 0, `安装应成功：${inst.stderr}`);

    const r = spawnSync(process.execPath, [BIN, 'run', '--root', dir, 'ensure-board.mjs', '--port', String(port), '--no-open'], {
      encoding: 'utf8', env: { ...process.env, FLOW_KIT_TEST: '1' },
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    assert.notEqual(r.status, 0, `他人占用端口应退出非 0；输出：${out}`);
    assert.ok(!out.includes('ERR_MODULE_NOT_FOUND'), `不得再报模块缺失：${out}`);
    assert.ok(out.includes('被他人进程占用'), `应提示端口被他人占用：${out}`);
  } finally {
    await new Promise((resolve) => impostor.close(() => resolve()));
  }
});
