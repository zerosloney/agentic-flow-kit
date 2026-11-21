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
  stageArtifactProblems, failRoute,
} from '../templates/engine/.agents/scripts/pipeline-run.mjs';
import { touchProblems, externalReviewId, filesOutsidePlan } from '../templates/engine/.agents/scripts/touch-set.mjs';

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

// 假 fill-* 脚本（pipeline 任务目录测试用）：按 --output 写一份带 frontmatter 的骨架文档，
// 让 intent-fill / spec-fill / plan-fill 阶段可独立推进而不依赖真实模板渲染。
const FILL_MJS = `import fs from 'node:fs';
import path from 'node:path';
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const out = arg('--output');
const level = arg('--level') || 'L1';
const topic = arg('--topic') || 'task';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, ['---', '状态: draft', '级别: ' + level, '模块: wiki', '---', '', '# ' + topic, '', '## 背景与问题', 'x', ''].join('\\n'));
`;

function fixture({ stageArtifacts = { verify: ['{plan}'] }, withPlan = true, onFail = { verify: { to: 'fix', retry: 3 } } } = {}) {
  const root = makeTmp('pipeline-exec-');
  const write = (rel, text) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  };
  write('.agents/config/pipeline.json', JSON.stringify({ version: 1, stages: [], stopTypes: [], stageArtifacts, onFail }, null, 2));
  write('.agents/config/workflow-modules.txt', 'wiki\nbackend\n');
  write('.agents/scripts/verify.mjs', VERIFY_MJS);
  write('.agents/scripts/check-extra.mjs', EXTRA_MJS);
  write('.agents/scripts/fake-git.mjs', FAKE_GIT);
  write('.agents/scripts/fill-intent.mjs', FILL_MJS);
  write('.agents/scripts/fill-spec.mjs', FILL_MJS);
  write('.agents/scripts/fill-plan.mjs', FILL_MJS);
  write('.agents/scripts/kb-search.mjs', 'process.exit(0);\n');
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
    retries: {},
    nextTarget: null,
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
  // 条目 37：apiDocs 是声明式兜底派生，文件未产物时 done 摘要标「未产物」，不得混用「?」。
  // 先断言派生确实发生（否则 match 空过——条件断言等于没测）。
  assert.ok(run.docs?.apiDocs, '该路径应触发 apiDocs 兜底派生');
  assert.doesNotMatch(r.stdout, /api\.md（\?）/);
  assert.match(r.stdout, /api\.md（未产物）/);
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
  fs.writeFileSync(path.join(root, 'workflow/plans/t.md'), '---\n状态: draft\n级别: L1\n---\n\n## 改动方案\n\nworkflow/wiki/e2e.md\n');
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
  // 条目 36 回归：机器生成/运行时产物不在 manifest 内（engine-map 装期生成、effective-policy 自愈
  // 生成、tmp/ 为 verify 自产日志）——不得算作工单改动面，无需列入 --files。
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tmp/verify-secrets-scan.log'), '机器日志\n');
  fs.writeFileSync(path.join(root, '.agents/notes/engine-map.md'), '# 引擎地图\n');
  fs.writeFileSync(path.join(root, 'workflow/effective-policy.md'), '# 快照\n');
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

test('R6-1: failRoute falls back to stop-in-place for missing or malformed edges', () => {
  assert.deepEqual(failRoute({}, 'verify'), { to: 'verify', retry: 0 });
  assert.deepEqual(failRoute(null, 'verify'), { to: 'verify', retry: 0 });
  assert.deepEqual(failRoute({ onFail: { verify: { to: 'fix', retry: 3 } } }, 'verify'), { to: 'fix', retry: 3 });
  assert.deepEqual(failRoute({ onFail: { verify: null } }, 'verify'), { to: 'verify', retry: 0 });
  assert.deepEqual(failRoute({ onFail: { verify: { to: '', retry: 9 } } }, 'verify'), { to: 'verify', retry: 0 });
  assert.deepEqual(failRoute({ onFail: { verify: { to: 'fix', retry: 2.5 } } }, 'verify'), { to: 'fix', retry: 0 });
  assert.deepEqual(failRoute({ onFail: { verify: { to: 'fix', retry: 5 } } }, 'verify'), { to: 'fix', retry: 5 });
});

