// 技能复盘候选（BACKLOG #19）：dream H2 只出候选，不改技能正文。
// 源是 session-log 的文本提及（引擎无技能装载遥测），故本文件同时锁「诚实边界」：
// 无日志显式报无输入、年轻遥测不产假失用候选、整词匹配不误命中、正文漂移不在此重复判定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { listSkills, scanSkillCandidates } from '../templates/engine/.agents/scripts/agg-skill-usage.mjs';
import { appendEvent } from '../templates/engine/.agents/scripts/session-log.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(HERE, '..', 'templates', 'engine', '.agents');
const AGG = path.join(ENGINE, 'scripts', 'agg-skill-usage.mjs');
const DREAM = path.join(ENGINE, 'scripts', 'dream-run.mjs');
const SKILLS_REL = path.join('.agents', 'skills');

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

function repo({ skills = [], events = [] } = {}) {
  const root = makeTmp('skill-review-');
  spawnSync('git', ['init', '-q'], { cwd: root });
  for (const name of skills) {
    const dir = path.join(root, SKILLS_REL, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} 技能\n---\n\n# ${name}\n`);
  }
  for (const e of events) appendEvent(root, e);
  return root;
}

function agg(root, args = []) {
  return spawnSync(process.execPath, [AGG, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root },
  });
}

// 技能面全文指纹：证明候选阶段零写操作（不新增、不改写、不删除）。
function skillTree(root) {
  const dir = path.join(root, SKILLS_REL);
  if (!fs.existsSync(dir)) return '';
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(`${path.relative(root, abs)}\u0000${fs.readFileSync(abs, 'utf8')}`);
    }
  };
  walk(dir);
  return out.join('\u0001');
}

const row = (type, text, extra = {}) => ({ type, text, ...extra });

test('scanSkillCandidates separates idle from linked and refuses idle verdicts on young telemetry', () => {
  const skills = ['eval', 'papercut-fix', 'why'];
  // 三个自然月 = 数据充分；eval / papercut-fix 有提及，why 零提及。
  const events = [
    row('note', '装载 eval 跑双臂', { ts: '2026-08-02T01:00:00.000Z' }),
    row('correction', 'eval 的 description 触发词太窄', { ts: '2026-09-03T02:00:00.000Z', ref: '.agents/skills/eval/SKILL.md' }),
    row('failure', 'papercut-fix 阈值判错', { ts: '2026-10-04T03:00:00.000Z' }),
    row('decision', 'eval 追证据', { ts: '2026-10-05T03:00:00.000Z' }),
  ];
  const full = scanSkillCandidates(skills, events);
  assert.equal(full.sufficient, true);
  assert.equal(full.dataMonths, 3);
  assert.deepEqual(full.idle, ['why'], '只有 why 窗口内零提及');
  assert.deepEqual(full.linked.map((i) => i.skill), ['eval', 'papercut-fix']);
  const evalItem = full.linked.find((i) => i.skill === 'eval');
  assert.equal(evalItem.total, 1, 'note/decision 提及算装载痕迹，不构成修正信号');
  assert.equal(evalItem.rows[0].type, 'correction');
  assert.equal(evalItem.rows[0].ref, '.agents/skills/eval/SKILL.md', '候选须带证据指针');

  // 年轻遥测：只有 1 个有数据月 → 不产失用候选，但关联候选是正信号，不受此限。
  const young = scanSkillCandidates(skills, [events[1]]);
  assert.equal(young.sufficient, false);
  assert.deepEqual(young.idle, []);
  assert.deepEqual(young.linked.map((i) => i.skill), ['eval']);

  // 整词边界：evaluate / re-eval 不得命中 eval，tddx 不得命中 tdd。
  const noise = scanSkillCandidates(['eval', 'tdd'], [
    row('note', 'evaluate the re-eval plan for tddx', { ts: '2026-08-02T01:00:00.000Z' }),
    row('note', '第二次 evaluate', { ts: '2026-09-02T01:00:00.000Z' }),
    row('note', '第三次 evaluate', { ts: '2026-10-02T01:00:00.000Z' }),
  ]);
  assert.deepEqual(noise.idle, ['eval', 'tdd']);
  assert.deepEqual(noise.linked, []);
});

test('listSkills only counts directories that actually carry a SKILL.md', () => {
  const root = repo({ skills: ['why', 'eval'] });
  fs.mkdirSync(path.join(root, SKILLS_REL, 'empty-dir'), { recursive: true });
  fs.writeFileSync(path.join(root, SKILLS_REL, 'stray.md'), '# 不是技能\n');
  assert.deepEqual(listSkills(root), ['eval', 'why']);
  assert.deepEqual(listSkills(makeTmp('skill-review-bare-')), []);
});

test('CLI reports 无输入 explicitly instead of staying silent, and never writes', () => {
  const noLogs = repo({ skills: ['why'] });
  const before = skillTree(noLogs);
  const r = agg(noLogs);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /无输入：窗口内无会话日志/);
  assert.match(r.stdout, /不能把「没有经验」当成「没有错误」/);
  assert.match(r.stdout, /session-log\.mjs append/, '须给出补日志的下一步');
  assert.ok(!r.stdout.includes('失用候选（'), '无日志不得产出失用候选');
  assert.equal(skillTree(noLogs), before);

  const noSkills = repo({ events: [row('failure', '某处失败', { now: daysAgo(1) })] });
  const s = agg(noSkills);
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /无输入：项目侧无 \.agents\/skills/);

  assert.equal(agg(noLogs, ['--days', '0']).status, 2);
  assert.equal(agg(noLogs, ['--months', 'x']).status, 2);
  assert.equal(agg(noLogs, ['--nope']).status, 2);
});

