// 纠偏短名索引的指针可指认性（BACKLOG #21）：新增四条准则的短名必须指到**安装树里真实存在**的正文，
// 且引号里点名的章节/条目仍在原处（防「文件在、章节没了」的指针漂移）。
// 运行时脚本（`.agents/scripts/**`、`.agents/hooks/*.cjs|mjs`）不安装到目标项目（R5-1b），
// 只能以 `flow-kit run|hook` 调起式出现——本测试同时锁这条写法。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRINCIPLES = path.join(KIT, 'templates/engine/.agents/config/principles.md');
// 分发面候选根：engine 正文、scaffold 工件、切面 notes、profile 根文档。
const ROOTS = [
  path.join(KIT, 'templates/engine'),
  path.join(KIT, 'templates/scaffold'),
  ...fs.readdirSync(path.join(KIT, 'templates/surfaces')).map((d) => path.join(KIT, 'templates/surfaces', d)),
  ...fs.readdirSync(path.join(KIT, 'templates/profiles')).map((d) => path.join(KIT, 'templates/profiles', d)),
];
const NEW_ROWS = ['类型面纪律', '幂等收敛', '单写者先分离', '测行为不测实现'];

function rows(text) {
  return text.split(/\r?\n/)
    .filter((line) => line.startsWith('|') && !/^\|[\s-|]+\|$/.test(line) && !line.startsWith('| 短名'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

function resolve(rel, roots = ROOTS) {
  return roots.map((root) => path.join(root, rel)).find((abs) => fs.existsSync(abs)) || null;
}

const isRuntime = (rel) => rel.startsWith('.agents/scripts/')
  || rel.startsWith('.agents/tests/')
  || (/^\.agents\/hooks\//.test(rel) && /\.(cjs|mjs)$/i.test(rel));

function pointers(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1])
    .filter((token) => token.startsWith('.agents/') || token.startsWith('workflow/'));
}

function anchors(cell) {
  return [...cell.matchAll(/「([^」]+)」/g)].map((m) => m[1]);
}

test('every principles row keeps three cells and the four new short names are present', () => {
  const parsed = rows(fs.readFileSync(PRINCIPLES, 'utf8'));
  for (const cells of parsed) assert.equal(cells.length, 3, `行不是三格：${cells.join(' | ')}`);
  const names = parsed.map((cells) => cells[0]);
  for (const name of NEW_ROWS) assert.ok(names.includes(name), `缺少短名 ${name}`);
  assert.equal(new Set(names).size, names.length, '短名不得重复（一概念一名）');
});

test('the four new rows point at distributed text whose named anchors still exist', () => {
  const parsed = rows(fs.readFileSync(PRINCIPLES, 'utf8')).filter((cells) => NEW_ROWS.includes(cells[0]));
  assert.equal(parsed.length, NEW_ROWS.length);
  for (const [name, when, cell] of parsed) {
    assert.ok(when.length > 0, `${name}: 「何时报它」不得为空`);
    const rels = pointers(cell);
    assert.ok(rels.length > 0, `${name}: 指针格必须有可指认路径`);
    const bodies = [];
    for (const rel of rels) {
      const abs = resolve(rel);
      assert.ok(abs, `${name}: 指针 ${rel} 在分发面不存在`);
      if (isRuntime(rel)) {
        // 运行时脚本不安装 → 必须以调起式出现，否则目标项目里指不到。
        assert.match(cell, /flow-kit (run|hook)/, `${name}: 运行时指针 ${rel} 须写成 flow-kit run|hook 调起式`);
        continue;
      }
      bodies.push(fs.readFileSync(abs, 'utf8'));
    }
    for (const anchor of anchors(cell)) {
      assert.ok(bodies.some((body) => body.includes(anchor)), `${name}: 指针正文里找不到点名的「${anchor}」`);
    }
    // 调起式里点名的脚本必须随包分发。
    for (const m of cell.matchAll(/flow-kit run ([A-Za-z0-9._-]+\.mjs)/g)) {
      assert.ok(resolve(`.agents/scripts/${m[1]}`), `${name}: 调起的脚本 ${m[1]} 不随包分发`);
    }
  }
});

test('pointer resolution is not vacuous: a missing target and a renamed anchor both fail', () => {
  // 负例一：夹具根里只放 wiki 技能，arena 指针必须解析不到。
  const fixture = makeTmp('principles-pointer-');
  const wikiRel = '.agents/skills/wiki/SKILL.md';
  const target = path.join(fixture, wikiRel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'templates/engine', wikiRel), target);
  assert.ok(resolve(wikiRel, [fixture]));
  assert.equal(resolve('.agents/skills/arena/SKILL.md', [fixture]), null);
  assert.equal(resolve('.agents/skills/ghost-skill/SKILL.md'), null);

  // 负例二：章节被改名（「单写者」消失）时，锚点核对必须失败——证明锚点检查不是空转。
  const original = fs.readFileSync(target, 'utf8');
  const renamed = original.replaceAll('单写者', '并发写');
  const cell = rows(fs.readFileSync(PRINCIPLES, 'utf8')).find((cells) => cells[0] === '单写者先分离')[2];
  const named = anchors(cell);
  assert.ok(named.includes('单写者'));
  const hit = (bodies, anchor) => bodies.some((body) => body.includes(anchor));
  assert.equal(hit([original], '单写者'), true);
  assert.equal(hit([renamed], '单写者'), false);
});
