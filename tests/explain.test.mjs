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
  const dir = makeTmp('flow-kit-explain-');
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

function install(dir, { host = 'trae', lang = 'zh-CN', extra = [] } = {}) {
  const r = run(['install', '--agent', host, '--lang', lang, '--stack', 'node', '--target', '.', ...extra], dir);
  assert.equal(r.status, 0, r.stderr);
  return r;
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

test('explain reports static template source and hashes', () => {
  const dir = tmpRepo();
  install(dir);
  const r = run(['explain', '.trae/commands/wf-new-task.md', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /文件：\.trae\/commands\/wf-new-task\.md/);
  assert.match(r.stdout, /类别：host/);
  assert.match(r.stdout, /状态：未变/);
  assert.match(r.stdout, /模板：templates\/hosts\/trae\/commands\/wf-new-task\.md/);
  assert.match(r.stdout, /语言覆盖：无/);
  assert.match(r.stdout, /模型注入：无/);
  assert.match(r.stdout, /manifest 哈希：[a-f0-9]{64}/);
  assert.match(r.stdout, /当前哈希：[a-f0-9]{64}/);

  // 绝对路径也应归一到 targetRel。
  const abs = path.join(dir, '.trae/commands/wf-new-task.md');
  const viaAbs = run(['explain', abs, '--target', '.'], dir);
  assert.equal(viaAbs.status, 0, viaAbs.stderr);
  assert.match(viaAbs.stdout, /文件：\.trae\/commands\/wf-new-task\.md/);
});

test('explain reports the locale override and follows the installed language', () => {
  const dir = tmpRepo();
  install(dir, { lang: 'en' });
  const r = run(['explain', '.agents/commands/new-task.md', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^File: \.agents\/commands\/new-task\.md/m);
  assert.match(r.stdout, /Template: templates\/engine\/\.agents\/commands\/new-task\.md/);
  assert.match(r.stdout, /Locale override: locales\/en\/overrides\/\.agents\/commands\/new-task\.md/);
});

test('explain reports model injection field, role and values', () => {
  const dir = tmpRepo();
  install(dir, { host: 'claude', extra: ['--model', 'claude:code=sonnet'] });
  const r = run(['explain', '.claude/agents/implementer.md', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /模型注入：model ← code/);
  assert.match(r.stdout, /计划值=sonnet/);
  assert.match(r.stdout, /当前值=sonnet/);
});

test('explain reports generated host skill surfaces', () => {
  const dir = tmpRepo();
  install(dir, { host: 'claude' });
  const r = run(['explain', '.claude/skills/arena/SKILL.md', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /类别：host/);
  assert.match(r.stdout, /模板：templates\/host-meta\/claude\/skill-pointer\.md/);
});

test('explain reports missing files without failing', () => {
  const dir = tmpRepo();
  install(dir);
  fs.rmSync(path.join(dir, '.agents/commands/review.md'));
  const r = run(['explain', '.agents/commands/review.md', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /状态：缺失/);
  assert.match(r.stdout, /当前哈希：文件不存在/);
});

test('explain reports orphan manifest entries', () => {
  const dir = tmpRepo();
  install(dir);
  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  manifest.files['legacy/old.md'] = '0'.repeat(64);
  fs.writeFileSync(
    path.join(dir, '.agents/install-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  const r = run(['explain', 'legacy/old.md', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /状态：孤儿/);
  assert.match(r.stdout, /模板：无/);
});

test('explain exits 1 for unmanaged files', () => {
  const dir = tmpRepo();
  install(dir);
  fs.writeFileSync(path.join(dir, 'README.local.md'), 'local\n', 'utf8');
  const r = run(['explain', 'README.local.md', '--target', '.'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /文件未托管/);
});

test('explain exits 2 without a target path', () => {
  const dir = tmpRepo();
  install(dir);
  const r = run(['explain', '--target', '.'], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /flow-kit explain/);
});

test('explain without a manifest exits 3', () => {
  const dir = tmpRepo();
  const r = run(['explain', '.agents/commands/new-task.md', '--target', '.'], dir);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /install/);
});
