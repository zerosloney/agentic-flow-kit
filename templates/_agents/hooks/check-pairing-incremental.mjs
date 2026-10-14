#!/usr/bin/env node
// 闭环配对（增量版）：本次暂存的 intents/ incidents/ 入口文档必须已有同名 plan（L2/L3 另须同名 spec）
// 目的：把 check-loop「配对断裂」hard-block 的发现时机从 pre-push 提前到 commit
// （papercut 2026-09-15：maintain.md 只写「incident≡intent 免另立 intent」，未把配 plan 写成显式步骤，
//  按文档字面执行三次 commit 全绿、push 才爆红，只能后补；
//  2026-09-27 audit-gate-hardening 补齐 spec 档——此前只查 plan，L2/L3 缺 spec 仍要拖到 push 才爆红）
// 口径与 check-loop 检查 1 同款分档：入口文档（intents/ incidents/ 直下 .md）↔ workflow/plans/ 同名，
// L2/L3 级别另须 workflow/specs/ 同名；同 commit 携带 plan/spec 合法（检查的是工作区文件存在，staged 新建同样命中）。
// 自 sh 版移植 node（2026-10-08 门禁去 sh 化第二批；2026-10-13 自 Shipyard.Material 参考实现回灌）——语义逐条对齐。
// 已知边界（沿 sh 版）：legacy 豁免与级别读取均基于工作区文件而非暂存 blob——add 后又改工作区时
// 可能误豁免/误拦（逐文件取 blob 的 fork 成本大于收益，接受）。
// git 调用带 `-c core.quotepath=off`：quotepath 默认 true 时非 ASCII 路径被引号转义，
// workflow/ 前缀匹配失配 → 门禁静默跳过（2026-09-27 gate-coverage 教训）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const git = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, out: (r.stdout || '').trim() };
};
const root = git(['rev-parse', '--show-toplevel']);
if (!root.ok) process.exit(1);
process.chdir(root.out);

const staged = git(['-c', 'core.quotepath=off', 'diff', '--cached', '--name-only', '--diff-filter=ACMR']);
if (!staged.ok) process.exit(1);
const entries = staged.out.split('\n').filter((f) => /^workflow\/(intents|incidents)\/[^/]+\.md$/.test(f) && !f.endsWith('_TEMPLATE.md'));

let fail = 0;
const block = (lines) => { console.log('闭环配对（增量）— BLOCK:'); for (const l of lines) console.log('  ' + l); fail = 1; };

for (const f of entries) {
  // 闭环引擎启用前的回填件带「流程: legacy」豁免配对检查（与 check-loop 同口径）
  let legacy = false, lvl = '';
  try {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      if (line.startsWith('流程: legacy')) legacy = true;
      const m = /^级别:\s*(.*)$/.exec(line);
      if (m && lvl === '') lvl = m[1].trim();
      if (legacy && lvl !== '') break;
    }
  } catch { /* 读不到按未豁免处理（沿 sh 版 grep 失败即不豁免的语义） */ }
  if (legacy) continue;
  const base = path.basename(f, '.md');
  if (!fs.existsSync(path.join('workflow', 'plans', `${base}.md`))) {
    block([
      `入口缺同名 plan: ${f}（应在 workflow/plans/${base}.md）`,
      'L1 用 fill-plan.mjs --level L1（入口/改动方案/约束与风险/验证计划/验收标准），不另立 intent',
    ]);
  }
  if (lvl === 'L2' || lvl === 'L3') {
    if (!fs.existsSync(path.join('workflow', 'specs', `${base}.md`))) {
      block([
        `入口缺同名 spec: ${f}（级别 ${lvl} 须三件套，应在 workflow/specs/${base}.md）`,
        '与 pre-push check-loop 检查 1 同口径——先起草 spec 走 design.md，再提交',
      ]);
    }
  }
}

if (fail !== 0) {
  console.error('pre-commit: 入口文档配对不全（plan / L2-L3 spec），提交已阻止（与 pre-push check-loop 同口径，发现时机提前到 commit）');
}
process.exit(fail);
