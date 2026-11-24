import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-dotnet-neutral-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

const NEUTRAL_FILES = [
  '.agents/notes/runtime-env.md',
  '.agents/config/test-impact-map.json',
  '.agents/config/lane-surfaces.txt',
  '.agents/config/workflow-modules.txt',
];

// 母项目（.NET + Vue 抽取源）的事实不得随 dotnet profile 装进陌生项目。
const FORBIDDEN = /Shipyard|8932|5203|Deve_|dev-local|run-backend-tests|material|mto/i;

function installDotnet(dir) {
  const r = run(['install', '--agent', 'claude', '--lang', 'zh-CN', '--stack', 'dotnet', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
}

test('dotnet profile ships a neutral skeleton: all four files present, no parent-project facts', () => {
  const dir = tmpRepo();
  installDotnet(dir);

  for (const rel of NEUTRAL_FILES) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `missing: ${rel}`);
    assert.doesNotMatch(read(dir, rel), FORBIDDEN, `parent-project residue in ${rel}`);
  }
});

test('dotnet runtime-env.md keeps the full section skeleton other files anchor to', () => {
  const dir = tmpRepo();
  installDotnet(dir);

  const env = read(dir, '.agents/notes/runtime-env.md');
  for (const heading of ['## 6.', '### 6.1 ', '### 6.1b', '### 6.2', '### 6.3', '### 6.4', '### 6.5', '### 6.6', '## 7.']) {
    assert.ok(env.includes(heading), `runtime-env.md missing heading anchor: ${heading}`);
  }
});

test('dotnet configs are empty skeletons: impact map empty, module wordlist has no entries', () => {
  const dir = tmpRepo();
  installDotnet(dir);

  const map = JSON.parse(read(dir, '.agents/config/test-impact-map.json'));
  assert.deepEqual(map.areas, {});
  assert.deepEqual(map.paths, []);

  const modules = read(dir, '.agents/config/workflow-modules.txt')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(modules, []);
});

test('check-test-impact-map.mjs on the neutral tree skips cleanly (no uncaught ENOENT stack)', () => {
  const dir = tmpRepo();
  installDotnet(dir);

  const check = run(['run', 'check-test-impact-map.mjs'], dir);
  const combined = `${check.stdout}\n${check.stderr}`;
  // 骨架态（未登记映射）= 明确 SKIP exit 0；目录缺失等前置问题也不得抛未捕获异常栈。
  assert.doesNotMatch(combined, /ENOENT/);
  assert.doesNotMatch(check.stderr, /^\s+at /m, `uncaught stack:\n${check.stderr}`);
  assert.equal(check.status, 0, combined);
  assert.match(check.stdout, /SKIP/);
});
