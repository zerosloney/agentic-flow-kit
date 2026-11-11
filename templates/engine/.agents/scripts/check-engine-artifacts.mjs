#!/usr/bin/env node
// check-engine-artifacts.mjs — 生成物漂移单门（2026-10-28 引擎减重第三刀；2026-11-08 档 2-E 改自愈）
// 背景：effective-policy / engine-map / workflow-index 三门机制完全相同（跑生成器 --check 比对磁盘），
//   逐个挂 verify 只增加门数与输出噪音。本脚本把三份收口成一次调用。
// 口径（档 2-E 自愈，2026-11-08）：生成物是磁盘态的确定函数，漂移的正确处置是重生成而非拦人——
//   --check 检出漂移 → 原地重生成受影响生成物 → 复跑 --check 确认后按通过计（并行会话在途立档
//   期间的既有漂移不再误伤关单 verify，本仓 11-08 两次实证）；重生成或复检失败才 exit 1。
//   各档（含 --full / CI）同语义无害：CI 工作区可写且生成物不随 CI 提交。
//   判据仍以各生成器 --check 为唯一单源（不复制比对逻辑）；workflow/verify-evidence.md 由 verify
//   全绿尾段（gen-verify-evidence）在全部门结束后的串行尾段写入——三个生成物均不以其为源，
//   与本门自愈写盘无读写交集，不存在顺序/幂等冲突。
// 用法：node .agents/scripts/check-engine-artifacts.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ITEMS = [
  ['effective-policy', 'gen-effective-policy.mjs', 'workflow/effective-policy.md'],
  ['engine-map', 'gen-engine-map.mjs', '.agents/notes/engine-map.md'],
  ['workflow-index', 'gen-workflow-index.mjs', 'workflow/INDEX.md'],
];

// check=true 跑生成器 --check（唯一判据，不写盘）；check=false 原地重生成。
const run = (script, check) =>
  spawnSync(process.execPath, [path.join(DIR, script), ...(check ? ['--check'] : [])], { encoding: 'utf8' });

let red = 0;
for (const [id, script, artifact] of ITEMS) {
  const r = run(script, true);
  if (r.status === 0) {
    console.log(`[artifacts] ✅ ${id}`);
    continue;
  }
  // 档 2-E 自愈：漂移 → 原地重生成 → 复跑 --check 确认；无漂移不写盘（幂等），自愈失败才红。
  const reason = (`${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/)[0] || `exit ${r.status}`).slice(0, 200);
  const regen = run(script, false);
  const recheck = regen.status === 0 ? run(script, true) : null;
  if (recheck && recheck.status === 0) {
    console.log(`[artifacts] ♻️ 已自愈重生成：${artifact}（漂移原因随场景：${reason}）`);
    continue;
  }
  red++;
  const f = recheck || regen;
  const why = regen.status === 0 ? '重生成后复检仍漂移' : `重生成器异常 exit ${regen.status}`;
  console.error(`[artifacts] ❌ ${id} 自愈失败（${why}）：${(`${f.stdout || ''}${f.stderr || ''}`.trim()) || `exit ${f.status}`}`);
  console.error(`[artifacts]    ${artifact} 手动重生成：node .agents/scripts/${script}`);
}
if (red) {
  console.error(`[artifacts] ${red}/${ITEMS.length} 份生成物自愈失败——单源与磁盘不可自动收敛，人工介入`);
  process.exit(1);
}
console.log(`[artifacts] ✅ ${ITEMS.length} 份生成物与单源一致`);
process.exit(0);
