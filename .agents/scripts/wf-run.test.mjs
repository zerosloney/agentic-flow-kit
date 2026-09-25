// wf-run.test.mjs — 脚本化子智能体编排 runner 全链路用例（fake provider，不依赖真实宿主 CLI / 登录态）。
// 方法：tmp fixture 根（roles + delegations 骨架 + providers(.local).json）+ 子进程调真实 wf-run.mjs，
// 断言编排面语义（串行/并发峰值/gate/重试/BLOCKER）、stdin 传输协议（含 Windows 真实 .bat shim）、
// 错误路径 settle 留痕、竖线列口径、providers.local.json 覆写与 --dry-run 校验门。
// 用例 ⑧ 的负例基因：2026-09-25 incident——fake provider 全用 node.exe 漏掉 .cmd shim 形态导致 P0 截断漏网。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, 'wf-run.mjs');
const NODE = process.execPath;

let pass = 0, failCount = 0, skip = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { failCount++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
}
const W = (p, content) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
const unix = (p) => p.replaceAll('\\', '/');

function mkRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wf-run-${tag}-`));
  W(path.join(root, '.agents/roles/implementer.md'), '# Implementer\n测试用角色契约（fake）。\n');
  W(path.join(root, '.agents/roles/independent-reviewer.md'), '# Independent Reviewer\n测试用角色契约（fake）。\n');
  W(path.join(root, 'workflow/delegations.md'), '# 量化证据台账\n\n## 委派结果\n\n| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 |\n|------|----------------|------------|------|------|\n\n## 自做任务结果\n');
  return root;
}
function mkProviders(root, extra) {
  W(path.join(root, '.agents/workflows/providers.json'), JSON.stringify({
    ok: { cmd: [NODE, '-e', "console.log('FAKE-OK')"] },
    sleep: { cmd: [NODE, '-e', "setTimeout(() => console.log('SLEEP-OK'), 200)"] },
    blocker: { cmd: [NODE, '-e', "console.log('BLOCKER: 缺输入')"] },
    ...extra,
  }));
}
function runRunner(root, script, ...flags) {
  return spawnSync(NODE, [RUNNER, script, '--root', root, ...flags], { encoding: 'utf8', timeout: 60000 });
}
function wfScript(root, name, code) {
  const p = path.join(root, `${name}.mjs`);
  W(p, code);
  return p;
}
const ledgerRows = (root) => fs.readFileSync(path.join(root, 'workflow/delegations.md'), 'utf8').split(/\r?\n/).filter((l) => l.startsWith('| 20'));

// ---- ① 串行两 agent 全过 + 留痕行格式（正则带负例——2026-09-25 P1-2 假绿教训：/^|…/ 恒真） ----
{
  const root = mkRoot('serial');
  mkProviders(root);
  const script = wfScript(root, 'wf-serial', `
export default {
  name: '串行冒烟',
  provider: 'ok',
  async run(wf) {
    const a = await wf.agent('implementer', '任务甲', { accept: 'FAKE-OK' });
    const b = await wf.agent('independent-reviewer', '任务乙', {});
    return { a: a.ok, b: b.ok };
  },
};`);
  const r = runRunner(root, script);
  check('① 串行全过 exit 0', r.status === 0, r.stderr?.slice(-500));
  const rows = ledgerRows(root);
  check('① 留痕两行且落在委派表', rows.length === 2, `实际 ${rows.length} 行`);
  const ROW_RE = /^\| 20\d\d-\d\d-\d\d \| ok \| .+ \| 一次通过 \| wf:串行冒烟 .+ \|$/;
  check('① 行格式与列数一致（^| 已转义）', rows.every((l) => ROW_RE.test(l)), rows.join(' / '));
  check('① 行格式负例：垃圾串与缺列行必须被拒', ROW_RE.test('complete garbage line !!!') === false && ROW_RE.test('| 2026-09-25 | ok | t | 一次通过 |') === false);
  check('① 一次通过口径', rows.every((l) => l.includes('| 一次通过 |')));
  check('① 汇总表含并发峰值', /并发峰值=1/.test(r.stdout), r.stdout?.slice(-300));
}

// ---- ② 并发峰值：3 任务上限 2 → 峰值恰 2；上限 1 → 峰值 1 ----
{
  const root = mkRoot('conc');
  mkProviders(root);
  const script = wfScript(root, 'wf-conc', `
