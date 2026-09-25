#!/usr/bin/env node
// wf-run.mjs — 脚本化子智能体编排 runner（契约见 .agents/workflows/_TEMPLATE.md 与 workflow/specs/2026-09-25-subagent-orchestration.md）
// 用法: node wf-run.mjs <script.mjs> [--provider <名>] [--concurrency N] [--timeout-ms N] [--dry-run] [--quiet] [--no-ledger]
//       [--root <dir>] [--ledger <file>]（后两者为测试注入用）
// 传输协议（2026-09-25 incident 修订）: 派单 prompt 默认经 **stdin** 传给子进程（命令模板不含 {PROMPT} 即 stdin 形态）；
//   模板含 {PROMPT} 则内联替换（POSIX / Windows 非 cmd 可用）——Windows 批处理 shim + 多行 prompt 会被 cmd.exe 截断，此处 fail-fast 拒绝。
// 纪律：workflow 脚本随 plan 确认后方可执行（确认前 --dry-run）；runner 与子智能体均不 commit / push。
// 零依赖：仅 node 内置模块；引擎要求 node ≥ 18。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_DEFAULT_ROOT = path.resolve(SELF_DIR, '..', '..');

// ---------- CLI ----------
function fail(msg, hint) { console.error(`wf-run: ${msg}${hint ? `\n  ${hint}` : ''}`); process.exit(2); }

function parseArgs(argv) {
  const opt = { provider: null, concurrency: null, timeoutMs: null, dryRun: false, quiet: false, noLedger: false, root: null, ledger: null, script: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider') opt.provider = argv[++i];
    else if (a === '--concurrency') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) fail(`--concurrency 须为正整数（收到: ${argv[i]}）`); // NaN 会让信号量条件永假 → 静默死锁
      opt.concurrency = n;
    } else if (a === '--timeout-ms') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) fail(`--timeout-ms 须为正数毫秒（收到: ${argv[i]}）`);
      opt.timeoutMs = n;
    } else if (a === '--dry-run') opt.dryRun = true;
    else if (a === '--quiet') opt.quiet = true;
    else if (a === '--no-ledger') opt.noLedger = true;
    else if (a === '--root') opt.root = argv[++i];
    else if (a === '--ledger') opt.ledger = argv[++i];
    else if (!a.startsWith('--')) { if (opt.script) fail('只接受一个脚本参数', `已收到第二个: ${a}`); opt.script = a; }
    else fail(`未知参数 ${a}`, '用法: node wf-run.mjs <script.mjs> [--provider <名>] [--concurrency N] [--timeout-ms N] [--dry-run] [--quiet] [--no-ledger]');
  }
  if (!opt.script) fail('缺脚本参数', '用法: node wf-run.mjs <script.mjs> [--provider <名>] [--concurrency N] [--timeout-ms N] [--dry-run] [--quiet] [--no-ledger]');
  return opt;
}

const opt = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(opt.root || RUNNER_DEFAULT_ROOT);
const ROLES_DIR = path.join(ROOT, '.agents', 'roles');
const LEDGER_PATH = opt.ledger ? path.resolve(opt.ledger) : path.join(ROOT, 'workflow', 'delegations.md');
if (!fs.existsSync(ROLES_DIR)) fail(`角色目录不存在: ${ROLES_DIR}`, '先 flow-kit init/sync 安装引擎，或用 --root 指向项目根');

// ---------- provider 注册表（builtin ← providers.json ← providers.local.json 三层 deep-merge） ----------
// 内置模板为 stdin 形态（无 {PROMPT}，prompt 经 stdin 传入）——Windows npm 全局 CLI 均为 .cmd shim，内联多行 prompt 会被 cmd.exe 截断
const BUILTIN_PROVIDERS = {
  zcode: { cmd: ['zcode', 'exec', '-'] },
  claude: { cmd: ['claude', '-p'] },
  opencode: { cmd: ['opencode', 'run'] },
  codex: { cmd: ['codex', 'exec', '-'] },
};
function loadProviders() {
  const merged = structuredClone(BUILTIN_PROVIDERS);
  for (const name of ['providers.json', 'providers.local.json']) {
    const file = path.join(ROOT, '.agents', 'workflows', name);
    if (!fs.existsSync(file)) continue;
    let proj;
    try { proj = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(`${name} 解析失败: ${e.message}`); }
    for (const [k, v] of Object.entries(proj)) {
      if (v === null) { delete merged[k]; continue; }
      merged[k] = { ...merged[k], ...v };
    }
  }
  return merged;
}

