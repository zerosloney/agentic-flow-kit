// sync.test.mjs — flow-kit sync 三态升级 + add-host / add-gate 行为验证。
// 方法：迷你 fixture 包根（小模板树 + 假宿主 zcode + 假门禁 fakeg）+ 手工模拟 v1 安装态（kit.json 台账 + 盘面），
// 子进程 driver 调真实 sync/add-host/add-gact（隔离 process.exit 与 doctor 尾部退出），断言盘面 + 台账 + stdout 标记。
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
function mkTarget(fixtureRoot) {
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
  check('S1 台账：跳过文件基线化为用户版 sha', kit.managed.find((f) => f.rel === '.agents/scripts/loc.txt').sha256 === sha256(Buffer.from('loc USER\n')));
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
  check('S7 localOnly 宿主进 .gitignore', R(path.join(t, '.gitignore')).includes('.zcode/'));
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

console.log(`\n合计: PASS ${pass} / FAIL ${failCount}`);
process.exit(failCount ? 1 : 0);
