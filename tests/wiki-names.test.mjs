// wiki-names.test.mjs — wiki 协议名随安装语言：① loadWikiNames 缺省/整体覆盖/部分覆盖/非法值回退；
// ② 英文布局（engine.json options.wiki）下看板 / 台账 / 批次目录 / --base 缺省按英文名工作；
// ③ 无 options.wiki 的中文布局行为不变。夹具为手工搭建的小项目（不跑完整 install）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { loadWikiNames, WIKI_NAME_DEFAULTS } from '../templates/engine/.agents/scripts/wiki-names.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(KIT, 'templates', 'engine', '.agents', 'scripts');
const BOARD_HTML = fs.readFileSync(path.join(KIT, 'templates', 'scaffold', 'wiki', '知识沉淀总览.html'), 'utf8');
const EN = Object.freeze({
  board: 'knowledge-overview.html',
  maintenance: 'data-maintenance',
  schemaBatch: 'schema-changes',
  dataFixBatch: 'data-fixes',
});
const EN_TOPIC = 'product-requirements';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
};
const writeEngine = (dir, options) => write(path.join(dir, '.agents', 'config', 'engine.json'), JSON.stringify({ options }, null, 2));
const runScript = (script, args, cwd, env = {}) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, ...env },
});

// INDEX 只保留脚本依赖的机器锚点（主题表头 / 合计行 / 映射表 / 命名规则），数据行由 gen 重写。
const indexText = (names, topic) => `# Wiki index

## 主题目录速览

| 主题 | 文件数 | 用途 |
|---|---|---|
| ${names.maintenance} | 1 | Ledger of schema change / data repair SQL |
| ${topic} | 1 | Product requirement docs |

合计：**1 份**知识文档，**2 个主题**

---

## 文件 → 主题 → 归属目录 映射表

## 命名规则

- Generated areas must not be hand-edited.
`;

// 手工项目：wiki 主题目录 + 看板 + INDEX + 数据维护台账（+ 可选批次 SQL）
function makeWikiProject(names, { topic, maintenanceReadme, batchSql } = {}) {
  const dir = makeTmp('flow-kit-wiki-names-');
  write(path.join(dir, 'wiki', 'INDEX.md'), indexText(names, topic));
  write(path.join(dir, 'wiki', names.board), BOARD_HTML);
  write(path.join(dir, 'wiki', 'drafts-archive', 'README.md'), '# Archive\n');
  write(path.join(dir, 'wiki', names.maintenance, 'README.md'), maintenanceReadme);
  write(path.join(dir, 'wiki', topic, 'overview.md'), '# Overview\n\nTopic doc body.\n');
  if (batchSql) write(path.join(dir, 'wiki', names.maintenance, names.schemaBatch, '001', '01-x.sql'), batchSql);
  // verify-wiki-consistency §9（叙事计数对账）的单源文件：缺则 fail-loud，故最小化提供
  write(path.join(dir, 'workflow', 'effective-policy.md'), '# Effective policy\n\npolicyVersion 1\n');
  write(path.join(dir, 'workflow', 'INDEX.md'), '# Workflow index\n\n## 活跃（0）\n\n## 档案计数（0）\n');
  return dir;
}

// verify 的 §9 需读 check-loop.mjs 源（脚本目录可由 FLOW_KIT_RUNTIME_SCRIPTS 注入，免复制整份引擎）
const VERIFY_ENV = { FLOW_KIT_RUNTIME_SCRIPTS: SCRIPTS };

// ---------- 1. loadWikiNames 单元行为 ----------

test('loadWikiNames: defaults when engine.json is missing', () => {
  const dir = makeTmp('flow-kit-wiki-names-');
  assert.deepEqual(loadWikiNames(dir), { ...WIKI_NAME_DEFAULTS });
});

test('loadWikiNames: defaults when engine.json is unparseable', () => {
  const dir = makeTmp('flow-kit-wiki-names-');
  write(path.join(dir, '.agents', 'config', 'engine.json'), '{ not json');
  assert.deepEqual(loadWikiNames(dir), { ...WIKI_NAME_DEFAULTS });
});

test('loadWikiNames: full options.wiki override', () => {
  const dir = makeTmp('flow-kit-wiki-names-');
  writeEngine(dir, { wiki: EN });
  assert.deepEqual(loadWikiNames(dir), { ...EN });
});

test('loadWikiNames: partial override merges with defaults', () => {
  const dir = makeTmp('flow-kit-wiki-names-');
  writeEngine(dir, { wiki: { maintenance: 'data-maintenance' } });
  assert.deepEqual(loadWikiNames(dir), { ...WIKI_NAME_DEFAULTS, maintenance: 'data-maintenance' });
});

test('loadWikiNames: non-string / empty values are ignored', () => {
  const dir = makeTmp('flow-kit-wiki-names-');
  writeEngine(dir, { wiki: { board: 42, maintenance: '', schemaBatch: null, dataFixBatch: ['x'] } });
  assert.deepEqual(loadWikiNames(dir), { ...WIKI_NAME_DEFAULTS });
});

// ---------- 2. 英文布局：脚本按 options.wiki 取名 ----------

