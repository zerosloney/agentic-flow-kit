#!/usr/bin/env node
// --rev 扫的是该提交的树，不是当前工作区。pre-push 把 stdin 里的本地 sha 传进去。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const LOOP = path.join(HERE, 'check-loop.mjs');
const ENUMS = path.join(REPO, 'templates', '_agents', 'workflow-enums.txt');
const HOOK = path.join(REPO, 'templates', '_githooks', 'pre-push');
const git = process.platform === 'win32' ? 'git.exe' : 'git';
const Z = '0'.repeat(40);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${String(detail).slice(0, 800)}` : ''}`); }
};

function shBin() {
  for (const bin of ['sh', 'bash']) {
    const r = spawnSync(bin, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return bin;
  }
  return null;
}

function gitRun(cwd, args) {
  const r = spawnSync(git, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${args.join(' ')}\n${r.stderr || r.stdout}`);
  return (r.stdout || '').trim();
}

function loop(cwd, args = [], env = {}) {
  return spawnSync(process.execPath, [LOOP, ...args], {
    cwd, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, ...env },
  });
}
const outOf = (r) => `${r.stdout || ''}${r.stderr || ''}`;

const intent = `---
状态: approved
级别: L1
日期: 2026-09-01
模块: pipeline
---
# INTENT — ok

## 验收标准（可测试）

- [x] 配了 plan（证据：同名 plan）
`;
const plan = `---
状态: approved
级别: L1
日期: 2026-09-01
模块: pipeline
---
# PLAN — ok

## 改动面

- 无
`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-rev-repo-'));
const planPath = path.join(root, 'workflow', 'plans', '2026-09-01-ok.md');
try {
  gitRun(root, ['init', '-q']);
  gitRun(root, ['config', 'user.email', 't@example.com']);
  gitRun(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.copyFileSync(ENUMS, path.join(root, '.agents', 'workflow-enums.txt'));
  fs.mkdirSync(path.join(root, 'workflow', 'intents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workflow', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'intents', '2026-09-01-ok.md'), intent);
  fs.writeFileSync(planPath, plan);
  gitRun(root, ['add', '--', '.']);
  gitRun(root, ['commit', '-q', '-m', 'good']);
  const good = gitRun(root, ['rev-parse', 'HEAD']);

  fs.rmSync(planPath);
  gitRun(root, ['add', '--', '.']);
  gitRun(root, ['commit', '-q', '-m', 'bad']);
  const bad = gitRun(root, ['rev-parse', 'HEAD']);

  fs.writeFileSync(planPath, plan);
  gitRun(root, ['add', '--', '.']);
  gitRun(root, ['commit', '-q', '-m', 'tip']);
  const tip = gitRun(root, ['rev-parse', 'HEAD']);

  const atGood = loop(root, ['--rev', good]);
  check('好提交：工作区稍后改断也不影响，--rev 退出 0', atGood.status === 0, outOf(atGood));
  const atBad = loop(root, ['--rev', bad]);
  check('断档提交：--rev 退出 1', atBad.status === 1 && outOf(atBad).includes('配对断裂'), outOf(atBad));
  const atTip = loop(root, ['--rev', tip]);
  check('当前 HEAD 不是判定对象：--rev tip 退出 0', atTip.status === 0, outOf(atTip));

  fs.rmSync(planPath);
  const dirty = loop(root, []);
  check('不带 --rev：工作区改断已跟踪文档仍 hard-block', dirty.status === 1 && outOf(dirty).includes('配对断裂'), outOf(dirty));
  const dirtyRev = loop(root, ['--rev', tip]);
  check('同一脏工作区：--rev tip 仍退出 0', dirtyRev.status === 0, outOf(dirtyRev));

  const zeros = loop(root, ['--rev', Z]);
  check('--rev 全 0 exit 1 并打印 sha', zeros.status === 1 && outOf(zeros).includes(Z), outOf(zeros));
  const bogus = 'a'.repeat(40);
  const peeled = loop(root, ['--rev', bogus]);
  check('--rev 剥不到提交 exit 1 并打印 sha', peeled.status === 1 && outOf(peeled).includes(bogus), outOf(peeled));

  gitRun(root, ['tag', '-a', 'vbad', '-m', 't', bad]);
  const tag = gitRun(root, ['rev-parse', 'vbad']);
  const viaTag = loop(root, ['--rev', tag]);
  check('附注标签剥到提交后再读树', tag !== bad && viaTag.status === 1 && outOf(viaTag).includes('配对断裂'), outOf(viaTag));

  const both = loop(root, ['--rev', tip], { CHECK_LOOP_ROOT: root });
  check('CHECK_LOOP_ROOT 与 --rev 同时出现 exit 1', both.status === 1 && outOf(both).includes('不能同时使用'), outOf(both));

  const doctor = fs.readFileSync(path.join(REPO, 'src', 'doctor.mjs'), 'utf8');
  check('doctor 调用闭环扫描时不传 --rev',
    doctor.includes("'.agents/scripts/check-loop.mjs'") && !doctor.includes('check-loop.mjs\', \'--rev\''));

  const sh = shBin();
  check('找到 sh 以跑 pre-push', !!sh);
  if (sh) {
    fs.mkdirSync(path.join(root, '.agents', 'scripts'), { recursive: true });
    const node = process.execPath.replace(/\\/g, '/');
    const loopSh = LOOP.replace(/\\/g, '/');
    fs.writeFileSync(path.join(root, '.agents', 'scripts', 'check-loop.sh'), `#!/bin/sh\nexec "${node}" "${loopSh}" "$@"\n`);
    const hookPath = path.join(root, 'pre-push');
    fs.copyFileSync(HOOK, hookPath);
    const push = (input) => spawnSync(sh, [hookPath], { cwd: root, input, encoding: 'utf8', timeout: 120000 });
    const onlyDelete = push(`refs/heads/old ${Z} refs/heads/old ${'b'.repeat(40)}\n`);
    check('stdin 只有删除行：不阻断', onlyDelete.status === 0, outOf(onlyDelete));
    const mixed = push(
      `refs/heads/old ${Z} refs/heads/old ${'b'.repeat(40)}\nrefs/heads/bad ${bad} refs/heads/bad ${Z}\n`,
    );
    check('删除行加断档 sha：整次失败', mixed.status !== 0 && outOf(mixed).includes('配对断裂'), outOf(mixed));
    const empty = push('');
    check('没有 stdin 行：扫工作区，脏树被拦住', empty.status !== 0 && outOf(empty).includes('配对断裂'), outOf(empty));
  }
} catch (e) {
  check('仓库准备', false, e.stack || e.message);
} finally {
  const listed = spawnSync(git, ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
  for (const line of (listed.stdout || '').split('\n')) {
    const m = line.startsWith('worktree ') ? line.slice(9).trim() : '';
    if (m && path.resolve(m) !== path.resolve(root)) {
      spawnSync(git, ['worktree', 'remove', '--force', m], { cwd: root });
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