export default {
  name: '并发冒烟',
  provider: 'sleep',
  concurrency: 2,
  async run(wf) {
    const rs = await wf.parallel([
      () => wf.agent('implementer', '并发一'),
      () => wf.agent('implementer', '并发二'),
      () => wf.agent('implementer', '并发三'),
    ]);
    return rs.map((x) => x.ok);
  },
};`);
  const r = runRunner(root, script);
  check('② 并行 3 任务全过 exit 0', r.status === 0, r.stderr?.slice(-500));
  check('② 并发峰值恰为 2', /并发峰值=2/.test(r.stdout), r.stdout?.slice(-300));
  const script1 = wfScript(root, 'wf-conc1', `
export default {
  name: '串行峰值',
  provider: 'sleep',
  concurrency: 1,
  async run(wf) {
    await wf.parallel([() => wf.agent('implementer', '甲'), () => wf.agent('implementer', '乙')]);
  },
};`);
  const r1 = runRunner(root, script1);
  check('② 上限 1 时峰值 1', r1.status === 0 && /并发峰值=1/.test(r1.stdout), r1.stdout?.slice(-300));
}

// ---- ③ gate：失败可捕获 → exit 0；未捕获 → exit 1 ----
{
  const root = mkRoot('gate');
  mkProviders(root);
  const okScript = wfScript(root, 'wf-gate-ok', `
export default {
  name: 'gate 捕获',
  provider: 'ok',
  async run(wf) {
    try { wf.gate('${unix(NODE)} -e "process.exit(3)"'); return 'unreached'; }
    catch (e) { return e.message.includes('GATE') ? 'caught' : 'wrong'; }
  },
};`);
  const rOk = runRunner(root, okScript);
  check('③ gate 失败可捕获 exit 0', rOk.status === 0 && /caught/.test(rOk.stdout), (rOk.stderr + rOk.stdout).slice(-400));
  check('③ 汇总记录 gate ❌', /❌ gate:/.test(rOk.stdout), rOk.stdout?.slice(-400));
  const badScript = wfScript(root, 'wf-gate-bad', `
export default {
  name: 'gate 未捕获',
  provider: 'ok',
  async run(wf) { wf.gate('${unix(NODE)} -e "process.exit(3)"'); },
};`);
  const rBad = runRunner(root, badScript);
  check('③ gate 未捕获 exit 1', rBad.status === 1, `status=${rBad.status}`);
}

// ---- ④ 重试：首跑失败二跑过 → ok、retriesUsed=1、留痕「返工×1」 ----
{
  const root = mkRoot('retry');
  const mark = unix(path.join(root, 'mark.txt'));
  mkProviders(root, { failfirst: { cmd: [NODE, '-e', `const fs=require('fs');if(!fs.existsSync('${mark}')){fs.writeFileSync('${mark}','1');process.exit(1)}console.log('OK-2ND')`] } });
  const script = wfScript(root, 'wf-retry', `
export default {
  name: '重试冒烟',
  provider: 'failfirst',
  async run(wf) {
    const r = await wf.agent('implementer', '抖动任务', { retries: 1 });
    return { ok: r.ok, retries: r.retriesUsed };
  },
};`);
  const r = runRunner(root, script);
  check('④ 重试后成功 exit 0', r.status === 0, r.stderr?.slice(-500));
  check('④ retriesUsed=1 进汇总', /retries=1/.test(r.stdout), r.stdout?.slice(-300));
  check('④ 留痕「返工×1」', ledgerRows(root).some((l) => l.includes('| 返工×1 |')), ledgerRows(root).join(' / '));
}

// ---- ⑤ provider 不在 PATH → ok=false、报错含覆写提示；workflow exit 1 ----
{
  const root = mkRoot('ghost');
  mkProviders(root, { ghost: { cmd: ['definitely-not-a-real-cmd-xyz', 'run'] } });
  const script = wfScript(root, 'wf-ghost', `
export default {
  name: '幽灵 provider',
  provider: 'ghost',
  async run(wf) {
    const r = await wf.agent('implementer', '必败任务');
    return { ok: r.ok, err: (r.error || '').slice(0, 80) };
  },
};`);
  const r = runRunner(root, script);
  check('⑤ ENOENT 归为 agent 失败 exit 1', r.status === 1, `status=${r.status}`);
  check('⑤ 报错含覆写提示', /覆写命令/.test(r.stdout), r.stdout?.slice(-400));
  check('⑤ 留痕「返工待修」', ledgerRows(root).some((l) => l.includes('| 返工待修 |')), ledgerRows(root).join(' / '));
}

// ---- ⑥ BLOCKER：输出含 BLOCKER: → blocker 标记 + 留痕返工待修 ----
{
  const root = mkRoot('blocker');
  mkProviders(root);
  const script = wfScript(root, 'wf-blocker', `
