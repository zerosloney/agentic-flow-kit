// E8b-H1 回归：check-scripts-syntax.mjs 在运行器环境（FLOW_KIT_RUNTIME_* 注入绝对路径）下
// 必须仍按「仓库根相对路径」与 git changed 集合比对——否则增量面恒空、语法错误脚本静默放行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'check-scripts-syntax.mjs');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

const BROKEN_MJS = 'export const =\n';
const BROKEN_CJS = 'module.exports = {\n';

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r;
}

function tmpRepo({ commit = true } = {}) {
  const dir = makeTmp('flow-kit-syntax-');
  git(dir, ['init', '-q']);
  if (commit) git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function write(dir, rel, text) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

// 运行器（src/commands/runtime.mjs:runChild）注入的环境：逐项显式给全，绝不依赖调用者环境。
function baseEnv() {
  const env = { ...process.env, FLOW_KIT_TEST: '1' };
  for (const key of ['CHECK_LOOP_FULL', 'CHECK_LOOP_ROOT', 'FLOW_KIT_PROJECT_ROOT',
    'FLOW_KIT_RUNTIME_SCRIPTS', 'FLOW_KIT_RUNTIME_HOOKS']) delete env[key];
  return env;
}

function runnerEnv({ root, scripts, hooks }) {
  const env = baseEnv();
  env.FLOW_KIT_PROJECT_ROOT = root;
  if (scripts) env.FLOW_KIT_RUNTIME_SCRIPTS = scripts;
  if (hooks) env.FLOW_KIT_RUNTIME_HOOKS = hooks;
  return env;
}

function runScript(cwd, env) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', env });
}

function runBin(cwd) {
  return spawnSync(process.execPath, [BIN, 'run', 'check-scripts-syntax.mjs', '--root', '.'], {
    cwd,
    encoding: 'utf8',
    env: baseEnv(),
  });
}

test('flow-kit run：暂存的项目脚本语法错误必须判红（exit 1，仓库尚无提交）', () => {
  const dir = tmpRepo({ commit: false });
  write(dir, '.agents/scripts/broken.mjs', BROKEN_MJS);
  git(dir, ['add', '.agents/scripts/broken.mjs']);

  const r = runBin(dir);
  assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stderr, /\.agents\/scripts\/broken\.mjs/);
});

test('运行器注入绝对运行时目录：按仓库根相对路径匹配 changed', () => {
  const dir = tmpRepo();
  const scripts = path.join(dir, 'engine', '.agents', 'scripts');
  const hooks = path.join(dir, 'engine', '.agents', 'hooks');
  write(dir, 'engine/.agents/scripts/broken.mjs', BROKEN_MJS);
  write(dir, 'engine/.agents/hooks/broken.cjs', BROKEN_CJS);
  git(dir, ['add', 'engine/.agents']);

  const r = runScript(dir, runnerEnv({ root: dir, scripts, hooks }));
  assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stderr, /engine\/\.agents\/scripts\/broken\.mjs/);
  assert.match(r.stderr, /engine\/\.agents\/hooks\/broken\.cjs/);
});

test('运行时目录之外：项目自带 .agents/scripts 与 .agents/hooks 仍被检查', () => {
  const dir = tmpRepo();
  const scripts = path.join(dir, 'pkg', '.agents', 'scripts');
  const hooks = path.join(dir, 'pkg', '.agents', 'hooks');
  write(dir, 'pkg/.agents/scripts/ok.mjs', 'export const ok = 1;\n');
  write(dir, 'pkg/.agents/hooks/ok.cjs', 'module.exports = {};\n');
  write(dir, '.agents/scripts/broken.mjs', BROKEN_MJS);
  write(dir, '.agents/hooks/broken.cjs', BROKEN_CJS);
  git(dir, ['add', '.agents', 'pkg/.agents']);

  const r = runScript(dir, runnerEnv({ root: dir, scripts, hooks }));
  assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stderr, /\.agents\/scripts\/broken\.mjs/);
  assert.match(r.stderr, /\.agents\/hooks\/broken\.cjs/);
});

test('无脚本变更：exit 0，不判红', () => {
  const dir = tmpRepo();
  const scripts = path.join(dir, 'pkg', '.agents', 'scripts');
  const hooks = path.join(dir, 'pkg', '.agents', 'hooks');
  write(dir, 'pkg/.agents/scripts/ok.mjs', 'export const ok = 1;\n');
  write(dir, 'pkg/.agents/hooks/ok.cjs', 'module.exports = {};\n');
  write(dir, '.agents/scripts/ok.mjs', 'export const ok = 2;\n');
  git(dir, ['add', '.agents', 'pkg/.agents']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'clean']);

  const r = runScript(dir, runnerEnv({ root: dir, scripts, hooks }));
  assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /本轮无引擎脚本变更/);
});

test('项目根是 git 仓库子目录：暂存脚本仍按项目根相对路径匹配', () => {
  const outer = tmpRepo();
  const root = path.join(outer, 'sub');
  const scripts = path.join(outer, 'pkg', '.agents', 'scripts');
  const hooks = path.join(outer, 'pkg', '.agents', 'hooks');
  write(outer, 'sub/.agents/scripts/broken.mjs', BROKEN_MJS);
  write(outer, 'pkg/.agents/scripts/ok.mjs', 'export const ok = 1;\n');
  write(outer, 'pkg/.agents/hooks/ok.cjs', 'module.exports = {};\n');
  git(outer, ['add', '-A']);

  const r = runScript(root, runnerEnv({ root, scripts, hooks }));
  assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stderr, /\.agents\/scripts\/broken\.mjs/);
});

test('运行器环境：项目侧目录只含配置、无脚本时不算清空去门', () => {
  const dir = tmpRepo();
  const scripts = path.join(dir, 'pkg', '.agents', 'scripts');
  const hooks = path.join(dir, 'pkg', '.agents', 'hooks');
  write(dir, 'pkg/.agents/scripts/ok.mjs', 'export const ok = 1;\n');
  write(dir, 'pkg/.agents/hooks/ok.cjs', 'module.exports = {};\n');
  write(dir, '.agents/hooks/gates.json', '{}\n');
  write(dir, '.agents/scripts/README.md', '# 项目自有脚本目录\n');
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'install']);

  const r = runScript(dir, runnerEnv({ root: dir, scripts, hooks }));
  assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /本轮无引擎脚本变更/);
});
