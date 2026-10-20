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
//      （gates/headShort 新增——非 git 环境解析失败则省略、不伪造；消费方只读 ts/exitCode/doc，
//       增量字段零影响）；计数捕获只认编排器权威行 `[run-tests] 合计: SUITES n / FAILED m`
//       （嵌套套件同形行不回退——宁缺勿错，exitCode 才是硬事实）；
//   c) --doc 绑定语义保留（归一基准 = ROOT，与 confirm-doc / 检查 8 三处同源）；
//   d) --test-cmd 为 fixture 测试注入缝：替换全部生产门为 [test, check-loop] 两门夹具（夹具根里没有
//      脚本本体，check-loop 用绝对路径直调，root 归属仍由 CHECK_LOOP_ROOT 裁决）；夹具模式不触发生效规则
//      视图门与摘要生成（假门凭证只进本地台账，不产 committed 摘要）。
// 未执行门清单：fail-fast 后序门状态未知≠通过——验证系统输出须完备（「没跑」与「过了」可区分）；
//   并发编排（2026-10-16）后该清单按「已出裁决」算：guardian 门
//   （scripts-syntax）串行先跑、未过即止；其余门进工作池并发（--jobs N / --serial，缺省
//   clamp(2..4, floor(cpus/4))），各自缓冲输出、完成即整块回放；任一门红 → 停排新门 + taskkill /T
//   树杀在跑门（Windows shell:true 起的是 cmd.exe，kill 只杀壳不杀孙进程）。
// 生效规则视图门（effective-policy --check）：policy 变更后必须重生成 workflow/effective-policy.md 随同
//   提交——新装户由 init 生成器首跑种子该文件，缺文件对 --check 是漂移（红），不静默放行。
// 绿凭证摘要（gen-verify-evidence.mjs）：全绿尾部自动重生成 workflow/verify-evidence.md——全绿事实与
//   仓内摘要同刻生成，消除「本地台账已绿、committed 摘要滞后」的双真相分叉；生成失败响亮告警但不推翻绿裁决。
// 用法：node .agents/scripts/verify.mjs [--list] [--jobs N | --serial] [--test-cmd "<shell 命令>"] [--stub-gate "<命令>"] [--doc <本单 workflow 路径>]
//   --list：按执行序打印门 id 后退出，不执行（与 --test-cmd / --stub-gate 互斥）。
//   --jobs N / --serial：并发档位与串行回退（缺省 clamp(2..4, floor(cpus/4))；--jobs 0 / 非整数 fail-loud）。
//   --test-cmd 用于测试注入，或在无根 package.json 的装户仓指定项目测试命令；
//   --stub-gate <命令>（2026-10-16）：单门夹具但走**生产尾段**（落凭证 / 生成摘要）——
//     与 --test-cmd 的差异是不打 testCmd 标记、尾段按生产路径执行；**必须配 CHECK_LOOP_ROOT**（夹具根），
//     禁止在真实仓库写出可被当成关单凭证的绿行。
//   --doc 把凭证绑到本单，如 --doc workflow/intents/<日期>-<主题>.md
// 测试：node templates/_agents/scripts/verify.test.mjs（--test-cmd 注入假命令 + CHECK_LOOP_ROOT 注入夹具）
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CHECK_LOOP_ROOT || path.resolve(SCRIPT_DIR, '..', '..');

