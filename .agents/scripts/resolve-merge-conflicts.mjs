#!/usr/bin/env node
// resolve-merge-conflicts.mjs — 台账与派生生成物合并冲突一键自愈器（2026-10-10；B9 自 Shipyard.Material
//   回灌——判定面逐字对齐，出处沿革留痕在包源仓 git 历史与 CHANGELOG，装户径不引实例路径）
// 解决什么：多人并发提同一分支，或单人多 worktree 并行后合并时，派生生成物与 append-only 台账走
//   git 文本合并产生冲突。第一道防线是 `.gitattributes` 的 `merge=jsonl-union` 驱动（台账类冲突直接
//   确定性并集，见 git-merge-jsonl.mjs）；本脚本是**兜底**——driver / gitattributes 行漏配退化成文本
//   冲突、或 INDEX.md 这类生成物仍要人工解时，一键消解派生面，把人留在业务冲突上。
// 逻辑：
// 1. 扫描当前 Git 处于 unmerged (UU / AA / DD / AU / UA 等) 状态的文件；
// 2. 若 workflow/INDEX.md 冲突：checkout --ours 后重新调用 gen-workflow-index.mjs 全量生成并 git add；
// 3. 若 .agents/ 下 *.jsonl 台账冲突且双方内容都在（UU/AA）：利用 git-merge-jsonl.mjs 合并当前与对方
//    版本并 git add。判定面按「.agents/ 前缀 + .jsonl 后缀」匹配，**天然含 confirmations.d/ 分片**——
//    分片是 kit 确认行的默认写入口径（2026-10-13 ledger-shard-default），分片 UU/AA 同走并集；
//    删除/改删型（DD/AU/UD/UA/DU）不做任何写入——自动并集会复活被删文件或凭空建空文件，仅提示人工裁决；
// 4. 输出处理清单，退出码 0。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mergeJsonlLines } from './git-merge-jsonl.mjs';

const git = (args) => {
  try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
  catch (e) { return ''; }
};

export function getUnmergedFiles() {
  const status = git(['status', '--porcelain']);
  if (!status) return [];

  const unmerged = [];
  for (const line of status.split(/\r?\n/)) {
    if (!line) continue;
    const code = line.slice(0, 2);
    const file = line.slice(3).trim();
    // 冲突代码：UU (both modified), AA (both added), DU, UD 等
    if (/^(UU|AA|DD|AU|UD|UA|DU)/.test(code)) {
      unmerged.push({ file, code });
    }
  }
  return unmerged;
}

export function autoResolveConflicts() {
  const files = getUnmergedFiles();
  if (files.length === 0) {
    console.log('[resolve-conflicts] 当前无未解决的合并冲突。');
    return { resolved: [], remaining: [] };
  }

  const resolved = [];
  const remaining = [];

  for (const { file, code } of files) {
    const normFile = file.replace(/\\/g, '/');

    // 1. workflow/INDEX.md 派生索引冲突：取当前版本为底，重新全量生成
    if (normFile === 'workflow/INDEX.md') {
      try {
        execFileSync('git', ['checkout', '--ours', 'workflow/INDEX.md'], { stdio: 'pipe' });
        // 调用索引生成器重新渲染
        execFileSync(process.execPath, ['.agents/scripts/gen-workflow-index.mjs'], { stdio: 'pipe' });
        execFileSync('git', ['add', 'workflow/INDEX.md'], { stdio: 'pipe' });
        resolved.push('workflow/INDEX.md (已自动全量重生成)');
      } catch (err) {
        remaining.push(`workflow/INDEX.md: 重生成失败 (${err.message})`);
      }
      continue;
    }

    // 2. .agents/ 下 *.jsonl 台账冲突（主台账与 confirmations.d/ 分片同判定面）：仅 UU/AA（双方内容
    //    都在）取当前版本和对方版本合并去重；删除/改删型（DD/AU/UD/UA/DU）不可并集，自动写入会
    //    复活被删文件或凭空建空文件
    if (normFile.startsWith('.agents/') && normFile.endsWith('.jsonl')) {
      if (!/^(UU|AA)$/.test(code)) {
        remaining.push(`${file}: 删除/改删型冲突不自动处理，请人工裁决`);
        continue;
      }
      try {
        const ours = git(['show', `:2:${normFile}`]);
        const theirs = git(['show', `:3:${normFile}`]);
        const merged = mergeJsonlLines(ours, theirs);
        fs.writeFileSync(file, merged, 'utf8');
        execFileSync('git', ['add', file], { stdio: 'pipe' });
        resolved.push(`${file} (已自动并集去重)`);
      } catch (err) {
        remaining.push(`${file}: 台账合并失败 (${err.message})`);
      }
      continue;
    }

    // 其余业务文件保持冲突，需人工审查
    remaining.push(file);
  }

  return { resolved, remaining };
}

if (process.argv[1] && process.argv[1].endsWith('resolve-merge-conflicts.mjs')) {
  const { resolved, remaining } = autoResolveConflicts();
  if (resolved.length > 0) {
    console.log('[resolve-conflicts] ✅ 已自动消解以下派生/台账冲突：');
    resolved.forEach((f) => console.log(`  - ${f}`));
  }
  if (remaining.length > 0) {
    console.log('\n[resolve-conflicts] ⚠️ 剩余业务代码冲突需手动介入处理：');
    remaining.forEach((f) => console.log(`  - ${f}`));
  } else if (resolved.length > 0) {
    console.log('\n[resolve-conflicts] 所有台账冲突已全部清零，可继续 git commit 完成合并。');
  }
}
