#!/usr/bin/env node
// pre-push.test.mjs — 加固门目标分支判定 fixture 套件（2026-10-01 v09-review-defects）
// 真仓端到端：临时仓库挂载真实 pre-push，.agents/scripts/check-loop.sh 以桩脚本记录 argv。
// 断言三态 refspec：
//   main→main                  → argv 含 --hardening（加固门）
//   experiment/x→main         → argv 含 --hardening（修复回归：直推漏口）
//   experiment/y→experiment/y → argv 不含 --hardening（advisory）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRE_PUSH = path.join(SCRIPT_DIR, '..', '..', '_githooks', 'pre-push');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const run = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prepush-test-'));
  const remote = path.join(root, 'remote.git');
  fs.mkdirSync(path.join(root, '.githooks'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents', 'scripts'), { recursive: true });
  // 挂载真实 pre-push（装户同款），stub 替换 check-loop 记录 argv
  fs.copyFileSync(PRE_PUSH, path.join(root, '.githooks', 'pre-push'));
  fs.writeFileSync(path.join(root, '.agents', 'scripts', 'check-loop.sh'), '#!/bin/sh\necho "$@" >> .stub-args\nexit 0\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'core.hooksPath', '.githooks']);
  git(root, ['add', 'a.txt']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['init', '-q', '--bare', remote]);
  git(root, ['remote', 'add', 'origin', remote]);
  return root;
};
const stubArgs = (root) => {
  const p = path.join(root, '.stub-args');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split(/\n/).filter(Boolean) : [];
};

const root = setup();
const w = (f, c) => fs.writeFileSync(path.join(root, f), c);

// 1) main → main：应含 --hardening
git(root, ['checkout', '-q', '-b', 'main']);
let r = run(root, ['push', 'origin', 'HEAD:main']);
check('main→main 推送成功', r.status === 0, `${r.stdout}${r.stderr}`);
check('main→main argv 含 --hardening', (stubArgs(root)[0] || '').includes('--hardening'), stubArgs(root).join('|'));

// 2) experiment/x → main（回归漏口）：本地分支在 experiment，目标 main → 必须含 --hardening
git(root, ['checkout', '-q', '-b', 'experiment/x']);
w('b.txt', 'b\n');
git(root, ['add', 'b.txt']);
git(root, ['commit', '-q', '-m', 'x']);
r = run(root, ['push', 'origin', 'HEAD:main']);
check('experiment/x→main 推送成功', r.status === 0, `${r.stdout}${r.stderr}`);
check('experiment/x→main argv 含 --hardening（直推漏口修复）', (stubArgs(root)[1] || '').includes('--hardening'), stubArgs(root).join('|'));

// 3) experiment/y → experiment/y：目标在探索泳道 → 不含 --hardening
git(root, ['fetch', '-q', 'origin']);
git(root, ['branch', 'experiment/y', 'origin/main']);
git(root, ['checkout', '-q', 'experiment/y']);
w('c.txt', 'c\n');
git(root, ['add', 'c.txt']);
git(root, ['commit', '-q', '-m', 'y']);
r = run(root, ['push', 'origin', 'HEAD:experiment/y']);
check('experiment→experiment 推送成功', r.status === 0, `${r.stdout}${r.stderr}`);
const line3 = stubArgs(root)[2] || '';
check('experiment→experiment argv 不含 --hardening', !line3.includes('--hardening'), stubArgs(root).join('|'));

console.log(`\n${fail ? `❌ ${fail} failed` : '✅ all passed'}（${pass} passed）`);
process.exit(fail ? 1 : 0);