import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashSkillDir, readLock, writeLock } from '../src/skills/lock.mjs';
import { EXIT } from '../src/cli/exit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'flow-kit.mjs');

function cli(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd, encoding: 'utf8', input,
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function installedTarget() {
  const dir = makeTmp('flow-kit-skills-');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
  const r = cli(dir, ['install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--no-model-config']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return dir;
}

function makeSkill(parent, name, { description = '测试用技能', extra = true, evalTasks = '' } = {}) {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  const fm = [
    '---',
    `name: ${name}`,
    ...(description ? [`description: ${description}`] : []),
    ...(evalTasks ? [`evalTasks: ${evalTasks}`] : []),
    '---',
    '',
    `# ${name}`,
    '',
    '正文。',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), fm);
  if (extra) fs.writeFileSync(path.join(dir, 'notes.txt'), '辅助文件\n');
  return dir;
}

function seedInstallLock(dir, info) {
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'install.lock'), JSON.stringify(info), 'utf8');
}

const target = installedTarget();
const work = makeTmp('flow-kit-skill-src-');

test('add-skill installs a local skill, writes lockfile and manifest category', () => {
  const src = makeSkill(work, 'demo-skill', { evalTasks: 'skill-trigger-positive' });
  const r = cli(target, ['add-skill', src, '--target', target, '--json']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.name, 'demo-skill');
  assert.equal(out.source.type, 'local');
  assert.match(out.checksum, /^[a-f0-9]{64}$/);
  assert.equal(out.files, 2);

  const lock = JSON.parse(fs.readFileSync(path.join(target, '.agents', 'skills.lock.json'), 'utf8'));
  assert.equal(lock.version, 1);
  assert.equal(lock.skills['demo-skill'].source.type, 'local');
  assert.ok(lock.skills['demo-skill'].files['SKILL.md']);

  const manifest = JSON.parse(fs.readFileSync(path.join(target, '.agents', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.skills['demo-skill'].checksum, out.checksum);
  assert.ok(manifest.files['.agents/skills/demo-skill/SKILL.md']);

  // 宿主技能面：claude 为 native 指针壳
  const pointer = path.join(target, '.claude', 'skills', 'demo-skill', 'SKILL.md');
  assert.equal(fs.existsSync(pointer), true);
  assert.match(fs.readFileSync(pointer, 'utf8'), /\.agents\/skills\/demo-skill\/SKILL\.md/);
});

test('skills lint passes for an installed skill and reports lock drift after edits', () => {
  const ok = cli(target, ['skills', 'lint', '--target', target, '--json']);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  assert.equal(JSON.parse(ok.stdout).ok, true);

  const installed = path.join(target, '.agents', 'skills', 'demo-skill', 'SKILL.md');
  fs.appendFileSync(installed, '\n用户追加\n');
  const bad = cli(target, ['skills', 'lint', '--target', target, '--json']);
  assert.equal(bad.status, 1);
  const report = JSON.parse(bad.stdout);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /与 lockfile 不一致/.test(e)));
});

test('remove-skill refuses tampered files, --force overrides, host pointer is cleaned', () => {
  const denied = cli(target, ['remove-skill', 'demo-skill', '--target', target]);
  assert.equal(denied.status, 1, denied.stderr || denied.stdout);
  assert.match(denied.stderr, /用户改动/);

  const forced = cli(target, ['remove-skill', 'demo-skill', '--target', target, '--force', '--json']);
  assert.equal(forced.status, 0, forced.stderr || forced.stdout);
  assert.equal(JSON.parse(forced.stdout).removed > 0, true);
  assert.equal(fs.existsSync(path.join(target, '.agents', 'skills', 'demo-skill')), false);
  assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'demo-skill')), false);

  const lock = JSON.parse(fs.readFileSync(path.join(target, '.agents', 'skills.lock.json'), 'utf8'));
  assert.equal(lock.skills['demo-skill'], undefined);
  const manifest = JSON.parse(fs.readFileSync(path.join(target, '.agents', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.skills, undefined);
  assert.equal(manifest.files['.agents/skills/demo-skill/SKILL.md'], undefined);
});

