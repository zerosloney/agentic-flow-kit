#!/usr/bin/env node
// pr-create — 按 origin 建 PR。GitHub → gh；Azure → tfs-pr。认不出即停。
// 用法：
//   flow-kit run pr-create.mjs create --source <branch> --target <branch> \
//     --title "<Conventional Commits 中文>" --body-file <file>
// 退出码：0 成功；1 托管命令失败；2 用法或远端不可识别。
// 测试钩子：PR_CREATE_GH=<script.mjs> 时用 node 跑该脚本代替 gh。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { forgeFromRemote, originUrl } from './forge.mjs';

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
  console.log(`pr-create.mjs — 按 origin 建 PR

用法：
  flow-kit run pr-create.mjs create --source <branch> --target <branch> \\
    --title "<Conventional Commits 中文>" --body-file <file>

分路：
  GitHub origin → gh pr create
  Azure origin  → tfs-pr create
  其他或无 origin → 停止
`);
  process.exit(0);
}

function opt(name) {
  const i = rawArgs.indexOf(name);
  if (i < 0 || i + 1 >= rawArgs.length) return null;
  return rawArgs[i + 1];
}

const remote = originUrl(ROOT);
const forge = forgeFromRemote(remote);
if (!forge) {
  console.error(`pr-create: 远端不是 GitHub 或 Azure：${remote || '无 origin'}。停止。`);
  process.exit(2);
}

if (forge === 'github') {
  const ghArgs = ['pr', 'create'];
  const source = opt('--source');
  const target = opt('--target');
  const title = opt('--title');
  const body = opt('--body-file');
  if (source) ghArgs.push('--head', source);
  if (target) ghArgs.push('--base', target);
  if (title) ghArgs.push('--title', title);
  if (body) ghArgs.push('--body-file', body);
  if (rawArgs.includes('--json')) ghArgs.push('--json', 'url,number');
  if (rawArgs.includes('--dry-run')) {
    console.log(`gh ${ghArgs.join(' ')}`);
    process.exit(0);
  }
  const hook = process.env.PR_CREATE_GH;
  const cmd = hook ? process.execPath : 'gh';
  const argv = hook ? [hook, ...ghArgs] : ghArgs;
  const created = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8' });
  if (created.error) {
    console.error('pr-create: 未找到 gh。');
    process.exit(2);
  }
  if (created.stdout) process.stdout.write(created.stdout);
  if (created.stderr) process.stderr.write(created.stderr);
  process.exit(created.status === null ? 1 : created.status);
}

const tfsPr = path.join(ROOT, '.agents/skills/tfs-pr/scripts/tfs-pr.mjs');
if (!fs.existsSync(tfsPr)) {
  console.error(`pr-create: 找不到 tfs-pr 脚本：${tfsPr}`);
  process.exit(2);
}
const hasCreate = rawArgs[0] === 'create';
const tfsArgs = hasCreate ? rawArgs : ['create', ...rawArgs];
const created = spawnSync(process.execPath, [tfsPr, ...tfsArgs], { cwd: ROOT, stdio: 'inherit' });
process.exit(created.status === null ? 1 : created.status);
