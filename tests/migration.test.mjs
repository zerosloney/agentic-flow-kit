import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readManifest, writeManifest } from '../src/install/manifest.mjs';
import { loadMigrations, migrateManifest, cleanupMigratedFiles } from '../src/install/migrations.mjs';
import crypto from 'node:crypto';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-migration-');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
  return dir;
}

function oldManifest() {
  return {
    kit: 'agentic-flow-kit',
    version: '2.1.0',
    language: 'zh-CN',
    hosts: ['claude'],
    stack: 'node',
    files: {},
  };
}

test('default migrations include the 0→1 schema initialization', async () => {
  const migrations = await loadMigrations();
  assert.equal(migrations.length >= 1, true);
  assert.deepEqual(
    migrations.slice(0, 1).map(({ from, to }) => [from, to]),
    [[0, 1]],
  );
});

test('migrateManifest upgrades an old manifest, is idempotent, and supports dry-run', async () => {
  const dir = tmpRepo();
  writeManifest(dir, oldManifest());
  const first = await migrateManifest({ target: dir, manifest: readManifest(dir) });
  assert.equal(first.changed, true);
  assert.deepEqual(first.applied, ['0-1', '1-2', '2-3']);
  assert.equal(readManifest(dir).schemaVersion, 3);

  const second = await migrateManifest({ target: dir, manifest: readManifest(dir) });
  assert.equal(second.changed, false);
  assert.deepEqual(second.applied, []);

  writeManifest(dir, oldManifest());
  const dry = await migrateManifest({ target: dir, manifest: readManifest(dir), dryRun: true });
  assert.equal(dry.changed, true);
  assert.equal(dry.dryRun, true);
  assert.equal(readManifest(dir).schemaVersion, undefined);
});

test('migration failures do not write the manifest', async () => {
  const dir = tmpRepo();
  writeManifest(dir, oldManifest());
  const before = fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8');
  const migrations = [{
    file: '0-1.mjs',
    from: 0,
    to: 1,
    migrate: () => { throw new Error('boom'); },
  }];
  await assert.rejects(
    () => migrateManifest({ target: dir, manifest: readManifest(dir), migrations }),
    (error) => error.code === 'MIGRATION_FAILED' && /boom/.test(error.message),
  );
  assert.equal(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8'), before);
});

test('a future manifest schema is rejected', async () => {
  const dir = tmpRepo();
  writeManifest(dir, { ...oldManifest(), schemaVersion: 99 });
  await assert.rejects(
    () => migrateManifest({ target: dir, manifest: readManifest(dir) }),
    (error) => error.code === 'MANIFEST_SCHEMA' && error.version === 99,
  );
});

test('upgrade migrates an old manifest without touching user files', () => {
  const dir = tmpRepo();
  const install = spawnSync(process.execPath, [BIN, 'install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(install.status, 0, install.stderr);
  fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'notes/user.txt'), 'keep me\n', 'utf8');

  const manifestFile = path.join(dir, '.agents/install-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  delete manifest.schemaVersion;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const dry = spawnSync(process.execPath, [BIN, 'upgrade', '--target', '.', '--dry-run', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(dry.status, 0, dry.stderr);
  const dryOut = JSON.parse(dry.stdout);
  assert.deepEqual(dryOut.migration.applied, ['0-1', '1-2', '2-3']);
  assert.equal(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).schemaVersion, undefined);

  const real = spawnSync(process.execPath, [BIN, 'upgrade', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(real.status, 0, real.stderr);
  assert.equal(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).schemaVersion, 3);
  assert.equal(fs.readFileSync(path.join(dir, 'notes/user.txt'), 'utf8'), 'keep me\n');

  const again = spawnSync(process.execPath, [BIN, 'upgrade', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).migration, undefined);
});

test('1→2 drops runtime files and deletes only unmodified copies', async () => {
  const dir = tmpRepo();
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, 'utf8');
  };
  write('.agents/scripts/drop.mjs', 'drop');
  write('.agents/scripts/modified.mjs', 'user changed');
  write('.agents/hooks/drop.cjs', 'hook');
  write('.agents/tests/x.test.mjs', 'test');
  write('.agents/hooks/gates.json', '{}');
  const files = {
    '.agents/scripts/drop.mjs': sha('drop'),
    '.agents/scripts/modified.mjs': sha('original'),
    '.agents/hooks/drop.cjs': sha('hook'),
    '.agents/tests/x.test.mjs': sha('test'),
    '.agents/hooks/gates.json': sha('{}'),
  };
  writeManifest(dir, { ...oldManifest(), schemaVersion: 1, files });

  const first = await migrateManifest({ target: dir, manifest: readManifest(dir) });
  assert.equal(first.manifest.schemaVersion, 3);
  assert.deepEqual(Object.keys(first.manifest.files).sort(), ['.agents/hooks/gates.json']);
  assert.deepEqual(first.removals.sort(), [
    '.agents/hooks/drop.cjs',
    '.agents/scripts/drop.mjs',
    '.agents/tests/x.test.mjs',
  ]);
  assert.deepEqual(first.keptLegacy, ['.agents/scripts/modified.mjs']);

  const cleanup = cleanupMigratedFiles({
    target: dir,
    files: first.previousFiles,
    removals: first.removals,
  });
  assert.deepEqual(cleanup.removed.sort(), first.removals);
  assert.deepEqual(cleanup.kept, []);
  for (const rel of first.removals) assert.equal(fs.existsSync(path.join(dir, rel)), false, rel);
  assert.equal(fs.existsSync(path.join(dir, '.agents/scripts/modified.mjs')), true);
  assert.equal(fs.existsSync(path.join(dir, '.agents/hooks/gates.json')), true);
});

