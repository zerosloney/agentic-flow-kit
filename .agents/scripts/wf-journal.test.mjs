#!/usr/bin/env node
// wf-journal.test.mjs — run journal 测试（2026-09-26 orchestration-journal-human）
// 方法：纯函数（replayRun/planStages/latestRun）fixture 直测 + CLI add/status spawn 冒烟（临时 journal + 临时 workflows 目录）
//       + 真实仓库 pipeline-closing 解析（human 形态行在位）。
// 判据：① schema 各字段与 attempt/run 语义 ② 末次生效 ③ 就绪/待定/中止分层 ④ 坏行容忍 ⑤ 9 列/human 列两代表全解析
// 用法：node templates/_agents/scripts/wf-journal.test.mjs（npm test 随跑）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { replayRun, planStages, latestRun } from './wf-journal.mjs';
import { parseStages } from './workflows-check.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const JOURNAL_CLI = path.join(SCRIPT_DIR, 'wf-journal.mjs');

const mkline = (over = {}) => JSON.stringify({ ts: '2026-09-26T10:00:00Z', run: 'w@20260926-1000', wf: 'w', stage: 'a', status: 'pass', attempt: 1, ...over });
const STAGES = parseStages(`| id | after | role | step | task | files | accept | gate | human | retries |
|----|-------|------|------|------|-------|--------|------|-------|---------|
| a | — | implementer | — | 做 A | src/** | 过 | | | |
| ask | a | — | — | 用户确认 | — | 一句可以 | | 用户确认 | |
| b | ask | — | — | — | — | — | npm test | | |
| c | b | — | — | — | — | — | npm run build | | |
`) || [];

// ---- S1 replayRun：字段进 state、total 计数 ----
{
  const r = replayRun([mkline(), mkline({ stage: 'ask', form: 'human', status: 'pass', note: '用户点头' })], 'w@20260926-1000');
  check('S1 replayRun 记 2 条且 form/note 进 state',
    r.total === 2 && r.state.a.status === 'pass' && r.state.ask.form === 'human' && r.state.ask.note === '用户点头',
    JSON.stringify(r));
}

// ---- S2 末次生效 + attempt 取最大（fail→pass 重试）----
{
  const r = replayRun([
    mkline({ stage: 'b', status: 'fail', attempt: 1 }),
    mkline({ stage: 'b', status: 'fail', attempt: 2 }),
    mkline({ stage: 'b', status: 'pass', attempt: 3 }),
  ], 'w@20260926-1000');
  check('S2 末次状态生效 pass 且 attempt=3',
    r.state.b.status === 'pass' && r.state.b.attempt === 3,
    JSON.stringify(r.state.b));
}

// ---- S3 其他 run / 坏行不混入 ----
{
  const r = replayRun([
    mkline({ stage: 'a' }),
    mkline({ stage: 'x', run: 'w@OTHER' }),
    '{ broken json',
    mkline({ stage: 'a', status: 'nope' }),
  ], 'w@20260926-1000');
  check('S3 异 run 过滤 + 坏 JSON/坏 status 计 bad 不进 state',
    r.total === 1 && r.bad === 2 && !r.state.x,
    JSON.stringify(r));
}

// ---- S4 latestRun：取该 wf 最后一条 run ----
{
  const run = latestRun([mkline({ run: 'w@A' }), mkline({ run: 'w@B', stage: 'a' })], 'w');
  check('S4 latestRun 取末条 w@B', run === 'w@B', String(run));
}

// ---- S5 planStages：空状态 → 第 0 层就绪；pass 后下层就绪；fail 下层待定 ----
{
  const p0 = planStages(STAGES, {});
  const p1 = planStages(STAGES, { a: { status: 'pass', attempt: 1 } });
  const p2 = planStages(STAGES, { a: { status: 'pass', attempt: 1 }, ask: { status: 'fail', attempt: 1 } });
  check('S5 分层：首层 a 就绪 → a 过后 ask 就绪 → ask fail 时 b/c 待定且 ask 重试就绪',
    p0.ready.map((s) => s.id).join() === 'a'
      && p1.ready.map((s) => s.id).join() === 'ask'
      && p2.ready.some((s) => s.id === 'ask' && s.retry === 1)
      && p2.pending.map((s) => s.id).join() === 'b,c',
    JSON.stringify({ p0, p1, p2 }));
}

