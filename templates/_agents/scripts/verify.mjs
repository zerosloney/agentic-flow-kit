#!/usr/bin/env node
// verify.mjs — 关单/CI 统一静态门编排（GATES 表版；2026-10-13 自 Shipyard.Material 参考实现回灌，
// 源仓沿革留痕在包源仓 git 历史与 CHANGELOG——装户径不引实例路径）
// 用途：关单或 CI 前一键过门——engine cohort 七门按表执行、逐项输出 pass/fail，任一门红即 fail-fast exit 1。
// 语义：单源口径。本地 verify 与装户远端门（kit-ci.yml 同一条命令）行为 100% 一致。
// 凭证落账：全绿才落绿凭证；任一门红即落失败行（suite=门 id），供根因分析——消费方（confirm-doc 前置 /
//   check-loop 检查 8）只认 exitCode===0 的行，失败行零污染凭证判定。
// 七门照搬源仓 engine cohort（不搬 product cohort——frontend/backend 门是源仓项目私有；lane-surface-ci 门
//   依赖 kit 侧 --ci 支持核实，留后续批次评估）。源仓 --engine 增量语义不移植：本表已全为引擎段，
//   「部分绿 ≠ 全量凭证」的分野不存在。
// kit 特有语义（沿现口径保留）：
//   a) 装户仓判定——cwd 无 package.json → engine-tests 门显式跳过（跳过≠通过，不计入门数）且**不落
//      测试绿凭证**（凭证语义 = 测试真跑绿，防假绿），提示 --test-cmd；
//   b) 凭证行形状 = {ts, exitCode:0, suite:'npm test', gates, headShort?, passed?, failed?, doc?, runId?}
//      （gates/headShort 自源仓回灌新增——非 git 环境解析失败则省略、不伪造；消费方只读 ts/exitCode/doc，
//       增量字段零影响）；计数捕获只认编排器权威行 `[run-tests] 合计: SUITES n / FAILED m`
//       （嵌套套件同形行不回退——宁缺勿错，exitCode 才是硬事实）；
//   c) --doc 绑定语义保留（归一基准 = ROOT，与 confirm-doc / 检查 8 三处同源）；
//   d) --test-cmd 为 fixture 测试注入缝：替换全部生产门为 [test, check-loop] 两门夹具（夹具根里没有
//      脚本本体，check-loop 用绝对路径直调，root 归属仍由 CHECK_LOOP_ROOT 裁决）；夹具模式不触发生效规则
//      视图门与摘要生成（假门凭证只进本地台账，不产 committed 摘要）。
// 未执行门清单：fail-fast 后序门状态未知≠通过——验证系统输出须完备（「没跑」与「过了」可区分）。
// 生效规则视图门（effective-policy --check）：policy 变更后必须重生成 workflow/effective-policy.md 随同
//   提交——新装户由 init 生成器首跑种子该文件，缺文件对 --check 是漂移（红），不静默放行。
// 绿凭证摘要（gen-verify-evidence.mjs）：全绿尾部自动重生成 workflow/verify-evidence.md——全绿事实与
//   仓内摘要同刻生成，消除「本地台账已绿、committed 摘要滞后」的双真相分叉；生成失败响亮告警但不推翻绿裁决。
// 用法：node .agents/scripts/verify.mjs [--list] [--test-cmd "<shell 命令>"] [--stub-gate "<命令>"] [--doc <本单 workflow 路径>]
//   --list：按执行序打印门 id 后退出，不执行（与 --test-cmd / --stub-gate 互斥）。
//   --test-cmd 用于测试注入，或在无根 package.json 的装户仓指定项目测试命令；
//   --stub-gate <命令>（2026-10-16 自源仓回灌）：单门夹具但走**生产尾段**（落凭证 / 生成摘要）——
//     与 --test-cmd 的差异是不打 testCmd 标记、尾段按生产路径执行；**必须配 CHECK_LOOP_ROOT**（夹具根），
//     禁止在真实仓库写出可被当成关单凭证的绿行。
//   --doc 把凭证绑到本单，如 --doc workflow/intents/<日期>-<主题>.md
// 测试：node templates/_agents/scripts/verify.test.mjs（--test-cmd 注入假命令 + CHECK_LOOP_ROOT 注入夹具）
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CHECK_LOOP_ROOT || path.resolve(SCRIPT_DIR, '..', '..');