test('duplicate install is rejected; --update upgrades an existing skill', () => {
  const src = makeSkill(work, 'up-skill', { description: '第一版' });
  assert.equal(cli(target, ['add-skill', src, '--target', target]).status, 0);
  const dup = cli(target, ['add-skill', src, '--target', target]);
  assert.equal(dup.status, 1);
  assert.match(dup.stderr, /技能已存在/);

  fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: up-skill\ndescription: 第二版\n---\n\n# up-skill\n\n新正文。\n');
  const upd = cli(target, ['add-skill', src, '--target', target, '--update', '--json']);
  assert.equal(upd.status, 0, upd.stderr || upd.stdout);
  assert.equal(JSON.parse(upd.stdout).updated, true);
  assert.match(fs.readFileSync(path.join(target, '.agents', 'skills', 'up-skill', 'SKILL.md'), 'utf8'), /第二版/);

  // 技能粒度评测凭证：record --skill 落账，status 聚合成技能通过率
  const rec = cli(target, ['run', 'agent-eval.mjs', 'record', '--root', target, '--pass-rate', '0.9',
    '--tasks', '5', '--model', 'opus', '--skill', 'up-skill']);
  assert.equal(rec.status, 0, rec.stderr || rec.stdout);
  const st = cli(target, ['run', 'agent-eval.mjs', 'status', '--root', target, '--json']);
  assert.equal(st.status, 0, st.stderr || st.stdout);
  const status = JSON.parse(st.stdout);
  const row = status.skills.find((s) => s.skill === 'up-skill');
  assert.ok(row, 'status 应包含技能粒度通过率');
  assert.equal(row.passRate, 0.9);
  assert.equal(row.outcome, 'pass');
});

test('admission rules reject missing description and unknown evalTasks', () => {
  const bad = makeSkill(work, 'bad-skill', { description: '' });
  const r = cli(target, ['add-skill', bad, '--target', target]);
  assert.equal(r.status, 1, r.stderr || r.stdout);
  assert.match(r.stderr, /description/);
  assert.equal(fs.existsSync(path.join(target, '.agents', 'skills', 'bad-skill')), false);

  const ev = makeSkill(work, 'eval-skill', { evalTasks: 'no-such-task' });
  const e = cli(target, ['add-skill', ev, '--target', target]);
  assert.equal(e.status, 1);
  assert.match(e.stderr, /evalTasks/);
});

test('network sources require --allow-network', () => {
  const r = cli(target, ['add-skill', 'https://example.com/skill.git', '--target', target]);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.match(r.stderr, /--allow-network/);

  const n = cli(target, ['add-skill', 'some-npm-skill', '--target', target]);
  assert.equal(n.status, 2, n.stderr || n.stdout);
  assert.match(n.stderr, /--allow-network/);
});

// ---- #24 技能正文写作准入（BODY_* 规则） ----

const BODY_RULE_IDS = ['BODY_IMPERATIVE', 'BODY_STEP_VERIFIABLE', 'BODY_DUPLICATED', 'BODY_LENGTH'];

// 单源夹具：两句 ≥20 字的长句 ×3 处，触发跨技能重复判定。
const DUP_PARAGRAPH = [
  '这一段是两个技能正文之间共用的实现细节长句。',
  '它讲述的是完全相同的背景说明与操作注意事项。',
  '阅读者应当在两处看到一模一样的内容从而产生困惑。',
].join('\n');

// 含四类正文违规的正文：祈使句 / 可验证 / 单源（与另一技能共用段落）/ 长度预算。
function violatingBody() {
  return [
    '# 正文违规夹具',
    '',
    '## 步骤',
    '',
    '1. 我们先讨论一下这个方案是否可行？',
    '- 保持良好的代码风格与命名习惯。',
    '',
    DUP_PARAGRAPH,
    '',
    ...Array.from({ length: 405 }, (_, i) => `填充说明第 ${i + 1} 行，用于突破正文长度预算。`),
    '',
  ].join('\n');
}

function dropSkill(targetDir, name, body) {
  const dir = path.join(targetDir, '.agents', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  const text = ['---', `name: ${name}`, 'description: 正文写作准入夹具', '---', '', body].join('\n');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), text);
  return dir;
}

test('body rules hard-fail a new unregistered skill with all four rule IDs', () => {
  dropSkill(target, 'lint-bad-a', violatingBody());
  dropSkill(target, 'lint-bad-b', violatingBody());
  const r = cli(target, ['skills', 'lint', '--target', target, '--json']);
  assert.equal(r.status, 1, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, false);
  for (const id of BODY_RULE_IDS) {
    assert.ok(report.errors.some((e) => e.includes(`[${id}]`)), `errors 应含 ${id}`);
  }
});