// ---------- 脚本加载与校验 ----------
async function loadScript(scriptPath) {
  let mod;
  try { mod = await import(pathToFileURL(path.resolve(scriptPath)).href); }
  catch (e) { fail(`脚本加载失败: ${e.message}`); }
  const def = mod.default;
  if (!def || typeof def !== 'object') fail('脚本须 default 导出一个编排定义对象');
  if (typeof def.name !== 'string' || !def.name.trim()) fail('编排定义缺 name（string）');
  if (typeof def.run !== 'function') fail('编排定义缺 run（async (wf) => {...}）');
  return def;
}

// ---------- spawn 计划 ----------
// argv 数组为标准（不走 shell；Windows .cmd/.bat shim 例外走 shell + 引号转义）。
// stdin 协议：模板不含 {PROMPT} → prompt 经 child stdin 传入（跨平台安全，无命令行长度/换行限制）。
function resolveWin(name) {
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';');
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    // PATHEXT 可执行扩展优先——npm 全局目录里的无扩展名同名文件是 sh 脚本，CreateProcess 执行不了
    for (const ext of [...exts, '']) {
      const p = path.join(dir, name + ext);
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { /* PATH 中不可读项跳过 */ }
    }
  }
  return null;
}
function winQuote(argv) {
  return argv.map((a) => (/[\s"]/.test(a) ? '"' + a.replaceAll('"', '""') + '"' : a)).join(' ');
}
function spawnPlan(cmdTpl, prompt, provName) {
  const inline = Array.isArray(cmdTpl) ? cmdTpl.some((t) => String(t).includes('{PROMPT}')) : String(cmdTpl).includes('{PROMPT}');
  const sub = (s) => s.replaceAll('{PROMPT}', prompt);
  if (Array.isArray(cmdTpl)) {
    const argv = cmdTpl.map((t) => sub(String(t)));
    if (process.platform !== 'win32') return { file: argv[0], argv, shell: false, stdin: !inline }; // POSIX：argv[0] 为程序名标签
    const resolved = resolveWin(argv[0]);
    if (resolved && /\.(cmd|bat)$/i.test(resolved)) {
      // 批处理 shim 经 cmd.exe 解析——命令行遇换行即截断，多行 prompt 内联是静默丢失（incident 2026-09-25 P0-1），必须拒绝
      if (inline && argv.some((a) => /[\r\n]/.test(a))) {
        throw new Error(`provider「${provName}」解析为 Windows 批处理（${resolved}），内联多行 prompt 会被 cmd.exe 截断——改用 stdin 形态（命令模板去掉 {PROMPT}）或经 providers(.local).json 覆写为可执行文件路径`);
      }
      return { cmdline: winQuote([resolved, ...argv.slice(1)]), shell: true, stdin: !inline };
    }
    // Windows：cmdline = file + argv 逐 token 拼接，子进程跳过首 token——argv 不得重复 program
    return { file: resolved || argv[0], argv: argv.slice(1), shell: false, stdin: !inline };
  }
  return { cmdline: sub(String(cmdTpl)), shell: true, stdin: !inline };
}

// ---------- 编排面 ----------
function makeWf(def, providers) {
  const concurrency = Math.max(1, opt.concurrency ?? def.concurrency ?? 2);
  const defaultTimeout = opt.timeoutMs ?? 600000;
  let inFlight = 0, seq = 0;
  const agents = []; // 汇总行
  const results = { agents, gates: [], peakConcurrency: 0 };
  let chain = Promise.resolve(); // 收尾链：agent 启动即入队——脚本不 await 的派单也被等待并留痕（incident 2026-09-25 P1-1）

  const log = (...m) => { if (!opt.quiet) console.error(`[wf:${def.name}]`, ...m); };

  function acquire() {
    return new Promise((res) => {
      const tryStart = () => {
        if (inFlight < concurrency) {
          inFlight++;
          results.peakConcurrency = Math.max(results.peakConcurrency, inFlight);
          res();
        } else setTimeout(tryStart, 25);
      };
      tryStart();
    });
  }

  async function runAgent(role, task, o) {
    await acquire();
    try {
      let r;
      for (let attempt = 0; attempt <= o.retries; attempt++) {
        if (attempt > 0) log(`${role}#${o.n} 第 ${attempt} 次重试…`);
        r = await runAgentOnce(role, task, o);
        if (r.ok) { r.retriesUsed = attempt; break; }
        if (attempt === o.retries) r.retriesUsed = attempt;
      }
      r.role = role; r.task = task; r.tag = `${role}#${o.n}`;
      agents.push(r);
      log(`${r.tag} ${r.ok ? '✅' : '❌'} ${(r.durationMs / 1000).toFixed(1)}s${r.retriesUsed ? `（重试 ${r.retriesUsed} 次）` : ''}${r.blocker ? '（BLOCKER）' : ''}${r.error ? ` ${r.error}` : ''}`);
      return r;
    } finally { inFlight--; }
  }

  async function runAgentOnce(role, task, o) {
    const prov = providers[o.provider];
    if (!prov) throw new Error(`provider「${o.provider}」不在注册表（内置: ${Object.keys(BUILTIN_PROVIDERS).join('/')}；可经 .agents/workflows/providers(.local).json 覆写）`);
    if (!Array.isArray(prov.cmd) && typeof prov.cmd !== 'string') throw new Error(`provider「${o.provider}」缺 cmd`);
    const prompt = buildPrompt(role, task, o);
    const plan = spawnPlan(prov.cmd, prompt, o.provider); // 配置错误（批处理 + 多行内联）在此同步 throw，主流程 fail-fast 可见
    const tagPrefix = `[${role}#${o.n}] `;
    const t0 = Date.now();
    return await new Promise((resolve) => {
      const child = plan.shell
        ? spawn(plan.cmdline, { shell: true, cwd: ROOT, env: { ...process.env, WF_PROMPT: prompt, WF_ROLE: role } })
        : spawn(plan.file, plan.argv, { shell: false, cwd: ROOT, env: { ...process.env, WF_PROMPT: prompt, WF_ROLE: role } });
      if (plan.stdin) {
        child.stdin.on('error', () => { /* 子进程不读 stdin 提前退出属正常 */ });
        child.stdin.write(prompt);
        child.stdin.end();
      }
      let out = '', killed = false, settled = false;
      // 行缓冲前缀转发：完整行才落 tag——预写悬空前缀会把 runner 自身日志吞进子智能体名下（并发时归属误导）
      const mkForward = (dest) => {
        let buf = '';
        return {
          push(chunk) { if (out.length < 512 * 1024) out += chunk; if (opt.quiet) return; buf += chunk.toString(); const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) dest.write(tagPrefix + l + '\n'); },
          flush() { if (!opt.quiet && buf) { dest.write(tagPrefix + buf + '\n'); buf = ''; } },
        };
      };
      const fwdOut = mkForward(process.stdout), fwdErr = mkForward(process.stderr);
      child.stdout.on('data', fwdOut.push);
      child.stderr.on('data', fwdErr.push);
      const timer = setTimeout(() => {
        killed = true;
        if (process.platform === 'win32' && child.pid) {
          // Windows 下 provider 多为 .cmd shim：SIGTERM 杀不掉 shim 背后的孙进程，close 会拖到其自然退出——按进程树强杀
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
        } else {
          child.kill('SIGTERM');
        }
      }, o.timeoutMs);
      const done = (ok, extra = {}) => {
        if (settled) return; settled = true; clearTimeout(timer);
        fwdOut.flush(); fwdErr.flush();
        resolve({ ok, exitCode: child.exitCode, output: out, durationMs: Date.now() - t0, provider: o.provider, timedOut: killed, blocker: /BLOCKER:/.test(out), ...extra });
      };
      child.on('error', (e) => done(false, { error: `${Array.isArray(prov.cmd) ? prov.cmd[0] : prov.cmd} 启动失败：${e.message}（provider 不在 PATH？可经 .agents/workflows/providers(.local).json 覆写命令）` }));
      child.on('close', (code) => done(code === 0));
    });
  }

  function agent(role, task, o = {}) {
    if (typeof role !== 'string' || !role.trim()) throw new Error('wf.agent: role 必填');
    if (typeof task !== 'string' || !task.trim()) throw new Error('wf.agent: task 必填');
    if (!fs.existsSync(path.join(ROLES_DIR, `${role}.md`))) throw new Error(`wf.agent: 未知角色「${role}」——.agents/roles/ 下无 ${role}.md`);
    const conf = { provider: opt.provider ?? def.provider ?? 'zcode', timeoutMs: defaultTimeout, retries: 0, ...o, n: ++seq };
    const p = runAgent(role, task, conf);
    chain = chain.then(() => p, () => p); // 启动即入收尾链：脚本异常退出时在跑派单仍被等待并写台账
    return p;
  }

  function gate(cmd, o = {}) {
    const quiet = o.quiet ?? opt.quiet;
    if (!quiet) log(`gate: ${cmd}`);
    const r = spawnSync(cmd, { shell: true, cwd: o.cwd || ROOT, timeout: o.timeoutMs ?? defaultTimeout, encoding: 'utf8', detached: process.platform !== 'win32' });
    const rec = { cmd, status: r.status, timedOut: !!r.signal };
    results.gates.push(rec);
    if (!quiet) console.log(r.stdout); if (r.stderr && !quiet) console.error(r.stderr);
    if (r.signal && r.pid) {
      // 超时被杀只回收了 shell 本体——孙进程（如 npm test 起的测试进程）会孤儿化继续跑，按树补杀
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(r.pid), '/T', '/F']);
      else { try { process.kill(-r.pid, 'SIGKILL'); } catch { /* 进程组已回收 */ } }
    }
    if (r.status !== 0) {
      const tail = `${r.stdout || ''}${r.stderr || ''}`.slice(-2000);
      throw new Error(`GATE 失败（exit ${r.status ?? 'signal'}）: ${cmd}\n${tail}`);
    }
    return rec;
  }

  async function parallel(tasks) {
    if (!Array.isArray(tasks) || tasks.some((t) => typeof t !== 'function')) throw new Error('wf.parallel: 传入任务函数数组，如 [() => wf.agent(...), ...]');
    return Promise.all(tasks.map((t) => t()));
  }

  return {
    agent, gate, parallel, log,
    get concurrency() { return concurrency; },
    provider: opt.provider ?? def.provider ?? 'zcode',
    results,
    settleAll: () => chain.then(() => undefined, () => undefined),
  };
}