test('R6-1: verify failure routes to the table target and persists per-stage retries', () => {
  const root = fixture();
  writeRun(root);
  const r = runPipeline(root, ['next', '--run', 'test-run'], { PIPELINE_FAKE_MODE: 'counter' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /修复环 1\/3：verify 未过/);
  const run = readRun(root);
  assert.equal(run.stage, 'fix');
  assert.equal(run.stopType, 'work-order');
  assert.equal(run.workOrder.kind, 'fix');
  assert.deepEqual(run.retries, { verify: 1 });
  assert.equal(run.fixLoop, undefined, '旧 fixLoop 计数已随路由表退役');
  assert.equal(run.nextTarget, null);
  // 条目 37：verify→fix 专用分支的退回也记 route 事件（与 stopGateFail 同语义），否则事件账本无路由历史
  const route = run.events.find((e) => e.type === 'route');
  assert.ok(route, 'verify→fix 退回缺 route 事件');
  assert.deepEqual([route.from, route.to, route.attempt, route.cap], ['verify', 'fix', 1, 3]);
});

test('R6-1: exhausted retry budget stops at the failure stage with exit 2', () => {
  const root = fixture();
  writeRun(root, { retries: { verify: 2 } });
  const r = runPipeline(root, ['next', '--run', 'test-run'], { PIPELINE_FAKE_MODE: 'counter' });
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.match(r.stdout + r.stderr, /修复环超限（3 次）/);
  const run = readRun(root);
  assert.equal(run.stage, 'verify', 'stage 留在失败处，不伪装成已退回');
  assert.equal(run.stopType, 'gate-fail');
  assert.equal(run.retries.verify, 3);
  assert.equal(run.nextTarget, null);
});

test('R6-1: an undeclared stage keeps the pre-table stop-in-place behavior', () => {
  const root = fixture({ onFail: {} });
  writeRun(root);
  const r = runPipeline(root, ['next', '--run', 'test-run'], { PIPELINE_FAKE_MODE: 'counter' });
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.match(r.stdout + r.stderr, /未声明失败路由/);
  const run = readRun(root);
  assert.equal(run.stage, 'verify');
  assert.equal(run.retries.verify, 1);
  assert.equal(run.nextTarget, null, '未声明即不退回');
  assert.equal(run.events.some((e) => e.type === 'route'), false);
});

test('R6-1: a declared edge routes a rejection and next re-enters the target', () => {
  const root = fixture({ onFail: { triage: { to: 'triage', retry: 2 } } });
  writeRun(root, { stage: 'triage', triage: null });
  const args = ['next', '--run', 'test-run', '--triage', 'kind=bogus level=L1 module=wiki topic=test'];
  const r = runPipeline(root, args);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.match(r.stdout, /退回 triage 重做/);
  const run = readRun(root);
  assert.equal(run.stage, 'triage');
  assert.equal(run.nextTarget, 'triage');
  assert.equal(run.retries.triage, 1);
  const route = run.events.find((e) => e.type === 'route');
  assert.deepEqual([route.from, route.to, route.attempt, route.cap], ['triage', 'triage', 1, 2]);

  const again = runPipeline(root, args);
  assert.equal(again.status, 2, again.stderr || again.stdout);
  const run2 = readRun(root);
  assert.ok(run2.events.some((e) => e.type === 'route-enter' && e.from === 'triage' && e.to === 'triage'));
  assert.equal(run2.retries.triage, 2, '计数跨进程持久化');
  assert.equal(run2.nextTarget, null, '预算耗尽后不再退回');
});

test('R6-2: resume reports missing artifacts and the contract gate still blocks', () => {
  const root = fixture({ withPlan: false });
  writeRun(root, { inFlight: { stage: 'verify', since: NOW } });
  const r = runPipeline(root, ['resume', '--run', 'test-run']);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const run = readRun(root);
  const ev = run.events.find((e) => e.type === 'resume');
  assert.equal(ev.stage, 'verify');
  assert.equal(ev.artifacts, 'missing');
  assert.equal(ev.missing.length, 1);
  assert.match(ev.missing[0], /阶段产物缺失：workflow\/plans\/t\.md/);
  assert.equal(run.nextTarget, null, '前置条件失败不消耗退回预算');
  assert.equal(run.events.some((e) => e.type === 'gate'), false);
});

test('R6-2: resume with complete artifacts re-runs the interrupted gate', () => {
  const root = fixture();
  writeRun(root, { inFlight: { stage: 'verify', since: NOW } });
  const r = runPipeline(root, ['resume', '--run', 'test-run']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const run = readRun(root);
  const ev = run.events.find((e) => e.type === 'resume');
  assert.equal(ev.artifacts, 'complete');
  assert.equal(ev.missing, undefined);
  assert.ok(run.events.some((e) => e.type === 'gate' && /verify\.mjs/.test(e.cmd)));
  assert.equal(run.inFlight, null);
  assert.equal(run.stage, 'closeout');
});

test('R6-2: artifact contract failure stops in place without consuming retry budget', () => {
  const root = fixture({ withPlan: false });
  writeRun(root);
  const r = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.match(r.stdout + r.stderr, /阶段产物缺失：workflow\/plans\/t\.md/);
  const run = readRun(root);
  assert.equal(run.stopType, 'gate-fail');
  assert.deepEqual(run.retries, {}, '产物契约失败（route:false）不消耗退回预算');
  assert.equal(run.nextTarget, null);
  assert.equal(run.events.some((e) => e.type === 'route'), false);
});

test('R6-2: verify-only short path fails without consuming retry budget', () => {
  const root = fixture();
  writeRun(root, { triage: { kind: 'verify', level: 'L1', module: 'wiki', topic: 'test' } });
  const r = runPipeline(root, ['next', '--run', 'test-run'], { PIPELINE_FAKE_MODE: 'counter' });
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.match(r.stdout + r.stderr, /verify-only 不带修复环/);
  const run = readRun(root);
  assert.equal(run.stopType, 'gate-fail');
  assert.deepEqual(run.retries, {}, 'verify-only 短路径（route:false）不消耗退回预算');
  assert.equal(run.nextTarget, null);
  assert.equal(run.events.some((e) => e.type === 'route'), false);
});

test('R6-1: static gate rejects dangling, terminal, out-of-range and dead onFail edges', () => {
  const src = fs.readFileSync(PIPELINE, 'utf8');
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'templates', 'engine', '.agents', 'config', 'pipeline.json'), 'utf8'));
  const bad = (onFail) => analyze(src, { ...cfg, onFail });
  const has = (res, text) => assert.ok(res.problems.includes(text), `期望命中「${text}」，实得：${res.problems.join(' | ')}`);

  const dangling = bad({ verify: { to: 'nowhere', retry: 3 } });
  assert.equal(dangling.ok, false);
  has(dangling, "onFail['verify'].to 未登记：'nowhere'");

  const terminal = bad({ verify: { to: 'done', retry: 3 } });
  assert.equal(terminal.ok, false);
  has(terminal, "onFail['verify'] 不得路由到终态 'done'");

  const overBudget = bad({ verify: { to: 'fix', retry: 6 } });
  assert.equal(overBudget.ok, false);
  assert.ok(overBudget.problems.some((p) => /retry 须为 0-5 整数/.test(p)), overBudget.problems.join(' | '));

  const unregistered = bad({ 'not-a-stage': { to: 'fix', retry: 1 } });
  assert.equal(unregistered.ok, false);
  has(unregistered, "onFail 键未登记：'not-a-stage'（补 stages）");

  const deadKey = bad({ done: { to: 'fix', retry: 1 } });
  assert.equal(deadKey.ok, false);
  has(deadKey, "onFail 不得声明终态 'done'");

  const emptyOnFail = bad({});
  assert.equal(emptyOnFail.ok, false);
  has(emptyOnFail, 'onFail 未声明任何失败路由：门失败将原地停机（模板契约至少声明 verify 退回边）');

  const noOnFailKey = { ...cfg };
  delete noOnFailKey.onFail;
  const noKey = analyze(src, noOnFailKey);
  assert.equal(noKey.ok, false);
  has(noKey, 'onFail 未声明任何失败路由：门失败将原地停机（模板契约至少声明 verify 退回边）');

  assert.deepEqual(analyze(src, cfg).problems, [], '真实配置仍须闭合');
  assert.equal(analyze(src, cfg).counts.onFail, 1);
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

// ── pipeline 任务目录（2026-11-16）：自动化产物落 workflow/tasks/<date>-<topic>/，与手动路径隔离 ──

const TASK_ENV = { PIPELINE_RUN_TODAY: '2026-11-13' };

test('task dir: intent-fill writes into workflow/tasks/<date>-<topic>/, manual dirs untouched', () => {
  const root = fixture();
  writeRun(root, {
    stage: 'intent-fill',
    docs: { entry: null, spec: null, plan: null },
    triage: { kind: 'require', level: 'L2', module: 'wiki', topic: 'foo' },
  });
  const r = runPipeline(root, ['next', '--run', 'test-run'], TASK_ENV);
  assert.ok(fs.existsSync(path.join(root, 'workflow', 'tasks', '2026-11-13-foo', 'intent.md')), r.stderr || r.stdout);
  assert.equal(readRun(root).docs.entry, 'workflow/tasks/2026-11-13-foo/intent.md');
  assert.deepEqual(fs.readdirSync(path.join(root, 'workflow', 'intents')), ['t.md'], '手动 intents/ 零写入');
  assert.equal(fs.existsSync(path.join(root, 'workflow', 'specs')), false);
});

test('task dir: spec-fill and plan-fill land inside the task dir', () => {
  const root = fixture();
  const taskDir = 'workflow/tasks/2026-11-13-foo';
  writeRun(root, {
    stage: 'spec-fill',
    docs: { entry: `${taskDir}/intent.md`, spec: null, plan: null },
    triage: { kind: 'require', level: 'L2', module: 'wiki', topic: 'foo' },
  });
  const r = runPipeline(root, ['next', '--run', 'test-run'], TASK_ENV);
  assert.ok(fs.existsSync(path.join(root, taskDir, 'spec.md')), r.stderr || r.stdout);
  assert.equal(readRun(root).docs.spec, `${taskDir}/spec.md`);
  assert.equal(fs.existsSync(path.join(root, 'workflow', 'specs', '2026-11-13-foo.md')), false);

  writeRun(root, {
    stage: 'plan-fill',
    docs: { entry: `${taskDir}/intent.md`, spec: `${taskDir}/spec.md`, plan: null },
    triage: { kind: 'require', level: 'L2', module: 'wiki', topic: 'foo' },
  });
  const r2 = runPipeline(root, ['next', '--run', 'test-run'], TASK_ENV);
  assert.ok(fs.existsSync(path.join(root, taskDir, 'plan.md')), r2.stderr || r2.stdout);
  assert.equal(readRun(root).docs.plan, `${taskDir}/plan.md`);
  assert.equal(fs.existsSync(path.join(root, 'workflow', 'plans', '2026-11-13-foo.md')), false);
});

test('task dir: resume reports missing artifact under the task dir', () => {
  const root = fixture();
  const taskDir = 'workflow/tasks/2026-11-13-foo';
  writeRun(root, {
    stage: 'verify',
    docs: { entry: `${taskDir}/intent.md`, spec: `${taskDir}/spec.md`, plan: `${taskDir}/plan.md` },
    triage: { kind: 'require', level: 'L2', module: 'wiki', topic: 'foo' },
    inFlight: { stage: 'verify', since: NOW },
  });
  const r = runPipeline(root, ['resume', '--run', 'test-run'], TASK_ENV);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const ev = readRun(root).events.find((e) => e.type === 'resume');
  assert.equal(ev.artifacts, 'missing');
  assert.match(ev.missing[0], /阶段产物缺失：workflow\/tasks\/2026-11-13-foo\/plan\.md/);
});

test('task dir: {apiDocs} contract gates closeout on the task-dir api.md', () => {
  const root = fixture({ stageArtifacts: { closeout: ['{apiDocs}'] } });
  const taskDir = 'workflow/tasks/2026-11-13-foo';
  // 引擎在 triage 决策点派生 apiDocs（与 entry/spec/plan 同一 docs 对象、同目录族）
  writeRun(root, { stage: 'triage', triage: null, docs: null });
  const t0 = runPipeline(root, ['next', '--run', 'test-run', '--triage', 'kind=require level=L2 module=wiki topic=foo'], TASK_ENV);
  assert.equal(readRun(root).docs.apiDocs, `${taskDir}/api.md`, t0.stderr || t0.stdout);

  // a) api.md 缺失 → closeout 前停 gate-fail，缺失信息指 taskDir 下的 api.md
  const run1 = readRun(root);
  fs.writeFileSync(path.join(root, '.agents', 'cache', 'pipeline-runs', 'test-run.json'),
    JSON.stringify({ ...run1, stage: 'closeout', stopType: 'work-order', workOrder: null, awaitConfirm: null }, null, 2));
  const r = runPipeline(root, ['next', '--run', 'test-run'], TASK_ENV);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.match(r.stdout + r.stderr, /阶段产物缺失：workflow\/tasks\/2026-11-13-foo\/api\.md/);
  assert.equal(readRun(root).stopType, 'gate-fail');
  assert.deepEqual(readRun(root).retries, {}, '产物契约失败（route:false）不消耗退回预算');

  // b) 补 api.md 后同门通过——closeout 正常发出勾验收工单
  fs.mkdirSync(path.join(root, taskDir), { recursive: true });
  fs.writeFileSync(path.join(root, taskDir, 'api.md'), '# API\n\nx\n');
  const again = runPipeline(root, ['next', '--run', 'test-run'], TASK_ENV);
  assert.equal(again.status, 0, again.stderr || again.stdout);
  const run2 = readRun(root);
  assert.equal(run2.stopType, 'work-order');
  assert.equal(run2.workOrder.kind, 'closeout');

  // c) 旧 run 兜底：升级前创建的 run（docs 无 apiDocs 键、triage 不重入）——advance 顶部派生
  //    让「声明即校验」对存量 run 生效：删键删文件后 next 应再停 gate-fail（无兜底则静默跳过、绿）
  const runFile = path.join(root, '.agents', 'cache', 'pipeline-runs', 'test-run.json');
  const legacy = readRun(root);
  delete legacy.docs.apiDocs;
  fs.writeFileSync(runFile, JSON.stringify(legacy, null, 2));
  fs.rmSync(path.join(root, taskDir, 'api.md'));
  const legacyNext = runPipeline(root, ['next', '--run', 'test-run'], TASK_ENV);
  assert.equal(legacyNext.status, 2, legacyNext.stderr || legacyNext.stdout);
  assert.equal(readRun(root).stopType, 'gate-fail', '旧 run 经兜底派生后契约门照常拦截');
  assert.equal(readRun(root).docs.apiDocs, `${taskDir}/api.md`, '兜底派生补回 docs.apiDocs');
});

test('touch set: prose hits, template lines do not', () => {
  assert.deepEqual(touchProblems('本次改共享契约', 'L1'), ['触达共享契约。级别写 L2。']);
  assert.deepEqual(touchProblems('改 schema', 'L2'), ['触达schema。级别写 L3。']);
  assert.deepEqual(touchProblems('改 schema', 'L3'), []);
  assert.deepEqual(touchProblems('- [ ] 编码权威 → 级别至少 L2', 'L1'), []);
  assert.deepEqual(touchProblems('- [x] 规则变更 → 级别至少 L2', 'L1'), ['触达红线。级别写 L2。']);
  assert.equal(externalReviewId('复核上下文：<会话或子代理 id>'), '');
  assert.equal(externalReviewId('- 独立复核：通过（复核上下文：sess-9f3a2c）'), 'sess-9f3a2c');
  assert.deepEqual(filesOutsidePlan(['src/b.mjs', 'src/a.mjs'], 'src/a.mjs'), ['src/b.mjs']);
});

test('triage stops when the requirement hits the closed set below level', () => {
  const root = fixture();
  writeRun(root, { stage: 'triage', triage: null, requirement: '调整共享契约的字段', docs: { entry: null, spec: null, plan: null } });
  const r = runPipeline(root, ['next', '--run', 'test-run', '--triage', 'kind=require level=L1 module=wiki topic=touch']);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.match(r.stdout + r.stderr, /触达共享契约。级别写 L2。/);
  assert.equal(readRun(root).stage, 'triage');
});

test('spec-review and review reject a placeholder id', () => {
  const root = fixture();
  const spec = 'workflow/tasks/2026-11-13-foo/spec.md';
  fs.mkdirSync(path.dirname(path.join(root, spec)), { recursive: true });
  fs.writeFileSync(path.join(root, spec), '## 确认与复核\n\n- 独立复核：P0 无（复核上下文：<会话或子代理 id>）\n');
  writeRun(root, {
    stage: 'spec-review',
    docs: { entry: 'workflow/tasks/2026-11-13-foo/intent.md', spec, plan: 'workflow/plans/t.md' },
    triage: { kind: 'require', level: 'L3', module: 'wiki', topic: 'foo' },
  });
  const bad = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(bad.status, 2, bad.stderr || bad.stdout);
  assert.match(bad.stdout + bad.stderr, /禁止占位符/);

  fs.writeFileSync(path.join(root, spec), '## 确认与复核\n\n- 独立复核：通过（复核上下文：sess-9f3a2c）\n');
  const ok = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  assert.equal(readRun(root).stopType, 'await-confirm');
  assert.equal(readRun(root).stage, 'spec-confirm');
});

test('implement stops for paths outside the plan until delegated', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'workflow/plans/t.md'), '---\n状态: draft\n级别: L1\n---\n\n## 改动方案\n\nsrc/a.mjs\n');
  writeRun(root, {
    stage: 'implement',
    stopType: 'work-order',
    workOrder: { id: 4, kind: 'implement' },
    docs: { entry: 'workflow/plans/t.md', spec: null, plan: 'workflow/plans/t.md' },
  });
  const blocked = runPipeline(root, ['next', '--run', 'test-run', '--files', 'src/b.mjs']);
  assert.equal(blocked.status, 0, blocked.stderr || blocked.stdout);
  assert.match(blocked.stdout, /计划外：src\/b.mjs/);
  assert.equal(readRun(root).stopType, 'await-confirm');
  assert.equal(readRun(root).stage, 'implement');

  const passed = runPipeline(root, ['next', '--run', 'test-run', '--files', 'src/b.mjs', '--delegated', '可以改 src/b.mjs']);
  assert.equal(passed.status, 0, passed.stderr || passed.stdout);
  assert.notEqual(readRun(root).stage, 'implement');
  assert.ok(readRun(root).events.some((e) => e.type === 'confirm' && e.to === 'files'));
});
