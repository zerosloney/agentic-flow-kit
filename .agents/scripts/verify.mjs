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
// --doc 凭证绑定（2026-10-08 verify-doc-binding）：落账行增 `doc` 字段，写入**相对仓库根的 posix 形态**
//   （win32 反斜杠 / posix 斜杠 / 绝对路径三种写法经 resolve+relative+分隔符归一后落同一值），使凭证
//   与被证明的那一单绑定。不带 --doc 时仍落行但**不写该键**——CI（kit-ci.yml）无单次上下文，照常记录
//   事实；这样的行不给任何单背书（消费方按 doc 精确匹配时 e.doc 为 undefined 恒不命中）。
// 用法：node .agents/scripts/verify.mjs [--test-cmd "<shell 命令>"] [--doc <本单 workflow 路径>]
//   （--test-cmd 用于测试注入，或在无根 package.json 的装户仓指定项目测试命令；
//     --doc 把凭证绑到本单，如 --doc workflow/intents/2026-10-08-x.md）
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

// --doc 解析（沿 --test-cmd 同款取下一 argv 的写法；缺值报用法错误 exit 1 与 --test-cmd 对称）。
// 归一基准 = **ROOT**（不是 cwd）——消费方两处都以仓库根为基准（check-loop 检查 8 用
// path.relative(ROOT, intent)；confirm-doc 的 docRelOf 用 path.resolve(root, doc)）。若这里按 cwd
// 解析而进程不在仓库根（CI / 钩子 / CHECK_LOOP_ROOT 注入夹具），落下的 doc 会是跨目录长路径，
// 凭证永远匹配不上——**基准必须三处同源**。
// 不校验目标文件是否存在：凭证记录的是「跑了什么」而非「被证明对象是否有效」，存在性校验属裁决，
// 越界（沿本件「只编排不裁决」语义）。
if (args.includes('--doc') && !args[args.indexOf('--doc') + 1]) {
  console.error('verify: --doc 缺值——用法 node .agents/scripts/verify.mjs [--test-cmd "<shell 命令>"] [--doc <本单 workflow 路径>]');
  process.exit(1);
}
const docArg = args.includes('--doc') ? args[args.indexOf('--doc') + 1] : null;
const docRel = docArg
  ? path.relative(ROOT, path.resolve(ROOT, docArg)).split(path.sep).join('/')
  : null;

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
    // doc 键：未传 --doc 时**不写该键**（不是写 null）——消费方按 doc 精确匹配，undefined 与 null 都恒不命中，
    // 但缺键让「本行没有绑定对象」这件事在台账盘面上直接可读。
    if (docRel) entry.doc = docRel;
    fs.mkdirSync(path.join(ROOT, '.agents'), { recursive: true });
    fs.appendFileSync(path.join(ROOT, '.agents', 'verifications.jsonl'), `${JSON.stringify(entry)}\n`);
    console.log(`[verify] 🧾 测试绿凭证已落账 verifications.jsonl${entry.passed !== undefined ? `（PASS ${entry.passed} / FAIL ${entry.failed}）` : ''}${docRel ? ` 绑定本单 ${docRel}` : '（未带 --doc：不给任何单背书）'}`);
  }
} catch (e) {
  console.error(`[verify] ⚠️ 凭证落账失败（${e.code || e.message}）——不阻断，关单门前置将按无凭证告警`);
}
console.log('[verify] ✅ 全绿——可以关单（逐条勾验验收标准补证据后 intent/plan → done）');