test('english layout: gen-wiki-board writes the named board, never the Chinese default', () => {
  const dir = makeWikiProject(EN, {
    topic: EN_TOPIC,
    maintenanceReadme: '# Data maintenance ledger\n\n| dir | purpose |\n|---|---|\n| `schema-changes/` | DDL batches |\n| `data-fixes/` | DML repairs |\n',
  });
  writeEngine(dir, { wiki: EN });

  const gen = runScript('gen-wiki-board.mjs', [], dir);
  assert.equal(gen.status, 0, `gen exit ${gen.status}\n${gen.stdout}\n${gen.stderr}`);
  const board = fs.readFileSync(path.join(dir, 'wiki', EN.board), 'utf8');
  assert.match(board, /"name": "data-maintenance"/);
  assert.ok(!fs.existsSync(path.join(dir, 'wiki', '知识沉淀总览.html')), 'Chinese board file must not be created');

  const verify = runScript('verify-wiki-consistency.mjs', [], dir, VERIFY_ENV);
  assert.equal(verify.status, 0, `verify exit ${verify.status}\n${verify.stdout}\n${verify.stderr}`);
  assert.ok(verify.stdout.includes('data-maintenance台账登记完整'), verify.stdout);
});

test('english layout: kb-search -t finds the ledger README and not the board', () => {
  const dir = makeWikiProject(EN, {
    topic: EN_TOPIC,
    maintenanceReadme: '# Data maintenance ledger\n\nBatch rows below.\n',
  });
  writeEngine(dir, { wiki: EN });
  write(path.join(dir, '.agents', 'config', 'workflow-modules.txt'), '');

  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'kb-search.mjs'), '-t', EN.maintenance, '--no-telemetry', 'ledger'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: dir },
  });
  assert.equal(r.status, 0, `kb-search exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.ok(r.stdout.includes(`wiki/${EN.maintenance}/README.md`), r.stdout);
  assert.ok(!r.stdout.includes(EN.board), r.stdout);
});

test('english layout: check-lane-surface recognises an english batch dir as a batch path', () => {
  const dir = makeWikiProject(EN, {
    topic: EN_TOPIC,
    maintenanceReadme: '# Data maintenance ledger\n\n| `schema-changes/` |\n| `001` |\n',
    batchSql: 'ALTER TABLE dbo.T ADD C INT;\n',
  });
  writeEngine(dir, { wiki: EN });
  write(path.join(dir, '.agents', 'config', 'lane-surfaces.txt'), '## product\n^wiki/.*\\.sql$\n');
  // 入口正文只写批次目录（不含文件名）——正是 BATCH_DIR 的罩住语义
  write(path.join(dir, 'workflow', 'intents', '2026-01-01-wiki-batch.md'),
    '---\n级别: L2\n状态: draft\n日期: 2026-01-01\n---\n\n## 目标\n\nSweep wiki/data-maintenance/schema-changes/001\n');
  const staged = path.join(dir, 'staged.txt');
  write(staged, 'wiki/data-maintenance/schema-changes/001/01-x.sql\n');

  const r = runScript('check-lane-surface.mjs', ['--root', dir, '--branch', 'main', '--staged-file', staged], dir);
  assert.equal(r.status, 0, `lane-surface exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.ok(!r.stderr.includes('产品契约面无活跃入口'), r.stderr);
});

test('english layout: check-schema-residue default --base names the english batch path', () => {
  const dir = makeTmp('flow-kit-wiki-names-');
  writeEngine(dir, { wiki: EN });

  const r = runScript('check-schema-residue.mjs', ['--conn', 'Server=x;Database=y;User Id=u;Password=p;'], dir);
  assert.equal(r.status, 2, `schema-residue exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.ok(r.stderr.includes('wiki/data-maintenance/schema-changes'), r.stderr);
});

// ---------- 3. 无 options.wiki 的中文布局：行为不变 ----------

test('chinese layout without options.wiki: gen + verify keep the Chinese board and ledger', () => {
  const names = WIKI_NAME_DEFAULTS;
  const dir = makeWikiProject(names, {
    topic: '产品需求',
    maintenanceReadme: '# 数据维护台账\n\n| 目录 | 用途 |\n|---|---|\n| `schema变更/` | DDL |\n',
  });
  writeEngine(dir, { language: 'zh-CN' });

  const gen = runScript('gen-wiki-board.mjs', [], dir);
  assert.equal(gen.status, 0, `gen exit ${gen.status}\n${gen.stdout}\n${gen.stderr}`);
  assert.match(fs.readFileSync(path.join(dir, 'wiki', names.board), 'utf8'), /"name": "数据维护"/);
  assert.ok(!fs.existsSync(path.join(dir, 'wiki', EN.board)));

  const verify = runScript('verify-wiki-consistency.mjs', [], dir, VERIFY_ENV);
  assert.equal(verify.status, 0, `verify exit ${verify.status}\n${verify.stdout}\n${verify.stderr}`);
});

test('chinese layout without options.wiki: check-schema-residue default --base stays Chinese', () => {
  const names = WIKI_NAME_DEFAULTS;
  const dir = makeWikiProject(names, {
    topic: '产品需求',
    maintenanceReadme: '# 数据维护台账\n\n| 目录 | 用途 |\n|---|---|\n| `schema变更/` | DDL |\n',
  });
  writeEngine(dir, { language: 'zh-CN' });

  const r = runScript('check-schema-residue.mjs', ['--conn', 'Server=x;Database=y;User Id=u;Password=p;'], dir);
  assert.equal(r.status, 2, `schema-residue exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.ok(r.stderr.includes('wiki/数据维护/schema变更'), r.stderr);
});
