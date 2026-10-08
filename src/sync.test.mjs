// sync.test.mjs — flow-kit sync 三态升级 + add-host / add-gate 行为验证。
// 方法：迷你 fixture 包根（小模板树 + 假宿主 zcode + 假门禁 fakeg）+ 手工模拟 v1 安装态（kit.json 台账 + 盘面），
// 子进程 driver 调真实 sync/add-host/add-gact（隔离 process.exit 与 doctor 尾部退出），断言盘面 + 台账 + stdout 标记。
// 场景 14：台账外文件收养（2026-09-26 managed-ledger-adopt）——内容==新版才登记，本地真改动仍跳过。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sha256 } from './render.mjs';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

let pass = 0, failCount = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { failCount++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
}
const W = (p, content) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
const R = (p) => fs.readFileSync(p, 'utf8');
// 可选读：装户端在无 localOnly 宿主时不再创建 .gitignore，断言「不追加」须容忍文件不存在
const ROpt = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

// ---- fixture 包根（v2 形态：chg/host 变更、new 新增、gone 已删）----
function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-fixture-'));
  W(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '9.9.9', type: 'module' }));
  W(path.join(root, 'templates/_agents/scripts/keep.txt'), 'keep v2\n');
  W(path.join(root, 'templates/_agents/scripts/chg.txt'), 'chg v2 port {{BOARD_PORT}}\n');
  W(path.join(root, 'templates/_agents/scripts/loc.txt'), 'loc v2\n');
  W(path.join(root, 'templates/_agents/scripts/var.txt'), 'same {{BUILD_CMD}}\n');
  W(path.join(root, 'templates/_agents/commands/new.txt'), 'new in v2\n');
  W(path.join(root, 'templates/AGENTS.md'), 'owned skeleton v2\n');
  W(path.join(root, 'modules/hosts/zcode/h.txt'), 'host v2 {{BOARD_PORT}}\n');
  W(path.join(root, 'modules/gates/fakeg/gate.sh'), 'echo gate\n');
  W(path.join(root, 'modules/gates/fakeg/README.md'), 'docs only\n');
  W(path.join(root, 'modules/gates/fakeg/local-pre-commit.line'), 'sh .agents/hooks/gate.sh\n');
  return root;
}

// ---- v1 安装态（managed 台账与盘面对应 v1 渲染产物）----
function mkTarget(_fixtureRoot) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-target-'));
  const files = {
    '.agents/scripts/keep.txt': 'keep v2\n',
    '.agents/scripts/chg.txt': 'chg v1 port 777\n',
    '.agents/scripts/loc.txt': 'loc v1\n',
    '.agents/scripts/var.txt': 'same <填写>\n',
    '.agents/scripts/gone.txt': 'gone v1\n',
    '.zcode/h.txt': 'host v1 777\n',
    'AGENTS.md': 'owned skeleton v2\n',
  };
  for (const [rel, c] of Object.entries(files)) W(path.join(t, rel), c);
  const managed = Object.entries(files)
    .filter(([rel]) => rel !== 'AGENTS.md')
    .map(([rel, c]) => ({ rel, sha256: sha256(Buffer.from(c, 'utf8')) }));
  W(path.join(t, '.agents/kit.json'), `${JSON.stringify({
    kit: 'agentic-flow-kit', version: '1.0.0', createdAt: '2026-09-23T00:00:00Z',
    options: { hosts: ['zcode'], stack: 'none', boardPort: '777' },
    managed, owned: [{ rel: 'AGENTS.md', sha256: sha256(Buffer.from('owned skeleton v2\n', 'utf8')) }],
  }, null, 2)}\n`);
  return t;
}

// ---- 子进程 driver：调真实实现，pkgRoot 指向 fixture ----
function runCmd(cmd, fixtureRoot, target, extra = []) {
  const driver = path.join(fixtureRoot, 'driver.mjs');
  W(driver, `import { sync } from ${JSON.stringify(pathToFileURL(path.join(SRC_ROOT, 'sync.mjs')).href)};
import { addHost } from ${JSON.stringify(pathToFileURL(path.join(SRC_ROOT, 'add-host.mjs')).href)};
import { addGate } from ${JSON.stringify(pathToFileURL(path.join(SRC_ROOT, 'add-gate.mjs')).href)};
const root = ${JSON.stringify(fixtureRoot)};
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'sync') sync(rest, root);
else if (cmd === 'add-host') addHost(rest, root);
else if (cmd === 'add-gate') addGate(rest, root);
`);
  return spawnSync(process.execPath, [driver, cmd, ...extra, '--dir', target], { encoding: 'utf8' });
}