// --- 门禁定义（engine cohort 七门，序即执行序；遇红即停） ---
const GATES = [
  { id: 'scripts-syntax', name: '引擎脚本语法自检', cmd: 'node .agents/scripts/check-scripts-syntax.mjs', folder: '.', type: 'shell' },
  { id: 'engine-tests', name: '测试门 (npm test)', cmd: 'npm test', folder: '.', type: 'shell' },
  { id: 'workflows-check', name: '编排脚本检查', cmd: 'node .agents/scripts/workflows-check.mjs', folder: '.', type: 'shell' },
  { id: 'rule-budget', name: '常驻面预算检查', cmd: 'node .agents/scripts/rule-budget.mjs --all', folder: '.', type: 'shell' },
  { id: 'effective-policy', name: '生效规则视图漂移检查', cmd: 'node .agents/scripts/gen-effective-policy.mjs --check', folder: '.', type: 'shell' },
  // 默认硬门。卫生段不进关单（2026-10-13 B6b-1 分道随源仓口径）：要看时另跑 check-loop.mjs --hygiene。
  { id: 'check-loop', name: '闭环门禁校验', cmd: 'node .agents/scripts/check-loop.mjs', folder: '.', type: 'shell' },
  { id: 'ledger-invariant', name: '确认台账不变量（历史全扫）', cmd: 'node .agents/scripts/check-ledger-invariant.mjs', folder: '.', type: 'shell' },
];

// fixture 夹具门（--test-cmd 注入时替换全部生产门，verify.test.mjs 断言依赖此口径）
// check-loop 用绝对路径直调真实脚本——夹具根里没有脚本本体，root 归属仍由 CHECK_LOOP_ROOT 裁决。
const fixtureGates = (cmd) => [
  { id: 'test', name: '测试步（注入）', cmd, folder: '.', type: 'shell' },
  { id: 'check-loop', name: '闭环门禁校验', cmd: `node "${path.join(SCRIPT_DIR, 'check-loop.mjs')}"`, folder: '.', type: 'shell' },
];

const args = process.argv.slice(2);
const explicitTestCmd = args.includes('--test-cmd') ? args[args.indexOf('--test-cmd') + 1] : null;

// --stub-gate（2026-10-16 自源仓 13f67ef7 回灌）：单门夹具但走**生产尾段**（落凭证 / 生成摘要）。
// 与 --test-cmd 的关键差异：不打 testCmd 标记（fixture 模式绿行带 testCmd:true，生产凭证不与之混淆）。
// **必须配 CHECK_LOOP_ROOT**——禁止在真实仓库写出可被当成关单凭证的绿行（信任边界：夹具单门不是关单凭证）。
const stubIdx = args.indexOf('--stub-gate');
const stubCmd = stubIdx >= 0 ? args[stubIdx + 1] : null;
if (stubIdx >= 0 && !stubCmd) {
  console.error('[verify] --stub-gate 需要一条命令');
  process.exit(2);
}
if (stubCmd && explicitTestCmd) {
  console.error('[verify] --stub-gate 与 --test-cmd 互斥');
  process.exit(2);
}
if (stubCmd && !process.env.CHECK_LOOP_ROOT) {
  console.error('[verify] --stub-gate 只允许配合 CHECK_LOOP_ROOT 夹具根（禁止在真实仓库落无关单凭证）');
  process.exit(2);
}

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

