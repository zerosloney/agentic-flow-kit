// check-scope-range.mjs：范围内 plan 被后续提交删除/更名时的裁决口径。
// 回归背景（2026-11-16 实证）：`git mv` 更名 plan 后，推送范围逐提交取 diff-tree（--no-renames）
// 会同时带上 old 路径的删除记录；原实现对该路径 fs.existsSync 失败直接 exit 2，含 plan 更名的分支
// 此后永远推不上去。口径修正为「删除的 plan 不构成承诺来源」跳过并出账，存活 plan 读不到仍 fail-loud。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'check-scope-range.mjs');
const SCOPE_SCRIPT = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'check-scope.mjs');

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

const PLAN_BODY = [
  '## 改动面',
  '',
  '| 文件 | 改动类型 |',
  '|---|---|',
  '| `src/a.cs` | 新增 |',
  '',
].join('\n');

function repoWithPlanRename() {
  const dir = makeTmp('flow-kit-scope-range-');
  git(dir, 'init', '-q');
  write(dir, 'README.md', 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c0');
  const c0 = git(dir, 'rev-parse', 'HEAD');
  write(dir, 'workflow/plans/2026-01-01-demo-fix.md', PLAN_BODY);
  write(dir, 'src/a.cs', 'class A {}\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c1 plan + code');
  git(dir, 'mv', 'workflow/plans/2026-01-01-demo-fix.md', 'workflow/plans/2026-01-01-demo.md');
  git(dir, 'commit', '-q', '-m', 'c2 rename plan');
  const c2 = git(dir, 'rev-parse', 'HEAD');
  return { dir, c0, c2 };
}

const run = (root, oldSha, newSha, extra = []) =>
  spawnSync(process.execPath, [SCRIPT, oldSha, newSha, ...extra, '--root', root], { encoding: 'utf8' });

test('plan 在范围内被更名：old 路径按「删除不作承诺来源」跳过，存活 plan 正常对账（exit 0）', () => {
  const { dir, c0, c2 } = repoWithPlanRename();
  const r = run(dir, c0, c2, ['--strict']);
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, `应放行，实际 exit ${r.status}:\n${out}`);
  assert.match(out, /已在后续提交删除\/更名，不作承诺来源：workflow\/plans\/2026-01-01-demo-fix\.md/);
  assert.match(out, /双向对齐/);
});

test('存活的 plan 未被删除时仍逐份读取对账（越界件 --strict 照拦 exit 1）', () => {
  const { dir, c0, c2 } = repoWithPlanRename();
  // 追加一个未声明的产品件：存活 plan 声明的 src/a.cs 之外再改 src/b.cs
  write(dir, 'src/b.cs', 'class B {}\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c3 undeclared');
  const c3 = git(dir, 'rev-parse', 'HEAD');
  const r = run(dir, c0, c3, ['--strict']);
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1, `越界件应 --strict 拦截，实际 exit ${r.status}:\n${out}`);
  assert.match(out, /越界件/);
  assert.match(out, /src\/b\.cs/);
});

test('范围内 plan 被删除且无存活 plan：不判 exit 2，走「无 plan 变更」skip 分支', () => {
  const { dir, c0 } = repoWithPlanRename();
  git(dir, 'rm', '-q', 'workflow/plans/2026-01-01-demo.md');
  git(dir, 'commit', '-q', '-m', 'c3 drop plan');
  const c3 = git(dir, 'rev-parse', 'HEAD');
  const r = run(dir, c0, c3, ['--strict']);
  const out = `${r.stdout}${r.stderr}`;
  assert.notEqual(r.status, 2, `删除的 plan 不应触发 fail-loud:\n${out}`);
  assert.match(out, /不作承诺来源/);
  assert.match(out, /推送范围无 plan 新增\/修改——skip/);
});

// check-scope.mjs 补扫节白名单回归（2026-11-16 双轴评审）：plan 节名基线双名并存——
// fill-plan.mjs 生成面为「验证计划」，_TEMPLATE.md 存量为「验证方式」；测试文件只在
// 「验证方式」节点名时也须计入声明，不判越界。
test('plan「验证方式」节声明的测试文件计入声明（--strict exit 0 双向对齐）', () => {
  const dir = makeTmp('flow-kit-scope-verify-sec-');
  git(dir, 'init', '-q');
  write(dir, 'README.md', 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c0');
  write(dir, 'workflow/plans/2026-11-16-demo.md', [
    '## 改动面',
    '- src/demo.cs：<做什么>',
    '',
    '## 验证方式',
    '- 新增测试：tests/DemoTests.cs 覆盖 <场景>',
    '',
  ].join('\n'));
  write(dir, 'src/demo.cs', 'class Demo {}\n');
  write(dir, 'tests/DemoTests.cs', 'class DemoTests {}\n');
  const r = spawnSync(process.execPath, [SCOPE_SCRIPT, 'workflow/plans/2026-11-16-demo.md', '--strict', '--root', dir], { encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, `「验证方式」节声明应计入，实际 exit ${r.status}:\n${out}`);
  assert.match(out, /双向对齐/);
});
