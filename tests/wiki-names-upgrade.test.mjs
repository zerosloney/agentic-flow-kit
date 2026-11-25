// wiki-names-upgrade.test.mjs — 旧版英文安装（manifest 记 en、脚手架却是中文路径）被新 kit 升级后的残留观测：
// applyPlan 不删除旧文件 → 旧命名的 kit 文件成孤儿；prune 只删未改动的孤儿；用户文档原样保留；
// doctor 用 wiki dir names advisory 报出另一种语言的遗留目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

// 旧 kit 的中文脚手架（manifest 记 en 时即成为孤儿）与新 kit 的英文脚手架。
const OLD_FILES = [
  'wiki/产品需求/.gitkeep',
  'wiki/开发方案/.gitkeep',
  'wiki/测试报告/.gitkeep',
  'wiki/用户功能/.gitkeep',
  'wiki/项目规范/.gitkeep',
  'wiki/数据维护/README.md',
  'wiki/知识沉淀总览.html',
];
const NEW_FILES = [
  'wiki/requirements/.gitkeep',
  'wiki/designs/.gitkeep',
  'wiki/test-reports/.gitkeep',
  'wiki/features/.gitkeep',
  'wiki/conventions/.gitkeep',
  'wiki/data-maintenance/README.md',
  'wiki/knowledge-overview.html',
];
const USER_DOC = 'wiki/产品需求/REQ-1.md';

function tmpRepo() {
  const dir = makeTmp('flow-kit-wiki-upgrade-');
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

function readJson(dir, rel) {
  return JSON.parse(read(dir, rel));
}

function writeJson(dir, rel, value) {
  fs.writeFileSync(path.join(dir, rel), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// 模拟旧版英文安装：中文脚手架落盘后，把 manifest 的 language 改成 en（旧 kit 的真实记录），
// 再走新 kit 的 upgrade —— 新 kit 按 en 渲染英文路径，旧中文文件留在磁盘上成为孤儿。
function simulateOldEnglishInstall(dir) {
  const r = run(['install', '--agent', 'trae', '--stack', 'node', '--lang', 'zh-CN', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  fs.writeFileSync(path.join(dir, USER_DOC), '# REQ-1\n', 'utf8');
  const manifest = readJson(dir, '.agents/install-manifest.json');
  manifest.language = 'en';
  writeJson(dir, '.agents/install-manifest.json', manifest);
  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
}

function doctorDoc(dir) {
  const r = run(['doctor', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function wikiRow(doc) {
  return doc.checks.find((c) => c.name === 'wiki dir names');
}

test('upgrading an old English install leaves the Chinese paths as orphans and installs the English scaffold', () => {
  const dir = tmpRepo();
  simulateOldEnglishInstall(dir);

  for (const rel of NEW_FILES) assert.ok(exists(dir, rel), `missing new scaffold ${rel}`);
  for (const rel of OLD_FILES) assert.ok(exists(dir, rel), `installer must not delete old file ${rel}`);
  assert.equal(readJson(dir, '.agents/config/engine.json').options.wiki.maintenance, 'data-maintenance');

  const r = run(['diff', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const diff = JSON.parse(r.stdout);
  const orphans = diff.items.filter((i) => i.kind === 'orphan').map((i) => i.targetRel).sort();
  assert.deepEqual(orphans, [...OLD_FILES].sort());
  assert.equal(diff.summary.missing, 0);
});

test('prune keeps a user-modified old kit file and the doctor row still names its directory', () => {
  const dir = tmpRepo();
  simulateOldEnglishInstall(dir);
  fs.appendFileSync(path.join(dir, 'wiki/数据维护/README.md'), '\nuser edit\n', 'utf8');

  const r = run(['prune', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const pruned = JSON.parse(r.stdout);
  assert.equal(pruned.deleted, 6);
  assert.equal(pruned.skipped, 1);
  for (const rel of OLD_FILES.slice(0, 5)) assert.equal(exists(dir, rel), false, `${rel} should be pruned`);
  assert.equal(exists(dir, 'wiki/知识沉淀总览.html'), false);
  assert.ok(exists(dir, 'wiki/数据维护/README.md'), 'user-modified orphan must be kept');
  assert.equal(read(dir, USER_DOC), '# REQ-1\n', 'user document must stay untouched');

  const row = wikiRow(doctorDoc(dir));
  assert.ok(row, 'doctor must report the leftover wiki directories');
  assert.equal(row.warn, true);
  assert.match(row.detail, /wiki\/产品需求\//);
  assert.match(row.detail, /wiki\/数据维护\//);
});

test('prune of pristine old kit files leaves only the directory holding the user document', () => {
  const dir = tmpRepo();
  simulateOldEnglishInstall(dir);

  const r = run(['prune', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).deleted, 7);
  for (const rel of ['wiki/开发方案', 'wiki/测试报告', 'wiki/用户功能', 'wiki/项目规范', 'wiki/数据维护']) {
    assert.equal(fs.existsSync(path.join(dir, rel)), false, `${rel}/ should be removed once empty`);
  }
  assert.ok(exists(dir, USER_DOC), 'user document must stay untouched');

  const row = wikiRow(doctorDoc(dir));
  assert.ok(row, 'doctor must report the remaining old-named directory');
  assert.equal(row.warn, true);
  assert.match(row.detail, /wiki\/产品需求\//);
  assert.doesNotMatch(row.detail, /wiki\/数据维护\//);
});

test('fresh installs in either language have no wiki dir names row', () => {
  for (const lang of ['en', 'zh-CN']) {
    const dir = tmpRepo();
    const install = run(['install', '--agent', 'trae', '--stack', 'node', '--lang', lang, '--target', '.'], dir);
    assert.equal(install.status, 0, install.stderr);
    const doctor = run(['doctor', '--target', '.', '--json', '--lang', lang], dir);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(wikiRow(JSON.parse(doctor.stdout)), undefined, `fresh ${lang} install must not warn about wiki dir names`);
  }
});