export default {
  name: '阻塞冒烟',
  provider: 'blocker',
  async run(wf) {
    const r = await wf.agent('implementer', '越界请求');
    return { ok: r.ok, blocker: r.blocker };
  },
};`);
  const r = runRunner(root, script);
  check('⑥ blocker 标记进汇总', /BLOCKER/.test(r.stdout), r.stdout?.slice(-400));
  check('⑥ blocker 留痕返工待修', ledgerRows(root).every((l) => l.includes('| 返工待修 |')), ledgerRows(root).join(' / '));
}

// ---- ⑦ --dry-run：合法过、非法拒（无 default / run 非函数）；未知角色派单时 fail-fast ----
{
  const root = mkRoot('dry');
  mkProviders(root);
  const good = wfScript(root, 'wf-good', `export default { name: '校验样例', provider: 'ok', async run(wf) {} };`);
  const rGood = runRunner(root, good, '--dry-run');
  check('⑦ dry-run 合法脚本 exit 0', rGood.status === 0 && /校验通过/.test(rGood.stdout), rGood.stderr?.slice(-300));
  const bad1 = wfScript(root, 'wf-bad1', `export const nothing = 1;`);
  const rBad1 = runRunner(root, bad1, '--dry-run');
  check('⑦ 无 default 导出被拒 exit 2', rBad1.status === 2, `status=${rBad1.status}`);
  const bad2 = wfScript(root, 'wf-bad2', `export default { name: '缺 run' };`);
  const rBad2 = runRunner(root, bad2, '--dry-run');
  check('⑦ 缺 run 被拒 exit 2', rBad2.status === 2 && /run/.test(rBad2.stderr), `status=${rBad2.status}`);
  const bad3 = wfScript(root, 'wf-bad3', `
export default { name: '未知角色', provider: 'ok', async run(wf) { await wf.agent('ghost-role', 'x'); } };`);
  const rBad3 = runRunner(root, bad3);
  check('⑦ 未知角色 fail-fast', rBad3.status === 1 && /未知角色/.test(rBad3.stdout + rBad3.stderr), (rBad3.stdout + rBad3.stderr).slice(-300));
}

// ---- ⑧ Windows 真实 .bat shim：stdin 协议收到完整多行 prompt；内联多行被 fail-fast（P0-1 同构威胁形态） ----
{
  if (process.platform !== 'win32') { skip++; console.log('SKIP ⑧（非 Windows，.cmd/.bat 分支不适用）'); }
  else {
    const root = mkRoot('cmdshim');
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-shim-'));
    const outFile = path.join(shimDir, 'got.txt');
    // 真实批处理 shim：把收到的 stdin 全文落盘（模拟 provider 读 prompt）
    fs.writeFileSync(path.join(shimDir, 'wfprobe.bat'),
      `@echo off\r\n"${process.execPath}" -e "const fs=require('fs');let d='';process.stdin.on('data',c=>d+=c).on('end',()=>fs.writeFileSync(process.env.OUT_FILE,d))"\r\n`);
    W(path.join(root, '.agents/workflows/providers.json'), JSON.stringify({
      shim: { cmd: ['wfprobe'] },            // stdin 形态（无 {PROMPT}）
      shimInline: { cmd: ['wfprobe', '{PROMPT}'] }, // 内联形态（应被拒绝）
    }));
    const env = { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}`, OUT_FILE: outFile };
    const s1 = wfScript(root, 'wf-shim', `
export default {
  name: 'shim 冒烟',
  provider: 'shim',
  async run(wf) { const r = await wf.agent('implementer', '多行任务第一行\\n第二行要点'); return r.ok; },
};`);
    const r = spawnSync(NODE, [RUNNER, s1, '--root', root], { encoding: 'utf8', timeout: 60000, env });
    const got = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    check('⑧ .bat shim + stdin：子进程收到完整多行 prompt（任务+角色契约+红线行）',
      r.status === 0 && got.includes('多行任务第一行') && got.includes('第二行要点') && got.includes('# Implementer') && got.includes('禁 git commit'),
      `status=${r.status} 收到=${JSON.stringify(got.slice(0, 120))}…`);
    const s2 = wfScript(root, 'wf-inline', `
export default {
  name: '内联拒绝',
  provider: 'shimInline',
  async run(wf) { const r = await wf.agent('implementer', '任务一\\n任务二'); return r.ok; },
};`);
    const r2 = spawnSync(NODE, [RUNNER, s2, '--root', root], { encoding: 'utf8', timeout: 60000, env });
    check('⑧ .bat shim + 内联多行 prompt 被 fail-fast 拒绝（不静默截断）',
      r2.status === 1 && /截断/.test(r2.stdout + r2.stderr), (r2.stdout + r2.stderr).slice(-400));
  }
}

