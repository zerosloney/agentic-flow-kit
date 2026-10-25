#!/usr/bin/env node
// check-local-gate-config.mjs — 本地门禁挂载自检（verify 门 WARN 档；2026-10-25 source-port-batch，自源仓优化1 回灌）
//
// 动机：core.hooksPath 不随 clone 传播，漏配 = 全部门禁静默失效。doctor 是 npx 手动面（「人记得跑」），
//   本门把同一 git 面（① core.hooksPath ② merge.jsonl-union driver ③ .gitattributes 的 jsonl-union 两行（主台账+分片）
//   ④ .githooks 五钩子文件在位）挂进 verify 门表，每次关单 / CI 自动对质。
//   kit 判据适配（对比源仓）：源仓另有 merge.ours / appsettings.json 两项（业务私有），kit 面只保留
//   引擎通用四项；doctor.mjs 的 hooksPath 检查与本门 ① 单源对齐（一边改另一边须跟）。
//
// 档位：默认 WARN——缺配只告警不阻断（打出修复命令，exit 0）；--strict 缺配即 exit 1（升格开关：
//   WARN 期观察误报后由 owner 拍板把 verify.mjs 门表 cmd 换成 --strict）。
//   CI（GITHUB_ACTIONS）不挂本地钩子是常态而非违规：loud-skip（跳过可见）。非 git 仓库（git 不可用）
//   同样 loud-skip（fixture 根合法形态）。
//
// 用法：node .agents/scripts/check-local-gate-config.mjs [--root <仓库根>] [--strict]
// 退出码：0 = 全配或 WARN 档放行 / 1 = --strict 下有缺配。零工作区副作用（git config 只读探测）。
// 测试：node .agents/scripts/check-local-gate-config.test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const strict = process.argv.includes('--strict');
let root = process.cwd();
{
  const i = process.argv.indexOf('--root');
  if (i >= 0 && process.argv[i + 1]) root = path.resolve(process.argv[i + 1]);
}

if (process.env.GITHUB_ACTIONS === 'true') {
  console.log('[local-gate-config] ⏭️ CI 环境（GITHUB_ACTIONS）——CI checkout 不挂本地钩子属常态，跳过（本地缺配由各机 verify 跑出）');
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

const JSONL_DRIVER = 'node .agents/scripts/git-merge-jsonl.mjs %O %A %B';
const hooksPath = git(['config', 'core.hooksPath']);
const gaText = (() => {
  const p = path.join(root, '.gitattributes');
  try { return fs.readFileSync(p, 'utf8').replace(/\r/g, ''); } catch { return ''; }
})();
const hooks = ['pre-commit', 'pre-merge-commit', 'commit-msg', 'pre-push', 'post-commit'];
const missingHooks = hooks.filter((h) => !fs.existsSync(path.join(root, '.githooks', h)));

const results = [
  {
    ok: hooksPath === '.githooks',
    name: 'core.hooksPath → .githooks（漏配 = 五钩子全部静默失效）',
    fix: 'git config core.hooksPath .githooks',
  },
  {
    ok: git(['config', 'merge.jsonl-union.driver']) === JSONL_DRIVER,
    name: 'merge.jsonl-union.driver（台账 jsonl 并发并集合并；漏配退化为文本冲突，不静默丢数据）',
    fix: `git config merge.jsonl-union.driver "${JSONL_DRIVER}"`,
  },
  {
    // 两行口径（2026-10-25 audit-fixes）：glob 不跨目录——主台账与 confirmations.d/ 分片各需一行
    //（单行时分片冲突退化为文本冲突，不丢数据但需人工解；workflow/README 迁移指引同口径）
    ok: /^\.agents\/\*\.jsonl\s+merge=jsonl-union$/m.test(gaText)
      && /^\.agents\/confirmations\.d\/\*\.jsonl\s+merge=jsonl-union$/m.test(gaText),
    name: '.gitattributes 含主台账与分片两行 merge=jsonl-union（owned 文件，sync 不覆盖——存量装户须手动补两行）',
    fix: null, // 仓库侧文件：git checkout -- .gitattributes 恢复（被删时）
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
  else console.log(`[local-gate-config]   ${strict ? '[缺失]' : '⚠️ WARN'} ${r.name}${r.fix ? ` —— 修复: ${r.fix}` : ' —— git checkout 恢复文件 / npx agentic-flow-kit doctor 体检'}`);
}
if (!bad.length) {
  console.log('[local-gate-config] 本地门禁挂载面全配（hooksPath + jsonl-union driver + .gitattributes + 五钩子在位）');
  process.exit(0);
}
console.log(`[local-gate-config] ${strict ? '❌' : '⚠️'} ${bad.length} 项缺配——逐项修复见上（体检：npx agentic-flow-kit doctor；机理见 README「本地 Clone 必做」）`);
process.exit(strict ? 1 : 0);
