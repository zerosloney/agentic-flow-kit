import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../src/cli/exit.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-adopt-');
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

function install(dir, hosts, extra = []) {
  const agents = hosts.flatMap((host) => ['--agent', host]);
  const r = run(['install', ...agents, '--lang', 'zh-CN', '--stack', 'node', '--target', '.', ...extra], dir);
  assert.equal(r.status, 0, r.stderr);
  return r;
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function manifestOf(dir) {
  return JSON.parse(read(dir, '.agents/install-manifest.json'));
}

function json(r) {
  assert.equal(r.stdout.trim().startsWith('{'), true, `expected JSON, got: ${r.stdout.slice(0, 200)}`);
  return JSON.parse(r.stdout);
}

function seedLock(dir, info) {
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'install.lock'), JSON.stringify(info), 'utf8');
}

test('adopt reconstructs the manifest and leaves no drift', () => {
  const dir = tmpRepo();
  install(dir, ['claude', 'trae']);
  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));

  const r = run(['adopt', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.deepEqual(out.hosts, ['claude', 'trae']);
  assert.equal(out.language, 'zh-CN');
  assert.equal(out.stack, 'node');
  assert.ok(out.adopted.length > 0);
  assert.deepEqual(out.modified, []);
  assert.deepEqual(out.missing, []);
  assert.ok(out.derived.includes('workflow/INDEX.md'));
  assert.ok(out.manifest);

  const manifest = manifestOf(dir);
  assert.equal(Object.keys(manifest.files).length, out.adopted.length);
  assert.deepEqual(manifest.hosts, ['claude', 'trae']);
  assert.ok(manifest.derived.includes('workflow/INDEX.md'));

  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.total, diff.summary.unchanged);

  const upgrade = run(['upgrade', '--target', '.', '--json'], dir);
  assert.equal(upgrade.status, 0, upgrade.stderr);
  const after = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(after.summary.userModified, 0);
  assert.equal(after.summary.kitUpdated, 0);
});

test('派生工件随装：引擎地图/生效策略/索引落盘即派生件，adopt 不漂移；--scaffold none 不造 workflow 面', () => {
  const full = tmpRepo();
  install(full, ['claude']);
  const mf = manifestOf(full);
  // 三份派生工件随装落盘，并按磁盘现状登记为 derived（静态模板不作预期值）
  for (const rel of ['.agents/notes/engine-map.md', 'workflow/INDEX.md', 'workflow/effective-policy.md']) {
    assert.ok(fs.existsSync(path.join(full, rel)), `${rel} 应随装落盘`);
    assert.ok(mf.derived.includes(rel), `${rel} 应登记为 derived`);
    assert.ok(rel in mf.files, `${rel} 应进 manifest 账本`);
  }
  // 生效策略随装即目标现场的生成视图（不是占位桩）
  assert.match(read(full, 'workflow/effective-policy.md'), /\| 锚键 \|/);

  // adopt：派生件按现状收录，不拿静态模板比对 → 不报漂移
  fs.rmSync(path.join(full, '.agents/install-manifest.json'));
  const out = json(run(['adopt', '--target', '.', '--json'], full));
  assert.deepEqual(out.modified, []);
  assert.ok(out.derived.includes('.agents/notes/engine-map.md'));
  assert.ok(out.derived.includes('workflow/effective-policy.md'));

  // --scaffold none：无脚手架即无 workflow 面，但引擎地图属声明面仍随装
  const none = tmpRepo();
  install(none, ['claude'], ['--scaffold', 'none']);
  assert.equal(fs.existsSync(path.join(none, 'workflow')), false, 'scaffold none 不应造出 workflow/ 目录');
  assert.ok(fs.existsSync(path.join(none, '.agents/notes/engine-map.md')), '引擎地图仍随装');
  const noneMf = manifestOf(none);
  assert.ok(noneMf.derived.includes('.agents/notes/engine-map.md'));
  assert.equal('workflow/effective-policy.md' in noneMf.files, false, 'scaffold none 不装 workflow 面产物');
});

