// check-confirm-order.test.mjs — 覆盖锚点只认 git 可见的 plan（未跟踪的 approved 正文不授权），
// 路径匹配按路径段边界（`src/a/b.css` 不得覆盖 `src/a/b.cs`）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(KIT, 'templates', 'engine', '.agents', 'hooks', 'check-confirm-order.mjs');

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function repo() {
  const dir = makeTmp('fk-confirm-order-');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'kit@example.com']);
  git(dir, ['config', 'user.name', 'kit']);
  write(dir, 'README.md', 'init\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
}

const plan = (status, body) => `---\n状态: ${status}\n---\n\n${body}\n`;

function commitPlan(dir, rel, body) {
  write(dir, rel, plan('approved', body));
  git(dir, ['add', rel]);
  git(dir, ['commit', '-qm', 'plan']);
}

function run(dir) {
  write(dir, 'msg.txt', 'test: 覆盖判定\n');
  return spawnSync(process.execPath, [HOOK, path.join(dir, 'msg.txt')], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: dir, CHECK_LOOP_NO_LEDGER: '1' },
  });
}

test('an untracked approved plan does not authorize', () => {
  const dir = repo();
  write(dir, 'src/a.js', 'export const a = 1;\n');
  git(dir, ['add', 'src/a.js']);
  write(dir, 'workflow/plans/fake.md', plan('approved', '修改 `src/a.js`'));
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /src\/a\.js/);
});

test('a tracked approved plan still authorizes', () => {
  const dir = repo();
  commitPlan(dir, 'workflow/plans/ok.md', '修改 `src/a.js`');
  write(dir, 'src/a.js', 'export const a = 1;\n');
  git(dir, ['add', 'src/a.js']);
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /已写在 approved plan/);
});

test('path matching is segment aware on the right edge', () => {
  const dir = repo();
  commitPlan(dir, 'workflow/plans/css.md', '修改 `src/a/b.css`');
  write(dir, 'src/a/b.cs', 'class B { }\n');
  git(dir, ['add', 'src/a/b.cs']);
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /src\/a\/b\.cs/);
});

test('path matching is segment aware on the left edge', () => {
  const dir = repo();
  commitPlan(dir, 'workflow/plans/vendor.md', '修改 `vendor/src/a.js`');
  write(dir, 'src/a.js', 'export const a = 1;\n');
  git(dir, ['add', 'src/a.js']);
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /src\/a\.js/);
});

test('a sentence period after the path still authorizes', () => {
  const dir = repo();
  commitPlan(dir, 'workflow/plans/period.md', 'Modified src/a.js.');
  write(dir, 'src/a.js', 'export const a = 1;\n');
  git(dir, ['add', 'src/a.js']);
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a longer sibling after the path does not authorize', () => {
  const dir = repo();
  commitPlan(dir, 'workflow/plans/bak.md', 'Modified src/a.js.bak');
  write(dir, 'src/a.js', 'export const a = 1;\n');
  git(dir, ['add', 'src/a.js']);
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /src\/a\.js/);
});

