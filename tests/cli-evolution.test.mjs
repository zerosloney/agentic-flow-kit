import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { main } from '../src/cli/main.mjs';
import { appendTimelineEvent, loadTimelineTrace } from '../templates/engine/.agents/scripts/timeline-trace.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function runCli(args, cwd = KIT) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

test('cli: timeline 命令顶层支持 --help', () => {
  const run = runCli(['timeline', '--help']);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /flow-kit timeline/);
  assert.match(run.stdout, /--export-html/);
});

test('cli: shadow-run 命令顶层支持 --help', () => {
  const run = runCli(['shadow-run', '--help']);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /flow-kit shadow-run/);
  assert.match(run.stdout, /--max-steps/);
});

test('cli: eval 命令顶层支持 --help', () => {
  const run = runCli(['eval', '--help']);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /flow-kit eval/);
  assert.match(run.stdout, /--benchmark/);
});

test('cli: optimize-skill 命令顶层支持 --help', () => {
  const run = runCli(['optimize-skill', '--help']);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /flow-kit optimize-skill/);
  assert.match(run.stdout, /--arbitrate/);
});

test('cli: eval list --json 正确返回标准基准任务集列表', () => {
  const run = runCli(['eval', 'list', '--json']);
  assert.equal(run.status, 0);
  const data = JSON.parse(run.stdout);
  assert.ok(Array.isArray(data));
  assert.ok(data.length >= 5);
  assert.ok(data.some((f) => f.id === 'fix-syntax-bug'));
});

