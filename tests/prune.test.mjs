import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../src/cli/exit.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-prune-');
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

function install(dir, lang = 'zh-CN') {
  const r = run(['install', '--agent', 'trae', '--lang', lang, '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  return r;
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function readManifest(dir) {
  return JSON.parse(read(dir, '.agents/install-manifest.json'));
}

function writeManifest(dir, value) {
  fs.writeFileSync(
    path.join(dir, '.agents/install-manifest.json'),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function seedLock(dir, info) {
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'install.lock'), JSON.stringify(info), 'utf8');
}

function sha(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// 制造一个“manifest 有、当前模板没有”的孤儿文件。
function addOrphan(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  const manifest = readManifest(dir);
  manifest.files[rel] = sha(content);
  writeManifest(dir, manifest);
  return abs;
}

test('prune deletes clean orphans, cleans empty dirs and updates the manifest', () => {
  const dir = tmpRepo();
  install(dir);
  addOrphan(dir, 'legacy/old.md', 'old\n');
  const manifest = readManifest(dir);
  manifest.derived = ['legacy/old.md'];
  writeManifest(dir, manifest);

  const r = run(['prune', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /删除 legacy\/old\.md/);
  assert.equal(fs.existsSync(path.join(dir, 'legacy/old.md')), false);
  assert.equal(fs.existsSync(path.join(dir, 'legacy')), false);
  const next = readManifest(dir);
  assert.equal('legacy/old.md' in next.files, false);
  assert.deepEqual(next.derived, []);
  assert.equal(typeof next.files['.agents/commands/new-task.md'], 'string');
  assert.deepEqual(next.hosts, ['trae']);
  assert.equal(next.stack, 'node');

  const again = run(['prune', '--target', '.'], dir);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /没有孤儿文件/);
  assert.match(again.stdout, /删除 0 \/ 清理记录 0 \/ 跳过 0/);
});

test('prune skips user-modified orphans unless --force is given', () => {
  const dir = tmpRepo();
  install(dir);
  const abs = addOrphan(dir, 'legacy/edit.md', 'original\n');
  fs.appendFileSync(abs, 'user edit\n', 'utf8');

  const r = run(['prune', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /跳过 legacy\/edit\.md/);
  assert.equal(fs.existsSync(abs), true);
  assert.equal('legacy/edit.md' in readManifest(dir).files, true);

  const again = run(['prune', '--target', '.'], dir);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /跳过 legacy\/edit\.md/);

  const forced = run(['prune', '--target', '.', '--force'], dir);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /删除 legacy\/edit\.md/);
  assert.equal(fs.existsSync(abs), false);
  assert.equal('legacy/edit.md' in readManifest(dir).files, false);
});

test('prune removes manifest records for files that are already gone', () => {
  const dir = tmpRepo();
  install(dir);
  const manifest = readManifest(dir);
  manifest.files['legacy/gone.md'] = '0'.repeat(64);
  writeManifest(dir, manifest);

  const r = run(['prune', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /移除 manifest 记录 legacy\/gone\.md/);
  assert.equal('legacy/gone.md' in readManifest(dir).files, false);
  assert.match(r.stdout, /删除 0 \/ 清理记录 1 \/ 跳过 0/);
});

test('prune --dry-run writes nothing', () => {
  const dir = tmpRepo();
  install(dir);
  const abs = addOrphan(dir, 'legacy/dry.md', 'dry\n');
  const before = readManifest(dir);

  const r = run(['prune', '--target', '.', '--dry-run'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry-run/);
  assert.match(r.stdout, /删除 legacy\/dry\.md/);
  assert.equal(fs.existsSync(abs), true);
  assert.deepEqual(readManifest(dir), before);
});

test('prune keeps non-empty parent directories', () => {
  const dir = tmpRepo();
  install(dir);
  addOrphan(dir, 'legacy/old.md', 'old\n');
  fs.writeFileSync(path.join(dir, 'legacy/keep.txt'), 'keep\n', 'utf8');

  const r = run(['prune', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'legacy/old.md')), false);
  assert.equal(fs.existsSync(path.join(dir, 'legacy/keep.txt')), true);
});

test('prune without a manifest exits 3', () => {
  const dir = tmpRepo();
  const r = run(['prune', '--target', '.'], dir);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /install/);
});

test('prune output is localized in English', () => {
  const dir = tmpRepo();
  install(dir, 'en');
  addOrphan(dir, 'legacy/old.md', 'old\n');
  const r = run(['prune', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Prune orphaned files:/);
  assert.match(r.stdout, /delete legacy\/old\.md/);
  assert.match(r.stdout, /Done: deleted 1/);
});

// 安装锁：prune 删孤儿文件并改写 manifest，必须与并发安装互斥。
test('fresh install lock blocks prune and leaves the manifest untouched', () => {
  const dir = tmpRepo();
  install(dir);
  const abs = addOrphan(dir, 'legacy/locked.md', 'locked\n');
  const before = readManifest(dir);
  seedLock(dir, { pid: 432102, ts: Date.now(), command: 'install' });

  const r = run(['prune', '--target', '.'], dir);
  assert.equal(r.status, EXIT.LOCK, `lock conflict must exit ${EXIT.LOCK}: ${r.stdout} ${r.stderr}`);
  assert.deepEqual(readManifest(dir), before);
  assert.equal(fs.existsSync(abs), true, 'blocked run must not delete orphan files');
  assert.equal(fs.existsSync(path.join(dir, '.agents/install.lock')), true, 'fresh lock must not be removed by the blocked run');
});

// manifest 可被篡改：解析到 target 之外的 key 绝不能变成删除指令。
test('prune refuses manifest keys that resolve outside the target', () => {
  const dir = tmpRepo();
  install(dir);
  const baseManifest = readManifest(dir);
  const base = path.basename(dir);
  const cases = [
    { rel: `../${base}-victim.txt`, victim: true },
    { rel: `../${base}-evil.txt`, victim: true },
    { rel: path.join(os.tmpdir(), 'flow-kit-prune-absolute-victim.txt'), victim: false },
    { rel: '\\\\server\\share\\flow-kit-prune-victim.txt', victim: false },
  ];

  for (const { rel, victim } of cases) {
    const abs = path.resolve(dir, rel);
    if (victim) fs.writeFileSync(abs, 'keep\n', 'utf8');
    writeManifest(dir, { ...baseManifest, files: { ...baseManifest.files, [rel]: sha('keep\n') } });

    const r = run(['prune', '--target', '.'], dir);
    assert.equal(r.status, EXIT.TARGET, `${rel}: ${r.stderr}`);
    assert.ok(r.stderr.includes(rel), `${rel} must be named in the error: ${r.stderr}`);
    if (victim) {
      assert.equal(fs.readFileSync(abs, 'utf8'), 'keep\n', `${rel} must not be deleted`);
      fs.rmSync(abs, { force: true });
    }
  }
});
