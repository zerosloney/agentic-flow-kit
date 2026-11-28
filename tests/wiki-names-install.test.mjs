// wiki-names-install.test.mjs — 安装期 wiki 协议名：英文安装落英文路径并写 engine.json options.wiki，
// 中文安装保持模板中文路径且不写该键；dotnet 画像的 data 面随语言；引擎脚本在英文布局上跑通。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { WIKI_NAMES, localizePath, wikiProtocolNames } from '../src/install/wiki-names.mjs';
import { WIKI_NAME_DEFAULTS } from '../templates/engine/.agents/scripts/wiki-names.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-wiki-names-install-');
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

const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

function install(dir, stack, lang) {
  const r = run(['install', '--agent', 'trae', '--stack', stack, '--lang', lang, '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
}

test('en install uses English wiki paths and records protocol names', () => {
  const dir = tmpRepo();
  install(dir, 'node', 'en');

  for (const rel of [
    'wiki/requirements/.gitkeep',
    'wiki/designs/.gitkeep',
    'wiki/test-reports/.gitkeep',
    'wiki/features/.gitkeep',
    'wiki/conventions/.gitkeep',
    'wiki/data-maintenance/README.md',
    'wiki/knowledge-overview.html',
    'wiki/INDEX.md',
    'wiki/drafts-archive/README.md',
  ]) {
    assert.ok(exists(dir, rel), `missing ${rel}`);
  }
  for (const rel of ['wiki/产品需求', 'wiki/开发方案', 'wiki/测试报告', 'wiki/用户功能', 'wiki/项目规范', 'wiki/数据维护', 'wiki/知识沉淀总览.html']) {
    assert.equal(exists(dir, rel), false, `Chinese path must not exist: ${rel}`);
  }

  const engine = JSON.parse(read(dir, '.agents/config/engine.json'));
  assert.deepEqual(engine.options.wiki, wikiProtocolNames('en'));

  const index = read(dir, 'wiki/INDEX.md');
  assert.ok(index.includes('wiki/data-maintenance/'), 'INDEX must reference the English topic path');
  assert.ok(index.includes('knowledge-overview.html'), 'INDEX must reference the English board file');

  const diff = run(['diff', '--target', '.', '--json'], dir);
  assert.equal(diff.status, 0, diff.stderr);
  const summary = JSON.parse(diff.stdout).summary;
  for (const key of ['missing', 'kitUpdated', 'userModified', 'orphan']) {
    assert.equal(summary[key], 0, `diff ${key}: ${JSON.stringify(summary)}`);
  }
});

test('en install runs wiki verification and board generation on the English layout', () => {
  const dir = tmpRepo();
  install(dir, 'node', 'en');

  const verify = run(['run', 'verify-wiki-consistency.mjs'], dir);
  assert.equal(verify.status, 0, `${verify.stdout}\n${verify.stderr}`);

  const gen = run(['run', 'gen-wiki-board.mjs'], dir);
  assert.equal(gen.status, 0, `${gen.stdout}\n${gen.stderr}`);
  assert.ok(exists(dir, 'wiki/knowledge-overview.html'));
  assert.equal(exists(dir, 'wiki/知识沉淀总览.html'), false, 'gen must not create a Chinese board file');
});

// issue #89：wiki/_memory 是生成区——不参与主题登记，INDEX/看板不登记它时 verify 仍绿，
// gen 重生成也不把它算进文件/主题计数、不产生速览表行。
test('generated area wiki/_memory is exempt from topic registration', () => {
  const dir = tmpRepo();
  install(dir, 'node', 'zh-CN');

  // 基线：安装态先跑一次 gen，拿到不含生成区的稳定计数
  const base = run(['run', 'gen-wiki-board.mjs'], dir);
  assert.equal(base.status, 0, `${base.stdout}\n${base.stderr}`);
  const counts = base.stdout.match(/文件 (\d+) 份 \/ 主题 (\d+) 个/);
  assert.ok(counts, base.stdout);

  fs.mkdirSync(path.join(dir, 'wiki', '_memory'), { recursive: true });
  for (const name of ['INDEX.md', 'incidents.md', 'papercuts.md']) {
    fs.writeFileSync(path.join(dir, 'wiki', '_memory', name), `# ${name}\n`, 'utf8');
  }

  // 生成页存在但 INDEX/看板未登记：修复前此处必红（磁盘多出第 N 个主题 + 合计不符）
  const verifyBefore = run(['run', 'verify-wiki-consistency.mjs'], dir);
  assert.equal(verifyBefore.status, 0, `${verifyBefore.stdout}\n${verifyBefore.stderr}`);
  assert.match(verifyBefore.stdout, new RegExp(`文件 ${counts[1]} 份 / 主题 ${counts[2]} 个`));

  const gen = run(['run', 'gen-wiki-board.mjs'], dir);
  assert.equal(gen.status, 0, `${gen.stdout}\n${gen.stderr}`);
  assert.ok(gen.stdout.includes(`文件 ${counts[1]} 份 / 主题 ${counts[2]} 个`), gen.stdout);
  assert.equal(gen.stdout.includes('_memory'), false, gen.stdout);

  assert.equal(read(dir, 'wiki/INDEX.md').includes('| _memory |'), false, 'INDEX 速览表不得出现生成区行');
  const boardData = JSON.parse(read(dir, 'wiki/知识沉淀总览.html').match(/const DATA = (\{[\s\S]*?\n\});/)[1]);
  assert.equal(boardData.topics.some((t) => t.name === '_memory'), false);
  assert.equal(boardData.summary.files, Number(counts[1]));
  assert.equal(boardData.summary.topics, Number(counts[2]));

  const verifyAfter = run(['run', 'verify-wiki-consistency.mjs'], dir);
  assert.equal(verifyAfter.status, 0, `${verifyAfter.stdout}\n${verifyAfter.stderr}`);
});

test('zh-CN install keeps Chinese wiki paths and writes no options.wiki', () => {
  const dir = tmpRepo();
  install(dir, 'node', 'zh-CN');

  for (const rel of ['wiki/产品需求/.gitkeep', 'wiki/数据维护/README.md', 'wiki/知识沉淀总览.html', 'wiki/INDEX.md']) {
    assert.ok(exists(dir, rel), `missing ${rel}`);
  }
  assert.equal(exists(dir, 'wiki/requirements'), false);

  const raw = read(dir, '.agents/config/engine.json');
  const engine = JSON.parse(raw);
  assert.equal('wiki' in engine.options, false);
  assert.equal(raw.includes('"wiki"'), false, 'Chinese install must not write the wiki key');

  // dotnet 画像 data 面：中文安装渲染为模板原文。
  const dotnet = tmpRepo();
  install(dotnet, 'dotnet', 'zh-CN');
  assert.deepEqual(JSON.parse(read(dotnet, '.agents/config/project-faces.json')).data, ['wiki/数据维护/']);
});

test('en dotnet install translates the data face and passes rules validate', () => {
  const dir = tmpRepo();
  install(dir, 'dotnet', 'en');

  assert.deepEqual(JSON.parse(read(dir, '.agents/config/project-faces.json')).data, ['wiki/data-maintenance/']);

  const validate = run(['rules', 'validate', '--target', '.'], dir);
  assert.equal(validate.status, 0, `${validate.stdout}\n${validate.stderr}`);
});

test('localizePath translates only the wiki topic segment', () => {
  assert.equal(localizePath('wiki/数据维护/README.md', 'zh-CN'), 'wiki/数据维护/README.md');
  assert.equal(localizePath('wiki/数据维护/schema变更/001/a.md', 'en'), 'wiki/data-maintenance/schema变更/001/a.md');
  assert.equal(localizePath('wiki/产品需求/.gitkeep', 'en'), 'wiki/requirements/.gitkeep');
  assert.equal(localizePath('wiki/知识沉淀总览.html', 'en'), 'wiki/knowledge-overview.html');
  assert.equal(localizePath('wiki/INDEX.md', 'en'), 'wiki/INDEX.md');
  assert.equal(localizePath('docs/wiki/数据维护/README.md', 'en'), 'docs/wiki/数据维护/README.md');
  assert.equal(localizePath('wiki/数据维护/README.md', 'fr'), 'wiki/数据维护/README.md');
});

test('zh-CN names stay in sync with the engine WIKI_NAME_DEFAULTS', () => {
  const zh = (key) => WIKI_NAMES[key]['zh-CN'];
  assert.deepEqual(
    {
      board: zh('board'),
      maintenance: zh('maintenance'),
      schemaBatch: zh('schemaBatch'),
      dataFixBatch: zh('dataFixBatch'),
    },
    WIKI_NAME_DEFAULTS,
  );
});