// ---- P2-4：清理资格持久化（manifest.pendingRemovals）----
// schemaVersion 在迁移时就落盘，而清理排在安装末尾（user-hooks 接线之后）：中间任一环节
// 失败（如 ~/.codex/hooks.json 损坏触发 USER_HOOKS_CONFIG fail-loud）后，重跑迁移不再执行，
// removals 不再生成，旧运行时文件永久滞留。修复：迁移落盘时把待删文件连同旧基线哈希写进
// manifest.pendingRemovals；install/upgrade 末尾按哈希守卫消费后清空字段并回写。

test('migrateManifest persists pendingRemovals; dry-run and zero-change paths stay write-free', async () => {
  const dir = tmpRepo();
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, 'utf8');
  };
  write('.agents/scripts/drop.mjs', 'drop');
  write('.agents/scripts/modified.mjs', 'user changed');
  write('.agents/hooks/drop.cjs', 'hook');
  const files = {
    '.agents/scripts/drop.mjs': sha('drop'),
    '.agents/scripts/modified.mjs': sha('original'),
    '.agents/hooks/drop.cjs': sha('hook'),
  };
  writeManifest(dir, { ...oldManifest(), schemaVersion: 1, files });

  const first = await migrateManifest({ target: dir, manifest: readManifest(dir) });
  assert.equal(first.changed, true);
  // 落盘的清理资格 = 待删文件 + 旧基线哈希；被用户改过的文件不入册（守卫本就保留它）
  assert.deepEqual(readManifest(dir).pendingRemovals, {
    '.agents/scripts/drop.mjs': sha('drop'),
    '.agents/hooks/drop.cjs': sha('hook'),
  });

  // 零变更路径零额外写：重跑迁移不改 manifest 一个字节
  const manifestFile = path.join(dir, '.agents/install-manifest.json');
  const before = fs.readFileSync(manifestFile, 'utf8');
  const second = await migrateManifest({ target: dir, manifest: readManifest(dir) });
  assert.equal(second.changed, false);
  assert.equal(fs.readFileSync(manifestFile, 'utf8'), before);

  // 只读迁移（dry-run）不落盘：schemaVersion 与 pendingRemovals 均维持写入前的磁盘状态
  writeManifest(dir, { ...oldManifest(), schemaVersion: 1, files });
  const dry = await migrateManifest({ target: dir, manifest: readManifest(dir), dryRun: true });
  assert.equal(dry.changed, true);
  assert.equal(readManifest(dir).pendingRemovals, undefined);
  assert.equal(readManifest(dir).schemaVersion, 1);
});

