// derived.test.mjs — 派生工件语义与「锚点外原文被覆盖」的证据判定（issue #86）。
//
// 判定只能靠证据，不能靠内容哨兵：正常新装户的锚点外同样是模板样板，
// 与被旧版安装覆盖后的形态逐字节相同——纯内容启发式会把每个健康仓都报成受损仓。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTmp } from './helpers/tmp.mjs';
import {
  countDiscardableLines,
  countOutsideAnchorLines,
  derivedModeOf,
  detectAnchorTextOverwritten,
  splitAnchorRegion,
} from '../src/install/derived.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = fs.readFileSync(path.join(KIT, 'templates/scaffold/workflow/INDEX.md'), 'utf8');

const HEAD = '# workflow 索引（生成物，勿手改）\n\n> 样板说明。\n\n';
const INNER = '<!-- GENERATED:BEGIN — x -->\n\n## 活跃（1）\n\n<!-- GENERATED:END -->\n';

function gitRepo(files) {
  const dir = makeTmp('fk-derived-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  for (const [rel, text] of Object.entries(files || {})) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
  }
  if (files && Object.keys(files).length) {
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed'], { cwd: dir });
  }
  return dir;
}

test('splitAnchorRegion：无成对锚点返回 null，成对时切分 before/inner/after', () => {
  assert.equal(splitAnchorRegion('no anchors\n'), null);
  assert.equal(splitAnchorRegion('<!-- GENERATED:BEGIN — x -->\nbody\n'), null, '只有 BEGIN 不成对');
  const region = splitAnchorRegion(`${HEAD}${INNER}tail\n`);
  assert.equal(region.before, HEAD);
  assert.ok(region.inner.includes('## 活跃（1）'));
  assert.equal(region.after.trim(), 'tail');
});

test('countOutsideAnchorLines / countDiscardableLines：锚点外 vs 整文件', () => {
  const text = `${HEAD}${INNER}尾部\n`;
  assert.equal(countOutsideAnchorLines(text), 3, '只数锚点外非空行（锚点前 + 锚点后）');
  assert.equal(countOutsideAnchorLines('no anchors\n'), 0);
  assert.equal(countDiscardableLines(text, 'anchor'), 3);
  assert.equal(countDiscardableLines(text, 'whole'), 6, '整文件生成时全文都会被丢弃');
});

test('derivedModeOf：INDEX.md 是锚区生成，另两个是整文件生成', () => {
  assert.equal(derivedModeOf('workflow/INDEX.md'), 'anchor');
  assert.equal(derivedModeOf('workflow/effective-policy.md'), 'whole');
  assert.equal(derivedModeOf('.agents/notes/engine-map.md'), 'whole');
  assert.equal(derivedModeOf('AGENTS.md'), null);
});

test('detectAnchorTextOverwritten：无 git 证据一律不报（宁可漏报不可误报）', () => {
  const dir = gitRepo({});
  const disk = TEMPLATE;
  assert.equal(detectAnchorTextOverwritten({ target: dir, rel: 'workflow/INDEX.md', diskText: disk, templateText: TEMPLATE }), null);
});

test('detectAnchorTextOverwritten：HEAD 里也是样板 → 不报（健康新装户）', () => {
  const dir = gitRepo({ 'workflow/INDEX.md': TEMPLATE });
  assert.equal(detectAnchorTextOverwritten({ target: dir, rel: 'workflow/INDEX.md', diskText: TEMPLATE, templateText: TEMPLATE }), null);
});

test('detectAnchorTextOverwritten：HEAD 里有手工说明而磁盘只剩样板 → 报出', () => {
  const manual = '# 我的索引\n\n> 手工说明，必须保留。\n\n';
  const dir = gitRepo({ 'workflow/INDEX.md': manual + TEMPLATE.slice(TEMPLATE.indexOf('<!-- GENERATED:BEGIN')) });
  const damaged = TEMPLATE;
  const hit = detectAnchorTextOverwritten({ target: dir, rel: 'workflow/INDEX.md', diskText: damaged, templateText: TEMPLATE });
  assert.ok(hit, '必须判定为锚点外原文被覆盖');
  assert.equal(hit.rel, 'workflow/INDEX.md');
  assert.ok(hit.headBefore.includes('我的索引'));
});

test('detectAnchorTextOverwritten：磁盘仍带手工说明 → 不报（用户自己改的）', () => {
  const manual = '# 我的索引\n\n> 手工说明。\n\n';
  const dir = gitRepo({ 'workflow/INDEX.md': manual + TEMPLATE.slice(TEMPLATE.indexOf('<!-- GENERATED:BEGIN')) });
  const hit = detectAnchorTextOverwritten({
    target: dir,
    rel: 'workflow/INDEX.md',
    diskText: manual + TEMPLATE.slice(TEMPLATE.indexOf('<!-- GENERATED:BEGIN')),
    templateText: TEMPLATE,
  });
  assert.equal(hit, null);
});
