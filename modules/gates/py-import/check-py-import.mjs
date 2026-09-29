#!/usr/bin/env node
// 暂存的业务 .py（不在 tests/ 或 test/ 下）不得 import tests 或 test。
// 正文只读索引（git show :path），不读工作区。
import { spawnSync } from 'node:child_process';

const git = process.platform === 'win32' ? 'git.exe' : 'git';
const listed = spawnSync(git, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' });
if (listed.status !== 0) {
  console.error('check-py-import: git diff --cached 失败（需在 git 仓库的暂存区上运行）');
  process.exit(1);
}
const re = /^\s*(?:import|from)\s+(?:tests?|test)\b/;
let bad = 0;
for (const rel of listed.stdout.split(/\n/).map((s) => s.trim()).filter(Boolean)) {
  const norm = rel.split('\\').join('/');
  if (!norm.endsWith('.py')) continue;
  if (norm.split('/').some((seg) => seg === 'tests' || seg === 'test')) continue;
  const shown = spawnSync(git, ['show', `:${norm}`], { encoding: 'utf8' });
  if (shown.status !== 0) {
    console.error(`${norm}: 读不到暂存内容`);
    bad += 1;
    continue;
  }
  shown.stdout.split(/\n/).forEach((line, i) => {
    if (!re.test(line)) return;
    console.error(`${norm}:${i + 1}: 业务代码不得 import tests 或 test`);
    bad += 1;
  });
}
process.exit(bad ? 1 : 0);
