// faces-hooks.test.mjs — 提交钩子的产品面判据单源（.agents/config/project-faces.json / faces.mjs）：
// pre-commit 四门触发面与 commit-msg 顺序门触发面改走 faces CLI 后，配置/未配置/配置错误三态行为。
// 成本控制：四门本体用 PATH 上的假 flow-kit 桩代替（faces 调用透传到真实 faces.mjs），
// 断言核心 = 钩子调 faces CLI 的参数 + 退出码处理 + 四门是否被调起；四门自身内容不在本文件覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = path.join(KIT, 'templates', 'git', '.githooks');
const FACES = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'faces.mjs');
const RULES = path.join(KIT, 'templates', 'engine', '.agents', 'config', 'commit-msg-rules.json');

const write = (root, rel, content = '') => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const git = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

// 假 flow-kit：记录每次调用参数；`hook --list` 声明 local-pre-commit 存在；`run faces*` 透传真实
// faces.mjs（按 FACES_ROOT 读目标仓库配置）；其余一律 exit 0（四门本体不在本测试范围）。
// Windows 走 .cmd（cmd.exe 按 PATHEXT 解析），POSIX 走无扩展名 sh 脚本。
const STUB_SRC = `import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'hook' && args[1] === '--list') {
  process.stdout.write('local-pre-commit\\n');
  process.exit(0);
}
if (args[0] === 'run' && /^faces(\\.mjs)?$/.test(args[1])) {
  const r = spawnSync(process.execPath, [process.env.FACES_SCRIPT, ...args.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: process.env.FACES_ROOT },
  });
  process.exit(typeof r.status === 'number' ? r.status : 1);
}
process.exit(0);
`;

function makeStub() {
  const dir = makeTmp('fk-faces-stub-');
  const script = path.join(dir, 'stub.mjs');
  fs.writeFileSync(script, STUB_SRC);
  fs.writeFileSync(path.join(dir, 'flow-kit.cmd'), `@echo off\r\nnode "${script}" %*\r\n`);
  const sh = path.join(dir, 'flow-kit');
  fs.writeFileSync(sh, `#!/bin/sh\nexec node "${script}" "$@"\n`);
  fs.chmodSync(sh, 0o755);
  return { dir, log: path.join(dir, 'calls.jsonl') };
}

function makeRepo() {
  const repo = makeTmp('fk-faces-hooks-');
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'kit@example.com']);
  git(repo, ['config', 'user.name', 'kit']);
  for (const name of ['pre-commit', 'commit-msg', 'package.json']) {
    write(repo, path.join('.githooks', name), fs.readFileSync(path.join(HOOKS, name)));
  }
  write(repo, path.join('.agents', 'config', 'commit-msg-rules.json'), fs.readFileSync(RULES));
  const stub = makeStub();
  return { repo, stub };
}

function runHook({ repo, stub }, hook, args = []) {
  return spawnSync(process.execPath, [path.join(repo, '.githooks', hook), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      FLOW_KIT_TEST: '1',
      PATH: `${stub.dir}${path.delimiter}${process.env.PATH || ''}`,
      STUB_LOG: stub.log,
      FACES_SCRIPT: FACES,
      FACES_ROOT: repo,
    },
  });
}

const calls = (stub) => (fs.existsSync(stub.log)
  ? fs.readFileSync(stub.log, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  : []);

const called = (stub, pred) => calls(stub).some(pred);
const facesCalled = (stub) => called(stub, (a) => a[0] === 'run' && /^faces(\.mjs)?$/.test(a[1]));
const gateCalled = (stub) => called(stub, (a) => a[0] === 'hook' && a[1] === 'local-pre-commit');
const orderCalled = (stub) => called(stub, (a) => a[0] === 'hook' && a[1] === 'check-confirm-order');

function stage(repo, rel, content = '') {
  write(repo, rel, content);
  const r = git(repo, ['add', '--', rel]);
  assert.equal(r.status, 0, r.stderr);
}

function configFaces(repo, faces) {
  write(repo, path.join('.agents', 'config', 'project-faces.json'), JSON.stringify(faces));
}

test('pre-commit: 配置 faces 后 docs-only 暂存 → faces 判 none，四门 SKIP', () => {
  const ctx = makeRepo();
  configFaces(ctx.repo, { code: ['src/'] });
  stage(ctx.repo, 'docs/x.md', '# doc\n');
  const r = runHook(ctx, 'pre-commit');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SKIP: 未触及代码面/);
  const faceCall = calls(ctx.stub).find((a) => a[0] === 'run' && /^faces(\.mjs)?$/.test(a[1]));
  assert.deepEqual(faceCall, ['run', 'faces', '--check-staged', '--keys', 'code,ui']);
  assert.equal(gateCalled(ctx.stub), false, '未命中产品面不得调起四门');
});

test('pre-commit: 配置 code:["src/"] 后暂存 src/a.ts → 四门被调起', () => {
  const ctx = makeRepo();
  configFaces(ctx.repo, { code: ['src/'] });
  stage(ctx.repo, 'src/a.ts', 'export const a = 1;\n');
  const r = runHook(ctx, 'pre-commit');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /SKIP: 未触及代码面/);
  assert.equal(facesCalled(ctx.stub), true);
  assert.equal(gateCalled(ctx.stub), true, '命中产品面必须调起四门');
});

