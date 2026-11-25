// check-local-gates.test.mjs — ⑪-advisory 通用宿主探测（issue #40）：
// 机器级宿主配置存在但无 flow-kit 接线 → WARN；项目内宿主目录未纳入 manifest → info。
// advisory 语义：不进硬项判定、不改退出码——断言只看 stdout 行，不断言 exit 0
//（裸临时目录缺 ①②④ 等硬项，脚本按设计 exit 1）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'check-local-gates.mjs');

// 机器级探测走假 HOME：os.homedir() 在 POSIX 读 HOME、Windows 读 USERPROFILE，两者都盖即跨平台生效。
const runGates = (cwd, fakeHome) => spawnSync(process.execPath, [SCRIPT], {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
});

const writeFile = (base, rel, content) => {
  const file = path.join(base, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

test('machine-level unmanaged host warns', () => {
  const cwd = makeTmp('fk-gates-cwd-');
  const home = makeTmp('fk-gates-home-');
  writeFile(home, '.codex/hooks.json', JSON.stringify({ hooks: { event: 'context-mode' } }));
  const r = runGates(cwd, home);
  assert.match(r.stdout, /\[WARN\] Codex 宿主已启用但未接入 flow-kit 门禁/);
});

test('machine-level wired host reports ok', () => {
  const cwd = makeTmp('fk-gates-cwd-');
  const home = makeTmp('fk-gates-home-');
  writeFile(home, '.codex/hooks.json', JSON.stringify({ note: 'flow-kit hook pre-shell-check' }));
  const r = runGates(cwd, home);
  assert.match(r.stdout, /\[OK\] Codex 宿主已接线 flow-kit/);
  assert.doesNotMatch(r.stdout, /未接入 flow-kit 门禁/);
});

test('absent host stays info-only', () => {
  const cwd = makeTmp('fk-gates-cwd-');
  const home = makeTmp('fk-gates-home-');
  const r = runGates(cwd, home);
  assert.match(r.stdout, /\[info\] Codex 宿主：本机未检出/);
  assert.doesNotMatch(r.stdout, /\[WARN\] Codex/);
});

test('project dirs outside manifest are listed', () => {
  const cwd = makeTmp('fk-gates-cwd-');
  const home = makeTmp('fk-gates-home-');
  fs.mkdirSync(path.join(cwd, '.trae'));
  writeFile(cwd, '.agents/install-manifest.json', JSON.stringify({ hosts: ['claude'] }));
  const r = runGates(cwd, home);
  assert.match(r.stdout, /已探测到未纳入 manifest 的宿主目录：\.trae/);
});

test('manifest missing skips project-dir sweep silently', () => {
  const cwd = makeTmp('fk-gates-cwd-');
  const home = makeTmp('fk-gates-home-');
  const r = runGates(cwd, home);
  assert.doesNotMatch(r.stdout, /未纳入 manifest/);
});

test('antigravity (.gemini) dir outside manifest is listed', () => {
  const cwd = makeTmp('fk-gates-cwd-');
  const home = makeTmp('fk-gates-home-');
  fs.mkdirSync(path.join(cwd, '.gemini'));
  writeFile(cwd, '.agents/install-manifest.json', JSON.stringify({ hosts: ['claude'] }));
  const r = runGates(cwd, home);
  assert.match(r.stdout, /已探测到未纳入 manifest 的宿主目录：\.gemini/);
});

// ⑦ 必设环境变量守卫（项目级配置 .agents/config/local-gates.json）：
// 未配置 = 明确跳过，不误拦；配置后按声明执法。
const runGatesClean = (cwd, fakeHome, extraEnv = {}) => {
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  delete env.TEST_DB_CONN;
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', env: { ...env, ...extraEnv } });
};

test('test-db guard stays skipped without project config', () => {
  const cwd = makeTmp('fk-gates-cwd-');
  const home = makeTmp('fk-gates-home-');
  const r = runGatesClean(cwd, home);
  assert.match(r.stdout, /\[SKIP\] 必设环境变量守卫未配置/);
  assert.doesNotMatch(r.stdout, /\[缺失\] TEST_DB_CONN/);
});

test('declared test-db guard fails when env unset', () => {
  const cwd = makeTmp('fk-gates-cwd-');
  const home = makeTmp('fk-gates-home-');
  writeFile(cwd, '.agents/config/local-gates.json', JSON.stringify({
    testDb: { env: 'TEST_DB_CONN', forbiddenDatabases: ['SHARED_DEV'] },
  }));
  const r = runGatesClean(cwd, home);
  assert.match(r.stdout, /\[缺失\] TEST_DB_CONN 已设且不指向禁用库/);
});

test('declared test-db guard rejects forbidden database', () => {
  const cwd = makeTmp('fk-gates-cwd-');
  const home = makeTmp('fk-gates-home-');
  writeFile(cwd, '.agents/config/local-gates.json', JSON.stringify({
    testDb: { env: 'TEST_DB_CONN', forbiddenDatabases: ['SHARED_DEV'] },
  }));
  const r = runGatesClean(cwd, home, { TEST_DB_CONN: 'Server=.;Database=shared_dev;Trusted_Connection=yes;' });
  assert.match(r.stdout, /\[缺失\] TEST_DB_CONN 已设且不指向禁用库.*指向禁用库/);
});

// 栈条件化：appsettings 合并保护仅 dotnet 栈判定；非 dotnet 打 info、不进结果集（不影响退出码）。
const initRepoWithStack = (options) => {
  const cwd = makeTmp('fk-gates-cwd-');
  spawnSync('git', ['init', '-q'], { cwd });
  spawnSync('git', ['config', '--local', 'merge.ours.driver', 'false'], { cwd });
  writeFile(cwd, '.agents/config/engine.json', JSON.stringify({ options }));
  return cwd;
};

test('non-dotnet stack skips appsettings merge protection as info', () => {
  const cwd = initRepoWithStack({ stack: 'node' });
  const home = makeTmp('fk-gates-home-');
  const r = runGates(cwd, home);
  assert.match(r.stdout, /\[info\] 非 dotnet 栈：appsettings 合并保护不适用（跳过）/);
  assert.doesNotMatch(r.stdout, /\[缺失\] merge\.ours\.driver/);
});

test('dotnet stack keeps appsettings merge-driver check', () => {
  const cwd = initRepoWithStack({ stacks: ['dotnet'] });
  const home = makeTmp('fk-gates-home-');
  const r = runGates(cwd, home);
  assert.match(r.stdout, /\[缺失\] merge\.ours\.driver/);
  assert.doesNotMatch(r.stdout, /\[info\] 非 dotnet 栈/);
});