test('CLI emits idle and linked candidates with evidence pointers and a proposed edit site', () => {
  const root = repo({
    skills: ['eval', 'papercut-fix', 'why'],
    events: [
      row('note', '装载 eval 跑双臂', { now: daysAgo(89) }),
      row('correction', 'eval 触发词太窄，用户问「评测」时没装载', { now: daysAgo(45), ref: '.agents/skills/eval/SKILL.md' }),
      row('failure', 'papercut-fix 阈值判错', { now: daysAgo(1) }),
    ],
  });
  const before = skillTree(root);
  const r = agg(root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /失用候选（窗口内零提及/);
  assert.match(r.stdout, /why {2}\.agents\/skills\/why\/SKILL\.md {2}拟改落点：description 触发词/);
  const idleLines = r.stdout.split(/\r?\n/).filter((l) => l.includes('拟改落点：description'));
  assert.deepEqual(idleLines.map((l) => l.trim().split(/\s+/)[0]), ['why'], '有提及的技能不得进失用候选');
  assert.match(r.stdout, /关联候选（纠错\/失败\/拒绝行提及技能名/);
  assert.match(r.stdout, /eval {2}\d{4}-\d{2}-\d{2} correction {2}「eval 触发词太窄/);
  assert.match(r.stdout, /ref=\.agents\/skills\/eval\/SKILL\.md/);
  assert.match(r.stdout, /papercut-fix {2}\d{4}-\d{2}-\d{2} failure/);
  assert.match(r.stdout, /拟改落点：\.agents\/skills\/eval\/SKILL\.md 正文/);
  // 正文漂移不在此重复判定（既有面：dream B + skills lint），且改正文须先过双臂评测。
  assert.match(r.stdout, /正文漂移：不在此判定/);
  assert.match(r.stdout, /gen-engine-map --check/);
  assert.match(r.stdout, /flow-kit skills lint/);
  assert.match(r.stdout, /skills\/eval\/SKILL\.md 跑双臂/);
  assert.match(r.stdout, /agent-eval\.mjs record/);
  assert.match(r.stdout, /扫描 3 个技能 \/ 3 条日志，有数据月 3；失用 1 \/ 关联 2/);
  assert.equal(skillTree(root), before, '候选阶段零写操作');

  // 年轻遥测走 CLI 同样不产假失用候选。
  const young = repo({ skills: ['why'], events: [row('note', '今天装载 eval', { now: daysAgo(1) })] });
  const y = agg(young);
  assert.equal(y.status, 0, y.stderr);
  assert.match(y.stdout, /失用候选：数据不充分（有数据月 1 < 下限 3）/);
  assert.ok(!y.stdout.includes('拟改落点：description'), '数据不充分不得给改触发词的落点');
});

test('dream-run H2 carries the candidates into the report and leaves the skill surface untouched', () => {
  const root = repo({
    skills: ['eval', 'why'],
    events: [
      row('note', '装载 eval', { now: daysAgo(89) }),
      row('refusal', 'eval 拒绝改测试，用户纠正后仍拒绝', { now: daysAgo(45), ref: '.agents/skills/eval/SKILL.md' }),
      row('note', '第二次装载 eval', { now: daysAgo(1) }),
    ],
  });
  const before = skillTree(root);
  const r = spawnSync(process.execPath, [DREAM, '--no-judge', '--report', 'tmp/dream-h2.md'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root, FLOW_KIT_RUNTIME_SCRIPTS: path.join(ENGINE, 'scripts') },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = fs.readFileSync(path.join(root, 'tmp', 'dream-h2.md'), 'utf8');
  assert.match(report, /## H2\. 技能复盘候选（agg-skill-usage --days 90）/);
  assert.match(report, /失用候选（窗口内零提及/);
  assert.match(report, /why {2}\.agents\/skills\/why\/SKILL\.md/);
  assert.match(report, /refusal {2}「eval 拒绝改测试/);
  assert.match(report, /正文漂移：不在此判定/);
  // H2 在 H（经验回放）之后、I（记忆表示）之前。
  assert.ok(report.indexOf('## H. 经验回放') < report.indexOf('## H2.'));
  assert.ok(report.indexOf('## H2.') < report.indexOf('## I. 记忆表示'));
  assert.equal(skillTree(root), before, 'dream H2 不得改技能正文');
});

test('dream-run H2 reports 无输入 when the project has no session logs', () => {
  const root = repo({ skills: ['why'] });
  const r = spawnSync(process.execPath, [DREAM, '--no-judge', '--report', 'tmp/dream-h2-empty.md'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root, FLOW_KIT_RUNTIME_SCRIPTS: path.join(ENGINE, 'scripts') },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = fs.readFileSync(path.join(root, 'tmp', 'dream-h2-empty.md'), 'utf8');
  assert.match(report, /## H2\. 技能复盘候选/);
  assert.match(report, /无输入：窗口内无会话日志/);
  assert.ok(!report.includes('⚠ 技能复盘候选失败'), '无输入不是失败');
});