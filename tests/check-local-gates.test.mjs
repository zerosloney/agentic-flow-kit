// check-local-gates.test.mjs — ⑪-advisory 通用宿主探测（issue #40）：
// 机器级宿主配置存在但无 flow-kit 接线 → WARN；项目内宿主目录未纳入 manifest → info。
// advisory 语义：不进八项判定、不改退出码——断言只看 stdout 行，不断言 exit 0
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
