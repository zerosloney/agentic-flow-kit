#!/usr/bin/env node
// pr-create.mjs — 本仓建 PR 的唯一推荐入口（2026-11-06）
//
// 原样转调 .agents/skills/tfs-pr/scripts/tfs-pr.mjs create。
// （2026-11-09 退役注记：前置的 pr-review 评审门已随自动触发拆除——本脚本不再跑 gate，
//   评审改为手动按需，编排见 .agents/commands/pr-review.md。）
//
// 用法：
//   node .agents/scripts/pr-create.mjs create --source <branch> --target <branch> \
//     --title "<Conventional Commits 中文>" --body-file <file>
//   node .agents/scripts/pr-create.mjs --source <branch> --target <branch> --title ... --body-file ...
//
// 选项：全部原样传给 tfs-pr create（--dry-run / --json / --title / --body-file / ...）。
//
// 退出码：0 成功；1 tfs-pr 失败；2 用法/环境错误。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = (() => {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) {
    console.error('pr-create: 不在 git 仓库内');
    process.exit(2);
  }
  return r.stdout.trim();
})();
process.chdir(ROOT);

const rawArgs = process.argv.slice(2);
if (!rawArgs.length || rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(`pr-create.mjs — 转调 tfs-pr create

用法：
  node .agents/scripts/pr-create.mjs create --source <branch> --target <branch> \\
    --title "<Conventional Commits 中文>" --body-file <file>

选项：
  其余参数原样传给 tfs-pr create
`);
  process.exit(0);
}

// 转调 tfs-pr create
const tfsPr = path.join(ROOT, '.agents/skills/tfs-pr/scripts/tfs-pr.mjs');
if (!fs.existsSync(tfsPr)) {
  console.error(`pr-create: 找不到 tfs-pr 脚本：${tfsPr}`);
  process.exit(2);
}
const hasCreate = rawArgs[0] === 'create';
const tfsArgs = hasCreate ? rawArgs : ['create', ...rawArgs];
const created = spawnSync(process.execPath, [tfsPr, ...tfsArgs], { cwd: ROOT, stdio: 'inherit' });
process.exit(created.status === null ? 1 : created.status);
