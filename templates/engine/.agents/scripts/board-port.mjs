// board-port.mjs — 看板端口解析单源（ensure-board.mjs / auto-tour.mjs 共用，2026-11-11 抽取前各自复制同构段）
// 口径：显式 --port（绝对值，不吃槽位偏移）> engine.json boardPort（配置基线）> BASE_BOARD_PORT，
//   再按槽位偏移 slot×10（FLOW_KIT_BOARD_SLOT 优先，旧名 SHIPYARD_SLOT 兼容；非数字按 0）。
// 自包含（2026-11-24）：原 import 的 scripts/verify/e2e/ports.mjs 属抽取前另一项目、不随包分发，
//   安装目标里不存在，ensure-board / auto-tour 一跑即 ERR_MODULE_NOT_FOUND——基线端口与槽位偏移落回本文件。
import fs from 'node:fs';
import path from 'node:path';

export const BASE_BOARD_PORT = 8933; // 看板基端口（ports.mjs 不再是单源，字面量落此处）

/** 槽位偏移：给定端口叠加 slot×10。槽位号取 FLOW_KIT_BOARD_SLOT（优先），旧名 SHIPYARD_SLOT 兼容；非数字按 0。 */
export function shiftPort(port) {
  const slot = Number(process.env.FLOW_KIT_BOARD_SLOT ?? process.env.SHIPYARD_SLOT);
  return port + (Number.isFinite(slot) ? slot : 0) * 10;
}

/** 解析看板基端口。explicit 传调用方的 --port 原始字符串；root 为仓库根（engine.json 定位用）。 */
export function resolveBoardPort({ explicit = '', root } = {}) {
  if (explicit && Number(explicit)) return Number(explicit); // 显式端口 = 绝对值，不吃槽位偏移（逃生口）
  // 基端口取引擎配置（init 询问值）；无配置或解析失败回落基线；再叠加槽位偏移（board-slot-strict）
  let configured = BASE_BOARD_PORT;
  try {
    configured = Number(JSON.parse(fs.readFileSync(path.join(root, '.agents', 'config', 'engine.json'), 'utf8')).options.boardPort) || BASE_BOARD_PORT;
  } catch { /* 无配置回落基线 */ }
  return shiftPort(configured);
}