function buildPrompt(role, task, o) {
  const roleDoc = fs.readFileSync(path.join(ROLES_DIR, `${role}.md`), 'utf8');
  const lines = [
    roleDoc,
    '',
    '# 派单',
    `目标：${task}`,
    o.files?.length ? `授权文件（只允许改动这些）：\n${o.files.map((f) => `- ${f}`).join('\n')}` : '授权文件：（未列——只读任务，不改动任何文件）',
    o.context?.length ? `必读材料：\n${o.context.map((c) => `- ${c}`).join('\n')}` : '',
    o.accept ? `验收判据：${o.accept}` : '验收判据：（未提供——按任务目标自证）',
    '',
    '红线：只改授权文件范围内内容；禁 git commit / push / reset --hard；缺输入或需偏离授权范围 → 在输出中给出「BLOCKER: 原因」并停止，不自行扩大范围。',
    '输出要求：末尾用「## 结果」节给出 1) 改动文件清单 2) 改动摘要 3) 已跑验证与结果 4) blocker / 剩余风险。',
  ];
  return lines.filter((l) => l !== '').join('\n');
}

// ---------- 留痕（workflow/delegations.md 委派结果表，行格式与 agg-delegations.cjs 对齐） ----------
// 列内半角 | 替换全角 ｜：agg 按 split('|') 切列不识别 \| 转义（incident 2026-09-25 P1-3）
const mdCell = (s) => String(s).replaceAll('|', '｜');
function ledgerResult(r) {
  if (!r.ok || r.blocker) return '返工待修';
  return r.retriesUsed ? `返工×${r.retriesUsed}` : '一次通过';
}
function appendLedger(name, r) {
  if (opt.noLedger || !r) return;
  let text;
  try { text = fs.readFileSync(LEDGER_PATH, 'utf8'); } catch { console.error(`[wf] 留痕跳过：${LEDGER_PATH} 不存在`); return; }
  const eol = (text.match(/\r\n/g) || []).length > (text.match(/(?<!\r)\n/g) || []).length ? '\r\n' : '\n'; // 保留主导行尾，不整文件翻写
  const date = new Date().toISOString().slice(0, 10);
  const task = r.task.length > 40 ? `${r.task.slice(0, 39)}…` : r.task;
  const note = `wf:${name} ${r.tag} ${(r.durationMs / 1000).toFixed(0)}s${r.blocker ? ' BLOCKER' : ''}${r.timedOut ? ' 超时' : ''}`;
  const row = `| ${date} | ${mdCell(r.provider)} | ${mdCell(task)} | ${ledgerResult(r)} | ${mdCell(note)} |`;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === '## 委派结果');
  if (start === -1) { console.error('[wf] 留痕跳过：delegations.md 无「## 委派结果」节'); return; }
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  let at = end;
  while (at > start && !lines[at - 1].startsWith('|')) at--; // 回退到表尾（空行之前）
  lines.splice(at, 0, row);
  fs.writeFileSync(LEDGER_PATH, lines.join(eol));
}

