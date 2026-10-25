#!/usr/bin/env node
// check-local-gate-config.mjs 的夹具测试（2026-10-25 source-port-batch）
// 断言：①全配根 exit 0；②缺配 WARN 档 exit 0 带修法；③--strict 缺配 exit 1；④CI（GITHUB_ACTIONS）
//       loud-skip；⑤非 git 目录 loud-skip。夹具 = 临时 git 仓（-c 注入 user 免全局依赖）。
// 用法：node .agents/scripts/check-local-gate-config.test.mjs（npm test 随跑）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(SCRIPT_DIR, 'check-local-gate-config.mjs');
const GITBIN = process.platform === 'win32' ? 'git.exe' : 'git';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const mkroot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lgc-'));
const gitAt = (root, ...args) => spawnSync(GITBIN, ['-C', root, ...args], { encoding: 'utf8' });
// 装配「全配」形态：git 仓 + 五钩子 + .gitattributes 行 + 两项 git config
const fullSetup = (root) => {
  fs.mkdirSync(path.join(root, '.githooks'), { recursive: true });
  for (const h of ['pre-commit', 'pre-merge-commit', 'commit-msg', 'pre-push', 'post-commit']) {
    fs.writeFileSync(path.join(root, '.githooks', h), '#!/bin/sh\nexit 0\n', 'utf8');
  }
  fs.writeFileSync(path.join(root, '.gitattributes'), '.agents/*.jsonl merge=jsonl-union\n', 'utf8');
  gitAt(root, 'init', '-q');
  gitAt(root, 'config', 'core.hooksPath', '.githooks');
  gitAt(root, 'config', 'merge.jsonl-union.driver', 'node .agents/scripts/git-merge-jsonl.mjs %O %A %B');
};
const run = (root, args = [], env = {}) => spawnSync(process.execPath, [CHECKER, '--root', root, ...args], {
  encoding: 'utf8',
  // env 隔离（CI 盲区修复）：非 CI 场景显式剥 GITHUB_ACTIONS——否则 CI 里被测进程全走 loud-skip
  // 分支，WARN/--strict/非 git 断言结构性失败（v1.8.10 发布失败同因；仅场景 4 显式注入 'true'）
  env: { ...process.env, GITHUB_ACTIONS: '', ...env },
});

// ---- ① 全配根 → exit 0 且逐项 OK ----
{
  const root = mkroot();
  fullSetup(root);
  const r = run(root);
  check('场景 1：全配 → exit 0 + 四项全 OK',
    r.status === 0 && (r.stdout.match(/\[OK\]/g) || []).length === 4 && r.stdout.includes('挂载面全配'),
    `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- ② 缺配默认 WARN：exit 0 带修法（hooksPath 漏配 = clone 后典型形态） ----
{
  const root = mkroot();
  fullSetup(root);
  gitAt(root, 'config', '--unset', 'core.hooksPath');
  const r = run(root);
  check('场景 2：缺 hooksPath → WARN 档 exit 0 + 打印修复命令',
    r.status === 0 && r.stdout.includes('⚠️ WARN') && r.stdout.includes('git config core.hooksPath .githooks'),
    `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- ③ --strict：缺配 exit 1（升格开关） ----
{
  const root = mkroot();
  fullSetup(root);
  gitAt(root, 'config', '--unset', 'core.hooksPath');
  const r = run(root, ['--strict']);
  check('场景 3：--strict 缺配 → exit 1 + [缺失] 标记',
    r.status === 1 && r.stdout.includes('[缺失]'),
    `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- ④ CI（GITHUB_ACTIONS=true）→ loud-skip exit 0 ----
{
  const root = mkroot(); // 故意不配任何东西——CI 形态下应跳过不判
  const r = run(root, [], { GITHUB_ACTIONS: 'true' });
  check('场景 4：CI 环境 → loud-skip exit 0（跳过可见）',
    r.status === 0 && r.stdout.includes('CI 环境') && r.stdout.includes('跳过'),
    `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- ⑤ 非 git 目录 → loud-skip exit 0 ----
{
  const root = mkroot(); // 无 git init
  const r = run(root);
  check('场景 5：非 git 仓库 → loud-skip exit 0',
    r.status === 0 && r.stdout.includes('非 git 仓库'),
    `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
process.exit(0);