// 装户仓判定：engine-tests 门只在**当前目录**有 package.json 时才跑（npm test 亦在该目录执行）。
// 跳过时后续不落测试绿凭证（见全绿落账段）。显式 --test-cmd 不受此判定影响。
const hasRootPackageJson = fs.existsSync(path.join(process.cwd(), 'package.json'));
const skipTest = explicitTestCmd === null && stubCmd === null && !hasRootPackageJson;
const gates = explicitTestCmd ? fixtureGates(explicitTestCmd)
  : stubCmd ? [{ id: 'stub', name: '夹具单门', cmd: stubCmd, folder: '.', type: 'shell' }]
  : GATES;

if (args.includes('--list')) {
  if (explicitTestCmd || stubCmd) {
    console.error('[verify] --list 与 --test-cmd / --stub-gate 互斥');
    process.exit(1);
  }
  for (const g of gates) console.log(g.id);
  process.exit(0);
}

// 失败留痕：失败行 {ts, exitCode, suite:门 id, note}——append-only 事实记录，供根因分析；
// 消费方只认 exitCode===0 的绿行，失败行零污染凭证判定。IO 失败出账不阻断。
const recordFailure = (step, exitInfo, note) => {
  try {
    const entry = { ts: new Date().toISOString(), exitCode: typeof exitInfo === 'number' ? exitInfo : -1, suite: step, note };
    if (process.env.PIPELINE_RUN_ID) entry.runId = process.env.PIPELINE_RUN_ID;
    fs.mkdirSync(path.join(ROOT, '.agents'), { recursive: true });
    fs.appendFileSync(path.join(ROOT, '.agents', 'verifications.jsonl'), `${JSON.stringify(entry)}\n`);
    console.log(`[verify] 🧾 失败行已留痕 verifications.jsonl（suite=${step}）`);
  } catch (e) {
    console.error(`[verify] ⚠️ 失败行落账失败（${e.code || e.message}）`);
  }
};

console.log(`[verify] 🚀 开始静态门验证 (共 ${gates.length} 项)${explicitTestCmd ? '【fixture 模式】' : ''}${stubCmd ? '【stub 尾段】' : ''}\n`);

let passedCount = 0;
const outputs = {};

