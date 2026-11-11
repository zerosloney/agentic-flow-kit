// board-port.mjs — 看板基端口解析单源（ensure-board.mjs / auto-tour.mjs 共用，2026-11-11 抽取前各自复制同构段）
// 口径：显式 --port（绝对值，不吃槽位偏移）> engine.json boardPort（配置基线）> ports.mjs BASE_BOARD_PORT，
//   再按 SHIPYARD_SLOT 偏移。槽位派生仍单源 scripts/verify/e2e/ports.mjs（本文件 import，端口字面量不落此处）。
import fs from 'node:fs';
import path from 'node:path';
import { shiftPort, BASE_BOARD_PORT } from '../../scripts/verify/e2e/ports.mjs';

/** 解析看板基端口。explicit 传调用方的 --port 原始字符串；root 为仓库根（engine.json 定位用）。 */
export function resolveBoardPort({ explicit = '', root } = {}) {
  if (explicit && Number(explicit)) return Number(explicit); // 显式端口 = 绝对值，不吃槽位偏移（逃生口）
  // 基端口取引擎配置（init 询问值）；无配置或解析失败回落基线（单源 ports.mjs）；再叠加槽位偏移（board-slot-strict）
  let configured = BASE_BOARD_PORT;
  try {
    configured = Number(JSON.parse(fs.readFileSync(path.join(root, '.agents', 'config', 'engine.json'), 'utf8')).options.boardPort) || BASE_BOARD_PORT;
  } catch { /* 无配置回落基线 */ }
  return shiftPort(configured);
}
