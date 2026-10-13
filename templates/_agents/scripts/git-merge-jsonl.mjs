#!/usr/bin/env node
// git-merge-jsonl.mjs — Git 自定义合并驱动：JSONL 追加式台账并集去重（2026-10-12 ledger-merge-driver）
// 解决什么：确认台账 `.agents/confirmations.jsonl` 是「尾部追加 + 多人/多 worktree 并行」形态。
//   两个分支各自追加行 → 同一文件末尾分叉 → git 默认三方合并把它当文本冲突，人工解且极易解错
//   （常见错解：整取一侧，**静默丢掉另一侧的确认行**——门禁事后无从发现，人不可信面直接扩大）。
//   本驱动把合并降级为确定性的**并集去重**：两侧行全保留，无冲突可解。
//
// 接线（两步，缺任一步则退化为文本冲突——不静默丢数据，但要人工解）：
//   ① git config merge.jsonl-union.driver "node .agents/scripts/git-merge-jsonl.mjs %O %A %B"
//   ② 目标仓 .gitattributes 含：.agents/*.jsonl merge=jsonl-union
//   flow-kit init 会自动做 ①；②由 templates/.gitattributes 下发（**owned**——存量装户 sync 永不覆盖，
//   需自行补一行，见 README 台账并发口径）。
//
// 调用协议（由 .gitattributes 关联 merge=jsonl-union 触发）：
//   %O 祖先版本路径 ｜ %A 当前分支版本（合并结果必须覆写回此文件）｜ %B 对方分支版本
//
// **为什么 union 去重不会破坏台账哈希链**（ledgerChainHash 的前提，勿破坏）：
//   去重按**整行文本**精确比对，不解析、不改写行内任何字段 → 合并后每行文本与合并前逐字相同
//   → JSON.parse 保持键序 → ledgerChainHash(row) 重算结果不变。哈希链的**行内自洽**因此恒成立。
//   （跨合并边界的**链首尾衔接**是另一回事，由链域改造承接，见 check-loop 检查 15。）
import fs from 'node:fs';

// mergeJsonlLines：并集去重。保持 current（%A）既有行的原始顺序，其余 other（%B）新行追加末尾。
// 全部行按整行文本精确去重；CRLF 归一为 LF（台账判据与 check-ledger-invariant 的 blob 口径对齐）。
export function mergeJsonlLines(currentContent, otherContent) {
  const norm = (str) => (str || '').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  const currentLines = norm(currentContent);
  const otherLines = norm(otherContent);

  const seen = new Set(currentLines);
  const result = [...currentLines];
  for (const line of otherLines) {
    if (!seen.has(line)) { seen.add(line); result.push(line); }
  }
  return result.length > 0 ? result.join('\n') + '\n' : '';
}

// CLI 执行入口（isMain 守卫沿本仓惯例：被 import 时零副作用，供 compact-ledgers 复用本函数）
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('git-merge-jsonl.mjs');
if (isMain) {
  // %O（祖先版本）本驱动用不到——并集去重只需 %A ∪ %B；保留位置占位以对齐 git 的 %O %A %B 调用协议
  const [, , _ancestorPath, currentPath, otherPath] = process.argv;

  if (!currentPath || !otherPath) {
    console.error('用法：node git-merge-jsonl.mjs %O %A %B（由 .gitattributes 的 merge=jsonl-union 触发，不供手工调用）');
    process.exit(1);
  }

  // 原子覆写：直接 writeFileSync 会先截断原文件，进程中途崩溃将留下半写文件——git 合并中途失败
  // 正是最需要「要么旧要么新」的场合。改为同目录临时文件 + rename。
  const tmpPath = `${currentPath}.tmp`;
  try {
    const currentContent = fs.existsSync(currentPath) ? fs.readFileSync(currentPath, 'utf8') : '';
    const otherContent = fs.existsSync(otherPath) ? fs.readFileSync(otherPath, 'utf8') : '';
    fs.writeFileSync(tmpPath, mergeJsonlLines(currentContent, otherContent), 'utf8');
    fs.renameSync(tmpPath, currentPath);
    process.exit(0);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* tmp 可能尚未创建 */ }
    console.error(`[git-merge-jsonl] 合并失败: ${err.message}——已保留原文件，git 将报为冲突（人工解，勿整取一侧丢行）`);
    process.exit(1);
  }
}