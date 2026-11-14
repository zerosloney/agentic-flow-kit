import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze } from '../templates/engine/.agents/scripts/check-pipeline-state.mjs';
import {
  parseParallelList as parseParallel, parseRetryCap as parseRetry, resolveArtifact, resolveDocRel,
  stageArtifactProblems,
} from '../templates/engine/.agents/scripts/pipeline-run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PIPELINE = path.join(REPO, 'templates', 'engine', '.agents', 'scripts', 'pipeline-run.mjs');
const NOW = '2026-11-13T12:00:00.000Z';

const VERIFY_MJS = `import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const mode = process.env.PIPELINE_FAKE_MODE || 'ok';
const marker = (name) => path.join(root, name);
if (mode === 'counter') {
  const f = marker('.verify-count');
  let n = 0;
  try { n = Number(fs.readFileSync(f, 'utf8')) || 0; } catch {}
  n += 1;
  fs.writeFileSync(f, String(n));
  process.exit(n >= 3 ? 0 : 1);
}
if (mode === 'sleep') {
  fs.writeFileSync(marker('.v-started'), '1');
  setTimeout(() => process.exit(0), 2000);
} else if (mode === 'barrier') {
  fs.writeFileSync(marker('.v-start'), '1');
  const end = Date.now() + 4000;
  const wait = () => {
    if (fs.existsSync(marker('.e-start'))) process.exit(0);
    if (Date.now() > end) process.exit(7);
    setTimeout(wait, 25);
  };
  wait();
} else {
  process.exit(0);
}
`;

const EXTRA_MJS = `import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
if ((process.env.PIPELINE_FAKE_MODE || 'ok') === 'barrier') {
  fs.writeFileSync(path.join(root, '.e-start'), '1');
  const end = Date.now() + 4000;
  const wait = () => {
    if (fs.existsSync(path.join(root, '.v-start'))) process.exit(0);
    if (Date.now() > end) process.exit(7);
    setTimeout(wait, 25);
  };
  wait();
} else {
  process.exit(Number(process.env.PIPELINE_FAKE_EXTRA_EXIT || 0));
}
`;

const FAKE_GIT = `process.exit(0);
`;

function fixture({ stageArtifacts = { verify: ['{plan}'] }, withPlan = true } = {}) {
  const root = makeTmp('pipeline-exec-');
  const write = (rel, text) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  };
  write('.agents/config/pipeline.json', JSON.stringify({ version: 1, stages: [], stopTypes: [], stageArtifacts }, null, 2));
  write('.agents/config/workflow-modules.txt', 'wiki\nbackend\n');
  write('.agents/scripts/verify.mjs', VERIFY_MJS);
  write('.agents/scripts/check-extra.mjs', EXTRA_MJS);
  write('.agents/scripts/fake-git.mjs', FAKE_GIT);
  write('workflow/intents/t.md', '---\n状态: draft\n级别: L1\n---\n\n## 验收标准\n\n- [ ] 待办\n');
  if (withPlan) write('workflow/plans/t.md', '---\n状态: draft\n级别: L1\n---\n\n## 改动方案\n\nx\n');
  return root;
}

function writeRun(root, overrides = {}) {
  const run = {
    runId: 'test-run',
    requirement: '测试需求',
    hint: '',
    createdAt: NOW,
    updatedAt: NOW,
    triage: { kind: 'require', level: 'L1', module: 'wiki', topic: 'test' },
    stage: 'verify',
    stopType: 'work-order',
    workOrder: null,
    awaitConfirm: null,
    fixLoop: { count: 0, cap: 3 },
    docs: { entry: 'workflow/intents/t.md', spec: null, plan: 'workflow/plans/t.md' },
    lastKbHits: [],
    lastFiles: [],
    events: [],
    ...overrides,
  };
  const abs = path.join(root, '.agents', 'cache', 'pipeline-runs', `${run.runId}.json`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(run, null, 2));
  return run;
}

function readRun(root, id = 'test-run') {
  return JSON.parse(fs.readFileSync(path.join(root, '.agents', 'cache', 'pipeline-runs', `${id}.json`), 'utf8'));
}

function envFor(root, extra = {}) {
  return {
    ...process.env,
    PIPELINE_RUN_ROOT: root,
    PIPELINE_RUN_BIN: path.join(root, '.agents', 'scripts'),
    PIPELINE_RUN_GIT_BIN: `"${process.execPath}" "${path.join(root, '.agents', 'scripts', 'fake-git.mjs')}"`,
    PIPELINE_RUN_TODAY: '2026-11-13',
    ...extra,
  };
}

