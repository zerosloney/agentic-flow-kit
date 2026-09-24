#!/usr/bin/env node
// verify.mjs — 关单固定编排（2026-09-24 intent closeout-verify-script）
// 用途：关单前一键过门——按写死顺序执行 npm test → check-loop.sh，逐项输出 pass/fail。
// 语义：只编排不裁决——两条命令都是既有门禁原样跑，本脚本不新增校验、不读配置、无状态；
//   任一步非零即 fail-fast 退出 1，失败原因经 stdio inherit 原样透传不吞；
//   缺 sh 环境 fail-closed 明确报错（关单门不可跳过，不像 run-tests 那样跳过并提示）。
// 测试：node templates/_agents/scripts/verify.test.mjs（--test-cmd 注入假命令 + CHECK_LOOP_ROOT 注入夹具，不触真实 npm test 与 workflow）
// 用法：node .agents/scripts/verify.mjs [--test-cmd "<shell 命令>"]（--test-cmd 仅供测试注入）
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const testCmd = args.includes('--test-cmd') ? args[args.indexOf('--test-cmd') + 1] : 'npm test';
const checkLoop = path.join(SCRIPT_DIR, 'check-loop.sh');

console.log(`[verify] ▶ 1/2 ${testCmd}`);
const t = spawnSync(testCmd, { shell: true, stdio: 'inherit' });
if (t.status !== 0) {
  console.error(`[verify] ❌ 1/2 ${testCmd} 未通过（exit ${t.status ?? t.error?.code}）——修复后重跑，非绿不关单`);
  process.exit(1);
}
console.log('[verify] ✅ 1/2 测试通过');

console.log('[verify] ▶ 2/2 check-loop');
const c = spawnSync('sh', [checkLoop], { stdio: 'inherit' });
if (c.status !== 0) {
  const hint = c.error?.code === 'ENOENT'
    ? '环境无 sh（装 Git Bash / WSL）——关单门不可跳过，不静默放行'
    : '按上方输出修复后原路重跑';
  console.error(`[verify] ❌ 2/2 check-loop 未通过（exit ${c.status ?? c.error?.code}）——${hint}`);
  process.exit(1);
}
console.log('[verify] ✅ 2/2 闭环校验通过');
console.log('[verify] ✅ 全绿——可以关单（逐条勾验验收标准补证据后 intent/plan → done）');
