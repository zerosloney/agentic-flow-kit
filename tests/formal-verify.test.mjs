import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const SKILL_REL = '.agents/skills/formal-verify/SKILL.md';

function tmpRepo() {
  const dir = makeTmp('flow-kit-formal-verify-');
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

function manifest(dir) {
  return JSON.parse(read(dir, '.agents/install-manifest.json'));
}

function manifestSkillKeys(dir) {
  return Object.keys(manifest(dir).files).filter((rel) => rel.startsWith('.agents/skills/formal-verify/'));
}

// BACKLOG #25：formal-verify 仅 --tier enterprise 安装；默认档（lean/standard）零增长。
test('formal-verify is absent on the default (standard) tier', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.agents/skills/formal-verify')), false);
  assert.deepEqual(manifestSkillKeys(dir), []);
  // 宿主指针壳同样不得出现（生成面以 plan 中的技能为源）。
  assert.equal(fs.existsSync(path.join(dir, '.claude/skills/formal-verify')), false);
  assert.equal(manifest(dir).tier, 'standard');
});

test('formal-verify is absent on the lean tier', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--tier', 'lean', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.agents/skills/formal-verify')), false);
  assert.deepEqual(manifestSkillKeys(dir), []);
  assert.equal(manifest(dir).tier, 'lean');
});

test('enterprise tier installs formal-verify with pointer shell and manifest entry', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--tier', 'enterprise', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  const body = read(dir, SKILL_REL);
  assert.match(body, /^name: formal-verify$/m);
  assert.match(body, /形式化验证资产/);
  assert.ok(manifestSkillKeys(dir).includes(SKILL_REL), 'skill body must be manifest-managed');
  // claude native 指针壳按 registry 能力自动生成。
  const pointer = read(dir, '.claude/skills/formal-verify/SKILL.md');
  assert.match(pointer, /formal-verify/);
  assert.ok(manifest(dir).files['.claude/skills/formal-verify/SKILL.md'], 'pointer shell must be manifest-managed');
  assert.equal(manifest(dir).tier, 'enterprise');
});

test('enterprise en install uses the full-file en override', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--tier', 'enterprise', '--lang', 'en', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  const body = read(dir, SKILL_REL);
  assert.match(body, /Formal verification assets/);
  assert.match(body, /Idea source:/);
  assert.ok(!body.includes('形式化验证资产'), 'en tree must not fall back to the zh body');
});

test('skills lint passes on the enterprise zh tree', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--tier', 'enterprise', '--target', '.'], dir).status, 0);
  const r = run(['skills', 'lint', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stdout);
  const result = JSON.parse(r.stdout);
  assert.ok(result.skills.some((s) => s.name === 'formal-verify'), 'formal-verify must be discovered');
});

test('skills lint on the enterprise en tree adds no formal-verify error', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--tier', 'enterprise', '--lang', 'en', '--target', '.'], dir).status, 0);
  const r = run(['skills', 'lint', '--target', '.', '--json'], dir);
  // BACKLOG #26 收敛后 en 树 0 错误（原 6 条存量 description 超预算已清），formal-verify 不得新增。
  assert.equal(r.status, 0, r.stdout);
  const result = JSON.parse(r.stdout);
  assert.ok(result.skills.some((s) => s.name === 'formal-verify'), 'formal-verify must be discovered');
});
