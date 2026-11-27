import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { collectSources, checkNarrativeClaims } from '../templates/engine/.agents/scripts/gen-narrative-claims.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'templates', 'engine', '.agents', 'scripts', 'gen-narrative-claims.mjs');
const VERIFY = path.join(HERE, '..', 'templates', 'engine', '.agents', 'scripts', 'verify.mjs');

const ANCHOR_ROWS = [
  '| `policy.version` | 版本 | 说明 | 依据 | hard |',
  '| `policy.anchors` | 锚 | 说明 | 依据 | advisory |',
].join('\n');

function makeRoot({ effectivePolicy = null, workflowIndex = null } = {}) {
  const root = makeTmp('narrative-claims-');
  fs.mkdirSync(path.join(root, '.agents', 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.agents', 'scripts', 'check-loop.mjs'),
    "const SECTIONS = [{ lane: 'hard' }, { lane: 'hard' }, { lane: 'hygiene' }];\n",
    'utf8',
  );
  fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'workflow', 'effective-policy.md'),
    effectivePolicy ?? `policyVersion 7\n\n${ANCHOR_ROWS}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'workflow', 'INDEX.md'),
    workflowIndex ?? '## 活跃（5）\n\n## 档案计数（9）\n',
    'utf8',
  );
  fs.mkdirSync(path.join(root, 'wiki', 'topic'), { recursive: true });
  fs.writeFileSync(path.join(root, 'wiki', 'INDEX.md'), '合计：**3 份**知识文档，**2 个主题**\n', 'utf8');
  fs.mkdirSync(path.join(root, '.githooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.githooks', 'pre-commit'), '#!/bin/sh\n', 'utf8');
  fs.writeFileSync(path.join(root, '.githooks', 'commit-msg'), '#!/bin/sh\n', 'utf8');
  fs.mkdirSync(path.join(root, '.agents', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents', 'roles'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'commands', 'a.md'), '# a\n', 'utf8');
  fs.writeFileSync(path.join(root, '.agents', 'commands', 'b.md'), '# b\n', 'utf8');
  fs.writeFileSync(path.join(root, '.agents', 'roles', 'r.md'), '# r\n', 'utf8');
  return root;
}

const writeDoc = (root, body) => {
  const file = path.join(root, 'wiki', 'topic', 'doc.md');
  fs.writeFileSync(file, body, 'utf8');
  return file;
};

test('降级的工作流索引来源跳过该类声明，文档保持原样', () => {
  const root = makeRoot({ workflowIndex: '索引头部缺失\n' });
  const file = writeDoc(root, '现状：workflow 活跃</td><td>5</td>，workflow 档案</td><td>9</td>。\n');

  const run = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(fs.readFileSync(file, 'utf8'), /workflow 活跃<\/td><td>5<\/td>/, '来源缺失时不得改写该类声明');
  assert.match(fs.readFileSync(file, 'utf8'), /workflow 档案<\/td><td>9<\/td>/);

  const check = checkNarrativeClaims(root);
  assert.equal(check.mismatches.length, 0, '来源缺失的声明类不得产生漂移噪声');
});

test('降级的 effective-policy 来源跳过锚数声明，不写入 vnull', () => {
  const root = makeRoot({ effectivePolicy: '策略文件被截断，没有版本行也没有锚表\n' });
  const file = writeDoc(root, '现状：policy v7 = 2 锚（hard 1 · advisory 1），请以文件为准。\n');

  const run = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(after, '现状：policy v7 = 2 锚（hard 1 · advisory 1），请以文件为准。\n');
  assert.doesNotMatch(after, /vnull|0 锚/);

  assert.equal(checkNarrativeClaims(root).mismatches.length, 0);
});

test('计数与门表不符的缓存被重建，不拿毒化数字做判定', () => {
  const root = makeRoot();
  const all = Number(spawnSync(process.execPath, [VERIFY, '--list'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/).filter(Boolean).length);
  const engine = Number(spawnSync(process.execPath, [VERIFY, '--list', '--engine'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/).filter(Boolean).length);
  assert.ok(all > 0 && engine > 0);

  const cacheFile = path.join(root, '.agents', 'cache', 'gate-counts.json');
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  const verifyHash = crypto.createHash('sha256').update(fs.readFileSync(VERIFY)).digest('hex');
  fs.writeFileSync(cacheFile, JSON.stringify({ v: 1, root: path.resolve(root), verifyHash, all: 5, engine: 1 }), 'utf8');

  const file = writeDoc(root, `现状：全量 ${all} 门、增量门 ${engine} 门、check-loop 3 段、硬门 2 段。\n`);
  const check = checkNarrativeClaims(root);
  assert.equal(check.sources.gatesAll, all, '毒化缓存必须按门表重建');
  assert.equal(check.sources.gatesEngine, engine);
  assert.equal(check.mismatches.length, 0);
  assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`全量 ${all} 门`));

  const rebuilt = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.equal(rebuilt.all, all);
  assert.equal(rebuilt.engine, engine);
});

test('单源正常时改写与 --check 均按单源真值工作', () => {
  const root = makeRoot();
  const file = writeDoc(root, '现状：check-loop 9 段、硬门 9 段、2 个 git 原生钩子、commands/ 9 个阶段指令。\n');

  const check = checkNarrativeClaims(root);
  assert.equal(check.claims, 4);
  assert.equal(check.mismatches.length, 3);

  const run = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    '现状：check-loop 3 段、硬门 2 段、2 个 git 原生钩子、commands/ 2 个阶段指令。\n',
  );

  const after = spawnSync(process.execPath, [SCRIPT, '--root', root, '--check'], { encoding: 'utf8' });
  assert.equal(after.status, 0, after.stderr || after.stdout);
});