// ============ 场景 1：sync 默认（无 --force）三态分派 ============
{
  const fx = mkFixture(), t = mkTarget(fx);
  W(path.join(t, '.agents/scripts/loc.txt'), 'loc USER\n'); // 用户本地改动
  const r = runCmd('sync', fx, t);
  const out = r.stdout + r.stderr;
  // fixture 非完整安装：doctor 尾部按设计 FAIL 退出（status 1），此处只断言 sync 主流程走完且有分派报告
  check('S1 sync 主流程走完（三态分派报告齐）', out.includes('覆盖更新') && out.includes('新增安装') && out.includes('doctor'), `status=${r.status} out=${out.slice(0, 200)}`);
  check('S1 未改动+模板变更 → 覆盖（chg.txt → v2 且渲染端口）', R(path.join(t, '.agents/scripts/chg.txt')) === 'chg v2 port 777\n');
  check('S1 宿主层同样覆盖（.zcode/h.txt → v2）', R(path.join(t, '.zcode/h.txt')) === 'host v2 777\n');
  check('S1 本地改动 → 跳过（loc.txt 保持用户版）', R(path.join(t, '.agents/scripts/loc.txt')) === 'loc USER\n');
  check('S1 跳过有报告标记', out.includes('本地已改，跳过') && out.includes('loc.txt'), out);
  check('S1 无变化文件不动（keep/var）', R(path.join(t, '.agents/scripts/keep.txt')) === 'keep v2\n' && R(path.join(t, '.agents/scripts/var.txt')) === 'same <填写>\n');
  check('S1 新增 managed 文件被安装', R(path.join(t, '.agents/commands/new.txt')) === 'new in v2\n');
  check('S1 包内已删：文件留盘', fs.existsSync(path.join(t, '.agents/scripts/gone.txt')));
  check('S1 包内已删有报告标记', out.includes('包内已移除'));
  const kit = JSON.parse(R(path.join(t, '.agents/kit.json')));
  const rels = kit.managed.map((f) => f.rel);
  check('S1 台账：版本对齐包版本', kit.version === '9.9.9');
  check('S1 台账：gone 出册、new 入册', !rels.includes('.agents/scripts/gone.txt') && rels.includes('.agents/commands/new.txt'));
  check('S1 台账：跳过文件保持包侧基线 sha（持续报告，不随盘面基线化）', kit.managed.find((f) => f.rel === '.agents/scripts/loc.txt').sha256 === sha256(Buffer.from('loc v1\n')));
  check('S1 台账：覆盖文件 sha 为新版', kit.managed.find((f) => f.rel === '.agents/scripts/chg.txt').sha256 === sha256(Buffer.from('chg v2 port 777\n')));
  check('S1 owned 不触碰（AGENTS.md 原样）', R(path.join(t, 'AGENTS.md')) === 'owned skeleton v2\n');
  check('S1 已装 owned 不误报新增', !out.includes('新增 owned 起步文档'), out);
}

// ============ 场景 2：sync --force 覆盖本地改动 ============
{
  const fx = mkFixture(), t = mkTarget(fx);
  W(path.join(t, '.agents/scripts/loc.txt'), 'loc USER\n');
  const r = runCmd('sync', fx, t, ['--force']);
  check('S2 --force 覆盖本地改动（loc.txt → v2）', R(path.join(t, '.agents/scripts/loc.txt')) === 'loc v2\n', r.stdout + r.stderr);
  check('S2 --force 有覆盖标记', (r.stdout + r.stderr).includes('--force 覆盖本地改动'));
}

// ============ 场景 3：managed 缺失 → 恢复 ============
{
  const fx = mkFixture(), t = mkTarget(fx);
  fs.rmSync(path.join(t, '.agents/scripts/keep.txt'));
  const r = runCmd('sync', fx, t);
  check('S3 缺失 managed 被恢复', fs.existsSync(path.join(t, '.agents/scripts/keep.txt')) && R(path.join(t, '.agents/scripts/keep.txt')) === 'keep v2\n', r.stdout + r.stderr);
  check('S3 恢复有报告标记', (r.stdout + r.stderr).includes('恢复缺失'));
}

