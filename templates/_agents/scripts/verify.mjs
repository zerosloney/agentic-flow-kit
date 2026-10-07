#!/usr/bin/env node
// verify.mjs — 关单固定编排（2026-09-24 intent closeout-verify-script；2026-09-26 check-loop-node 第 2 步直连 node）
// 用途：关单前一键过门——按写死顺序执行 npm test → check-loop，逐项输出 pass/fail。
// 语义：只编排不裁决——两条命令都是既有门禁原样跑，本脚本不读配置、不判窗口、不改退出码；
//   任一步非零即 fail-fast 退出 1，失败原因原样透传不吞。
//   check-loop 为 node 实现（经 check-loop.mjs 直跑——node 即本脚本运行时必然可用，
//   旧「缺 sh 环境 fail-closed」分支随 sh 依赖消失退役）。
// 凭证落账（2026-10-07 verify-evidence）：两步全绿后向 <root>/.agents/verifications.jsonl append
//   一行机器事实 {ts, exitCode:0, suite, passed?, failed?, runId?}——append-only 事实记录，不属裁决
//   （窗口判定/门禁在消费方 confirm-doc 与 check-loop 检查 8）；消费语义 = 「按门跑了 verify 且全绿」，
//   裸跑 npm test 不落账（对齐引导）。npm test 步骤输出从 inherit 改 pipe 捕获后回放（延迟显示，
//   关单场景可接受）——仅为 best-effort 抓「合计: PASS n / FAIL n」计数行，抓不到则省略计数键。
// 装户仓（根目录无 package.json，工程在子目录）下默认 npm test 恒 ENOENT（exit 4058）→ **显式跳过步骤 1**
// 且**不落测试绿凭证**（凭证语义 = 测试真跑绿，跳过即无凭证，防假绿），并提示用
// --test-cmd "<项目测试命令>" 指定；显式 --test-cmd 不受此判定影响（2026-10-07 papercut）。
// 测试：node templates/_agents/scripts/verify.test.mjs（--test-cmd 注入假命令 + CHECK_LOOP_ROOT 注入夹具，不触真实 npm test 与 workflow）
// 用法：node .agents/scripts/verify.mjs [--test-cmd "<shell 命令>"]（--test-cmd 用于测试注入，或在无根 package.json 的装户仓指定项目测试命令）
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const explicitTestCmd = args.includes('--test-cmd') ? args[args.indexOf('--test-cmd') + 1] : null;
const testCmd = explicitTestCmd ?? 'npm test';
const checkLoop = path.join(SCRIPT_DIR, 'check-loop.mjs');
const ROOT = process.env.CHECK_LOOP_ROOT || path.resolve(SCRIPT_DIR, '..', '..');

// 装户仓判定：默认命令只在**当前目录**有 package.json 时才跑（npm test 亦在该目录执行）。
// 跳过时后续不落测试绿凭证（见文末落账段）。
const hasRootPackageJson = fs.existsSync(path.join(process.cwd(), 'package.json'));
const skipTest = explicitTestCmd === null && !hasRootPackageJson;
let testStdout = '';

if (skipTest) {
  console.log('[verify] ⏭ 1/2 跳过 npm test：当前目录无 package.json（装户仓）——请按项目口径手工跑测试，或用 --test-cmd "<项目测试命令>" 指定后重跑');
} else {
  console.log(`[verify] ▶ 1/2 ${testCmd}`);
  const t = spawnSync(testCmd, { shell: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (t.stdout) process.stdout.write(t.stdout);
  if (t.stderr) process.stderr.write(t.stderr);
  if (t.status !== 0) {
    console.error(`[verify] ❌ 1/2 ${testCmd} 未通过（exit ${t.status ?? t.error?.code}）——修复后重跑，非绿不关单`);
    process.exit(1);
  }
  testStdout = String(t.stdout || '');
  console.log('[verify] ✅ 1/2 测试通过');
}

console.log('[verify] ▶ 2/2 check-loop');
const c = spawnSync(process.execPath, [checkLoop], { stdio: 'inherit' });
if (c.status !== 0) {
  console.error(`[verify] ❌ 2/2 check-loop 未通过（exit ${c.status ?? c.error?.code}）——按上方输出修复后原路重跑`);
  process.exit(1);
}
console.log('[verify] ✅ 2/2 闭环校验通过');

// 凭证落账：两步全绿才落（check-loop 红不产生凭证——凭证语义 = verify 全绿）；**步骤 1 被跳过同样不落**
// （测试未跑即无「测试绿」事实，落账即假绿）；IO 失败出账不阻断
try {
  if (skipTest) {
    console.log('[verify] ⚠️ 步骤 1 已跳过——本次不落测试绿凭证（凭证语义 = 测试真跑绿）');
  } else {
    const m = [...testStdout.matchAll(/合计: PASS (\d+) \/ FAIL (\d+)/g)].pop();
    const entry = { ts: new Date().toISOString(), exitCode: 0, suite: 'npm test' };
    if (m) { entry.passed = Number(m[1]); entry.failed = Number(m[2]); }
    if (process.env.PIPELINE_RUN_ID) entry.runId = process.env.PIPELINE_RUN_ID;
    fs.mkdirSync(path.join(ROOT, '.agents'), { recursive: true });
    fs.appendFileSync(path.join(ROOT, '.agents', 'verifications.jsonl'), `${JSON.stringify(entry)}\n`);
    console.log(`[verify] 🧾 测试绿凭证已落账 verifications.jsonl${entry.passed !== undefined ? `（PASS ${entry.passed} / FAIL ${entry.failed}）` : ''}`);
  }
} catch (e) {
  console.error(`[verify] ⚠️ 凭证落账失败（${e.code || e.message}）——不阻断，关单门前置将按无凭证告警`);
}
console.log('[verify] ✅ 全绿——可以关单（逐条勾验验收标准补证据后 intent/plan → done）');