test('upgrade consumes persisted pendingRemovals even when migration no longer runs', () => {
  const dir = tmpRepo();
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, 'utf8');
  };
  write('.agents/scripts/drop.mjs', 'drop');
  write('.agents/hooks/drop.cjs', 'hook');
  write('.agents/scripts/modified.mjs', 'user changed');
  // 状态注入：迁移已落盘（schemaVersion 最新）但清理未发生——pendingRemovals 在案，旧文件仍在盘
  writeManifest(dir, {
    ...oldManifest(),
    schemaVersion: 2,
    files: {},
    pendingRemovals: {
      '.agents/scripts/drop.mjs': sha('drop'),
      '.agents/hooks/drop.cjs': sha('hook'),
      '.agents/scripts/modified.mjs': sha('original'), // 与磁盘内容不符 → 哈希守卫保留
    },
  });

  const r = spawnSync(process.execPath, [BIN, 'upgrade', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  // 哈希匹配的旧文件删除，被改文件保留，资格字段清空
  assert.equal(fs.existsSync(path.join(dir, '.agents/scripts/drop.mjs')), false);
  assert.equal(fs.existsSync(path.join(dir, '.agents/hooks/drop.cjs')), false);
  assert.equal(fs.existsSync(path.join(dir, '.agents/scripts/modified.mjs')), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8'));
  assert.equal(manifest.pendingRemovals, undefined);
  // --json 的 removed 与持久消费口径一致：上报实际删除结果
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.migration.removed.sort(), ['.agents/hooks/drop.cjs', '.agents/scripts/drop.mjs']);
  assert.deepEqual(out.migration.keptLegacy, ['.agents/scripts/modified.mjs']);

  // 幂等：资格已消费，重跑不再报 migration、字段不再出现
  const again = spawnSync(process.execPath, [BIN, 'upgrade', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).migration, undefined);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8')).pendingRemovals,
    undefined,
  );
});

test('upgrade interrupted between migration write and cleanup recovers on rerun', () => {
  const dir = tmpRepo();
  const home = makeTmp('flow-kit-home-');
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, 'utf8');
  };
  write('.agents/scripts/drop.mjs', 'drop');
  writeManifest(dir, {
    ...oldManifest(),
    schemaVersion: 1,
    hosts: ['codex'],
    files: { '.agents/scripts/drop.mjs': sha('drop') },
  });

  // 损坏的用户级 hooks 配置（假 HOME 手法同 codex-host.test.mjs）：upgrade 在迁移落盘之后、
  // 清理之前 fail-loud，制造「迁移已落盘但清理未发生」的真实缺口
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  const hooksFile = path.join(home, '.codex', 'hooks.json');
  fs.writeFileSync(hooksFile, '{ broken', 'utf8');
  const env = { ...process.env, FLOW_KIT_TEST: '1', HOME: home, USERPROFILE: home };
  const upgrade = () => spawnSync(process.execPath, [BIN, 'upgrade', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env,
  });

  const first = upgrade();
  assert.notEqual(first.status, 0, 'corrupt ~/.codex/hooks.json must fail loud');
  assert.equal(fs.existsSync(path.join(dir, '.agents/scripts/drop.mjs')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8')).pendingRemovals, {
    '.agents/scripts/drop.mjs': sha('drop'),
  });

  // 修复用户配置后重跑：迁移不再执行，但凭持久化资格完成清理
  fs.writeFileSync(hooksFile, '{}\n', 'utf8');
  const second = upgrade();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.agents/scripts/drop.mjs')), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8'));
  assert.equal(manifest.pendingRemovals, undefined);
  assert.deepEqual(JSON.parse(second.stdout).migration.removed, ['.agents/scripts/drop.mjs']);
});

// ---- 2→3：技能改名 shipyard-workflow-closeout → workflow-closeout（v2.11.0）----
// 旧 manifest 仍托管旧技能正文与宿主指针；迁移摘除条目并登记旧哈希，upgrade 末尾按哈希清理。

const OLD_SKILL_BODY = '.agents/skills/shipyard-workflow-closeout/SKILL.md';
const OLD_SKILL_POINTER = '.claude/skills/shipyard-workflow-closeout/SKILL.md';
const NEW_SKILL_BODY = '.agents/skills/workflow-closeout/SKILL.md';

function writeRel(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text, 'utf8');
}

