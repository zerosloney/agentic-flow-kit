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
if (!forge) {
  console.error(`pr-create: 远端不是 GitHub / GitLab / Azure：${remote || '无 origin'}。停止。`);
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
  if (rawArgs.includes('--json')) {
    // gh pr create 不支持 --json；从 stdout 提取 PR URL/编号，stdout 只留最终单对象。
    const match = /https?:\/\/\S+\/pull\/(\d+)/.exec(created.stdout || '');
    if (match) {
      process.stdout.write(JSON.stringify({ ok: true, url: match[0], number: Number(match[1]) }) + '\n');
    } else {
      process.stdout.write(JSON.stringify({ ok: created.status === 0, url: null, number: null }) + '\n');
      if (created.stdout) process.stderr.write(created.stdout);
      if (created.stderr) process.stderr.write(created.stderr);
    }
    process.exit(created.status === 0 ? 0 : 1);
  }
  if (created.stdout) process.stdout.write(created.stdout);
  if (created.stderr) process.stderr.write(created.stderr);
  // 审查遗漏补 2026-11-23：非 json 路径透传原生退出码
  process.exit(typeof created.status === 'number' ? created.status : 1);
}

if (forge === 'gitlab') {
  const glArgs = ['mr', 'create'];
  const source = opt('--source');
  const target = opt('--target');
  const title = opt('--title');
  const body = opt('--body-file');
  if (source) glArgs.push('--source-branch', source);
  if (target) glArgs.push('--target-branch', target);
  if (title) glArgs.push('--title', title);
  const dryRun = rawArgs.includes('--dry-run');
  if (body) {
    if (dryRun) {
      // dry-run 不读正文，只示意 shell 展开，避免把整篇描述打到 stdout。
      glArgs.push('--description', `"$(cat ${body})"`);
    } else {
      let description;
      try {
        description = fs.readFileSync(body, 'utf8');
      } catch {
        console.error(`pr-create: 读不到 --body-file：${body}`);
        process.exit(2);
      }
      glArgs.push('--description', description);
    }
  }
  if (dryRun) {
    console.log(`glab ${glArgs.join(' ')}`);
    process.exit(0);
  }
  const hook = process.env.PR_CREATE_GLAB;
  const cmd = hook ? process.execPath : 'glab';
  const argv = hook ? [hook, ...glArgs] : glArgs;
  const created = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8' });
  if (created.error) {
    console.error('pr-create: 未找到 glab。');
    process.exit(2);
  }
  if (rawArgs.includes('--json')) {
    // glab mr create 不支持 --json；从 stdout 提取 MR URL/编号，stdout 只留最终单对象。
    const match = /https?:\/\/\S+\/-\/merge_requests\/(\d+)/i.exec(created.stdout || '');
    if (match) {
      process.stdout.write(JSON.stringify({ ok: true, url: match[0], number: Number(match[1]) }) + '\n');
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

const tfsPr = path.join(ROOT, '.agents/skills/tfs-pr/scripts/tfs-pr.mjs');
if (!fs.existsSync(tfsPr)) {
  console.error(`pr-create: 找不到 tfs-pr 脚本：${tfsPr}`);
  process.exit(2);
}
const hasCreate = rawArgs[0] === 'create';
const tfsArgs = hasCreate ? rawArgs : ['create', ...rawArgs];
if (rawArgs.includes('--json')) {
  // tfs-pr 认识 --json（create 成功输出含 url 的 JSON），原样转发；捕获输出提取 PR URL/编号，stdout 只留最终单对象。
  const created = spawnSync(process.execPath, [tfsPr, ...tfsArgs], { cwd: ROOT, encoding: 'utf8' });
  const match = /https?:\/\/\S+\/pullrequest\/(\d+)/i.exec(created.stdout || '');
  if (match) {
    process.stdout.write(JSON.stringify({ ok: true, url: match[0], number: Number(match[1]) }) + '\n');
  } else {
    process.stdout.write(JSON.stringify({ ok: created.status === 0, url: null, number: null }) + '\n');
    if (created.stdout) process.stderr.write(created.stdout);
    if (created.stderr) process.stderr.write(created.stderr);
  }
  process.exit(created.status === 0 ? 0 : 1);
}
const created = spawnSync(process.execPath, [tfsPr, ...tfsArgs], { cwd: ROOT, stdio: 'inherit' });
// 审查遗漏补 2026-11-23：非 json 路径透传原生退出码
process.exit(typeof created.status === 'number' ? created.status : 1);
