#!/usr/bin/env node
// check-local-gate-config.mjs — 本地门禁挂载自检（verify 门 WARN 档；2026-10-25 优化1）
//
// 动机：core.hooksPath 不随 clone 传播，漏配 = 全部门禁静默失效（2026-09-16 事故实证，机理
//   runtime-env.md §7）。check-local-gates.mjs 是上岗自检的显著入口，但「靠人记得跑」是整座
//   防御纵深唯一的地基软肋——本门把同一 git 面（① core.hooksPath ② merge.ours ②b merge.jsonl-union
//   ③ .gitattributes 两行 ④ 五钩子文件在位）挂进 verify 门表，每次关单/CI 自动对质。
//   判据与 check-local-gates.mjs ①-④ 逐条对齐（单源：一边改另一边须跟）；栈条件化同源：
//   ② merge.ours.driver 与 ③ 的 appsettings merge=ours 行仅 engine.json stacks 含 dotnet 时判定，
//   非 dotnet 打 info 跳过（不进结果集、不影响退出码）；jsonl-union 判定通用。node/dotnet/浏览器
//   工具链项不进本门——其余 verify 门自身即依赖 node，dotnet 由 backend-build 门执法。
//
// 档位：默认 WARN——缺配只告警不阻断（打出修复命令，exit 0）；--strict 缺配即 exit 1（升格
//   开关：WARN 期观察误报后由 owner 拍板把 verify.mjs 门表 cmd 换成 --strict，机制台账该行挂复评）。
//   CI（TF_BUILD）不挂本地钩子是常态而非违规：loud-skip（跳过可见，与 E2E 门对称）。
//   非 git 仓库（git config 不可用）→ 同样 loud-skip（fixture 根合法形态）。
//
// 用法：flow-kit run check-local-gate-config.mjs [--root <仓库根>] [--strict]
// 退出码：0 = 全配或 WARN 档放行 / 1 = --strict 下有缺配。零工作区副作用。
// 测试面已随引擎减重退役（2026-10-28，owner 决策），本脚本现无测试兜底

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isCi } from './ci-provider.mjs';
let detectStackFromRules = () => [];
try {
  const mod = await import('./rules-loader.mjs');
  if (typeof mod?.detectStackFromRules === 'function') detectStackFromRules = mod.detectStackFromRules;
} catch {
  // 当脚本在最小隔离测试夹具中独立运行且未复制 rules-loader.mjs 时平滑降级
}

const strict = process.argv.includes('--strict');
let root = process.cwd();
{
  const i = process.argv.indexOf('--root');
  if (i >= 0 && process.argv[i + 1]) root = path.resolve(process.argv[i + 1]);
}

if (isCi()) {
  console.log('[local-gate-config] ⏭️ CI 环境——CI checkout 不挂本地钩子属常态，跳过（本地缺配由各机 verify 跑出）');
  process.exit(0);
}

const git = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8', cwd: root });
  if (r.status === 0) return String(r.stdout || '').trim();
  if (r.status === 1) return ''; // git config 键未配置（合法缺省，非错误——与「fatal 非 git 仓」分离）
  return null; // fatal（非 git 仓库 / git 不可用）
};
if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') {
  console.log(`[local-gate-config] ⏭️ ${root} 非 git 仓库（git 不可用或不在工作树内）——无本地门禁挂载面，跳过`);
  process.exit(0);
}

const JSONL_DRIVER = 'flow-kit run git-merge-jsonl %O %A %B';
const hooksPath = git(['config', 'core.hooksPath']);
const gaText = (() => {
  const p = path.join(root, '.gitattributes');
  try { return fs.readFileSync(p, 'utf8').replace(/\r/g, ''); } catch { return ''; }
})();
const hooks = ['pre-commit', 'pre-merge-commit', 'commit-msg', 'pre-push', 'post-commit'];
const missingHooks = hooks.filter((h) => !fs.existsSync(path.join(root, '.githooks', h)));

// 栈条件化（与 check-local-gates.mjs 同口径）：engine.json 缺失/坏 → 未声明栈，不按 dotnet 执法。
const STACKS = (() => {
  try {
    const options = JSON.parse(fs.readFileSync(path.join(root, '.agents/config/engine.json'), 'utf8')).options || {};
    const list = options.stacks?.length ? options.stacks : (options.stack ? [options.stack] : []);
    if (list.length) return list;
  } catch { /* 忽略 engine.json 缺省 */ }
  return detectStackFromRules(root);
})();
const isDotnet = STACKS.includes('dotnet');
if (!isDotnet) console.log('[local-gate-config] ⏭️ 非 dotnet 栈：appsettings 合并保护不适用（跳过）');

const gaOursOk = /^(?:.*\/)?appsettings\.json\s+merge=ours$/m.test(gaText);
const gaJsonlOk = /^\.agents\/\*\.jsonl\s+merge=jsonl-union$/m.test(gaText);

const results = [
  {
    ok: hooksPath === '.githooks',
    name: 'core.hooksPath → .githooks（漏配 = 五钩子全部静默失效）',
    fix: 'git config core.hooksPath .githooks',
  },
  ...(isDotnet ? [{
    ok: git(['config', 'merge.ours.driver']) === 'true',
    name: 'merge.ours.driver（appsettings.json 连接串合并保护）',
    fix: 'git config merge.ours.driver true',
  }] : []),
  {
    ok: git(['config', 'merge.jsonl-union.driver']) === JSONL_DRIVER,
    name: 'merge.jsonl-union.driver（台账 jsonl 并发并集合并）',
    fix: `git config merge.jsonl-union.driver "${JSONL_DRIVER}"`,
  },
  {
    // 与 check-local-gates.mjs 同一口径：接受任意目录下的 appsettings.json（随包模板写的是 **/appsettings.json）
    // appsettings merge=ours 行仅 dotnet 栈判定；jsonl 行通用
    ok: isDotnet ? gaOursOk && gaJsonlOk : gaJsonlOk,
    name: isDotnet ? '.gitattributes 含 merge=ours 与 merge=jsonl-union 两行' : '.gitattributes 含 merge=jsonl-union 行',
    fix: null, // 仓库侧文件：git checkout -- .gitattributes 恢复
  },
  {
    ok: missingHooks.length === 0,
    name: `.githooks/ 五钩子文件在位${missingHooks.length ? `（缺 ${missingHooks.join('、')}）` : ''}`,
    fix: null,
  },
];

const bad = results.filter((r) => !r.ok);
for (const r of results) {
  if (r.ok) console.log(`[local-gate-config]   [OK] ${r.name}`);
  else console.log(`[local-gate-config]   ${strict ? '[缺失]' : '⚠️ WARN'} ${r.name}${r.fix ? ` —— 修复: ${r.fix}` : ' —— git checkout 恢复文件'}`);
}
if (!bad.length) {
  console.log(isDotnet
    ? '[local-gate-config] 本地门禁挂载面全配（hooksPath + 两条 merge driver + .gitattributes + 五钩子在位）'
    : '[local-gate-config] 本地门禁挂载面全配（hooksPath + jsonl 并集合并驱动 + .gitattributes + 五钩子在位；appsettings 合并保护不适用）');
  process.exit(0);
}
console.log(`[local-gate-config] ${strict ? '❌' : '⚠️'} ${bad.length} 项缺配——一键修复: flow-kit run check-local-gates.mjs --fix（机理见 .agents/notes/runtime-env.md §7）`);
process.exit(strict ? 1 : 0);