test('2→3 drops renamed skill entries and persists their old hashes as pending removals', async () => {
  const dir = tmpRepo();
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  writeRel(dir, OLD_SKILL_BODY, 'old body');
  writeRel(dir, OLD_SKILL_POINTER, 'old pointer');
  writeRel(dir, NEW_SKILL_BODY, 'new body');
  const files = {
    [OLD_SKILL_BODY]: sha('old body'),
    [OLD_SKILL_POINTER]: sha('old pointer'),
    [NEW_SKILL_BODY]: sha('new body'),
    '.claude/settings.json': sha('{}'),
  };
  writeManifest(dir, { ...oldManifest(), schemaVersion: 2, files });

  const result = await migrateManifest({ target: dir, manifest: readManifest(dir) });
  assert.equal(result.changed, true);
  assert.deepEqual(result.applied, ['2-3']);

  const manifest = readManifest(dir);
  assert.equal(manifest.schemaVersion, 3);
  assert.deepEqual(Object.keys(manifest.files).sort(), [NEW_SKILL_BODY, '.claude/settings.json'].sort());
  assert.deepEqual(manifest.pendingRemovals, {
    [OLD_SKILL_BODY]: sha('old body'),
    [OLD_SKILL_POINTER]: sha('old pointer'),
  });
  // 迁移只动 manifest：磁盘旧文件仍在，等 upgrade 末尾按哈希守卫清理
  assert.equal(fs.existsSync(path.join(dir, OLD_SKILL_BODY)), true);
  assert.equal(fs.existsSync(path.join(dir, OLD_SKILL_POINTER)), true);
});

test('2→3 leaves manifests without the renamed skill untouched', async () => {
  const dir = tmpRepo();
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const files = {
    [NEW_SKILL_BODY]: sha('new body'),
    '.claude/settings.json': sha('{}'),
  };
  writeManifest(dir, { ...oldManifest(), schemaVersion: 2, files });

  const result = await migrateManifest({ target: dir, manifest: readManifest(dir) });
  assert.deepEqual(result.applied, ['2-3']);
  const manifest = readManifest(dir);
  assert.equal(manifest.schemaVersion, 3);
  assert.deepEqual(manifest.files, files);
  assert.equal(manifest.pendingRemovals, undefined);
});

test('migration merge keeps an earlier interrupted pendingRemovals instead of dropping it', async () => {
  const dir = tmpRepo();
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const leftoverRel = '.agents/scripts/legacy-runtime.mjs';
  writeRel(dir, OLD_SKILL_BODY, 'old body');
  const files = {
    [OLD_SKILL_BODY]: sha('old body'),
    '.claude/settings.json': sha('{}'),
  };
  // 上次 1→2 迁移已落盘但清理中断：资格残留、schemaVersion 已是 2。
  writeManifest(dir, {
    ...oldManifest(),
    schemaVersion: 2,
    files,
    pendingRemovals: { [leftoverRel]: sha('legacy') },
  });

  await migrateManifest({ target: dir, manifest: readManifest(dir) });
  const manifest = readManifest(dir);
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.pendingRemovals[leftoverRel], sha('legacy'));
  assert.equal(manifest.pendingRemovals[OLD_SKILL_BODY], sha('old body'));
});

test('upgrade 2→3 deletes unmodified renamed-skill files, keeps user edits, and dry-run writes nothing', () => {
  const dir = tmpRepo();
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  writeRel(dir, OLD_SKILL_BODY, 'old body');
  writeRel(dir, OLD_SKILL_POINTER, 'user edited pointer');
  const files = {
    [OLD_SKILL_BODY]: sha('old body'),
    [OLD_SKILL_POINTER]: sha('original pointer'),
  };
  writeManifest(dir, { ...oldManifest(), schemaVersion: 2, files });
  const manifestFile = path.join(dir, '.agents/install-manifest.json');

  const dry = spawnSync(process.execPath, [BIN, 'upgrade', '--target', '.', '--dry-run', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(fs.existsSync(path.join(dir, OLD_SKILL_BODY)), true);
  assert.equal(fs.existsSync(path.join(dir, OLD_SKILL_POINTER)), true);
  assert.equal(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).schemaVersion, 2);

  const real = spawnSync(process.execPath, [BIN, 'upgrade', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(real.status, 0, real.stderr);
  // 未改动的旧文件按旧哈希删除；用户改过的按哈希守卫保留
  assert.equal(fs.existsSync(path.join(dir, OLD_SKILL_BODY)), false);
  assert.equal(fs.existsSync(path.join(dir, OLD_SKILL_POINTER)), true);

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.pendingRemovals, undefined);
  assert.equal(Object.keys(manifest.files).some((rel) => rel.includes('shipyard-workflow-closeout')), false);
  const out = JSON.parse(real.stdout);
  assert.deepEqual(out.migration.applied, ['2-3']);
  assert.deepEqual(out.migration.removed, [OLD_SKILL_BODY]);
  assert.deepEqual(out.migration.keptLegacy, [OLD_SKILL_POINTER]);
});