// ============ 场景 4：本地改动恰好等于新版 → 视为无变化 ============
{
  const fx = mkFixture(), t = mkTarget(fx);
  W(path.join(t, '.agents/scripts/chg.txt'), 'chg v2 port 777\n'); // == 新版渲染，但台账还是 v1 sha
  const r = runCmd('sync', fx, t);
  const out = r.stdout + r.stderr;
  check('S4 恰好等于新版不报跳过', !out.includes('本地已改，跳过'), out);
  const kit = JSON.parse(R(path.join(t, '.agents/kit.json')));
  check('S4 台账 sha 更新为新版', kit.managed.find((f) => f.rel === '.agents/scripts/chg.txt').sha256 === sha256(Buffer.from('chg v2 port 777\n')));
}

// ============ 场景 5：无 kit.json → 明确报错引导 init ============
{
  const fx = mkFixture();
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-empty-'));
  const r = runCmd('sync', fx, t);
  check('S5 无台账退出码 1', r.status === 1);
  check('S5 报错引导 init', (r.stderr || '').includes('flow-kit init'), r.stderr);
}

// ============ 场景 6：全新 v2 包（台账空基线）→ 全量安装 + 未装 owned 起步文档报告 ============
{
  const fx = mkFixture(), t = mkTarget(fx);
  fs.rmSync(path.join(t, 'AGENTS.md'), { force: true }); // 未装 owned 起步文档
  const r = runCmd('sync', fx, t);
  const out = r.stdout + r.stderr;
  check('S6 未装 owned 起步文档有报告且未自动安装', out.includes('新增 owned 起步文档') && !fs.existsSync(path.join(t, 'AGENTS.md')), out);
}

// ============ 场景 7：add-host 后补宿主 ============
{
  const fx = mkFixture();
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-host-'));
  W(path.join(t, '.agents/kit.json'), `${JSON.stringify({
    kit: 'agentic-flow-kit', version: '1.0.0',
    options: { hosts: [], stack: 'none', boardPort: '777' }, managed: [], owned: [],
  }, null, 2)}\n`);
  const r = runCmd('add-host', fx, t, ['zcode']);
  const out = r.stdout + r.stderr;
  check('S7 宿主文件就位（.zcode/h.txt 渲染）', R(path.join(t, '.zcode/h.txt')) === 'host v2 777\n', out);
  const kit = JSON.parse(R(path.join(t, '.agents/kit.json')));
  check('S7 managed 台账补记（项目根相对路径）', kit.managed.some((f) => f.rel === '.zcode/h.txt'), JSON.stringify(kit.managed));
  check('S7 options.hosts 补记', Array.isArray(kit.options.hosts) && kit.options.hosts.includes('zcode'));
  check('S7 宿主目录不再进 .gitignore（localOnly 已撤销，zcode 与其余宿主同策）', !ROpt(path.join(t, '.gitignore')).includes('.zcode/'), ROpt(path.join(t, '.gitignore')));
  const r2 = runCmd('add-host', fx, t, ['zcode']);
  check('S7 重复装未 --force → 报错退出', r2.status === 1 && (r2.stderr || '').includes('--force'), r2.stderr);
}

// ============ 场景 8：add-gate 装门禁 + 幂等接线 ============
{
  const fx = mkFixture();
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-gate-'));
  W(path.join(t, '.agents/kit.json'), `${JSON.stringify({
    kit: 'agentic-flow-kit', version: '1.0.0',
    options: { hosts: [], stack: 'none', boardPort: '777' }, managed: [], owned: [],
  }, null, 2)}\n`);
  const r = runCmd('add-gate', fx, t, ['fakeg']);
  const out = r.stdout + r.stderr;
  check('S8 门禁文件落 .agents/hooks/', R(path.join(t, '.agents/hooks/gate.sh')) === 'echo gate\n', out);
  check('S8 包内 README 不拷', !fs.existsSync(path.join(t, '.agents/hooks/README.md')));
  check('S8 接线元数据不拷', !fs.existsSync(path.join(t, '.agents/hooks/local-pre-commit.line')));
  check('S8 local-pre-commit 接线（缺失则建 set -e 头）', R(path.join(t, '.agents/hooks/local-pre-commit')) === '#!/bin/sh\nset -e\nsh .agents/hooks/gate.sh\n', out);
  const kit = JSON.parse(R(path.join(t, '.agents/kit.json')));
  check('S8 owned 台账补记（归项目所有）', kit.owned.some((f) => f.rel === '.agents/hooks/gate.sh'));
  check('S8 接线后 local-pre-commit 进 owned 且哈希=盘面（Shipyard 回流根因，2026-09-24）', (() => {
    const e = kit.owned.find((f) => f.rel === '.agents/hooks/local-pre-commit');
    return e && e.sha256 === sha256(Buffer.from(R(path.join(t, '.agents/hooks/local-pre-commit')), 'utf8'));
  })(), JSON.stringify(kit.owned));
  runCmd('add-gate', fx, t, ['fakeg']); // 再跑一遍
  check('S8 幂等：接线行不重复', R(path.join(t, '.agents/hooks/local-pre-commit')) === '#!/bin/sh\nset -e\nsh .agents/hooks/gate.sh\n');
  const r3 = runCmd('add-gate', fx, t, ['nope']);
  check('S8 未知门禁报错并列出可选', r3.status === 1 && (r3.stderr || '').includes('fakeg'), r3.stderr);
}