test('旧版装户升级：装期生成的引擎地图被认领，不再永久假漂移', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  const rel = '.agents/notes/engine-map.md';
  // 模拟旧版 Kit 装户：该文件由旧版装期生成，不进 manifest（files/derived 均无记录），内容与当前静态模板不同。
  const mf = manifestOf(dir);
  delete mf.files[rel];
  mf.derived = mf.derived.filter((entry) => entry !== rel);
  fs.writeFileSync(path.join(dir, '.agents/install-manifest.json'), `${JSON.stringify(mf, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, rel), '# 旧版生成的引擎地图\n\n- 与静态模板不同的旧版内容\n', 'utf8');

  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /engine-map\.md（派生工件·整文件生成·首次认领：纳入跟踪，由生成器整文件重写/);
  assert.doesNotMatch(up.stdout, /engine-map\.md（已存在且非本工具安装/);
  const after = manifestOf(dir);
  assert.ok(rel in after.files, '认领后应进 manifest 账本');
  assert.ok(after.derived.includes(rel), '认领后应登记为 derived');

  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  const item = diff.items.find((entry) => entry.targetRel === rel);
  assert.ok(item, `missing diff item for ${rel}`);
  assert.equal(item.kind, 'unchanged');
  assert.equal(diff.summary.kitUpdated, 0);

  // 幂等：第二次升级文件已在账本里，不再走认领分支
  const again = run(['upgrade', '--target', '.'], dir);
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /纳入跟踪/);
});

test('旧版装户升级：workflow/INDEX.md 锚点外用户文本不得被占位模板覆盖', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  const rel = 'workflow/INDEX.md';
  // 模拟旧版装户：该 rel 不在 manifest（files/derived 均无），磁盘上是生成器写过的真实数据。
  const mf = manifestOf(dir);
  delete mf.files[rel];
  mf.derived = mf.derived.filter((entry) => entry !== rel);
  fs.writeFileSync(path.join(dir, '.agents/install-manifest.json'), `${JSON.stringify(mf, null, 2)}\n`, 'utf8');

  const full = read(dir, rel);
  const anchor = full.indexOf('<!-- GENERATED:BEGIN');
  assert.ok(anchor > 0, 'INDEX.md 必须含 GENERATED 锚点');
  const header = '# 我的工作流索引\n\n> 这一行是手工说明，升级必须保留。\n\n';
  fs.writeFileSync(path.join(dir, rel), header + full.slice(anchor), 'utf8');

  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  const after = read(dir, rel);
  assert.ok(after.startsWith(header), '锚点外用户文本必须原样保留');
  assert.doesNotMatch(after, /本文件为新装户占位/, '占位哨兵不得进入存量仓');
  assert.match(after, /GENERATED:BEGIN/);
  const mfAfter = manifestOf(dir);
  assert.ok(rel in mfAfter.files, '认领后应进 manifest 账本');
  assert.ok(mfAfter.derived.includes(rel), '认领后应登记为 derived');

  // 不再拿静态模板比对：diff 不得把「保留手工区」报成 kitUpdated 漂移。
  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  const item = diff.items.find((entry) => entry.targetRel === rel);
  assert.ok(item, `missing diff item for ${rel}`);
  assert.equal(item.kind, 'unchanged');
  assert.equal(diff.summary.kitUpdated, 0);

  // 幂等：第二次升级不再改动手工区
  const again = run(['upgrade', '--target', '.'], dir);
  assert.equal(again.status, 0, again.stderr);
  assert.ok(read(dir, rel).startsWith(header), '二次升级仍须保留手工区');
});

test('已入账的 workflow/INDEX.md 改过锚点外说明后升级：不报冲突、锚点内刷新、手改保留', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  const rel = 'workflow/INDEX.md';
  assert.ok(rel in manifestOf(dir).files, '前提：INDEX.md 已入账，不是首次认领');

  const full = read(dir, rel);
  const anchor = full.indexOf('<!-- GENERATED:BEGIN');
  assert.ok(anchor > 0, 'INDEX.md 必须含 GENERATED 锚点');
  const header = '# 我的索引\n\n> 手工说明，上次安装后写的。\n\n';
  fs.writeFileSync(path.join(dir, rel), header + full.slice(anchor), 'utf8');

  // 造一篇活跃文档：锚点内的索引过期，升级时须由生成器刷新。
  fs.mkdirSync(path.join(dir, 'workflow/intents'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'workflow/intents/2026-11-26-demo.md'),
    '---\n状态: draft\n级别: L2\n日期: 2026-11-26\n模块: engine\n---\n\n# INTENT — demo\n',
    'utf8',
  );

  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /workflow\/INDEX\.md（派生工件·锚区生成：保留锚点外原文，锚点内由生成器刷新）/);
  assert.doesNotMatch(up.stdout, /workflow\/INDEX\.md（整文件生成/);

  const after = read(dir, rel);
  assert.ok(after.startsWith(header), '锚点外手改必须保留');
  assert.match(after, /活跃（1）/, '锚点内必须由生成器刷新');

  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.userModified, 0);
});

test('健康新装户（生成区已有真实数据）：不得误报「锚点外原文被覆盖」', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  const rel = 'workflow/INDEX.md';
  // 提交一次：git HEAD 里就是新装户样板（健康态的典型现场）。
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--no-verify', '-m', 'init'], { cwd: dir });
  // 造一篇活跃文档：生成区有真实数据，锚点外仍是样板（与受损仓逐字节同形）。
  fs.mkdirSync(path.join(dir, 'workflow/intents'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'workflow/intents/2026-11-26-demo.md'),
    '---\n状态: draft\n级别: L2\n日期: 2026-11-26\n模块: engine\n---\n\n# INTENT — demo\n',
    'utf8',
  );

  // 升级后哈希与磁盘一致（kind=unchanged），提示不能依赖漂移计数。
  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.doesNotMatch(up.stdout, /疑似被旧版安装覆盖/, '健康新装户升级时不得误报');
  const diffJson = json(run(['diff', '--target', '.', '--json'], dir));
  const item = diffJson.items.find((entry) => entry.targetRel === rel);
  assert.ok(item, `missing diff item for ${rel}`);
  assert.equal(item.kind, 'unchanged');
  assert.equal(item.overwritten, undefined, '健康新装户不得被判成受损仓');

  const human = run(['diff', '--target', '.'], dir);
  assert.equal(human.status, 0, human.stderr);
  assert.doesNotMatch(human.stdout, /issue #86/);

  const doctor = run(['doctor', '--target', '.'], dir);
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.doesNotMatch(doctor.stdout, /派生工件锚点外原文疑似被覆盖/);
});

test('锚点外原文被旧版安装覆盖：有 git 证据时 diff 与 doctor 必须点名（issue #86）', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  const rel = 'workflow/INDEX.md';
  const full = read(dir, rel);
  const anchor = full.indexOf('<!-- GENERATED:BEGIN');
  const header = '# 我的索引\n\n> 手工说明，升级前写在这里。\n\n';
  fs.writeFileSync(path.join(dir, rel), header + full.slice(anchor), 'utf8');
  // 提交手工版：git HEAD 里留着用户原文（受损前的现场）。
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--no-verify', '-m', 'manual header'], { cwd: dir });
  // 模拟旧版安装把锚点外覆盖成模板样板（#86 的现场：锚点外只剩样板，生成区有真实数据）。
  const template = fs.readFileSync(path.join(KIT, 'templates/scaffold/workflow/INDEX.md'), 'utf8');
  fs.writeFileSync(path.join(dir, rel), template.slice(0, template.indexOf('<!-- GENERATED:BEGIN')) + full.slice(anchor), 'utf8');
  fs.mkdirSync(path.join(dir, 'workflow/intents'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'workflow/intents/2026-11-26-demo.md'),
    '---\n状态: draft\n级别: L2\n日期: 2026-11-26\n模块: engine\n---\n\n# INTENT — demo\n',
    'utf8',
  );

  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /锚点外原文疑似被旧版安装覆盖/);

  const diffJson = json(run(['diff', '--target', '.', '--json'], dir));
  const item = diffJson.items.find((entry) => entry.targetRel === rel);
  assert.ok(item, `missing diff item for ${rel}`);
  assert.ok(item.overwritten, 'diff JSON 必须携带 overwritten');

  const human = run(['diff', '--target', '.'], dir);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /issue #86/);

  const doctor = run(['doctor', '--target', '.'], dir);
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.match(doctor.stdout, /派生工件锚点外原文疑似被覆盖/);
  assert.match(doctor.stdout, /workflow\/INDEX\.md/);
});

test('--force 覆盖派生工件：显式丢弃锚点外用户文本并报出行数', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  const rel = 'workflow/INDEX.md';
  const full = read(dir, rel);
  const anchor = full.indexOf('<!-- GENERATED:BEGIN');
  fs.writeFileSync(path.join(dir, rel), '# 我的索引\n\n> 手工说明\n\n' + full.slice(anchor), 'utf8');

  const up = run(['upgrade', '--target', '.', '--force'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /--force 覆盖派生工件：已丢弃锚点外 2 行非生成内容/);
  const after = read(dir, rel);
  assert.doesNotMatch(after, /我的索引/);
  assert.match(after, /^# workflow 索引/);
});

test('整文件生成的派生工件：用户改过就保留原文并跳过重生成（不静默吃数据）', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  const rel = 'workflow/effective-policy.md';
  assert.ok(fs.existsSync(path.join(dir, rel)), '派生工件必须已装进目标');
  // 现场是「未提交」：install 产出的文件在 git init 的临时仓里全是未跟踪 → 覆盖后找不回。
  fs.appendFileSync(path.join(dir, rel), '\n<!-- MANUAL: 手工策略说明，勿删 -->\n', 'utf8');

  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /整文件生成：含未提交的非生成内容，已保留现状并跳过重生成/);
  assert.match(read(dir, rel), /MANUAL: 手工策略说明/, '用户手写内容必须存活');
});

test('--force 覆盖整文件生成的派生工件：报出整文件行数（不得谎报 0 行）', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  const rel = 'workflow/effective-policy.md';
  fs.appendFileSync(path.join(dir, rel), '\n<!-- MANUAL: 手工策略说明，勿删 -->\n', 'utf8');
  const lines = read(dir, rel).split(/\r?\n/).filter((line) => line.trim()).length;

  const up = run(['upgrade', '--target', '.', '--force'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, new RegExp(`--force 覆盖派生工件：已丢弃整文件 ${lines} 行非生成内容`));
});

test('非派生集合的未跟踪既有文件仍按原样跳过', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.agents/commands'), { recursive: true });
  const rel = '.agents/commands/new-task.md';
  fs.writeFileSync(path.join(dir, rel), '# 我自己的命令\n', 'utf8');

  const r = install(dir, ['claude']);
  assert.match(r.stdout, /new-task\.md（已存在且非本工具安装，跳过/);
  assert.equal(read(dir, rel), '# 我自己的命令\n', '外来源文件不得被覆盖');
});

test('adopt is idempotent', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));

  const first = json(run(['adopt', '--target', '.', '--json'], dir));
  const firstManifest = manifestOf(dir);
  const second = json(run(['adopt', '--target', '.', '--json'], dir));

  assert.deepEqual(second.adopted.sort(), first.adopted.sort());
  assert.deepEqual(second.modified, first.modified);
  assert.deepEqual(second.missing, first.missing);
  assert.deepEqual(manifestOf(dir), firstManifest);
});

test('adopt --dry-run writes nothing', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));

  const r = run(['adopt', '--target', '.', '--dry-run', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.ok(out.adopted.length > 0);
  assert.equal(out.manifest, null);
  assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false);
});

test('modified and missing files are reported but not adopted', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  fs.appendFileSync(path.join(dir, '.agents/commands/new-task.md'), '\nuser edit\n', 'utf8');
  fs.rmSync(path.join(dir, '.agents/commands/review.md'));
  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));

  const r = run(['adopt', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.ok(out.modified.some((item) => item.path === '.agents/commands/new-task.md'));
  assert.ok(out.missing.includes('.agents/commands/review.md'));

  const manifest = manifestOf(dir);
  assert.equal('.agents/commands/new-task.md' in manifest.files, false);
  assert.equal('.agents/commands/review.md' in manifest.files, false);
  assert.match(read(dir, '.agents/commands/new-task.md'), /user edit/);
});

test('unrecognized files are reported and left unmanaged', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  fs.writeFileSync(path.join(dir, '.trae/commands/custom.md'), '# custom\n', 'utf8');
  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));

  const out = json(run(['adopt', '--target', '.', '--json'], dir));
  assert.ok(out.unrecognized.includes('.trae/commands/custom.md'));
  assert.equal('.trae/commands/custom.md' in manifestOf(dir).files, false);
});

test('adopt with nothing recognizable exits 1 and writes no manifest', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'notes.md'), '# notes\n', 'utf8');
  const r = run(['adopt', '--agent', 'trae', '--target', '.', '--json'], dir);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(json(r).manifest, null);
  assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false);
});

// 安装锁：adopt 直写 manifest，须与并发安装互斥。
test('fresh install lock blocks adopt and leaves the manifest untouched', () => {
  const dir = tmpRepo();
  install(dir, ['trae']);
  const before = manifestOf(dir);
  seedLock(dir, { pid: 432112, ts: Date.now(), command: 'install' });

  const r = run(['adopt', '--target', '.', '--json'], dir);
  assert.equal(r.status, EXIT.LOCK, `lock conflict must exit ${EXIT.LOCK}: ${r.stdout} ${r.stderr}`);
  assert.deepEqual(manifestOf(dir), before);
  assert.equal(fs.existsSync(path.join(dir, '.agents/install.lock')), true, 'fresh lock must not be removed by the blocked run');
});

// —— 整文件派生工件的升级守卫（issue：哈希变化 ≠ 手工内容）——
// 判据：generated（--check 通过）或 recoverable（已提交，可 git show HEAD:<rel> 找回）时照常重生成，
// 只有「既非生成器输出、又未提交」才保留现状并跳过重生成。

test('整文件派生工件被生成器合法重生成后升级：正常重生成、不报冲突', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  fs.mkdirSync(path.join(dir, '.agents/commands'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.agents/roles'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents/commands/zz-demo.md'), '---\ndescription: demo\n---\n\n# zz-demo\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.agents/roles/zz-demo.md'), '# zz-demo-role\n', 'utf8');
  const rel = '.agents/notes/engine-map.md';
  const gen = run(['run', 'gen-engine-map.mjs', '--root', '.'], dir);
  assert.equal(gen.status, 0, gen.stderr);
  assert.match(read(dir, rel), /zz-demo/, '生成器重生成后地图应含新增命令/角色');

  // 磁盘 == 生成器输出，但 manifest 哈希已过期：不得判成手改。
  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.doesNotMatch(up.stdout, /整文件生成：含未提交的非生成内容/);
  assert.doesNotMatch(up.stdout, /整文件生成：上次安装后有改动/);
  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.userModified, 0);
});

test('整文件派生工件只因行尾转换而变化：升级不报冲突', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  for (const rel of ['workflow/effective-policy.md', '.agents/notes/engine-map.md']) {
    const abs = path.join(dir, rel);
    fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
  }

  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.doesNotMatch(up.stdout, /整文件生成：含未提交的非生成内容/);
  assert.doesNotMatch(up.stdout, /整文件生成：上次安装后有改动/);
  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.userModified, 0);
});

test('整文件派生工件含已提交的手工内容：升级照常重生成并提示可用 git 找回', () => {
  const dir = tmpRepo();
  install(dir, ['claude']);
  const rel = 'workflow/effective-policy.md';
  fs.appendFileSync(path.join(dir, rel), '\n<!-- MANUAL: 手工策略说明 -->\n', 'utf8');
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--no-verify', '-m', 'manual note'], { cwd: dir });

  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /git show HEAD:workflow\/effective-policy\.md/);
  assert.doesNotMatch(read(dir, rel), /MANUAL/, '已提交的手工内容照常被生成器重写');
  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.userModified, 0);
});