test('pre-commit: 未配置 faces → 任意暂存文件都调起四门（保守全触发）', () => {
  const ctx = makeRepo();
  stage(ctx.repo, 'docs/x.md', '# doc\n');
  const r = runHook(ctx, 'pre-commit');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /SKIP: 未触及代码面/);
  assert.equal(gateCalled(ctx.stub), true);
});

test('pre-commit: faces 配置错误 → fail-closed exit 1，四门不调起', () => {
  const ctx = makeRepo();
  write(ctx.repo, path.join('.agents', 'config', 'project-faces.json'), '{');
  stage(ctx.repo, 'docs/x.md', '# doc\n');
  const r = runHook(ctx, 'pre-commit');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /产品面配置错误/);
  assert.equal(gateCalled(ctx.stub), false, '配置坏不得放行');
});

test('commit-msg: 配置 faces 后 docs-only 暂存 → 不触发顺序门', () => {
  const ctx = makeRepo();
  configFaces(ctx.repo, { code: ['src/'] });
  stage(ctx.repo, 'docs/x.md', '# doc\n');
  const msg = path.join(ctx.repo, 'msg.txt');
  write(ctx.repo, 'msg.txt', 'docs: 更新说明\n');
  const r = runHook(ctx, 'commit-msg', [msg]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(facesCalled(ctx.stub), true, 'commit-msg 须经 faces CLI 判定产品面');
  assert.equal(orderCalled(ctx.stub), false, 'docs-only 不触发先确认后改代码');
});

test('commit-msg: 配置 faces 后产品文件暂存 → 触发顺序门', () => {
  const ctx = makeRepo();
  configFaces(ctx.repo, { code: ['src/'] });
  stage(ctx.repo, 'src/a.ts', 'export const a = 1;\n');
  const msg = path.join(ctx.repo, 'msg.txt');
  write(ctx.repo, 'msg.txt', 'fix: 修一处逻辑\n');
  const r = runHook(ctx, 'commit-msg', [msg]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(orderCalled(ctx.stub), true);
});

test('commit-msg: 未配置 faces → 视为含产品文件（保守全触发）', () => {
  const ctx = makeRepo();
  stage(ctx.repo, 'docs/x.md', '# doc\n');
  const msg = path.join(ctx.repo, 'msg.txt');
  write(ctx.repo, 'msg.txt', 'docs: 更新说明\n');
  const r = runHook(ctx, 'commit-msg', [msg]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(orderCalled(ctx.stub), true);
});

test('commit-msg: faces 配置错误 → fail-closed exit 1', () => {
  const ctx = makeRepo();
  write(ctx.repo, path.join('.agents', 'config', 'project-faces.json'), '{');
  stage(ctx.repo, 'src/a.ts', 'export const a = 1;\n');
  const msg = path.join(ctx.repo, 'msg.txt');
  write(ctx.repo, 'msg.txt', 'fix: 修一处逻辑\n');
  const r = runHook(ctx, 'commit-msg', [msg]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /产品面配置错误|判定失败/);
  assert.equal(orderCalled(ctx.stub), false, '配置坏不得放行');
});

// 顺序门本体（非桩）：复制真实现 + faces 单源，验证 isProductPath 改走 faces 后的三态。
function makeOrderRepo() {
  const repo = makeTmp('fk-faces-order-');
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'kit@example.com']);
  git(repo, ['config', 'user.name', 'kit']);
  write(repo, path.join('.agents', 'hooks', 'check-confirm-order.mjs'),
    fs.readFileSync(path.join(KIT, 'templates', 'engine', '.agents', 'hooks', 'check-confirm-order.mjs')));
  for (const name of ['faces.mjs', 'judgment-ledger.mjs']) {
    write(repo, path.join('.agents', 'scripts', name),
      fs.readFileSync(path.join(KIT, 'templates', 'engine', '.agents', 'scripts', name)));
  }
  return repo;
}

function runOrder(repo, args = []) {
  return spawnSync(process.execPath, [path.join(repo, '.agents', 'hooks', 'check-confirm-order.mjs'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: repo, CHECK_LOOP_NO_LEDGER: '1' },
  });
}

test('check-confirm-order: 配置 faces 后 docs-only 暂存 → SKIP exit 0（不再写死 backend/…）', () => {
  const repo = makeOrderRepo();
  configFaces(repo, { code: ['src/'] });
  stage(repo, 'docs/x.md', '# doc\n');
  const r = runOrder(repo);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SKIP: 先确认后改代码——未暂存产品路径/);
});

test('check-confirm-order: 配置 faces 后产品路径暂存且无覆盖 plan → exit 1', () => {
  const repo = makeOrderRepo();
  configFaces(repo, { code: ['src/'] });
  stage(repo, 'src/a.ts', 'export const a = 1;\n');
  const r = runOrder(repo);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /src\/a\.ts/);
});

test('check-confirm-order: 未配置 faces → 保守全触发（docs 也按产品路径判定）', () => {
  const repo = makeOrderRepo();
  stage(repo, 'docs/x.md', '# doc\n');
  const r = runOrder(repo);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /docs\/x\.md/);
});

test('check-confirm-order: faces 配置错误 → fail-closed exit 2', () => {
  const repo = makeOrderRepo();
  write(repo, path.join('.agents', 'config', 'project-faces.json'), '{');
  stage(repo, 'src/a.ts', 'export const a = 1;\n');
  const r = runOrder(repo);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /产品面配置错误/);
});