// ============ 场景 9：旧装态 local-pre-commit（尾部 exit 0）→ 归一化剥掉再接线 ============
{
  const fx = mkFixture();
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-gate2-'));
  W(path.join(t, '.agents/kit.json'), `${JSON.stringify({
    kit: 'agentic-flow-kit', version: '1.0.0',
    options: { hosts: [], stack: 'none', boardPort: '777' }, managed: [], owned: [],
  }, null, 2)}\n`);
  W(path.join(t, '.agents/hooks/local-pre-commit'), '#!/bin/sh\n# 旧装态注释\nexit 0\n');
  const r = runCmd('add-gate', fx, t, ['fakeg']);
  const out = r.stdout + r.stderr;
  check('S9 旧装态归一化：剥掉尾部 exit 0', out.includes('归一化'), out);
  check('S9 挂载行在 exit 0 原位之前追加', R(path.join(t, '.agents/hooks/local-pre-commit')) === '#!/bin/sh\n# 旧装态注释\nsh .agents/hooks/gate.sh\n', R(path.join(t, '.agents/hooks/local-pre-commit')));
}

// ============ 场景 10：模板树内的运行时缓存不进安装与台账 ============
{
  const fx = mkFixture();
  W(path.join(fx, 'templates/_agents/cache/kb-index.json'), '{"stale":"test-residue"}');
  const t = mkTarget(fx); // v1 安装态无 cache 文件
  const r = runCmd('sync', fx, t);
  check('S10 cache 残留不被安装', !fs.existsSync(path.join(t, '.agents/cache/kb-index.json')), r.stdout + r.stderr);
  const kit = JSON.parse(R(path.join(t, '.agents/kit.json')));
  check('S10 cache 不入 managed 台账', !kit.managed.some((f) => f.rel.startsWith('.agents/cache/')), JSON.stringify(kit.managed.filter((f) => f.rel.includes('cache'))));
}

// ============ 场景 11：跳过件不被下次升级静默覆盖（台账保持包侧基线，2026-09-24 语义修正回归） ============
{
  const fx = mkFixture(), t = mkTarget(fx);
  W(path.join(t, '.agents/scripts/loc.txt'), 'loc USER\n');
  runCmd('sync', fx, t); // 第一次：本地已改 → 跳过
  W(path.join(fx, 'templates/_agents/scripts/loc.txt'), 'loc v3\n'); // 包再出新版
  const r = runCmd('sync', fx, t);
  const out = r.stdout + r.stderr;
  check('S11 二次 sync 不覆盖本地改动（loc.txt 仍为用户版）', R(path.join(t, '.agents/scripts/loc.txt')) === 'loc USER\n', out);
  check('S11 仍按「本地已改，跳过」报告', out.includes('本地已改，跳过') && out.includes('loc.txt'), out);
}

// ============ 场景 12：owned 台账哈希按盘面自愈（Shipyard 回流策略，2026-09-24） ============
{
  const fx = mkFixture(), t = mkTarget(fx);
  W(path.join(t, 'AGENTS.md'), 'owned skeleton v2 EDITED BY USER\n'); // owned 件手改 → 台账停旧值
  const r = runCmd('sync', fx, t);
  const out = r.stdout + r.stderr;
  check('S12 owned 文件不被触碰（AGENTS.md 保持用户版）', R(path.join(t, 'AGENTS.md')) === 'owned skeleton v2 EDITED BY USER\n', out);
  const kit = JSON.parse(R(path.join(t, '.agents/kit.json')));
  check('S12 owned 台账哈希自愈为盘面值', kit.owned.find((f) => f.rel === 'AGENTS.md').sha256 === sha256(Buffer.from('owned skeleton v2 EDITED BY USER\n')), JSON.stringify(kit.owned));
  check('S12 有刷新报告', out.includes('owned 台账哈希按盘面刷新 1 份'), out);
}

