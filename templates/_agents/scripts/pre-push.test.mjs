#!/usr/bin/env node
// pre-push.test.mjs — 加固门目标分支判定 + 构建门 fixture 套件
// （2026-10-01 v09-review-defects 建；2026-10-16 随 pre-push node 化更新：桩改 .agents/scripts/check-loop.mjs
// 直调，补 commit-check 构建门桩与 --range 断言——自源仓 2ff869a9 回灌面）
// 真仓端到端：临时仓库挂载真实 pre-push，check-loop.mjs 与 commit-check.cjs 以桩记录 argv。
// 断言三态 refspec：
//   main→main                  → argv 含 --hardening（加固门）；构建门 --range 新分支首推=全量零 sha
//   experiment/x→main         → argv 含 --hardening（修复回归：直推漏口）；构建门 old 为远端实 sha
//   experiment/y→experiment/y → argv 不含 --hardening（advisory）；构建门仍按范围跑（advisory 不阻断）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// 钩子双布局探测：templates 布局（../../_githooks）与装户布局（../../.githooks）——本测试随 sync
// 落到 .agents/scripts 后 ../../_githooks 不存在（装户钩子在仓库根 .githooks/），2026-10-02 ci-red-batch
const PRE_PUSH = [
  path.join(SCRIPT_DIR, '..', '..', '_githooks', 'pre-push'),
  path.join(SCRIPT_DIR, '..', '..', '.githooks', 'pre-push'),
].find((p) => fs.existsSync(p));

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
  fs.mkdirSync(path.join(root, '.agents', 'hooks'), { recursive: true });
  // 挂载真实 pre-push（装户同款），stub 替换 check-loop 与 commit-check 记录 argv
  fs.copyFileSync(PRE_PUSH, path.join(root, '.githooks', 'pre-push'));
  // Linux：git 静默跳过不可执行钩子（推送照常成功、桩无记录）——挂载后必须设执行位；桩经 node 调用无须 +x
  fs.chmodSync(path.join(root, '.githooks', 'pre-push'), 0o755);
  fs.writeFileSync(path.join(root, '.agents', 'scripts', 'check-loop.mjs'),
    'import fs from "node:fs";\nfs.appendFileSync(".stub-args", process.argv.slice(2).join(" ") + "\\n");\n');
  fs.writeFileSync(path.join(root, '.agents', 'hooks', 'commit-check.cjs'),
    'const fs = require("node:fs");\nfs.appendFileSync(".stub-args-cc", process.argv.slice(2).join(" ") + "\\n");\n');
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
const ccArgs = (root) => {
  const p = path.join(root, '.stub-args-cc');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split(/\n/).filter(Boolean) : [];
};

const root = setup();
const w = (f, c) => fs.writeFileSync(path.join(root, f), c);

// 1) main → main：应含 --hardening；构建门首推 = 全量零 sha
git(root, ['checkout', '-q', '-b', 'main']);
let r = run(root, ['push', 'origin', 'HEAD:main']);
check('main→main 推送成功', r.status === 0, `${r.stdout}${r.stderr}`);
check('main→main argv 含 --hardening', (stubArgs(root)[0] || '').includes('--hardening'), stubArgs(root).join('|'));
check('main→main 构建门 --range 新分支首推=全量零 sha（2026-10-16 构建门后移）',
  (ccArgs(root)[0] || '').startsWith('--range 0000000000000000000000000000000000000000 '), ccArgs(root).join('|'));

// 2) experiment/x → main（回归漏口）：本地分支在 experiment，目标 main → 必须含 --hardening
git(root, ['checkout', '-q', '-b', 'experiment/x']);
w('b.txt', 'b\n');
git(root, ['add', 'b.txt']);
git(root, ['commit', '-q', '-m', 'x']);
r = run(root, ['push', 'origin', 'HEAD:main']);
check('experiment/x→main 推送成功', r.status === 0, `${r.stdout}${r.stderr}`);
check('experiment/x→main argv 含 --hardening（直推漏口修复）', (stubArgs(root)[1] || '').includes('--hardening'), stubArgs(root).join('|'));
check('experiment/x→main 构建门 --range old 为远端实 sha（非零）',
  /^--range [0-9a-f]{40} /.test(ccArgs(root)[1] || ''), ccArgs(root).join('|'));

// 3) experiment/y → experiment/y：目标在探索泳道 → 不含 --hardening；构建门仍按范围跑（advisory）
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
check('experiment→experiment 构建门仍按范围跑（advisory 不阻断）',
  /^--range [0-9a-f]{40} /.test(ccArgs(root)[2] || ''), ccArgs(root).join('|'));

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);