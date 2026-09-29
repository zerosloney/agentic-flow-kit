#!/usr/bin/env node
// 暂存区内 src/ 下的脚本不得引用 tests/、test/ 或 __tests__/。
// 正文只读索引（git show :path），不读工作区。
import { spawnSync } from 'node:child_process';

const git = process.platform === 'win32' ? 'git.exe' : 'git';
const listed = spawnSync(git, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' });
if (listed.status !== 0) {
  console.error('check-node-layer: git diff --cached 失败（需在 git 仓库的暂存区上运行）');
  process.exit(1);
}
const re = /['"](?:[^'"]*\/)?(?:tests?|__tests__)(?:\/[^'"]*)?['"]/;
let bad = 0;
for (const rel of listed.stdout.split(/\n/).map((s) => s.trim()).filter(Boolean)) {
  const norm = rel.split('\\').join('/');
  if (!norm.startsWith('src/') || !/\.(?:[cm]?js|jsx|tsx?)$/.test(norm)) continue;
  const shown = spawnSync(git, ['show', `:${norm}`], { encoding: 'utf8' });
  if (shown.status !== 0) {
    console.error(`${norm}: 读不到暂存内容`);
    bad += 1;
    continue;
  }
  shown.stdout.split(/\n/).forEach((line, i) => {
    if (!re.test(line)) return;
    console.error(`${norm}:${i + 1}: src 不得引用 tests/、test/ 或 __tests__/`);
    bad += 1;
  });
}
process.exit(bad ? 1 : 0);