// ============ 场景 13：managed 连同父目录整目录缺失 → 恢复并重建父目录（恢复分支 mkdir，2026-09-25） ============
{
  const fx = mkFixture(), t = mkTarget(fx);
  fs.rmSync(path.join(t, '.zcode'), { recursive: true, force: true });
  const r = runCmd('sync', fx, t);
  const out = r.stdout + r.stderr;
  check('S13 整目录缺失的 managed 被恢复（父目录重建）', R(path.join(t, '.zcode/h.txt')) === 'host v2 777\n', out);
  check('S13 恢复有报告标记', out.includes('恢复缺失'), out);
}

// ============ 场景 14：台账外文件收养（2026-09-26 managed-ledger-adopt） ============
// 盘上有 managed 类文件但台账无该条目（旧版手动双写绕过 init/sync 登记）。收养判据与台账内
// 「改动恰好等于新版」同源：diskSha === 新版渲染 sha 才登记；内容不等（本地真改动）仍保守跳过。
{
  // ①盘上有、台账无、内容 == 新版 → 收养登记
  const fx = mkFixture(), t = mkTarget(fx);
  W(path.join(t, '.agents/scripts/chg.txt'), 'chg v2 port 777\n'); // == 新版渲染
  // 把它从台账里剔除，伪造「盘上有但未登记」
  const k0 = JSON.parse(R(path.join(t, '.agents/kit.json')));
  k0.managed = k0.managed.filter((f) => f.rel !== '.agents/scripts/chg.txt');
  W(path.join(t, '.agents/kit.json'), `${JSON.stringify(k0, null, 2)}\n`);
  const r = runCmd('sync', fx, t);
  const out = r.stdout + r.stderr;
  check('S14① 内容==新版 → 收养登记（报告标记）', out.includes('收养登记') && out.includes('chg.txt'), out);
  const kit1 = JSON.parse(R(path.join(t, '.agents/kit.json')));
  check('S14① 收养后入台账且 sha=盘面', (() => {
    const e = kit1.managed.find((f) => f.rel === '.agents/scripts/chg.txt');
    return e && e.sha256 === sha256(Buffer.from('chg v2 port 777\n'));
  })(), JSON.stringify(kit1.managed));
  check('S14① 收养不改盘面（内容原样）', R(path.join(t, '.agents/scripts/chg.txt')) === 'chg v2 port 777\n');

  // ②盘上有、台账无、内容 != 新版 → 不收养、不覆盖、台账不登记
  const fx2 = mkFixture(), t2 = mkTarget(fx2);
  W(path.join(t2, '.agents/scripts/chg.txt'), 'chg LOCAL EDIT\n'); // 本地真改动
  const k1 = JSON.parse(R(path.join(t2, '.agents/kit.json')));
  k1.managed = k1.managed.filter((f) => f.rel !== '.agents/scripts/chg.txt');
  W(path.join(t2, '.agents/kit.json'), `${JSON.stringify(k1, null, 2)}\n`);
  const r2 = runCmd('sync', fx2, t2);
  const out2 = r2.stdout + r2.stderr;
  check('S14② 内容!=新版 → 不收养（不报收养登记）', !out2.includes('收养登记'), out2);
  check('S14② 本地改动幸存未被覆盖', R(path.join(t2, '.agents/scripts/chg.txt')) === 'chg LOCAL EDIT\n', out2);
  const kit2 = JSON.parse(R(path.join(t2, '.agents/kit.json')));
  check('S14② 台账不登记（持续报告，防下次静默覆盖）', !kit2.managed.some((f) => f.rel === '.agents/scripts/chg.txt'));
  check('S14② 报「已存在未入台账」跳过', out2.includes('已存在未入台账'), out2);

  // ③盘上无、台账无 → 新增安装（既有行为不回归）
  const fx3 = mkFixture(), t3 = mkTarget(fx3);
  const r3 = runCmd('sync', fx3, t3);
  check('S14③ 盘上无 → 新增安装（既有行为不回归）', (r3.stdout + r3.stderr).includes('新增安装') && R(path.join(t3, '.agents/commands/new.txt')) === 'new in v2\n');
}

