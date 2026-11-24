// verify-scope.mjs 增量基线解析的两类环境态 + verify.mjs --scope loud-skip 口径。
// 回归背景（2026-11-17 行为评测②）：本地未推送仓（无 origin 远端）跑 `verify.mjs --scope` 曾直接
// exit 2——评测子代理按「不越门」停是对的，但门语义不对：新装最小项目的快速道永远走不通。
// 修法：无 origin / 零提交 → loud-skip（exit 0 + 降级建议，不判红）；有 origin 的既有路径零变化
// （diff 面为空仍 fail-loud exit 2）。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeDiffScope, loadProductFaces } from '../templates/engine/.agents/scripts/verify-scope.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'verify.mjs');

const ok = (stdout = '') => ({ status: 0, stdout });
const fail = () => ({ status: 128, stdout: '' });

// 注入式 git 假件：真实调用带 `-c core.quotepath=off` 前缀，按「子命令」路由
// （rev-parse / merge-base / rev-list / diff / ls-files）。
function fakeGit({ head = 'abc1234', committed = [], worktree = [], untracked = [], originBase = 'def5678', originFails = false, headFails = false, revListFails = false, revListEmpty = false } = {}) {
  const calls = [];
  const SUBS = ['rev-parse', 'rev-list', 'merge-base', 'diff', 'ls-files'];
  return {
    calls,
    git(args) {
      calls.push(args.join(' '));
      const sub = args.find((a) => SUBS.includes(a));
      if (sub === 'rev-parse') {
        if (headFails) return fail();
        return ok(`${head}\n`);
      }
      if (sub === 'rev-list') {
        if (revListFails) return fail();
        return ok(revListEmpty ? '' : `${head}\n`);
      }
      if (sub === 'merge-base') {
        if (args.includes('--is-ancestor')) return ok();
        if (originFails) return fail();
        return ok(`${originBase}\n`);
      }
      if (sub === 'diff') {
        const range = args.find((a) => a.includes('..'));
        return ok((range ? committed : worktree).join('\n'));
      }
      if (sub === 'ls-files') return ok(untracked.join('\n'));
      return fail();
    },
  };
}

test('computeDiffScope: 无 origin merge-base 失败 → Error.scopeSkip=no-origin（分类给 loud-skip）', () => {
  const f = fakeGit({ originFails: true });
  try {
    computeDiffScope(f.git);
    assert.fail('应当抛错');
  } catch (e) {
    assert.equal(e.scopeSkip, 'no-origin');
    assert.match(e.message, /origin/);
  }
});

test('computeDiffScope: 零提交仓（rev-list --all 空）→ Error.scopeSkip=no-commits', () => {
  const f = fakeGit({ headFails: true, revListEmpty: true });
  try {
    computeDiffScope(f.git);
    assert.fail('应当抛错');
  } catch (e) {
    assert.equal(e.scopeSkip, 'no-commits');
    assert.match(e.message, /尚无任何提交/);
  }
});

test('computeDiffScope: rev-parse 失败且 rev-list 也失败（git 故障）→ 维持 fail-loud（无 scopeSkip）', () => {
  const f = fakeGit({ headFails: true, revListFails: true });
  try {
    computeDiffScope(f.git);
    assert.fail('应当抛错');
  } catch (e) {
    assert.equal(e.scopeSkip, undefined);
    assert.match(e.message, /rev-parse HEAD 失败/);
  }
});

test('computeDiffScope: 有 origin 但 diff 面为空 → 维持 fail-loud（无 scopeSkip，既有口径零变化）', () => {
  const f = fakeGit({});
  try {
    computeDiffScope(f.git);
    assert.fail('应当抛错');
  } catch (e) {
    assert.equal(e.scopeSkip, undefined);
    assert.match(e.message, /diff 面为空/);
  }
});

test('computeDiffScope: 台账绿行作基线时不需要 origin（baseSource=ledger 路径不变）', () => {
  // 面/门映射派生自项目配置（2026-11-24 faces 收单）：夹具写 project-faces + product-gates。
  const facesRoot = makeTmp('fk-vscope-faces-');
  fs.mkdirSync(path.join(facesRoot, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(path.join(facesRoot, '.agents', 'config', 'project-faces.json'),
    JSON.stringify({ code: ['backend/'], ui: ['frontend/src/'] }));
  fs.writeFileSync(path.join(facesRoot, '.agents', 'config', 'product-gates.json'), JSON.stringify({ gates: [
    { id: 'backend-test', name: 'b', cmd: 'x', folder: 'backend' },
    { id: 'frontend-lint', name: 'f', cmd: 'x', folder: 'frontend' },
  ] }));
  const f = fakeGit({ committed: ['backend/a.cs'], worktree: [], untracked: [] });
  const scope = computeDiffScope(f.git, 'abc1234', 'ledger', loadProductFaces(facesRoot));
  assert.equal(scope.baseSource, 'ledger');
  assert.equal(scope.baseShort, 'abc1234');
  assert.equal(scope.touched.has('backend'), true);
  assert.deepEqual(scope.skippedGateIds, ['frontend-lint']);
  assert.ok(!f.calls.some((c) => c.startsWith('merge-base origin/main')), '有台账基线不得再问 origin/main');
});

// ---- verify.mjs --scope 端到端（真实 git 仓）----

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败: ${r.stderr}`);
  return r.stdout.trim();
};

const runVerifyScope = (root) => spawnSync(process.execPath, [VERIFY, '--scope'], {
  cwd: root, encoding: 'utf8', env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root },
});

test('verify --scope: 无 origin 的本地仓 loud-skip exit 0，输出含原因与降级指引，不落账', () => {
  const dir = makeTmp('fk-vscope-noorigin-');
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c0');
  const r = runVerifyScope(dir);
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, `应 loud-skip 不判红，实际 exit ${r.status}:\n${out}`);
  assert.match(out, /loud-skip/);
  assert.match(out, /无 origin 远端/);
  assert.match(out, /check-scope\.mjs/);
  assert.match(out, /check-scope-range/);
  assert.equal(fs.existsSync(path.join(dir, '.agents', 'verifications.jsonl')), false, 'loud-skip 不得落绿凭证');
});

test('verify --scope: 零提交仓同样 loud-skip exit 0 并说明原因', () => {
  const dir = makeTmp('fk-vscope-nocommit-');
  git(dir, 'init', '-q', '-b', 'main');
  const r = runVerifyScope(dir);
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, `应 loud-skip 不判红，实际 exit ${r.status}:\n${out}`);
  assert.match(out, /loud-skip/);
  assert.match(out, /尚无任何提交/);
});

test('verify --scope: 有 origin 的干净仓保持既有 fail-loud（diff 面为空 exit 2）', () => {
  const origin = makeTmp('fk-vscope-originbare-');
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  const dir = makeTmp('fk-vscope-withorigin-');
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c0');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'fetch', '-q', 'origin');
  git(dir, 'push', '-q', 'origin', 'main');
  const r = runVerifyScope(dir);
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 2, `有 origin 的空 diff 面应维持 fail-loud，实际 exit ${r.status}:\n${out}`);
  assert.match(out, /diff 面为空/);
});
