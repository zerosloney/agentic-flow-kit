#!/usr/bin/env node
// auto-tour.mjs — plan 落盘后自动拉起开发全景看板并输出 /tour 链接（Build 段回填后调用）
// 用法：node .agents/scripts/auto-tour.mjs workflow/plans/<name>.md
//
// 存在理由（2026-11-11）：stages.md Build §2 第 5 步要求「生成全景并核对文档外实际改动」，
// 但那步只产出静态快照；看板实时版要人手动跑 ensure-board 再自己拼 /tour?file= 链接。
// 本脚本把两件事并成一步：拉起看板（幂等）+ 打印本 plan 的实时链接，不弹浏览器。
//
// 三条硬约束：
//   1. 幂等：看板已在跑则复用（ensure-board 自身判定 up-to-date / stale 并决定是否重启），
//      重复调用不产生第二个进程、不抢焦点。
//   2. 不弹浏览器：ensure-board 的 --no-open；链接由本脚本输出，由人或 AI 自行打开。
//   3. 失败不阻断：看板拉不起来（端口被他人占 / 冷启动超时）时打印告警并 exit 0——
//      全景图是可选的观察面，不是门禁，Build 流程不应因它停摆。
//
// 端口单源：board-port.mjs（显式 --port > 配置基线 > BASE_BOARD_PORT，再按 SHIPYARD_SLOT 偏移；
//   与 ensure-board.mjs 同口径，共用同一函数，端口字面量不落本文件）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveBoardPort } from './board-port.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../..');
const ENSURE_BOARD = path.join(SCRIPT_DIR, 'ensure-board.mjs');

const USAGE = `用法：node .agents/scripts/auto-tour.mjs <workflow/plans/<name>.md> [--port <port>]

plan 落盘后拉起开发全景看板并打印实时链接（不弹浏览器）。
看板已在跑则复用；拉起失败只告警不阻断（exit 0）。`;

function parseArgs(argv) {
  const out = { doc: '', port: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else if (a === '--port') out.port = argv[++i] || '';
    else if (a.startsWith('-')) { console.error(`❌ 未知参数：${a}\n\n${USAGE}`); process.exit(1); }
    else if (!out.doc) out.doc = a;
    else { console.error(`❌ 只接受一个文档参数（多余：${a}）\n\n${USAGE}`); process.exit(1); }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.doc) { console.error(USAGE); process.exit(1); }

  const docAbs = path.resolve(ROOT, args.doc);
  if (!fs.existsSync(docAbs)) {
    console.error(`❌ 找不到文档：${args.doc}`);
    process.exit(1);
  }
  // 传相对路径给看板（看板按仓库相对路径解析 file 参数）
  const rel = path.relative(ROOT, docAbs).split(path.sep).join('/');

  const port = resolveBoardPort({ explicit: args.port, root: ROOT });
  const r = spawnSync(process.execPath, [ENSURE_BOARD, '--port', String(port), '--no-open'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();

  // ensure-board 失败 = 端口被他人占或冷启动超时；不阻断 Build 流程。
  // 透传末 3 行（失败信息是「原因+处置」多行，单行截尾会丢处置提示；逐行缩进保可读）
  if (r.status !== 0) {
    const tail = out.split('\n').filter(Boolean).slice(-3).map((l) => `   ${l}`).join('\n');
    console.error(`⚠ 开发全景看板未就绪（不影响 Build 流程）：\n${tail || `   exit ${r.status}`}`);
    console.error(`   手动拉起：node .agents/scripts/ensure-board.mjs --no-open`);
    process.exit(0);
  }

  console.log(out.split('\n').filter(Boolean).pop() || `board: up-to-date at http://127.0.0.1:${port}`);
  console.log(`   开发全景实时版：http://127.0.0.1:${port}/tour?file=${encodeURIComponent(rel)}`);
}

main();