// ============ 场景 15：模板下发感知三态（2026-10-06 template-downstream）============
// fixture 包源 templates/AGENTS.md = 'owned skeleton v2\n'；盘面定制 'owned CUSTOM\n'（≠ 包源）
{
  const sha = (s) => sha256(Buffer.from(s, 'utf8'));
  const SRC_TPL = 'owned skeleton v2\n';
  const kitOf = (t) => JSON.parse(R(path.join(t, '.agents', 'kit.json')));
  const mkStale = (fx, t, owned) => W(path.join(t, '.agents', 'kit.json'), `${JSON.stringify({
    kit: 'agentic-flow-kit', version: '1.0.0', createdAt: '2026-09-23T00:00:00Z',
    options: { hosts: ['zcode'], stack: 'none', boardPort: '777' },
    managed: [{ rel: '.agents/scripts/keep.txt', sha256: sha('keep v2\n') }], owned,
  }, null, 2)}\n`);

  // ① 源演进未拉取 → advisory 出账（唯一出账形态）+ 锚刷新 + 再跑静默（单周期出账）
  const fx1 = mkFixture(), t1 = mkTarget(fx1);
  W(path.join(t1, 'AGENTS.md'), 'owned CUSTOM\n');
  mkStale(fx1, t1, [{ rel: 'AGENTS.md', sha256: sha('owned CUSTOM\n'), srcSha256: sha('owned skeleton v1\n') }]);
  let r1 = runCmd('sync', fx1, t1);
  const out1 = r1.stdout + r1.stderr;
  // 断言锚定出账特征串「有演进且盘面未跟随」——doctor §6.9 的 PASS 回显也含「模板感知」四字，不可作判据
  check('S15① 源演进未拉取 → 出账「模板感知」含文件名', out1.includes('有演进且盘面未跟随') && out1.includes('AGENTS.md'), out1.slice(0, 300));
  check('S15① 锚刷新为当前包源 sha', kitOf(t1).owned[0].srcSha256 === sha(SRC_TPL));
  r1 = runCmd('sync', fx1, t1);
  check('S15① 锚已刷 → 再跑静默（单周期出账）', !(r1.stdout + r1.stderr).includes('有演进且盘面未跟随'));

  // ② 定制跟源（srcSha256 == 当前包源）→ custom-synced 静默
  const fx2 = mkFixture(), t2 = mkTarget(fx2);
  W(path.join(t2, 'AGENTS.md'), 'owned CUSTOM\n');
  mkStale(fx2, t2, [{ rel: 'AGENTS.md', sha256: sha('owned CUSTOM\n'), srcSha256: sha(SRC_TPL) }]);
  const r2 = runCmd('sync', fx2, t2);
  check('S15② 定制跟源 → 静默（owned 语义正常态永不告警）', !(r2.stdout + r2.stderr).includes('有演进且盘面未跟随'));

  // ③ 旧 schema 无锚（mkTarget 原生）→ 静默写锚不追溯
  const fx3b = mkFixture(), t3b = mkTarget(fx3b);
  const r3b = runCmd('sync', fx3b, t3b);
  check('S15③ 旧 schema 无锚 → 静默（写锚不出账，不追溯）', !(r3b.stdout + r3b.stderr).includes('有演进且盘面未跟随'));
  check('S15③ 无锚首跑写入锚（下次 sync 起生效）', kitOf(t3b).owned.find((f) => f.rel === 'AGENTS.md').srcSha256 === sha(SRC_TPL));

  // ④ 手工拉取（盘面 == 包源）→ synced 静默（可消退出账的路径）
  const fx4 = mkFixture(), t4 = mkTarget(fx4);
  mkStale(fx4, t4, [{ rel: 'AGENTS.md', sha256: sha(SRC_TPL), srcSha256: sha('owned skeleton v1\n') }]);
  const r4 = runCmd('sync', fx4, t4);
  check('S15④ 盘面已跟随（手工拉取）→ 静默', !(r4.stdout + r4.stderr).includes('有演进且盘面未跟随'));

  // ⑤ doctor 只读回显：同判据出 stale 清单、且运行后 kit.json 字节不变；旧账无锚 skipped
  //    （no-anchor 须用未跑过 sync 的独立 fixture——sync 会写锚）
  const { checkTemplateDrift } = await import(pathToFileURL(path.join(SRC_ROOT, 'doctor.mjs')).href);
  const fx5 = mkFixture(), t5 = mkTarget(fx5);
  W(path.join(t5, 'AGENTS.md'), 'owned CUSTOM\n');
  mkStale(fx5, t5, [{ rel: 'AGENTS.md', sha256: sha('owned CUSTOM\n'), srcSha256: sha('owned skeleton v1\n') }]);
  const before = R(path.join(t5, '.agents', 'kit.json'));
  const resStale = checkTemplateDrift(t5, fx5);
  check('S15⑤ doctor 判据同源：stale 出清单', resStale.skipped === false && resStale.stale.includes('AGENTS.md'), JSON.stringify(resStale));
  check('S15⑤ doctor 只读：kit.json 字节不变', R(path.join(t5, '.agents', 'kit.json')) === before);
  const fx6 = mkFixture(), t6 = mkTarget(fx6);
  const resNoAnchor = checkTemplateDrift(t6, fx6);
  check('S15⑤ doctor 旧账无锚 → skipped 静默', resNoAnchor.skipped === true, JSON.stringify(resNoAnchor));

  // ⑥ 点目录前缀翻译（复核 P2-1）：owned rel `.agents/x` ↔ 包源 `templates/_agents/x`——
  //    有包源起步模板的 .agents/ owned 件同样参与感知（rule-budgets.txt 等 5 类）
  const fx7 = mkFixture(), t7 = mkTarget(fx7);
  W(path.join(fx7, 'templates/_agents/rule-budgets.txt'), 'budgets v2\n');
  W(path.join(t7, '.agents/rule-budgets.txt'), 'budgets CUSTOM\n');
  mkStale(fx7, t7, [
    { rel: 'AGENTS.md', sha256: sha('owned skeleton v2\n'), srcSha256: sha(SRC_TPL) },
    { rel: '.agents/rule-budgets.txt', sha256: sha('budgets CUSTOM\n'), srcSha256: sha('budgets v1\n') },
  ]);
  const r7 = runCmd('sync', fx7, t7);
  check('S15⑥ .agents/ 前缀翻译 → _agents 模板参与感知出账', (r7.stdout + r7.stderr).includes('有演进且盘面未跟随') && (r7.stdout + r7.stderr).includes('.agents/rule-budgets.txt'));
}

