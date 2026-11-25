#!/usr/bin/env node
// pr-create — 按 origin 建 PR。GitHub → gh；GitLab → glab；Azure → tfs-pr。认不出即停。
// 用法：
//   flow-kit run pr-create.mjs create --source <branch> --target <branch> \
//     --title "<Conventional Commits 中文>" --body-file <file>
// 退出码：非 json 透传托管命令原生退出码（异常兜底 1），--json 统一 0/1；2 用法或远端不可识别。
// 测试钩子：PR_CREATE_GH / PR_CREATE_GLAB=<script.mjs> 时用 node 跑该脚本代替 gh / glab。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getForgeProvider, forgeFromRemote, originUrl } from './forge.mjs';

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
  GitLab origin → glab mr create
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
const provider = getForgeProvider(forge);
if (!provider) {
  console.error(`pr-create: 远端不是 GitHub / GitLab / Azure：${remote || '无 origin'}。停止。`);
  process.exit(2);
}

if (provider.id === 'github' || provider.id === 'gitlab') {
  const source = opt('--source');
  const target = opt('--target');
  const title = opt('--title');
  const body = opt('--body-file');
  const dryRun = rawArgs.includes('--dry-run');

  let cliArgs;
  try {
    cliArgs = provider.buildPrArgs({ source, target, title, bodyFile: body, dryRun });
  } catch (err) {
    if (err.code === 'BODY_FILE_NOT_FOUND') {
      console.error(`pr-create: 读不到 --body-file：${body}`);
      process.exit(2);
    }
    throw err;
  }

  if (dryRun) {
    console.log(`${provider.cli} ${cliArgs.join(' ')}`);
    process.exit(0);
  }

  const hook = provider.envHook ? process.env[provider.envHook] : null;
  const cmd = hook ? process.execPath : provider.cli;
  const argv = hook ? [hook, ...cliArgs] : cliArgs;
  const created = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8' });
  if (created.error) {
    console.error(`pr-create: 未找到 ${provider.cli}。`);
    process.exit(2);
  }

  if (rawArgs.includes('--json')) {
    const parsed = provider.parsePrResponse(created.stdout);
    if (parsed.ok) {
      process.stdout.write(JSON.stringify({ ok: true, url: parsed.url, number: parsed.number }) + '\n');
    } else {
      process.stdout.write(JSON.stringify({ ok: created.status === 0, url: null, number: null }) + '\n');
      if (created.stdout) process.stderr.write(created.stdout);
      if (created.stderr) process.stderr.write(created.stderr);
    }
    process.exit(created.status === 0 ? 0 : 1);
  }

  if (created.stdout) process.stdout.write(created.stdout);
  if (created.stderr) process.stderr.write(created.stderr);
  process.exit(typeof created.status === 'number' ? created.status : 1);
}

if (provider.id === 'azure') {
  const tfsPr = path.join(ROOT, '.agents/skills/tfs-pr/scripts/tfs-pr.mjs');
  if (!fs.existsSync(tfsPr)) {
    console.error(`pr-create: 找不到 tfs-pr 脚本：${tfsPr}`);
    process.exit(2);
  }

  const tfsArgs = provider.buildPrArgs({ rawArgs });
  if (rawArgs.includes('--json')) {
    const created = spawnSync(process.execPath, [tfsPr, ...tfsArgs], { cwd: ROOT, encoding: 'utf8' });
    const parsed = provider.parsePrResponse(created.stdout);
    if (parsed.ok) {
      process.stdout.write(JSON.stringify({ ok: true, url: parsed.url, number: parsed.number }) + '\n');
    } else {
      process.stdout.write(JSON.stringify({ ok: created.status === 0, url: null, number: null }) + '\n');
      if (created.stdout) process.stderr.write(created.stdout);
      if (created.stderr) process.stderr.write(created.stderr);
    }
    process.exit(created.status === 0 ? 0 : 1);
  }

  const created = spawnSync(process.execPath, [tfsPr, ...tfsArgs], { cwd: ROOT, stdio: 'inherit' });
  process.exit(typeof created.status === 'number' ? created.status : 1);
}
