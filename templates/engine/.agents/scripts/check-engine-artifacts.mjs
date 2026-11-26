#!/usr/bin/env node
// check-engine-artifacts.mjs — 生成物漂移单门（2026-10-28 引擎减重第三刀；2026-11-08 档 2-E 改自愈）
// 背景：effective-policy / engine-map / workflow-index 三门机制完全相同（跑生成器 --check 比对磁盘），
//   逐个挂 verify 只增加门数与输出噪音。本脚本把三份收口成一次调用。
// 口径（档 2-E 自愈，2026-11-08）：生成物是磁盘态的确定函数，漂移的正确处置是重生成而非拦人——
//   --check 检出漂移 → 原地重生成受影响生成物 → 复跑 --check 确认后按通过计（并行会话在途立档
//   期间的既有漂移不再误伤关单 verify，本仓 11-08 两次实证）；重生成或复检失败才 exit 1。
//   例外（与安装器同一条规则）：整文件生成的产物（effective-policy / engine-map）若既不是生成器
//   输出、又未提交 git，重生成会覆盖掉找不回的手工内容 → 不重生成、点名判红；已提交的手工内容
//   照常自愈，并提示可用 git show HEAD:<文件> 找回。磁盘内容与 .agents/install-manifest.json 记录的
//   哈希一致（= 安装器上次生成的那一份，含装完尚未提交的纯生成内容）视同生成器输出，照常自愈、
//   不打找回提示——否则刚装完就改单源的非 git 项目会永久判红。锚点生成的 workflow/INDEX.md 不受
//   此例外影响（生成器只重写锚点内，锚点外文本本来就会保留）。
//   各档（含 --full / CI）同语义无害：CI 工作区可写且生成物不随 CI 提交。
//   判据仍以各生成器 --check 为唯一单源（不复制比对逻辑）；workflow/verify-evidence.md 由 verify
//   全绿尾段（gen-verify-evidence）在全部门结束后的串行尾段写入——三个生成物均不以其为源，
//   与本门自愈写盘无读写交集，不存在顺序/幂等冲突。
// 用法：flow-kit run check-engine-artifacts.mjs
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.FLOW_KIT_PROJECT_ROOT || process.cwd());
const MANIFEST_REL = '.agents/install-manifest.json';
// 第四项 whole：生成器整文件重写（无用户区），须走「未提交且非安装器产物才不覆盖」的例外判断。
const ITEMS = [
  ['effective-policy', 'gen-effective-policy.mjs', 'workflow/effective-policy.md', true],
  ['engine-map', 'gen-engine-map.mjs', '.agents/notes/engine-map.md', true],
  ['workflow-index', 'gen-workflow-index.mjs', 'workflow/INDEX.md', false],
];

// check=true 跑生成器 --check（唯一判据，不写盘）；check=false 原地重生成。
const run = (script, check) =>
  spawnSync(process.execPath, [path.join(DIR, script), ...(check ? ['--check'] : [])], { encoding: 'utf8' });

// 当前内容已提交进 git（覆盖后可用 git show HEAD:<file> 找回）：未跟踪/已改/暂存未提交/非 git 仓
// /git 不可用一律算否——覆盖后找不回的内容按最坏情况保护。
const isCommitted = (artifact) => {
  const g = spawnSync('git', ['status', '--porcelain', '--', artifact], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  return !g.error && g.status === 0 && String(g.stdout || '').trim() === '';
};

const sha256Text = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// 磁盘内容 == 安装器上次生成的那一份（manifest.files 记录的最终文本哈希）：装完尚未提交时，
// 纯生成内容同样是「真实的生成物」，不按手工内容保护。manifest 读不到/无记录一律按否处理。
const isInstalledOutput = (artifact) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_REL), 'utf8'));
    const expected = manifest?.files?.[artifact];
    if (typeof expected !== 'string' || !expected) return false;
    return sha256Text(fs.readFileSync(path.join(ROOT, artifact), 'utf8')) === expected;
  } catch {
    return false;
  }
};

let red = 0;
for (const [id, script, artifact, whole] of ITEMS) {
  const r = run(script, true);
  if (r.status === 0) {
    console.log(`[artifacts] ✅ ${id}`);
    continue;
  }
  const installed = whole && isInstalledOutput(artifact);
  // 整文件生成、既非安装器产物又未提交：重生成会覆盖掉找不回的手工内容 → 保留现状、点名判红。
  if (whole && !installed && !isCommitted(artifact)) {
    red++;
    console.error(`[artifacts] ❌ ${artifact}（未提交的非生成内容：重生成会覆盖且找不回，已保留现状；手工说明请迁到别处，或提交后再跑，或手动 flow-kit run ${script}）`);
    continue;
  }
  // 档 2-E 自愈：漂移 → 原地重生成 → 复跑 --check 确认；无漂移不写盘（幂等），自愈失败才红。
  const reason = (`${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/)[0] || `exit ${r.status}`).slice(0, 200);
  const regen = run(script, false);
  const recheck = regen.status === 0 ? run(script, true) : null;
  if (recheck && recheck.status === 0) {
    const hint = whole && !installed ? `（原内容可用 git show HEAD:${artifact} 找回）` : '';
    console.log(`[artifacts] ♻️ 已自愈重生成：${artifact}${hint}（漂移原因随场景：${reason}）`);
    continue;
  }
  red++;
  const f = recheck || regen;
  const why = regen.status === 0 ? '重生成后复检仍漂移' : `重生成器异常 exit ${regen.status}`;
  console.error(`[artifacts] ❌ ${id} 自愈失败（${why}）：${(`${f.stdout || ''}${f.stderr || ''}`.trim()) || `exit ${f.status}`}`);
  console.error(`[artifacts]    ${artifact} 手动重生成：flow-kit run ${script}`);
}
if (red) {
  console.error(`[artifacts] ${red}/${ITEMS.length} 份生成物自愈失败——单源与磁盘不可自动收敛，人工介入`);
  process.exit(1);
}
console.log(`[artifacts] ✅ ${ITEMS.length} 份生成物与单源一致`);
process.exit(0);
