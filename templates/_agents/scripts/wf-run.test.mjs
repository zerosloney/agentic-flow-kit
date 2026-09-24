// wf-run.test.mjs — 脚本化子智能体编排 runner 全链路用例（fake provider，不依赖真实宿主 CLI / 登录态）。
// 方法：tmp fixture 根（roles + delegations 骨架 + providers.json）+ 子进程调真实 wf-run.mjs，
// 断言编排面语义（串行/并发峰值/gate/重试/BLOCKER）、留痕行格式与 --dry-run 校验门。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, 'wf-run.mjs');
const NODE = process.execPath;

let pass = 0, failCount = 0;
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

// ---- ① 串行两 agent 全过 + 留痕行格式 ----
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
  check('① 行格式与列数一致', rows.every((l) => /^| 20\d\d-\d\d-\d\d \| ok \| .+ \| 一次通过 \| wf:串行冒烟 .+ \|$/.test(l)), rows.join(' / '));
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

// ---- ③ gate：失败被捕获 → exit 0；未捕获 → exit 1 ----
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
  check('⑤ 报错含覆写提示', /providers\.json 覆写/.test(r.stdout), r.stdout?.slice(-400));
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

// ---- ⑦ --dry-run：合法过、非法拒（无 default / run 非函数） ----
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
  check('⑦ 未知角色 fail-fast', rBad3.status === 1 && /未知角色/.test(rBad3.stdout), (rBad3.stdout + rBad3.stderr).slice(-300));
}

console.log(`\n合计: PASS ${pass} / FAIL ${failCount}`);
process.exit(failCount ? 1 : 0);
