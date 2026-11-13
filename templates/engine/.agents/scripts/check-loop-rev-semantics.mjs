#!/usr/bin/env node
// check-loop-rev-semantics.mjs — 合并提交增量面语义对拍探针（2026-10-28 C1，P0-A 防退化钉子）
// 背景（P0-A，2026-10-28 复核实证）：check-loop-kit 的 REV 面曾用 `git show --name-only` 取文件面，
//   合并提交默认无文件面 → hard 5 段空扫报绿（近三天 6/6 合并提交实证）。修复改为 first-parent diff
//   （普通提交等价 git show；合并提交 = REV^1..REV）。f7de5922 的教训「合并必须取全文件面」此前只靠
//   commit message 口头声明 + 已删测试守护——本探针把该语义钉成机器可证伪：
//   A) 等价性：first-parent 结果 ⊆ `git show -m` 双侧并集（防现行实现本身算错面）；
//   B) 退化钉子：样本合并提交中至少 1 个满足「旧语义 git show 为空集且 first-parent 非空」——
//      实现被改回 git show 时两条语义重合、pinned 归零，B 即红。
// 用法：flow-kit run check-loop-rev-semantics.mjs [样本数，默认 12]；
//   check-loop FULL 模式（本地手动审计）末尾自动调用。手动工具：不占 verify 门表（16 门不变）、不进 CI。
import { spawnSync } from 'node:child_process';

const SAMPLES = Math.max(1, Number(process.argv[2] || 12));
const git = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};

const head = git(['rev-parse', '--verify', 'HEAD']);
if (!head) {
  console.log('[rev-semantics] 不在 git 仓库内或无 HEAD——跳过（fail-open）');
  process.exit(0);
}
const merges = (git(['rev-list', '--merges', '-n', String(SAMPLES), 'HEAD']) || '')
  .split(/\r?\n/).filter(Boolean);
if (!merges.length) {
  console.log('[rev-semantics] 仓内无合并提交样本——跳过（exit 0）');
  process.exit(0);
}

let equivFails = 0;
let pinned = 0;
for (const rev of merges) {
  const legacy = git(['show', '--name-only', '--format=', '--no-renames', rev]) ?? '';
  const fp = git(['diff', '--name-only', '--no-renames', `${rev}^1`, rev]) ?? '';
  const showM = git(['show', '-m', '--name-only', '--format=', '--no-renames', rev]) ?? '';
  const fpLines = fp.split(/\r?\n/).filter(Boolean);
  const showMLines = new Set(showM.split(/\r?\n/).filter(Boolean));
  const outside = fpLines.filter((f) => !showMLines.has(f));
  if (outside.length) {
    equivFails++;
    console.error(`FAIL  ${rev.slice(0, 10)} first-parent 有 ${outside.length} 个文件不在 show -m 并集中（例：${outside[0]}）`);
  }
  // 旧语义空集而现行非空 = 「合并必须取全文件面」语义的实际命中
  const legacyEmpty = !legacy.split(/\r?\n/).filter(Boolean).length;
  if (legacyEmpty && fpLines.length) pinned++;
}

console.log(`[rev-semantics] 合并样本 ${merges.length}｜等价性违例 ${equivFails}｜退化钉子命中 ${pinned}`);
if (equivFails > 0) {
  console.error('[rev-semantics] FAIL——first-parent 实现与 show -m 并集不等价，REV 面取面逻辑有误');
  process.exit(1);
}
if (pinned === 0) {
  console.error('[rev-semantics] FAIL——全部样本「git show 空」与「first-parent 非空」不再分化，REV 面实现疑似退化为 git show（P0-A 复发）');
  process.exit(1);
}
console.log('[rev-semantics] PASS');