function runPipeline(root, args, extraEnv = {}) {
  return spawnSync(process.execPath, [PIPELINE, ...args], {
    cwd: root, encoding: 'utf8', env: envFor(root, extraEnv), timeout: 60000,
  });
}

test('helpers validate retry / parallel / artifact templates', () => {
  assert.equal(parseRetry(undefined), 0);
  assert.equal(parseRetry('2'), 2);
  assert.equal(parseParallel('a.mjs, b.mjs,a.mjs').length, 2);
  assert.equal(resolveArtifact('{entry}|{spec}|{plan}', { entry: 'e', spec: null, plan: 'p' }), 'e||p');
  const problems = stageArtifactProblems((rel) => (rel === 'p' ? '' : null), 'verify', { plan: 'p' }, { stageArtifacts: { verify: ['{plan}', '{entry}'] } });
  assert.deepEqual(problems, ['阶段产物为空：p（verify 契约）']);
  assert.throws(() => parseParallel('../evil.mjs'), /--parallel/);
  assert.throws(() => parseRetry('9'), /0-5/);
});

test('R3-5: stage artifact contract blocks missing products before the gate', () => {
  const root = fixture({ withPlan: false });
  writeRun(root);
  const r = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.match(r.stdout + r.stderr, /阶段产物缺失：workflow\/plans\/t\.md/);
  assert.equal(readRun(root).stopType, 'gate-fail');
  assert.equal(readRun(root).events.some((e) => e.type === 'gate'), false, 'gate must not run before contract passes');

  fs.mkdirSync(path.join(root, 'workflow', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'plans', 't.md'), '---\n状态: draft\n---\n\n## 改动方案\n\nx\n');
  const again = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(again.status, 0, again.stderr || again.stdout);
  assert.ok(readRun(root).events.some((e) => e.type === 'gate' && /verify\.mjs/.test(e.cmd)));
});

