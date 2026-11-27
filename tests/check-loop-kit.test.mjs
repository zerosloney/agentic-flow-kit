// check-loop-kit：git 路径清单的 core.quotepath 回归钉子。
// 背景（2026-11-26 审计 E8a）：git 默认对非 ASCII 路径做 C 引号化
// （"workflow/intents/2026-11-20-\344\270\255..."），check-loop-kit 的 ls-tree / diff / ls-files /
// log --name-only 未关 quotepath——isTracked、changedDocSet、addedDateOf 全部漏掉中文名文档，
// s01/s03x/s08/s15/s23 硬门静默跳过、exit 0。默认安装语言是 zh-CN，引擎命名规范本身就是
// `YYYY-MM-DD-<中文主题>`，故这不是边角输入。
// 夹具显式把仓内 core.quotepath 钉成 true（git 文档默认值；防宿主全局设为 false 掩盖回归）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(KIT, 'templates', 'engine', '.agents', 'scripts');
const CHECK_LOOP = path.join(SCRIPTS, 'check-loop.mjs');
const ENUMS_SRC = path.join(KIT, 'templates', 'engine', '.agents', 'config', 'workflow-enums.txt');

const CN_DOC = '2026-11-20-中文名称.md';
const ASCII_DOC = '2026-11-20-ascii-name.md';

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

// 写一份 L3 intent：状态 draft → s01「L3 状态未确认」硬阻断。suffix 用于制造工作区改动。
function writeIntent(dir, name, suffix = '') {
  const file = path.join(dir, 'workflow', 'intents', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\n状态: draft\n级别: L3\n---\n\n# intent${suffix}\n`);
  return file;
}

function makeRepo(name) {
  const dir = makeTmp('flow-kit-check-loop-kit-');
  fs.mkdirSync(path.join(dir, '.agents', 'config'), { recursive: true });
  fs.copyFileSync(ENUMS_SRC, path.join(dir, '.agents', 'config', 'workflow-enums.txt'));
  writeIntent(dir, name);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'core.quotepath', 'true']);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init']);
  return dir;
}

function runLoop(dir, { full = false } = {}) {
  return spawnSync(process.execPath, [CHECK_LOOP], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      FLOW_KIT_TEST: '1',
      FLOW_KIT_RUNTIME_SCRIPTS: SCRIPTS,
      CHECK_LOOP_VERBOSE: '1',
      CHECK_LOOP_ROOT: '',
      CHECK_LOOP_FULL: full ? '1' : '',
    },
  });
}

test('full scan blocks a committed Chinese-named L3 draft intent', () => {
  const dir = makeRepo(CN_DOC);
  const r = runLoop(dir, { full: true });
  assert.equal(r.status, 1, `中文名文档被全量扫描漏掉：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /\[状态未确认\]/);
  assert.ok(r.stderr.includes(CN_DOC), r.stderr);
});

test('incremental scan sees an edited Chinese-named intent', () => {
  const dir = makeRepo(CN_DOC);
  assert.equal(runLoop(dir).status, 0, '干净工作区不应有本轮变更触及的门');
  writeIntent(dir, CN_DOC, ' (edited)');
  const r = runLoop(dir);
  assert.equal(r.status, 1, `中文名文档的改动未被增量面看到：\n${r.stdout}${r.stderr}`);
  assert.ok(r.stderr.includes(CN_DOC), r.stderr);
});

test('ASCII control: the same gate blocks full and incremental scans', () => {
  const dir = makeRepo(ASCII_DOC);
  const full = runLoop(dir, { full: true });
  assert.equal(full.status, 1, full.stderr);
  writeIntent(dir, ASCII_DOC, ' (edited)');
  const inc = runLoop(dir);
  assert.equal(inc.status, 1, inc.stderr);
});

test('addedDateOf dates a Chinese-named doc from git history', async () => {
  const dir = makeRepo(CN_DOC);
  const prev = process.env.CHECK_LOOP_ROOT;
  process.env.CHECK_LOOP_ROOT = dir;
  try {
    // 动态 import：check-loop-kit 在 import 期按 CHECK_LOOP_ROOT 构建 ROOT 与 added-dates 索引。
    const kit = await import('../templates/engine/.agents/scripts/check-loop-kit.mjs');
    const file = path.join(dir, 'workflow', 'intents', CN_DOC);
    assert.match(kit.addedDateOf(file), /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    if (prev === undefined) delete process.env.CHECK_LOOP_ROOT;
    else process.env.CHECK_LOOP_ROOT = prev;
  }
});
