// faces-verify.test.mjs — 产品面单源接入 verify / verify-scope 的行为契约：
// 未配置 faces = 保守全触发；配置后只认列出前缀；配置解析失败 fail-closed（exit 2 + 「配置错误」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { loadProductFaces } from '../templates/engine/.agents/scripts/verify-scope.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'verify.mjs');
const REGR = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'check-regression-consistency.mjs');
const FEATURE_MAP = '.agents/skills/verify-ui/features/map.md';

const write = (root, rel, content) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
const repo = () => {
  const dir = makeTmp('fk-faces-verify-');
  assert.equal(git(dir, ['init', '-q']).status, 0);
  return dir;
};
const commitAll = (root) => {
  assert.equal(git(root, ['add', '-A']).status, 0);
  assert.equal(git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']).status, 0);
};
const runVerify = (root, args) => spawnSync(process.execPath, [VERIFY, ...args], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root, CHECK_LOOP_ROOT: root, FLOW_KIT_TEST: '1' },
});
// 夹具门（--test-cmd）走生产尾段：全绿后落 .agents/verifications.jsonl，末行 dirty = 业务脏路径快照。
const lastGreenDirty = (root) => {
  const lines = fs.readFileSync(path.join(root, '.agents', 'verifications.jsonl'), 'utf8').trim().split(/\r?\n/);
  return JSON.parse(lines[lines.length - 1]).dirty;
};

test('未配置 faces：verify 脏路径过滤把任意源码当业务面（保守全触发）', () => {
  const dir = repo();
  write(dir, 'backend/a.cs', 'a\n');
  write(dir, 'docs/x.md', 'x\n');
  commitAll(dir);
  write(dir, 'backend/a.cs', 'a2\n');
  write(dir, 'docs/x.md', 'x2\n');
  const r = runVerify(dir, ['--test-cmd', 'node -e "process.exit(0)"']);
  assert.equal(r.status, 0, r.stderr);
  const dirty = lastGreenDirty(dir);
  assert.ok(dirty.includes('backend/a.cs'), dirty.join(','));
  assert.ok(dirty.includes('docs/x.md'), dirty.join(','), '未配置时文档路径也按业务面计（保守）');
  assert.ok(!dirty.includes(''), '空路径不得进 dirty 快照');
});

test('配置 faces 后：docs 变更不算业务面，code 前缀命中', () => {
  const dir = repo();
  write(dir, '.agents/config/project-faces.json', JSON.stringify({ code: ['backend/'], ui: ['frontend/src/'] }));
  write(dir, 'backend/a.cs', 'a\n');
  write(dir, 'docs/x.md', 'x\n');
  commitAll(dir);
  write(dir, 'backend/a.cs', 'a2\n');
  write(dir, 'docs/x.md', 'x2\n');
  const r = runVerify(dir, ['--test-cmd', 'node -e "process.exit(0)"']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lastGreenDirty(dir), ['backend/a.cs']);
});

test('product-gates 配置损坏：verify --list exit 2 且打印「配置错误」', () => {
  const dir = repo();
  write(dir, '.agents/config/project-faces.json', JSON.stringify({ code: ['backend/'] }));
  write(dir, '.agents/config/product-gates.json', '{bad');
  const r = runVerify(dir, ['--list']);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /配置错误：.*product-gates\.json/);
});

test('project-faces 配置损坏：verify 同样 fail-closed（exit 2）', () => {
  const dir = repo();
  write(dir, '.agents/config/project-faces.json', '{"code":');
  const r = runVerify(dir, ['--list']);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /配置错误：.*project-faces\.json/);
});

test('面与门映射派生自 project-faces + product-gates（未配置 = 空面清单）', () => {
  const empty = repo();
  assert.deepEqual(loadProductFaces(empty), []);

  const dir = repo();
  write(dir, '.agents/config/project-faces.json', JSON.stringify({
    ui: ['frontend/src/'], code: ['backend/'], tests: ['tests/'], data: ['wiki/data/'],
  }));
  write(dir, '.agents/config/product-gates.json', JSON.stringify({
    gates: [
      { id: 'backend-build', name: 'b', cmd: 'x', folder: '.' },
      { id: 'frontend-lint', name: 'f', cmd: 'x', folder: 'frontend' },
      { id: 'tests-only', name: 't', cmd: 'x', folder: 'tests' },
    ],
  }));
  const faces = loadProductFaces(dir);
  assert.deepEqual(faces.map((f) => f.face), ['backend', 'frontend', 'tests', 'data']);
  const byFace = Object.fromEntries(faces.map((f) => [f.face, f.gates]));
  assert.deepEqual(byFace.backend, ['backend-build']);
  assert.deepEqual(byFace.frontend, ['backend-build', 'frontend-lint']);
  assert.deepEqual(byFace.tests, ['backend-build', 'tests-only']);
  assert.equal(faces.find((f) => f.face === 'backend').match('backend/a.cs'), true);
  assert.equal(faces.find((f) => f.face === 'frontend').match('frontend/src/a.vue'), true);
  assert.equal(faces.find((f) => f.face === 'backend').match('docs/x.md'), false);
});

test('特性地图符号搜索按 faces code+ui 收窄；配置错误打印后退回全仓（advisory exit 0）', () => {
  const runRegr = (root) => spawnSync(process.execPath, [REGR, '--root', root], { cwd: root, encoding: 'utf8' });

  // 配置 code=backend/：符号只在 docs/ → 收窄搜索找不到（advisory 提示）
  const narrowed = repo();
  write(narrowed, '.agents/config/project-faces.json', JSON.stringify({ code: ['backend/'] }));
  write(narrowed, 'docs/ghost.md', '`GhostService`\n');
  write(narrowed, FEATURE_MAP, '`GhostService`\n');
  commitAll(narrowed);
  const r1 = runRegr(narrowed);
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /GhostService/);

  // 配置项损坏：打印「配置错误」并退回全仓（docs/ 里能找到 → 不再 advisory），退出码仍 0
  const broken = repo();
  write(broken, '.agents/config/project-faces.json', '{"code":');
  write(broken, 'docs/ghost.md', '`GhostService`\n');
  write(broken, FEATURE_MAP, '`GhostService`\n');
  commitAll(broken);
  const r2 = runRegr(broken);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stderr, /配置错误：.*project-faces\.json/);
  assert.doesNotMatch(r2.stdout, /GhostService/);
});

test('confirm-doc：project-faces 配置损坏 → exit 2 并写明文件（fail-closed）', () => {
  const dir = repo();
  write(dir, '.agents/config/project-faces.json', '{"code":');
  const r = spawnSync(process.execPath, [
    path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'confirm-doc.mjs'),
    'workflow/intents/x.md', '--delegated', 'ok', '--root', dir,
  ], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /配置错误：.*project-faces\.json/);
});