// ============ 场景 16：装户 GitHub CI 远端门模板（2026-10-07 adopter-ci-github）============
// 包源 templates/_github/workflows/kit-ci.yml → 装户 .github/workflows/kit-ci.yml（owned）：
// ① isOwned / srcTemplatePath 契约（含 .agents 存量不回归、无模板反例）；
// ② 存量装户盘上无该件 → newOwned 提示且不自动落盘；③ 已装 + 源演进 → 感知出账 + 锚刷新 + 再跑静默
{
  const sha = (s) => sha256(Buffer.from(s, 'utf8'));
  const CI_REL = '.github/workflows/kit-ci.yml';
  const CI_TPL = 'ci v2\n';
  const { isOwned, srcTemplatePath } = await import(pathToFileURL(path.join(SRC_ROOT, 'profiles.mjs')).href);

  // ① 契约断言：.github/ 归 owned；点前缀翻译 .github ↔ _github 命中、.agents 严格不回归、无模板 null
  check('S16① isOwned：.github/ 前缀归 owned + 存量正例不回归（spec 验收 1）',
    isOwned(CI_REL) === true && isOwned('.github/other.yml') === true
    && isOwned('AGENTS.md') === true && isOwned('.agents/notes/x.md') === true && isOwned('workflow/plans/a.md') === true
    && isOwned('.agents/scripts/check-loop.mjs') === false);
  const fxC = mkFixture();
  W(path.join(fxC, 'templates/_github/workflows/kit-ci.yml'), CI_TPL);
  const norm = (p) => p.split(path.sep).join('/');
  check('S16① srcTemplatePath 通用点前缀翻译：.github → _github 命中 / .agents 严格不回归',
    norm(srcTemplatePath(fxC, CI_REL)).endsWith('templates/_github/workflows/kit-ci.yml')
    && norm(srcTemplatePath(fxC, '.agents/scripts/keep.txt')).endsWith('templates/_agents/scripts/keep.txt'),
    JSON.stringify({ ci: srcTemplatePath(fxC, CI_REL), agents: srcTemplatePath(fxC, '.agents/scripts/keep.txt') }));
  check('S16① srcTemplatePath 无对应模板 → null（.gitattributes 反例，与旧实现等价）',
    srcTemplatePath(fxC, '.gitattributes') === null);

  // ② 存量装户（盘上无该件）→ newOwned 提示且不自动落盘
  const fx1 = mkFixture();
  W(path.join(fx1, 'templates/_github/workflows/kit-ci.yml'), CI_TPL);
  const t1 = mkTarget(fx1);
  const r1 = runCmd('sync', fx1, t1);
  const out1 = r1.stdout + r1.stderr;
  check('S16② 存量装户无该件 → newOwned 提示含文件名且不自动落盘',
    out1.includes('新增 owned 起步文档') && out1.includes(CI_REL) && !fs.existsSync(path.join(t1, CI_REL)), out1);

  // ③ 装户已装（带旧锚）+ 源演进 → 感知出账；锚刷新后（custom-synced）再跑静默
  const fx2 = mkFixture();
  W(path.join(fx2, 'templates/_github/workflows/kit-ci.yml'), CI_TPL);
  const t2 = mkTarget(fx2);
  W(path.join(t2, CI_REL), 'ci CUSTOM\n');
  W(path.join(t2, '.agents/kit.json'), `${JSON.stringify({
    kit: 'agentic-flow-kit', version: '1.0.0', createdAt: '2026-09-23T00:00:00Z',
    options: { hosts: ['zcode'], stack: 'none', boardPort: '777' },
    managed: [{ rel: '.agents/scripts/keep.txt', sha256: sha('keep v2\n') }],
    owned: [{ rel: CI_REL, sha256: sha('ci CUSTOM\n'), srcSha256: sha('ci v1\n') }],
  }, null, 2)}\n`);
  const r2 = runCmd('sync', fx2, t2);
  const out2 = r2.stdout + r2.stderr;
  check('S16③ 源演进未跟随 → 感知出账含 .github rel', out2.includes('有演进且盘面未跟随') && out2.includes(CI_REL), out2.slice(0, 300));
  check('S16③ 装户定制不被覆盖（盘面仍 CUSTOM）', R(path.join(t2, CI_REL)) === 'ci CUSTOM\n', out2);
  const kit2 = JSON.parse(R(path.join(t2, '.agents/kit.json')));
  check('S16③ 锚刷新为当前包源 sha', kit2.owned.find((f) => f.rel === CI_REL).srcSha256 === sha(CI_TPL), JSON.stringify(kit2.owned));
  const r2b = runCmd('sync', fx2, t2);
  check('S16③ 锚已刷（custom-synced）→ 再跑静默', !(r2b.stdout + r2b.stderr).includes('有演进且盘面未跟随'));
}

