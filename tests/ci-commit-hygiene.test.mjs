// ci-commit-hygiene.mjs 基准层回归（issue #63，2026-11-16 装户实证 build 29647）：
// 手工重档等非 PR 构建落在合并提交上时，CI_PUSH_BEFORE（changes API 取「最老一笔的第一父」）
// 会指向源分支侧提交，区间横跨两支、把目标分支侧规则生效前的存量提交判红（假红指向历史而非本次合入）。
// 口径：HEAD 是合并提交（两父）即取第一父作基准——只判合并带进来的那段，与 PR 构建既有口径一致；
// 普通推送构建（单父 HEAD）仍走 CI_PUSH_BEFORE 不回归。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'ci-commit-hygiene.mjs');

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败: ${r.stderr}`);
  return r.stdout.trim();
};

const write = (cwd, rel, text) => {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
};

// 显式清空 PR 变量：issue #63 场景 = 非 PR 构建（无 SYSTEM_PULLREQUEST_TARGETBRANCH）
const run = (cwd, args = [], env = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SYSTEM_PULLREQUEST_TARGETBRANCH: '', ...env },
  });

// 装户仓形状（issue #63 build 29647）：main 侧存量违规提交（规则生效前）+ develop 侧 PR 提交 + 合并提交；
// changes API 把 CI_PUSH_BEFORE 指到源分支侧最老一笔（S1）。
function mergeRepo() {
  const dir = makeTmp('fk-hygiene-merge-');
  git(dir, 'init', '-q');
  git(dir, 'checkout', '-q', '-b', 'main');
  write(dir, 'base.txt', 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: init');
  git(dir, 'checkout', '-q', '-b', 'develop');
  write(dir, 'dev1.txt', 'd1\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat: side work one');
  const s1 = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', 'main');
  write(dir, 'main.txt', 'm\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '还原已合并功能的存量提交'); // 违规消息：非约定类型、非豁免前缀
  git(dir, 'checkout', '-q', 'develop');
  write(dir, 'dev2.txt', 'd2\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat: side work two');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', "Merge branch 'develop'", 'develop');
  return { dir, s1 };
}

test('issue #63：合并提交上的非 PR 构建——CI_PUSH_BEFORE 指向源分支侧时取第一父，目标侧存量违规提交不判红', () => {
  const { dir, s1 } = mergeRepo();
  const r = run(dir, [], { CI_PUSH_BEFORE: s1 });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, `目标侧存量提交不应判红，实际 exit ${r.status}:\n${out}`);
  assert.match(out, /基准=合并提交第一父/);
  assert.match(out, /共 2 笔/); // 区间 = 第一父..HEAD 非合并提交 = 源侧两笔（S1/S2）；目标侧 A2 不可达不参与
  assert.doesNotMatch(out, /还原已合并功能的存量提交/);
});

test('普通推送构建（单父 HEAD）仍走 CI_PUSH_BEFORE：区间内违规提交照判（不回归）', () => {
  const dir = makeTmp('fk-hygiene-push-');
  git(dir, 'init', '-q');
  write(dir, 'a.txt', 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: init');
  const c1 = git(dir, 'rev-parse', 'HEAD');
  write(dir, 'b.txt', 'b\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '随手改一下没写类型'); // 违规
  const r = run(dir, [], { CI_PUSH_BEFORE: c1 });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1, `推送区间违规应判红，实际 exit ${r.status}:\n${out}`);
  assert.match(out, /基准=CI_PUSH_BEFORE/);
  assert.match(out, /随手改一下没写类型/);
});

test('--base 显式指定仍最优先（本地复跑口径不变）', () => {
  const dir = makeTmp('fk-hygiene-base-');
  git(dir, 'init', '-q');
  write(dir, 'a.txt', 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: init');
  const c1 = git(dir, 'rev-parse', 'HEAD');
  write(dir, 'b.txt', 'b\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fix: ok');
  const r = run(dir, ['--base', c1]);
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, `--base 复跑应绿，实际 exit ${r.status}:\n${out}`);
  assert.match(out, /基准=--base/);
});