// ---- ⑨ 收尾语义：fire-and-forget 与脚本异常路径，在跑 agent 仍被等待并留痕（P1-1） ----
{
  const root = mkRoot('settle');
  mkProviders(root);
  const ff = wfScript(root, 'wf-ff', `
export default {
  name: 'fire and forget',
  provider: 'sleep',
  async run(wf) { wf.agent('implementer', '后台慢任务'); return 'done'; },
};`);
  const r = runRunner(root, ff);
  check('⑨ fire-and-forget 派单被等待并留痕', r.status === 0 && ledgerRows(root).length === 1, `rows=${ledgerRows(root).length} status=${r.status}`);

  const root2 = mkRoot('settle2');
  mkProviders(root2);
  const err = wfScript(root2, 'wf-errsettle', `
export default {
  name: '异常时在跑',
  provider: 'sleep',
  async run(wf) {
    wf.agent('implementer', '慢任务不留死');
    wf.gate('${unix(NODE)} -e "process.exit(3)"');
  },
};`);
  const r2 = runRunner(root2, err);
  check('⑨ 脚本异常时在跑 agent 仍被等待（汇总可见 ✅）', /✅ implementer#1/.test(r2.stdout), r2.stdout?.slice(-400));
  check('⑨ 异常路径留痕不丢（1 行）且 exit 1', r2.status === 1 && ledgerRows(root2).length === 1, `rows=${ledgerRows(root2).length} status=${r2.status}`);
}

// ---- ⑩ task 含半角 | → 全角化不乱列（agg split 口径）；CRLF 台账行尾保留（P1-3 / P2） ----
{
  const root = mkRoot('pipe');
  mkProviders(root);
  const led = path.join(root, 'workflow/delegations.md');
  fs.writeFileSync(led, fs.readFileSync(led, 'utf8').replaceAll('\n', '\r\n'));
  const script = wfScript(root, 'wf-pipe', `
export default {
  name: '竖线冒烟',
  provider: 'ok',
  async run(wf) { await wf.agent('implementer', '修复 A|B 环节'); },
};`);
  const r = runRunner(root, script);
  const rows = ledgerRows(root);
  check('⑩ task 含 | 全角化、agg split 列口径（恰 7 段）', r.status === 0 && rows.length === 1 && rows[0].split('|').length === 7 && rows[0].includes('A｜B'), rows.join(' / '));
  check('⑩ CRLF 台账行尾保留不翻写', fs.readFileSync(led, 'utf8').includes('\r\n'));
}

// ---- ⑪ providers.local.json 侧车覆写生效（managed providers.json 不动，P1-4） ----
{
  const root = mkRoot('local');
  W(path.join(root, '.agents/workflows/providers.json'), JSON.stringify({ ok: { cmd: [NODE, '-e', "console.log('BASE-OK')"] } }));
  W(path.join(root, '.agents/workflows/providers.local.json'), JSON.stringify({ ok: { cmd: [NODE, '-e', "console.log('LOCAL-OK')"] } }));
  const script = wfScript(root, 'wf-local', `
export default { name: 'local 覆写', provider: 'ok', async run(wf) { const r = await wf.agent('implementer', '任务'); return r.output.trim(); } };`);
  const r = runRunner(root, script);
  check('⑪ providers.local.json 覆写生效（优先于 providers.json）', r.status === 0 && /LOCAL-OK/.test(r.stdout) && !/BASE-OK/.test(r.stdout), (r.stdout + r.stderr).slice(-300));
}

// ---- ⑫ 数值参数校验：--concurrency/--timeout-ms 非数字 fail-fast（防 NaN 静默死锁，P2） ----
{
  const root = mkRoot('num');
  mkProviders(root);
  const script = wfScript(root, 'wf-num', `export default { name: 'x', provider: 'ok', async run() {} };`);
  const r = runRunner(root, script, '--concurrency', 'abc');
  check('⑫ --concurrency 非数字 fail-fast exit 2', r.status === 2 && /正整数/.test(r.stderr), r.stderr);
  const r2 = runRunner(root, script, '--timeout-ms', 'xyz');
  check('⑫ --timeout-ms 非数字 fail-fast exit 2', r2.status === 2 && /正数毫秒/.test(r2.stderr), r2.stderr);
}

console.log(`\n合计: PASS ${pass} / FAIL ${failCount}` + (skip ? ` / SKIP ${skip}` : ''));
process.exit(failCount ? 1 : 0);