test('R3-5: --retry re-runs the verify gate within budget and records attempts', () => {
  const root = fixture();
  writeRun(root);
  const r = runPipeline(root, ['next', '--run', 'test-run', '--retry', '2'], { PIPELINE_FAKE_MODE: 'counter' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const run = readRun(root);
  const gates = run.events.filter((e) => e.type === 'gate' && /verify\.mjs/.test(e.cmd));
  const retries = run.events.filter((e) => e.type === 'retry');
  assert.equal(gates.length, 3);
  assert.deepEqual(gates.map((g) => g.exit), [1, 1, 0]);
  assert.deepEqual(retries.map((x) => x.attempt), [1, 2]);
  assert.equal(run.stage, 'closeout');
  assert.equal(run.inFlight, null);
});

test('R3-5: --parallel runs gate branches concurrently, not sequentially', () => {
  const root = fixture();
  writeRun(root);
  const r = runPipeline(root, ['next', '--run', 'test-run', '--parallel', 'check-extra.mjs'], { PIPELINE_FAKE_MODE: 'barrier' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const run = readRun(root);
  const gates = run.events.filter((e) => e.type === 'gate' && /(verify|check-extra)\.mjs/.test(e.cmd));
  assert.equal(gates.length, 2);
  assert.ok(gates.every((g) => g.exit === 0), 'both branches saw each other, so they overlapped');
  assert.equal(gates[0].parallel, gates[1].parallel);
  assert.match(gates[0].parallel, /^p-/);
});

test('R3-5: parallel branch failure fails the gate as a whole', () => {
  const root = fixture();
  writeRun(root);
  const r = runPipeline(root, ['next', '--run', 'test-run', '--parallel', 'check-extra.mjs'], { PIPELINE_FAKE_EXTRA_EXIT: '3' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /修复环 1\/3：verify 未过/);
  const run = readRun(root);
  assert.equal(run.stage, 'fix');
  assert.equal(run.stopType, 'work-order');
  assert.ok(run.events.some((e) => e.type === 'gate' && /check-extra\.mjs/.test(e.cmd) && e.exit === 3));
});

test('R3-5: killed gate is marked inFlight and resume re-enters from it', async () => {
  const root = fixture();
  writeRun(root);
  const child = spawn(process.execPath, [PIPELINE, 'next', '--run', 'test-run'], {
    cwd: root, env: envFor(root, { PIPELINE_FAKE_MODE: 'sleep' }), stdio: 'ignore',
  });
  const started = await waitForFile(path.join(root, '.v-started'), 5000);
  assert.ok(started, 'verify gate did not start');
  child.kill();
  await new Promise((resolve) => child.on('exit', resolve));

  const interrupted = readRun(root);
  assert.equal(interrupted.inFlight?.stage, 'verify');

  const resumed = runPipeline(root, ['resume', '--run', 'test-run'], { PIPELINE_FAKE_MODE: 'ok' });
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  const run = readRun(root);
  assert.ok(run.events.some((e) => e.type === 'resume' && e.stage === 'verify'));
  assert.equal(run.inFlight, null);
  assert.equal(run.stage, 'closeout');
});

test('resume without an interrupted run exits 0 and changes nothing', () => {
  const root = fixture();
  writeRun(root);
  const r = runPipeline(root, ['resume', '--run', 'test-run']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /无断点可续/);
  assert.equal(readRun(root).events.length, 0);
});

test('R3-5: archived terminal doc still counts as closed (done-confirm does not deadlock)', () => {
  const root = fixture();
  const planRel = 'workflow/plans/t.md';
  const archived = 'workflow/archive/2026-11/plans/t.md';
  fs.mkdirSync(path.dirname(path.join(root, archived)), { recursive: true });
  fs.renameSync(path.join(root, planRel), path.join(root, archived));
  fs.writeFileSync(path.join(root, archived), '---\n状态: done\n级别: L1\n---\n\n## 改动方案\n\nx\n');
  writeRun(root, {
    stage: 'done-confirm',
    stopType: 'await-confirm',
    awaitConfirm: { doc: planRel, points: '关单确认', ledger: true },
    docs: { entry: planRel, spec: null, plan: planRel },
  });
  assert.equal(resolveDocRel({ root }, planRel), archived);
  const r = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const run = readRun(root);
  assert.equal(run.stage, 'done');
  assert.equal(run.stopType, 'done');
});

test('R3-4: empty module vocabulary disables triage module validation', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, '.agents/config/workflow-modules.txt'), '# 仅注释：新装户尚未登记模块\n');
  writeRun(root, { stage: 'triage', stopType: 'await-confirm', docs: { entry: 'workflow/intents/t.md', spec: null, plan: null } });
  const r = runPipeline(root, ['next', '--run', 'test-run', '--triage', 'kind=require level=L1 module=custom']);
  assert.doesNotMatch(r.stdout + r.stderr, /module 须在词表内/);
});

test('R3-4: pristine install output is not counted as work-order changes', () => {
  const root = fixture();
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  const pristineRel = '.agents/notes/managed.md';
  fs.mkdirSync(path.join(root, '.agents/notes'), { recursive: true });
  fs.writeFileSync(path.join(root, pristineRel), '安装产物\n');
  const files = {};
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (ent.isDirectory()) {
        if (rel === '.git' || rel === '.agents/cache') continue;
        walk(abs);
      } else if (rel !== '.agents/install-manifest.json') {
        files[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      }
    }
  };
  walk(root);
  fs.writeFileSync(path.join(root, '.agents/install-manifest.json'), JSON.stringify({
    kit: 'agentic-flow-kit', schemaVersion: 2, version: 'test', language: 'zh-CN',
    hosts: ['claude'], stack: 'node', files,
  }));
  fs.mkdirSync(path.join(root, 'workflow/wiki'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow/wiki/e2e.md'), '新增文档\n');
  writeRun(root, {
    stage: 'implement',
    stopType: 'work-order',
    workOrder: { id: 3, kind: 'implement' },
    docs: { entry: 'workflow/plans/t.md', spec: null, plan: 'workflow/plans/t.md' },
  });
  const r = runPipeline(root, ['next', '--run', 'test-run', '--files', 'workflow/wiki/e2e.md'], { PIPELINE_RUN_GIT_BIN: 'git' });
  assert.doesNotMatch(r.stdout + r.stderr, /超出回填清单/, r.stdout + r.stderr);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('pipeline state machine stays statically closed after R3-5', () => {
  const src = fs.readFileSync(PIPELINE, 'utf8');
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'templates', 'engine', '.agents', 'config', 'pipeline.json'), 'utf8'));
  const res = analyze(src, cfg);
  assert.deepEqual(res.problems, []);
  assert.ok(res.ok);
});

function waitForFile(file, ms) {
  const end = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = () => {
      if (fs.existsSync(file)) return resolve(true);
      if (Date.now() > end) return resolve(false);
      setTimeout(tick, 25);
    };
    tick();
  });
}
