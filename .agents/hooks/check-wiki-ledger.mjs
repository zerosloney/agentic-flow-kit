#!/usr/bin/env node
// wiki 台账一致性（增量版）：本次暂存触及 wiki/ 时跑 verify 三方校验（磁盘 ↔ INDEX ↔ 看板 DATA）
// 目的：给「登记动作」装触发点——verify 此前无任何钩子调用，只能靠「触及 wiki 时手跑」的文字纪律
// （incident 2026-09-16-wiki-drift-and-verifier-gaps 认定的根因）；本脚本把发现时机提前到 commit。
// 口径与 .agents/scripts/verify-wiki-consistency.mjs 一致：活层新增/删除/移动未登记、数据维护批次目录未入台账即拦。
// 自 sh 版移植 node（2026-10-08 门禁去 sh 化第二批；2026-10-13 自 Shipyard.Material 参考实现回灌）——语义逐条对齐。
// 注意 git 调用带 `-c core.quotepath=off`：quotepath 默认 true 时中文路径被转义加引号，^wiki/ 前缀
// 匹配失配 → 门禁静默跳过（2026-09-27 gate-coverage 教训）。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const git = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, out: (r.stdout || '').trim() };
};
const root = git(['rev-parse', '--show-toplevel']);
if (!root.ok) process.exit(1);
process.chdir(root.out);

const touched = git(['-c', 'core.quotepath=off', 'diff', '--cached', '--name-only']);
if (!touched.ok || !touched.out.split('\n').some((f) => f.startsWith('wiki/'))) process.exit(0);

const r = spawnSync(process.execPath, [path.join('.agents', 'scripts', 'verify-wiki-consistency.mjs')], { stdio: 'inherit' });
if (r.status !== 0) {
  console.log('wiki 台账（增量）— BLOCK:');
  console.log('  先跑 node .agents/scripts/gen-wiki-board.mjs 补 INDEX/看板（或补 wiki/数据维护/README.md 登记行），再原路重试提交');
  process.exit(1);
}
process.exit(0);
