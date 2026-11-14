import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'flow-kit.mjs');

function cli(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd, encoding: 'utf8', input,
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function installedTarget() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-skills-'));
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

const target = installedTarget();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-skill-src-'));

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