// ---- S6 planStages：blocked 标注中止 + 依赖中止提示 ----
{
  const p = planStages(STAGES, { a: { status: 'pass', attempt: 1 }, ask: { status: 'blocked', attempt: 1, note: '用户驳回' } });
  check('S6 blocked 进中止列且下游标依赖中止',
    p.blocked.length === 1 && p.blocked[0].id === 'ask' && p.blocked[0].note === '用户驳回'
      && p.pending.some((s) => s.id === 'b' && s.depBlocked),
    JSON.stringify(p));
}

// ---- S7 CLI add 冒烟：attempt 自动计次 + run 复用 ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfj-cli-'));
  const j = path.join(tmp, 'j.jsonl');
  const run = (args) => spawnSync(process.execPath, [JOURNAL_CLI, ...args], { encoding: 'utf8' });
  const r1 = run(['add', '--wf', 'w', '--stage', 'a', '--status', 'pass', '--journal', j]);
  const r2 = run(['add', '--wf', 'w', '--stage', 'a', '--status', 'fail', '--journal', j]);
  const lines = fs.readFileSync(j, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  check('S7 add×2 attempt 自动 1→2 且 run 复用同 id',
    r1.status === 0 && r2.status === 0 && lines.length === 2
      && lines[0].attempt === 1 && lines[1].attempt === 2 && lines[0].run === lines[1].run,
    JSON.stringify({ r1: r1.stdout + r1.stderr, r2: r2.stdout + r2.stderr, lines }));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- S8 CLI status 冒烟：临时 workflows 目录 + 坏行容忍 ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfj-st-'));
  const wfRoot = path.join(tmp, 'workflows');
  fs.mkdirSync(wfRoot, { recursive: true });
  fs.writeFileSync(path.join(wfRoot, 'demo.md'),
    '---\nname: demo\ndescription: d\n---\n\n' +
    '| id | after | role | step | task | files | accept | gate | retries |\n' +
    '|----|-------|------|------|------|-------|--------|------|---------|\n' +
    '| a | — | — | — | — | — | — | npm test | |\n' +
    '| b | a | — | — | — | — | — | npm run build | |\n');
  const j = path.join(tmp, 'j.jsonl');
  fs.writeFileSync(j, '{ broken\n' + mkline({ wf: 'demo', stage: 'a' }) + '\n');
  const r = spawnSync(process.execPath, [JOURNAL_CLI, 'status', '--wf', 'demo', '--journal', j, '--wf-root', wfRoot], { encoding: 'utf8' });
  check('S8 status：坏行告警不炸、a 已完成、b 就绪',
    r.status === 0 && /坏行 1 条/.test(r.stderr) && /已完成（1）：a/.test(r.stdout) && /就绪（1）：b/.test(r.stdout),
    JSON.stringify({ out: r.stdout, err: r.stderr }));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- S9 真实仓库：pipeline-closing 解析含 human 形态 confirm 行；无 journal 时首层就绪 ----
{
  const ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
  const wfFile = path.join(ROOT, '.agents', 'workflows', 'pipeline-closing.md');
  if (!fs.existsSync(wfFile)) {
    console.log('SKIP  S9（非包源仓库，无 pipeline-closing）');
  } else {
    const stages = parseStages(fs.readFileSync(wfFile, 'utf8')) || [];
    const confirm = stages.find((s) => s.id === 'confirm');
    const j = path.join(os.tmpdir(), `wfj-real-${Date.now()}.jsonl`);
    const r = spawnSync(process.execPath, [JOURNAL_CLI, 'status', '--wf', 'pipeline-closing', '--journal', j], { encoding: 'utf8', cwd: ROOT });
    check('S9 真实 pipeline-closing：confirm 为 human 形态且无 journal 时 author 首层就绪',
      !!confirm && confirm.human && !confirm.role && stages.length >= 10
        && r.status === 0 && /就绪（第 0 层.*author/.test(r.stdout),
      JSON.stringify({ confirm, out: r.stdout }));
    fs.rmSync(j, { force: true });
  }
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