test('body rules are advisory-only for skills registered in the lockfile', () => {
  const t2 = installedTarget();
  const dirA = dropSkill(t2, 'lint-legacy-a', violatingBody());
  const dirB = dropSkill(t2, 'lint-legacy-b', violatingBody());
  const lock = readLock(t2);
  for (const [name, dir] of [['lint-legacy-a', dirA], ['lint-legacy-b', dirB]]) {
    const { files, checksum } = hashSkillDir(dir);
    lock.skills[name] = {
      source: { type: 'local', spec: dir, resolved: dir },
      version: null,
      checksum,
      installedAt: new Date().toISOString(),
      files,
    };
  }
  writeLock(t2, lock);

  const r = cli(t2, ['skills', 'lint', '--target', t2, '--json']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  for (const id of BODY_RULE_IDS) {
    assert.ok(
      report.warnings.some((w) => w.startsWith('.agents/skills/lint-legacy-b:') && w.includes(`[${id}]`)),
      `warnings 应含 lint-legacy-b 的 ${id}`,
    );
    assert.ok(!report.errors.some((e) => e.includes(`[${id}]`)), `errors 不应含 ${id}`);
  }
});

test('body rules stay silent for a clean new unregistered skill', () => {
  const t3 = installedTarget();
  dropSkill(t3, 'lint-clean', [
    '# lint-clean',
    '',
    '## 步骤',
    '',
    '1. 运行 `npm test` 并确认退出码为 0。',
    '- 把命令输出原文写入 `tmp/evidence/lint-clean.md`。',
    '- 对照 `workflow/INDEX.md` 逐条复核后再提交。',
    '',
  ].join('\n'));
  const r = cli(t3, ['skills', 'lint', '--target', t3, '--json']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  const hits = [...report.errors, ...report.warnings]
    .filter((m) => m.startsWith('.agents/skills/lint-clean:') && /BODY_/.test(m));
  assert.deepEqual(hits, []);
});

// —— 安装锁：add-skill / remove-skill 直写 manifest，须与并发安装互斥 ——

test('fresh install lock blocks add-skill and leaves the manifest untouched', () => {
  const t4 = installedTarget();
  const before = JSON.parse(fs.readFileSync(path.join(t4, '.agents', 'install-manifest.json'), 'utf8'));
  seedInstallLock(t4, { pid: 432110, ts: Date.now(), command: 'install' });

  const src = makeSkill(work, 'locked-add-skill');
  const r = cli(t4, ['add-skill', src, '--target', t4, '--json']);
  assert.equal(r.status, EXIT.LOCK, `lock conflict must exit ${EXIT.LOCK}: ${r.stdout} ${r.stderr}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(t4, '.agents', 'install-manifest.json'), 'utf8')), before);
  assert.equal(fs.existsSync(path.join(t4, '.agents', 'skills', 'locked-add-skill')), false, 'blocked run must not copy skill files');
  assert.equal(fs.existsSync(path.join(t4, '.agents', 'install.lock')), true, 'fresh lock must not be removed by the blocked run');
});

test('fresh install lock blocks remove-skill and leaves the manifest untouched', () => {
  const t5 = installedTarget();
  const src = makeSkill(work, 'locked-remove-skill');
  const added = cli(t5, ['add-skill', src, '--target', t5, '--json']);
  assert.equal(added.status, 0, added.stderr || added.stdout);
  const before = JSON.parse(fs.readFileSync(path.join(t5, '.agents', 'install-manifest.json'), 'utf8'));
  seedInstallLock(t5, { pid: 432111, ts: Date.now(), command: 'install' });

  const r = cli(t5, ['remove-skill', 'locked-remove-skill', '--target', t5, '--json']);
  assert.equal(r.status, EXIT.LOCK, `lock conflict must exit ${EXIT.LOCK}: ${r.stdout} ${r.stderr}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(t5, '.agents', 'install-manifest.json'), 'utf8')), before);
  assert.equal(fs.existsSync(path.join(t5, '.agents', 'skills', 'locked-remove-skill', 'SKILL.md')), true, 'blocked run must not delete skill files');
});
