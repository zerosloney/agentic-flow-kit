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
const roots = [root];
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
    const goodThenBad = push(
      `refs/heads/ok ${good} refs/heads/ok ${Z}\nrefs/heads/bad ${bad} refs/heads/bad ${Z}\n`,
    );
    check('stdin 先好后坏：整次失败', goodThenBad.status !== 0 && outOf(goodThenBad).includes('配对断裂'), outOf(goodThenBad));
  }

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-rev-outside-'));
  roots.push(outside);
  const absent = 'a'.repeat(40);
  const outsideRev = loop(outside, ['--rev', absent]);
  check('仓库外 --rev：exit 1 并打印 sha', outsideRev.status === 1 && outOf(outsideRev).includes(absent), outOf(outsideRev));
  const outsidePlain = loop(outside, []);
  check('仓库外且不带 --rev：仍跳过且退出 0', outsidePlain.status === 0 && outOf(outsidePlain).includes('跳过扫描'), outOf(outsidePlain));

  fs.writeFileSync(planPath, plan);
  fs.writeFileSync(path.join(root, 'workflow', 'intents', '2026-09-02-extra.md'), intent.replace('# INTENT — ok', '# INTENT — extra'));
  gitRun(root, ['add', '--', '.']);
  gitRun(root, ['commit', '-q', '-m', 'extra']);
  const extra = gitRun(root, ['rev-parse', 'HEAD']);
  fs.rmSync(path.join(root, 'workflow', 'intents', '2026-09-02-extra.md'));
  gitRun(root, ['add', '--', '.']);
  gitRun(root, ['commit', '-q', '-m', 'drop-extra']);
  const atExtra = loop(root, ['--rev', extra]);
  check('断档文件不在当前 HEAD：--rev 仍退出 1', atExtra.status === 1 && outOf(atExtra).includes('2026-09-02-extra.md'), outOf(atExtra));
  const headNow = loop(root, []);
  check('当前 HEAD 没有该断档文件：不带 --rev 不点名它', headNow.status === 0 && !outOf(headNow).includes('2026-09-02-extra.md'), outOf(headNow));

  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-rev-tree-'));
  roots.push(tree);
  gitRun(tree, ['init', '-q']);
  gitRun(tree, ['config', 'user.email', 't@example.com']);
  gitRun(tree, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(tree, '.agents', 'scripts'), { recursive: true });
  fs.copyFileSync(ENUMS, path.join(tree, '.agents', 'workflow-enums.txt'));
  fs.copyFileSync(path.join(HERE, 'gen-workflow-index.mjs'), path.join(tree, '.agents', 'scripts', 'gen-workflow-index.mjs'));
  fs.copyFileSync(path.join(HERE, 'workflow-enums.mjs'), path.join(tree, '.agents', 'scripts', 'workflow-enums.mjs'));
  fs.copyFileSync(path.join(HERE, 'rule-budget.sh'), path.join(tree, '.agents', 'scripts', 'rule-budget.sh'));
  fs.writeFileSync(path.join(tree, '.agents', 'rule-budgets.txt'), 'big.txt 10\n');
  fs.writeFileSync(path.join(tree, 'big.txt'), 'ok\n');
  for (const sub of ['intents', 'specs', 'plans', 'incidents']) {
    fs.mkdirSync(path.join(tree, 'workflow', sub), { recursive: true });
  }
  fs.writeFileSync(path.join(tree, 'workflow', 'intents', '2026-09-01-ok.md'), intent);
  fs.writeFileSync(path.join(tree, 'workflow', 'plans', '2026-09-01-ok.md'), plan);
  const gen = spawnSync(process.execPath, [path.join(tree, '.agents', 'scripts', 'gen-workflow-index.mjs')], { cwd: tree, encoding: 'utf8' });
  if (gen.status !== 0) throw new Error(outOf(gen));
  gitRun(tree, ['add', '--', '.']);
  gitRun(tree, ['commit', '-q', '-m', 'aligned']);
  const indexPath = path.join(tree, 'workflow', 'INDEX.md');
  const indexBefore = fs.readFileSync(indexPath, 'utf8');
  if (!indexBefore.includes('☑1/1')) throw new Error('INDEX 里没有 ☑1/1，无法制造漂移');
  fs.writeFileSync(indexPath, indexBefore.replace('☑1/1', '☑0/1'));
  gitRun(tree, ['add', '--', '.']);
  gitRun(tree, ['commit', '-q', '-m', 'drift']);
  const drift = gitRun(tree, ['rev-parse', 'HEAD']);
  const drifted = loop(tree, ['--rev', drift]);
  check('被推送提交索引损坏：--rev 报索引漂移', outOf(drifted).includes('索引漂移'), outOf(drifted));
  fs.writeFileSync(path.join(tree, 'big.txt'), 'x'.repeat(100));
  const restored = spawnSync(process.execPath, [path.join(tree, '.agents', 'scripts', 'gen-workflow-index.mjs')], { cwd: tree, encoding: 'utf8' });
  if (restored.status !== 0) throw new Error(outOf(restored));
  gitRun(tree, ['add', '--', '.']);
  gitRun(tree, ['commit', '-q', '-m', 'fat']);
  const fat = gitRun(tree, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(tree, 'big.txt'), 'ok\n');
  gitRun(tree, ['add', '--', '.']);
  gitRun(tree, ['commit', '-q', '-m', 'slim']);
  const atFat = loop(tree, ['--rev', fat]);
  const atSlim = loop(tree, []);
  check('预算只在被推送提交里超限：--rev 报 100B', outOf(atFat).includes('常驻面超限') && outOf(atFat).includes('100B'), outOf(atFat));
  check('工作区预算未超限：不带 --rev 不报常驻面超限，也不报索引漂移',
    !outOf(atSlim).includes('常驻面超限') && !outOf(atSlim).includes('索引漂移'), outOf(atSlim));
} catch (e) {
  check('仓库准备', false, e.stack || e.message);
} finally {
  for (const dir of roots) {
    const listed = spawnSync(git, ['worktree', 'list', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    for (const line of (listed.stdout || '').split('\n')) {
      const m = line.startsWith('worktree ') ? line.slice(9).trim() : '';
      if (m && path.resolve(m) !== path.resolve(dir)) {
        spawnSync(git, ['worktree', 'remove', '--force', m], { cwd: dir });
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 委派表随 ROOT 读：--rev 看不到工作区后补的行。
{
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-rev-del-'));
  try {
    gitRun(repo, ['init', '-q']);
    gitRun(repo, ['config', 'user.email', 't@example.com']);
    gitRun(repo, ['config', 'user.name', 't']);
    fs.mkdirSync(path.join(repo, '.agents'), { recursive: true });
    fs.copyFileSync(ENUMS, path.join(repo, '.agents', 'workflow-enums.txt'));
    for (const sub of ['intents', 'specs', 'plans']) fs.mkdirSync(path.join(repo, 'workflow', sub), { recursive: true });
    const name = '2026-09-12-gap.md';
    fs.writeFileSync(path.join(repo, 'workflow', 'intents', name), `---
状态: done
级别: L2
日期: 2026-09-12
---
# INTENT — gap

## 验收标准（可测试）

- [x] 用例通过（证据:fixture）
`);
    fs.writeFileSync(path.join(repo, 'workflow', 'specs', name), `---
状态: approved
级别: L2
日期: 2026-09-12
---
# SPEC — gap
`);
    fs.writeFileSync(path.join(repo, 'workflow', 'plans', name), `---
状态: approved
级别: L2
日期: 2026-09-12
---
# PLAN — gap
`);
    gitRun(repo, ['add', '--', '.']);
    gitRun(repo, ['commit', '-q', '-m', 'gap']);
    const sha = gitRun(repo, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(repo, 'workflow', 'delegations.md'), `## 委派结果

| 日期 | 被委派方 | 任务一句话 | 结果 | 备注 |
|------|----------|------------|------|------|
| 2026-09-12 | x | y | 一次通过 | ${name} |
`);
    const atOld = loop(repo, ['--rev', sha]);
    check('委派行只在工作区：--rev 旧提交仍输出委派台账',
      outOf(atOld).includes('委派台账') && outOf(atOld).includes(`intents/${name}`),
      outOf(atOld));
    const dirty = loop(repo, []);
    check('同一工作区不带 --rev：后补的委派行消掉警告',
      dirty.status === 0 && !outOf(dirty).includes('委派台账'),
      outOf(dirty));
  } catch (e) {
    check('委派 --rev 仓库准备', false, e.stack || e.message);
  } finally {
    const listed = spawnSync(git, ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' });
    for (const line of (listed.stdout || '').split('\n')) {
      const m = line.startsWith('worktree ') ? line.slice(9).trim() : '';
      if (m && path.resolve(m) !== path.resolve(repo)) spawnSync(git, ['worktree', 'remove', '--force', m], { cwd: repo });
    }
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