// --- 门禁定义（engine cohort 七门，序即执行序；遇红即停） ---
// guardian（2026-10-16 并行编排）：本门未过则后序门一并不启动——引擎脚本不可解析时其余门无意义，
// 且夹具根（CHECK_LOOP_ROOT 指向无脚本目录）下若并行铺开，各门会在假根里乱跑。
// deps：门间依赖边（本门须待所列门**成功**后才启动；kit 门表当前无边——机制随编排器下发，装户增门可用）。
const GATES = [
  { id: 'scripts-syntax', guardian: true, name: '引擎脚本语法自检', cmd: 'node .agents/scripts/check-scripts-syntax.mjs', folder: '.', type: 'shell' },
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

// --stub-gate（2026-10-16）：单门夹具但走**生产尾段**（落凭证 / 生成摘要）。
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

// 并发档位（2026-10-16 并行编排）：门之间无共享状态（各自独立进程 + 独立工作目录），串行编排下
// 总耗时 = 各门之和；工作池并发后墙钟 ≈ max(最长门, 各门之和 / 并发)——门自身已内部并行
//（npm test 套件池 / check-loop），档位越高越互相抢核。缺省 = clamp(2..4, floor(cpus/4))；
// --serial 回退串行（排障/对比）；--jobs N 显式钉档（0 / 非整数 fail-loud）。
const serial = args.includes('--serial');
const jobsRaw = args.includes('--jobs') ? Number(args[args.indexOf('--jobs') + 1]) : null;
if (jobsRaw !== null && (!Number.isInteger(jobsRaw) || jobsRaw < 1)) {
  console.error(`[verify] --jobs 须为正整数（现 ${args[args.indexOf('--jobs') + 1]}）`);
  process.exit(2);
}
const JOBS = serial ? 1 : Math.min(jobsRaw ?? Math.max(2, Math.min(4, Math.floor(os.cpus().length / 4))), gates.length);
// 单门输出上限（与旧 spawnSync maxBuffer 同口径）：超限即树杀判红，不静默截断（截断后的输出不可当证据）
const MAX_GATE_OUTPUT = 32 * 1024 * 1024;
// 树杀（fail-fast 中止在跑门）：Windows 下 shell:true 起的是 cmd.exe，kill 只杀壳不杀孙进程
//（npm→node 会成孤儿并占住文件锁）——故走 taskkill /T /F 整树。
const killTree = (child) => {
  try {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch { /* best-effort：杀不动不改变裁决 */ }
};

console.log(`[verify] 🚀 开始静态门验证 (共 ${gates.length} 项，并发 ${JOBS}${serial ? '·串行' : ''})${explicitTestCmd ? '【fixture 模式】' : ''}${stubCmd ? '【stub 尾段】' : ''}\n`);

async function main() {
  let passedCount = 0;
  const outputs = {};
  const durations = {};
  const doneIdx = new Set();  // 已出裁决的门序（成功/失败/中止；未列入者 = fail-fast 后状态未知）
  const aborted = new Set();  // 因他门失败被树杀中止的门序
  const running = new Map();  // 门序 -> child（树杀目标）
  let failedIdx = -1;

  const startGate = (i) => {
    const gate = gates[i];
    console.log(`[verify] ▶ ${i + 1}/${gates.length} ${gate.name}...`);
    const t0 = performance.now();
    const child = spawn(gate.cmd, { shell: true, cwd: path.join(ROOT, gate.folder) });
    running.set(i, child);
    const buf = { stdout: '', stderr: '', overflow: false };
    const pump = (src, key) => {
      src.setEncoding('utf8');
      src.on('data', (d) => {
        if (buf.overflow) return;
        buf[key] += d;
        // 与旧 spawnSync maxBuffer 同口径：超限即中止判红（不静默截断——截断后的输出不可当证据）
        if (buf[key].length > MAX_GATE_OUTPUT) { buf.overflow = true; killTree(child); }
      });
    };
    pump(child.stdout, 'stdout');
    pump(child.stderr, 'stderr');
    return new Promise((resolve) => {
      let settled = false;
      const settle = (status, error) => {
        if (settled) return;
        settled = true;
        running.delete(i);
        resolve({ status, error, ...buf, durMs: Math.round(performance.now() - t0) });
      };
      child.on('error', (e) => settle(null, e));
      child.on('close', (status) => settle(status, null));
    });
  };

  // 出裁决：先回放该门缓冲输出（并发下输出按门整块回放，逐门可读，与 run-tests 同口径），再打结论行。
  // 返回 true = 该门红（调用方据此 fail-fast）。
  const finishGate = (i, r) => {
    const gate = gates[i];
    doneIdx.add(i);
    durations[gate.id] = r.durMs;
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (aborted.has(i)) {
      console.error(`[verify] ⏹ ${i + 1}/${gates.length} ${gate.name} 已中止（他门失败触发 fail-fast，状态未知）`);
      return false;
    }
    if (r.overflow) {
      console.error(`[verify] ❌ ${i + 1}/${gates.length} ${gate.name} 未通过（输出超 ${MAX_GATE_OUTPUT / 1024 / 1024}MB 上限，已中止）`);
      recordFailure(gate.id, -1, 'output-overflow');
      return true;
    }
    if (r.status !== 0) {
      const note = `exit ${r.status ?? r.error?.code}`;
      console.error(`[verify] ❌ ${i + 1}/${gates.length} ${gate.name} 未通过 (${note})`);
      recordFailure(gate.id, r.status, note);
      return true;
    }
    outputs[gate.id] = r.stdout || '';
    console.log(`[verify] ✅ ${i + 1}/${gates.length} ${gate.name} 通过 [${r.durMs} ms]\n`);
    passedCount++;
    return false;
  };

  const wallStart = performance.now();

  // 依赖边（deps）：本门须待所列门**成功**后才启动；依赖门红/未跑 → 本门不启动（状态未知，由尾段清单兜底）
  const idxOf = new Map(gates.map((g, i) => [g.id, i]));
  const gatePromise = new Map(); // 门序 -> 该门结果 Promise（依赖方 await 用）

  // 守卫段（guardian）：串行先跑、未过即止——后序门一并不启动
  for (let i = 0; i < gates.length && failedIdx < 0; i++) {
    if (!gates[i].guardian) continue;
    const p = startGate(i);
    gatePromise.set(i, p);
    if (finishGate(i, await p) && failedIdx < 0) failedIdx = i;
  }

  if (failedIdx < 0) {
    // 主体段：工作池并发（完成一个补一个）；任一门红 → 停排新门 + 树杀在跑门（fail-fast 语义保留）
    const bodyIdx = gates.map((_, i) => i).filter((i) => !gates[i].guardian);
    let cursor = 0;
    const worker = async () => {
      while (failedIdx < 0 && cursor < bodyIdx.length) {
        const i = bodyIdx[cursor++];
        const gate = gates[i];
        // 装户仓：engine-tests 门显式跳过——跳过≠通过，不计入 passedCount、不算绿（全绿落账段据此不落凭证）
        if (skipTest && gate.id === 'engine-tests') {
          console.log(`[verify] ⏭ ${i + 1}/${gates.length} 跳过 ${gate.cmd}：当前目录无 package.json（装户仓）——请按项目口径手工跑测试，或用 --test-cmd "<项目测试命令>" 指定后重跑`);
          doneIdx.add(i);
          continue;
        }
        const deps = gate.deps || [];
        if (deps.length) {
          const depResults = await Promise.all(deps.map((d) => gatePromise.get(idxOf.get(d)) ?? Promise.resolve(null)));
          if (failedIdx >= 0) return;
          if (depResults.some((r) => !r || r.status !== 0)) continue; // 依赖未过 → 本门不启动
        }
        const p = startGate(i);
        gatePromise.set(i, p);
        if (finishGate(i, await p) && failedIdx < 0) {
          failedIdx = i;
          for (const [j, child] of [...running]) { aborted.add(j); killTree(child); }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(JOBS, bodyIdx.length) }, worker));
  }

  if (failedIdx >= 0) {
    // 未执行门清单（按「已出裁决」算，已中止的门同样状态未知——被树杀时无结论，一并点名）：
    // fail-fast 后状态未知≠通过——「没跑」在台账里与「过了」不可区分即输出不完备
    const remaining = gates.map((g, i) => i).filter((i) => !doneIdx.has(i) || aborted.has(i)).map((i) => gates[i].id);
    if (remaining.length) console.error(`[verify] ⏭️ 未执行门（fail-fast，状态未知；含被树杀的已中止门）：${remaining.join('、')}`);
    process.exit(1);
  }

  // ---- 全绿尾段（任一门红已在上方 exit 1 返回，能走到这里即全绿）----
  // 凭证落账：全部门绿才落；**测试门被跳过同样不落**（测试未跑即无「测试绿」事实，落账即假绿）；IO 失败出账不阻断
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
      // 门禁成本入账：totalMs = 各门之和（并发后已非墙钟，保留以续接历史口径）；
      // wallMs = 本次实际墙钟——「一次迭代的等待成本」是墙钟，读方以 wallMs 优先。
      entry.totalMs = Object.values(durations).reduce((a, b) => a + b, 0);
      entry.wallMs = Math.round(performance.now() - wallStart);
      entry.durations = durations;
      if (process.env.PIPELINE_RUN_ID) entry.runId = process.env.PIPELINE_RUN_ID;
      // doc 键：未传 --doc 时**不写该键**（不是写 null）——消费方按 doc 精确匹配，undefined 与 null 都恒不命中，
      // 但缺键让「本行没有绑定对象」这件事在台账盘面上直接可读。
      if (docRel) entry.doc = docRel;
      fs.mkdirSync(path.join(ROOT, '.agents'), { recursive: true });
      fs.appendFileSync(path.join(ROOT, '.agents', 'verifications.jsonl'), `${JSON.stringify(entry)}\n`);
      const top3 = Object.entries(durations).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([id, ms]) => `${id}(${(ms / 1000).toFixed(1)}s)`).join(' ');
      console.log(`[verify] 🧾 测试绿凭证已落账 verifications.jsonl${entry.passed !== undefined ? `（套件 ${entry.passed} / FAIL ${entry.failed}）` : ''}${docRel ? ` 绑定本单 ${docRel}` : '（未带 --doc：不给任何单背书）'}`);
      console.log(`[verify] ⏱️ 门禁成本：墙钟 ${(entry.wallMs / 1000).toFixed(1)}s｜各门合计 ${(entry.totalMs / 1000).toFixed(1)}s｜最慢三门 ${top3}`);
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
}

main().catch((e) => {
  console.error(`[verify] ❌ 编排器异常：${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