test('cli: evolution top-level commands honor advertised flags and main(argv) without process.argv leakage', async () => {
  const dir = makeTmp('flow-kit-evo-flags-');
  fs.mkdirSync(path.join(dir, '.agents', 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: demo\n---\n# Demo\n', 'utf8');

  // 1. programmatic main(argv) does not read test runner process.argv
  const code = await main(['eval', 'list', '--target', dir, '--json']);
  assert.equal(code, 0);

  // 2. eval --benchmark --rubric --threshold=0.95 --json maps rubric & = threshold
  const evalRun = runCli(['eval', '--benchmark', '--rubric', '--threshold=0.95', '--target', dir, '--json']);
  assert.equal(evalRun.status, 0, evalRun.stderr);
  const evalOut = JSON.parse(evalRun.stdout);
  assert.equal(evalOut.status, 'pass');
  assert.equal(evalOut.threshold, 0.95);
  assert.ok(evalOut.rubric && typeof evalOut.rubric.radar === 'string');

  // 3. timeline --list / --step / --export-html work with advertised flags
  appendTimelineEvent(dir, { runId: 'run-42', stage: 'plan', eventType: 'RUN_STARTED', summary: 'start' });
  appendTimelineEvent(dir, { runId: 'run-42', stage: 'implement', eventType: 'STAGE_ENTER', summary: 'code' });

  const tlList = runCli(['timeline', '--run=run-42', '--list', '--target', dir, '--json']);
  assert.equal(tlList.status, 0, tlList.stderr);
  assert.equal(JSON.parse(tlList.stdout).length, 2);

  const htmlOut = path.join(dir, 'out', 'review.html');
  const tlExport = runCli(['timeline', '--run', 'run-42', '--export-html', htmlOut, '--target', dir]);
  assert.equal(tlExport.status, 0, tlExport.stderr);
  assert.equal(fs.existsSync(htmlOut), true);

  // 4. shadow-run --task / --max-steps / --timeout & --clean work
  const shadowRun = runCli(['shadow-run', '--task', 'verify-s6', '--max-steps', '5', '--timeout', '5000', '--target', dir, '--json']);
  assert.equal(shadowRun.status, 0, shadowRun.stderr);
  const shadowOut = JSON.parse(shadowRun.stdout);
  assert.equal(shadowOut.success, true);
  assert.equal(shadowOut.task, 'verify-s6');

  // 5. optimize-skill works with --arbitrate AND standalone --dry-run --json without falling back to help
  const optRun = runCli(['optimize-skill', '--skill', 'demo', '--arbitrate', '--target', dir, '--json']);
  assert.doesNotMatch(optRun.stdout, /^用法:/m);
  assert.equal(typeof JSON.parse(optRun.stdout).success, 'boolean');

  const optDryOnly = runCli(['optimize-skill', '--dry-run', '--target', dir, '--json']);
  assert.doesNotMatch(optDryOnly.stdout, /^用法:/m);
  assert.equal(typeof JSON.parse(optDryOnly.stdout).success, 'boolean');
});

test('cli: timeline list without --run lists all recorded traces', () => {
  const dir = makeTmp('flow-kit-tl-list-');
  appendTimelineEvent(dir, { runId: 'run-alpha', stage: 'plan', eventType: 'RUN_STARTED', summary: 'alpha start' });
  appendTimelineEvent(dir, { runId: 'run-beta', stage: 'verify', eventType: 'RUN_COMPLETED', summary: 'beta done', status: 'completed' });

  // 1. subcommand format: timeline list
  const run1 = runCli(['timeline', 'list', '--target', dir, '--json']);
  assert.equal(run1.status, 0, run1.stderr);
  const data1 = JSON.parse(run1.stdout);
  assert.equal(data1.length, 2);
  assert.ok(data1.some((t) => t.runId === 'run-alpha'));
  assert.ok(data1.some((t) => t.runId === 'run-beta'));

  // 2. flag format: timeline --list
  const run2 = runCli(['timeline', '--list', '--target', dir, '--json']);
  assert.equal(run2.status, 0, run2.stderr);
  const data2 = JSON.parse(run2.stdout);
  assert.equal(data2.length, 2);
});

test('cli: timeline append records new event with custom metadata', () => {
  const dir = makeTmp('flow-kit-tl-append-');
  const run = runCli([
    'timeline', 'append',
    '--run=run-append-test',
    '--stage=implement',
    '--event-type=STAGE_ENTER',
    '--summary=added feature logic',
    '--status=in_progress',
    '--actor=developer-agent',
    '--target', dir,
    '--json',
  ]);
  assert.equal(run.status, 0, run.stderr);
  const evt = JSON.parse(run.stdout);
  assert.equal(evt.ok, true);
  assert.equal(evt.runId, 'run-append-test');
  assert.ok(evt.traceFile && fs.existsSync(evt.traceFile));

  const traces = loadTimelineTrace(dir, 'run-append-test');
  assert.equal(traces.length, 1);
  assert.equal(traces[0].stage, 'implement');
  assert.equal(traces[0].eventType, 'STAGE_ENTER');
  assert.equal(traces[0].summary, 'added feature logic');
  assert.equal(traces[0].status, 'in_progress');
  assert.equal(traces[0].actor, 'developer-agent');
});

test('cli: shadow-run supports status inspection and custom stages', () => {
  const dir = makeTmp('flow-kit-shadow-status-');

  // 1. subcommand format: shadow-run status
  const run1 = runCli(['shadow-run', 'status', '--target', dir, '--json']);
  assert.equal(run1.status, 0, run1.stderr);
  const data1 = JSON.parse(run1.stdout);
  assert.ok(Array.isArray(data1.workspaces));
  assert.equal(typeof data1.count, 'number');

  // 2. flag format: shadow-run --status
  const run2 = runCli(['shadow-run', '--status', '--target', dir, '--json']);
  assert.equal(run2.status, 0, run2.stderr);
  const data2 = JSON.parse(run2.stdout);
  assert.ok(Array.isArray(data2.workspaces));

  // 3. custom stages execution
  const runStages = runCli([
    'shadow-run',
    '--task', 'verify-custom-stages',
    '--stages', 'plan,verify',
    '--target', dir,
    '--json',
  ]);
  assert.equal(runStages.status, 0, runStages.stderr);
  const res = JSON.parse(runStages.stdout);
  assert.equal(res.success, true);
  assert.equal(res.task, 'verify-custom-stages');
  assert.deepEqual(res.stagesCompleted, ['plan', 'verify']);
});

test('cli: eval supports category filtering, single fixture and rubric report', () => {
  const dir = makeTmp('flow-kit-eval-fixture-');
  const reportPath = path.join(dir, 'eval-report.md');

  // 1. eval list --category repair
  const runList = runCli(['eval', 'list', '--category', 'repair', '--json']);
  assert.equal(runList.status, 0, runList.stderr);
  const listData = JSON.parse(runList.stdout);
  assert.ok(Array.isArray(listData));
  assert.ok(listData.length >= 1);
  assert.ok(listData.every((f) => f.category === 'repair'));
  assert.ok(listData.some((f) => f.id === 'fix-syntax-bug'));

  // 2. single fixture execution with rubric and report output
  const runFixture = runCli([
    'eval',
    '--fixture', 'fix-syntax-bug',
    '--rubric',
    '--report', reportPath,
    '--target', dir,
    '--json',
  ]);
  assert.equal(runFixture.status, 0, runFixture.stderr);
  const outFixture = JSON.parse(runFixture.stdout);
  assert.equal(outFixture.status, 'pass');
  assert.equal(outFixture.totalCases, 1);
  assert.ok(outFixture.rubric && typeof outFixture.rubric.radar === 'string');
  assert.ok(fs.existsSync(reportPath));

  // 3. category-based evaluation execution
  const runCat = runCli([
    'eval',
    '--category', 'repair',
    '--target', dir,
    '--json',
  ]);
  assert.equal(runCat.status, 0, runCat.stderr);
  const outCat = JSON.parse(runCat.stdout);
  assert.equal(outCat.status, 'pass');
  assert.ok(outCat.totalCases >= 1);
});

test('cli: optimize-skill supports extract defect patterns and rollback', () => {
  const dir = makeTmp('flow-kit-opt-subcommands-');
  const skillDir = path.join(dir, '.agents', 'skills', 'demo');
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, 'SKILL.md');
  const bakFile = path.join(skillDir, 'SKILL.md.bak');

  fs.writeFileSync(skillFile, '---\nname: demo\ndescription: demo v2\n---\n# Demo Modified\n', 'utf8');
  fs.writeFileSync(bakFile, '---\nname: demo\ndescription: demo v1\n---\n# Demo Original\n', 'utf8');

  // 1. extract subcommand with --json
  const extractRun = runCli([
    'optimize-skill', 'extract',
    '--skill', 'demo',
    '--target', dir,
    '--json',
  ]);
  assert.equal(extractRun.status, 0, extractRun.stderr);
  const extractData = JSON.parse(extractRun.stdout);
  assert.equal(extractData.skillName, 'demo');
  assert.ok(Array.isArray(extractData.defectPatterns));

  // 2. rollback subcommand restores from .bak
  const rollbackRun = runCli([
    'optimize-skill', 'rollback',
    '--skill', 'demo',
    '--target', dir,
    '--json',
  ]);
  assert.equal(rollbackRun.status, 0, rollbackRun.stderr);
  const rollbackData = JSON.parse(rollbackRun.stdout);
  assert.equal(rollbackData.rolledBack, true);
  assert.equal(fs.readFileSync(skillFile, 'utf8'), '---\nname: demo\ndescription: demo v1\n---\n# Demo Original\n');
  assert.equal(fs.existsSync(bakFile), false);
});
