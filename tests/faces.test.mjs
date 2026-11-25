// faces.test.mjs — 产品面单源（.agents/config/project-faces.json）的读取语义与 CLI 契约：
// 未配置 = 保守全触发；配置后只认列出的前缀；配置错误 fail-closed。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { faceOf, isProductPath, loadFaces } from '../templates/engine/.agents/scripts/faces.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'faces.mjs');
const write = (root, rel, content) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const runCli = (root, args) => spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root },
});

test('missing config = unconfigured, every path is product (conservative)', () => {
  const root = makeTmp('fk-faces-');
  const faces = loadFaces(root);
  assert.equal(faces.configured, false);
  assert.deepEqual(faces.code, []);
  assert.equal(isProductPath(faces, 'anything/at/all.ts'), true);
  assert.equal(isProductPath(faces, '.agents/scripts/x.mjs'), true);
});

test('configured faces match prefixes only and classify face names', () => {
  const root = makeTmp('fk-faces-');
  write(root, '.agents/config/project-faces.json', JSON.stringify({
    ui: ['frontend/src/'],
    code: ['backend/'],
    tests: ['tests/'],
    data: ['wiki/数据维护/'],
  }));
  const faces = loadFaces(root);
  assert.equal(faces.configured, true);
  assert.equal(faceOf(faces, 'backend/orders/A.cs'), 'code');
  assert.equal(faceOf(faces, 'frontend/src/pages/a.vue'), 'ui');
  assert.equal(faceOf(faces, 'tests/Acme.Tests/X.cs'), 'tests');
  assert.equal(faceOf(faces, 'wiki/数据维护/schema变更/001.sql'), 'data');
  assert.equal(faceOf(faces, 'docs/design.md'), null);
  assert.equal(isProductPath(faces, 'docs/design.md'), false);
  assert.equal(isProductPath(faces, 'backend/orders/A.cs', ['ui']), false);
});

test('prefix matching is segment-aware (src/ does not match srcfoo/)', () => {
  const faces = { configured: true, ui: [], code: ['src/'], tests: [], data: [] };
  assert.equal(faceOf(faces, 'src/a.ts'), 'code');
  assert.equal(faceOf(faces, 'srcfoo/a.ts'), null);
});

test('invalid config throws (fail-closed, never treated as unconfigured)', () => {
  const root = makeTmp('fk-faces-');
  write(root, '.agents/config/project-faces.json', JSON.stringify({ code: 'backend/' }));
  assert.throws(() => loadFaces(root), /code 必须是数组/);
  write(root, '.agents/config/project-faces.json', JSON.stringify({ code: ['/abs/path'] }));
  assert.throws(() => loadFaces(root), /仓库相对前缀/);
  write(root, '.agents/config/project-faces.json', JSON.stringify({ cod: ['src/'] }));
  assert.throws(() => loadFaces(root), /未知键/);
});

test('CLI: --check / --check-staged / --face 的退出码与输出', () => {
  const root = makeTmp('fk-faces-');
  spawnSync('git', ['init', '-q'], { cwd: root });
  write(root, '.agents/config/project-faces.json', JSON.stringify({ code: ['src/'], ui: [], tests: [], data: [] }));

  let r = runCli(root, ['--check', 'src/a.ts']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^hit src\/a\.ts/);

  r = runCli(root, ['--check', 'docs/x.md']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^none/);

  r = runCli(root, ['--face', 'src/a.ts']);
  assert.equal(r.stdout.trim(), 'code');
  r = runCli(root, ['--face', 'docs/x.md']);
  assert.equal(r.stdout.trim(), 'none');

  write(root, 'src/a.ts', 'export {};\n');
  spawnSync('git', ['add', 'src/a.ts'], { cwd: root });
  r = runCli(root, ['--check-staged']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^hit src\/a\.ts/);
});

test('CLI: unconfigured project reports full and exits 0', () => {
  const root = makeTmp('fk-faces-');
  spawnSync('git', ['init', '-q'], { cwd: root });
  const r = runCli(root, ['--check-staged']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^full/);
  const bad = makeTmp('fk-faces-');
  write(bad, '.agents/config/project-faces.json', '{');
  const err = runCli(bad, ['--check', 'src/a.ts']);
  assert.equal(err.status, 2);
  assert.match(err.stderr, /JSON 解析失败/);
});

// D17：git 失败不是「未命中」——--check-staged 必须 exit 2，否则 pre-commit 会把配置错误当跳过。
test('CLI: --check-staged outside a git repo exits 2 with a loud error', () => {
  const root = makeTmp('fk-faces-nogit-');
  const r = runCli(root, ['--check-staged']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /git diff --cached 失败/);
});