for (let i = 0; i < gates.length; i++) {
  const gate = gates[i];
  // 装户仓：engine-tests 门显式跳过——跳过≠通过，不计入 passedCount、不算绿（全绿落账段据此不落凭证）
  if (skipTest && gate.id === 'engine-tests') {
    console.log(`[verify] ⏭ ${i + 1}/${gates.length} 跳过 ${gate.cmd}：当前目录无 package.json（装户仓）——请按项目口径手工跑测试，或用 --test-cmd "<项目测试命令>" 指定后重跑`);
    continue;
  }
  console.log(`[verify] ▶ ${i + 1}/${gates.length} ${gate.name}...`);

  const result = spawnSync(gate.cmd, {
    shell: true,
    encoding: 'utf8',
    cwd: path.join(ROOT, gate.folder),
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    const note = `exit ${result.status ?? result.error?.code}`;
    console.error(`[verify] ❌ ${i + 1}/${gates.length} ${gate.name} 未通过 (${note})`);
    // 未执行门清单：fail-fast 后序门状态未知≠通过——「没跑」在台账里与「过了」不可区分即输出不完备
    const remaining = gates.slice(i + 1).map((g) => g.id);
    if (remaining.length) console.error(`[verify] ⏭️ 未执行门（fail-fast，状态未知）：${remaining.join('、')}`);
    recordFailure(gate.id, result.status, note);
    process.exit(1);
  }
  outputs[gate.id] = result.stdout || '';
  console.log(`[verify] ✅ ${i + 1}/${gates.length} ${gate.name} 通过\n`);
  passedCount++;
}

// 凭证落账：全部门绿才落（任一门红已在上面 fail-fast 退出）；**测试门被跳过同样不落**
// （测试未跑即无「测试绿」事实，落账即假绿）；IO 失败出账不阻断
try {
  if (skipTest) {
    console.log('[verify] ⚠️ 测试门已跳过——本次不落测试绿凭证（凭证语义 = 测试真跑绿）');
  } else {
    const entry = { ts: new Date().toISOString(), exitCode: 0, suite: 'npm test' };
    // 门数：凭证明此记录「过全量门禁全绿」是几门（fixture 模式 = 2 门夹具，仍如实记）
    entry.gates = passedCount;
    // HEAD 短 SHA 钉进绿行本体（源仓回灌）：确定性证据此前只存在于测试夹具、绿行无 SHA 可锚定验证对象；
    // 非 git 环境（fixture 根在 os.tmpdir）解析失败则省略该键，不伪造。
    const rev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', cwd: ROOT });
    if (rev.status === 0 && rev.stdout) entry.headShort = rev.stdout.trim();
    // 计数行**只认编排器权威前缀**：嵌套套件同形行不回退——非本编排器口径的 --test-cmd
    //（装户项目自有测试命令）抓不到即省略计数键，不回退到错的事实（宁缺勿错，exitCode 才是硬事实）。
    const m = [...(outputs['engine-tests'] || outputs['test'] || '').matchAll(/\[run-tests\] 合计: SUITES (\d+) \/ FAILED (\d+)/g)].pop();
    if (m) { entry.passed = Number(m[1]); entry.failed = Number(m[2]); }
    if (process.env.PIPELINE_RUN_ID) entry.runId = process.env.PIPELINE_RUN_ID;
    // doc 键：未传 --doc 时**不写该键**（不是写 null）——消费方按 doc 精确匹配，undefined 与 null 都恒不命中，
    // 但缺键让「本行没有绑定对象」这件事在台账盘面上直接可读。
    if (docRel) entry.doc = docRel;
    fs.mkdirSync(path.join(ROOT, '.agents'), { recursive: true });
    fs.appendFileSync(path.join(ROOT, '.agents', 'verifications.jsonl'), `${JSON.stringify(entry)}\n`);
    console.log(`[verify] 🧾 测试绿凭证已落账 verifications.jsonl${entry.passed !== undefined ? `（套件 ${entry.passed} / FAIL ${entry.failed}）` : ''}${docRel ? ` 绑定本单 ${docRel}` : '（未带 --doc：不给任何单背书）'}`);
  }
} catch (e) {
  console.error(`[verify] ⚠️ 凭证落账失败（${e.code || e.message}）——不阻断，关单门前置将按无凭证告警`);
}

// 摘要事件原子化：全绿事实与仓内摘要（workflow/verify-evidence.md）同刻生成，消除「本地台账已绿、
// committed 摘要滞后」的双真相分叉。仅生产模式（fixture 假门凭证不产 committed 摘要；测试门跳过时
// 本就无凭证）；stub 尾段按生产路径执行（摘要落在 CHECK_LOOP_ROOT 夹具根，不触真实仓）。
// 生成失败响亮告警但不推翻绿裁决（同落账口径）。
if (!explicitTestCmd && !skipTest) {
  const gen = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'gen-verify-evidence.mjs'), '--root', ROOT], { encoding: 'utf8' });
  if (gen.status === 0) {
    if (gen.stdout) process.stdout.write(String(gen.stdout).trimEnd() + '\n');
  } else {
    console.error(`[verify] ⚠️ 绿凭证摘要生成失败（${String(gen.stderr || gen.stdout || '').trim().slice(0, 200)}）——绿裁决不变，手动补跑 node .agents/scripts/gen-verify-evidence.mjs`);
  }
}

console.log(`\n[verify] 🎉 全绿——可以关单（共 ${passedCount} 项通过；逐条勾验验收标准补证据后 intent/plan → done）`);