// ---------- 汇总与退出 ----------
function summarize(def, wf, wfResult, error) {
  const { agents, gates, peakConcurrency } = wf.results;
  console.log('\n== wf-run 汇总 ==');
  console.log(`workflow: ${def.name}（provider=${wf.provider}，并发上限=${wf.concurrency}，并发峰值=${peakConcurrency}）`);
  for (const a of agents) {
    console.log(`  ${a.ok ? '✅' : '❌'} ${a.tag} ${(a.durationMs / 1000).toFixed(1)}s retries=${a.retriesUsed ?? 0}${a.blocker ? ' BLOCKER' : ''}${a.timedOut ? ' 超时' : ''}${a.error ? ` ${a.error}` : ''}`);
  }
  for (const g of gates) console.log(`  ${g.status === 0 ? '✅' : '❌'} gate: ${g.cmd}`);
  if (error) console.log(`  ❌ 脚本异常: ${error.message}`);
  else if (wfResult !== undefined) console.log(`  结果: ${JSON.stringify(wfResult).slice(0, 2000)}`);
  const bad = agents.filter((a) => !a.ok).length + (error ? 1 : 0);
  console.log(`退出码: ${bad ? 1 : 0}`);
  return bad ? 1 : 0;
}

// ---------- main ----------
const providers = loadProviders();
const def = await loadScript(opt.script);
const wf = makeWf(def, providers);

if (opt.dryRun) {
  console.log(`wf-run --dry-run: 脚本「${def.name}」加载与校验通过——已验 default 导出形态（name + run）；role 合法性与 provider 配置在派单时校验（控制流动态，dry-run 不执行派单）。provider 默认 ${wf.provider}，并发 ${wf.concurrency}；未执行。`);
  console.log('纪律提醒：脚本须随 plan 确认后方可去掉 --dry-run 执行。');
  process.exit(0);
}

let wfResult, error = null;
try {
  wfResult = await def.run(wf);
} catch (e) {
  error = e;
}
await wf.settleAll(); // 错误路径同样等待在跑派单收尾——已发生的执行必须留痕（P1-1）
for (const a of wf.results.agents) appendLedger(def.name, a);
process.exit(summarize(def, wf, wfResult, error));