// ============ 场景 17：sync 一次自洽——生成器重写 owned 目标后按终态记账（2026-10-08 papercuts-cleanup-batch 修 1）============
// 修前：记账段（owned 自愈/感知/台账重写）先于生成器执行 → 生成器重写 wiki 类 owned 目标后台账停旧值
// → doctor §6.6 owned 漂移 FAIL 一次，需二次 sync 自愈。修后：生成器先跑，记账按生成后盘面收口。
{
  const sha = (s) => sha256(Buffer.from(s, 'utf8'));
  const GEN = "import fs from 'node:fs';\nfs.writeFileSync('wiki/INDEX.md', 'generated v2\\n');\n";
  const fx = mkFixture();
  W(path.join(fx, 'templates/_agents/scripts/gen-wiki-board.mjs'), GEN);
  const t = mkTarget(fx);
  W(path.join(t, '.agents/scripts/gen-wiki-board.mjs'), GEN); // 目标侧与包源渲染一致（genGuard/scriptTrusted 放行）
  W(path.join(t, 'wiki/INDEX.md'), 'generated v1\n');    // 盘面停旧版——生成器将重写它
  const k0 = JSON.parse(R(path.join(t, '.agents/kit.json')));
  k0.managed.push({ rel: '.agents/scripts/gen-wiki-board.mjs', sha256: sha(GEN) });
  k0.owned.push({ rel: 'wiki/INDEX.md', sha256: sha('generated v1\n') });
  W(path.join(t, '.agents/kit.json'), `${JSON.stringify(k0, null, 2)}\n`);
  const r = runCmd('sync', fx, t);
  const out = r.stdout + r.stderr;
  check('S17 一次 sync：生成器重写后 owned 台账按终态记账（wiki/INDEX.md → v2 sha）',
    JSON.parse(R(path.join(t, '.agents/kit.json'))).owned.find((f) => f.rel === 'wiki/INDEX.md').sha256 === sha('generated v2\n'),
    JSON.stringify(JSON.parse(R(path.join(t, '.agents/kit.json'))).owned) + out.slice(0, 300));
  const { checkOwnedDrift } = await import(pathToFileURL(path.join(SRC_ROOT, 'doctor.mjs')).href);
  const d = checkOwnedDrift(t);
  check('S17 一次 sync 后 doctor owned 零漂移（修前必漂移需二次 sync）', d.drift === 0 && d.gone.length === 0, JSON.stringify(d));
  const r2 = runCmd('sync', fx, t);
  check('S17 二次 sync 幂等（无 owned 刷新报告）', !(r2.stdout + r2.stderr).includes('owned 台账哈希按盘面刷新'), r2.stdout + r2.stderr);
}

console.log(`\n合计: PASS ${pass} / FAIL ${failCount}`);
process.exit(failCount ? 1 : 0);
