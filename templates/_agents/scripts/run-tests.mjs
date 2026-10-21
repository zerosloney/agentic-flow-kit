#!/usr/bin/env node
// run-tests — 引擎脚本测试统一入口（2026-10-08 agents-hygiene 批2；2026-10-09 并行化）
// 用途：一条命令跑 .agents/scripts/ 下全部 *.test.mjs 套件——逐个 node 直跑（与 test.md 逐条口径一致，
//       不引 node --test：既有套件是自研 check/「合计: PASS n / FAIL n」计数风格，非 node:test 风格）。
// 语义：套件并发执行（默认 clamp(4..12, 逻辑核数) 自适应，--concurrency <N> 可调，1 = 等价旧串行；非正整数 fail-loud）——每套件
//       stdout/stderr 缓冲、完成即回放（「[run-tests] ▶ 套件名」分隔头，避免并行交错不可读）；
//       stderr 仅红套件回放尾部 5 行防刷屏；聚合各套件「合计: PASS n / FAIL n」末次计数（无该行按 0 计）；
//       任一套件 exit 非零 / spawn 失败 / 计数 FAIL>0 → 该套件记红；有红套件即 exit 1。
//       套件发现 = 目录内 *.test.mjs 字典序（非递归）；回放按完成序（并行的自然结果，不影响裁决）。
// 红线：只做调度层并行，不改任何套件内部。并发沿革三段：①默认 6（2026-10-09 实测：串行 2m47s →
// 并发4 2m05s → 并发6 1m48s；Windows spawn 密集放大瞬时抖动——同日实证一次 git EBUSY 偶发红，套件内
// git 调用已有 gitRetry 防护）；②6→12 仅 -3~5%（2026-10-10 复测，膝点 4-6 间：工作池地板 =
// check-loop.test 独跑 73.8s 占总时长 65%）默认维持 6；③前提推翻（分片批）：check-loop.test 场景
// 注册表化 + 自分裂子进程后地板 73.8s→27.1s，中速套件接力轮次成为新瓶颈——默认改 clamp(4..12,
// 核数) 自适应（见 DEFAULT_CONC 注），上限 12 防 spawn 风暴。
// 用法：node .agents/scripts/run-tests.mjs [--dir <目录>] [--only <文件名子串>] [--concurrency <N>]
//       --dir 默认本脚本所在目录（测试注入钩子）；--only 过滤文件名（调试单套件用，如 --only check-loop）。
// 测试：node .agents/scripts/run-tests.test.mjs（临时目录夹具：并行全绿聚合 / 红套件 / 崩溃套件 / --only / 空目录 / 并发数校验 / 并发1=串行）
// 沿革：2026-10-08 立档（串行）；2026-10-09 并行化（sess_52d1d1be 路线图「串行→并行」真缺口）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const dir = val('--dir') || SCRIPT_DIR;
const only = val('--only');
const concRaw = val('--concurrency');
// 默认并发 = clamp(4..12, 逻辑核数)（前提已变：check-loop.test 分片后地板 73.8s→27.1s，中速套件
// 接力轮次成为新瓶颈；上限 12 防 spawn 风暴，小核 CI 自适应降档、=1 即顺序等价）
const DEFAULT_CONC = Math.min(12, Math.max(4, os.cpus().length));
const CONC = concRaw === null ? DEFAULT_CONC : Number(concRaw);
if (!Number.isInteger(CONC) || CONC < 1) {
  console.error(`run-tests: --concurrency 须为正整数（现 ${concRaw}）`);
  process.exit(1);
}

let suites;
try {
  suites = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && (!only || f.includes(only))).sort();
} catch (e) {
  console.error(`run-tests: 无法读取目录 ${dir}（${e.code || e.message}）`);
  process.exit(1);
}
if (!suites.length) {
  console.error(`run-tests: ${dir} 下无 *.test.mjs${only ? `（--only ${only}）` : ''}`);
  process.exit(1);
}

// 工作池调度（完成一个补一个——分块会让最慢套件阻塞同块槽位，2026-10-09 实测 check-loop.test 独占 ~1/3 时长）
let totalPass = 0, totalFail = 0, red = 0;
const slow = []; // Top3 慢套件（耗时分布可见性；同批的自适应并发原以「check-loop.test 未分片、
//   73.8s 地板前提未变」为不采理由——本批分片落地后前提推翻，DEFAULT_CONC 已解锁，见上沿革③）
const runSuite = (s) => new Promise((resolve) => {
  const t0 = Date.now();
  const child = spawn(process.execPath, [path.join(dir, s)]);
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('close', (code) => resolve({ stdout: out, stderr: err, status: code, error: null, ms: Date.now() - t0 }));
  child.on('error', (e) => resolve({ stdout: out, stderr: err, status: null, error: e, ms: Date.now() - t0 }));
});
const replay = (s, r) => {
  const m = [...String(r.stdout || '').matchAll(/合计: PASS (\d+) \/ FAIL (\d+)/g)].pop();
  const p = m ? Number(m[1]) : 0;
  const f = m ? Number(m[2]) : 0;
  totalPass += p;
  totalFail += f;
  const ok = r.status === 0 && f === 0;
  slow.push({ s, ms: r.ms || 0 });
  slow.sort((a, b) => b.ms - a.ms);
  if (slow.length > 3) slow.length = 3;
  const sec = ((r.ms || 0) / 1000).toFixed(1);
  process.stdout.write(`\n[run-tests] ▶ ${s}\n`);
  if (r.stdout) process.stdout.write(r.stdout);
  if (ok) {
    console.log(`[run-tests] OK ${s}（PASS ${p} / FAIL ${f}，${sec}s）`);
  } else {
    red++;
    console.log(`[run-tests] RED ${s}${r.status != null ? `（exit ${r.status}）` : r.error ? `（spawn ${r.error.code || r.error.message}）` : ''}${m ? `（PASS ${p} / FAIL ${f}，${sec}s）` : ''}`);
    if (r.stderr) process.stderr.write(String(r.stderr).split('\n').slice(-5).join('\n') + '\n');
  }
};
{
  const queue = [...suites];
  const inflight = new Map(); // suite -> promise（回放按提交序记录、完成即按序回放：用「下一个待回放」指针）
  const pending = [];         // {s, promise}
  let cursor = 0;
  const launch = () => {
    while (inflight.size < CONC && queue.length) {
      const s = queue.shift();
      const pr = runSuite(s).then((r) => ({ s, r }));
      inflight.set(s, pr);
      pending.push(pr);
    }
  };
  launch();
  while (cursor < pending.length) {
    const { s, r } = await pending[cursor++];
    inflight.delete(s);
    replay(s, r);
    launch();
  }
}
console.log(`\n[run-tests] 套件 ${suites.length}（红 ${red}，并发 ${CONC}）｜断言合计 PASS ${totalPass} / FAIL ${totalFail}${red ? '——红套件见上，修复后原路重跑' : '——全绿'}`);
if (slow.length) console.log(`[run-tests] 最慢${slow.length > 1 ? ` Top${slow.length}` : ''}：${slow.map((x) => `${x.s} ${(x.ms / 1000).toFixed(1)}s`).join(' · ')}`);
process.exit(red ? 1 : 0);
