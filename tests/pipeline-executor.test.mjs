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
  stageArtifactProblems, failRoute, renderDashboard, stripAnsi, visualWidth, truncate, truncateAnsi, parseGateName,
  pruneWorkOrderContext, listAllRuns, renderMarkdown, inspectArtifact, getAvailableTargets, renderInspect,
  analyzeGateFailure, manifestPristine, isRuntimeOrManaged, checkAuthorized, validateDraftContent, closeoutComplete,
  loadModelRolesConfig, resolveWorkOrderRole, extractDocSection, assembleWorkOrderContext, verifyReviewEndorsement,
  loadPrescriptions, savePrescriptions, findMatchingPrescriptions, generatePostMortem, checkQueueBrake,
  mergeAppliedRxIds,
  parseCodeReviewRange, ensureCodeReviewDoc,
} from '../templates/engine/.agents/scripts/pipeline-run.mjs';
import {
  touchProblems, externalReviewId, parseReviewMetadata, filesOutsidePlan, planPaths,
  buildHandoffSheet, validateHandoffSheet, parseHandoffSheet,
  normalizeModelFamily, isHeterogeneousModel, isApprovedConclusion,
} from '../templates/engine/.agents/scripts/touch-set.mjs';
import { commitmentFingerprint } from '../templates/engine/.agents/scripts/stage-gates.mjs';
import {
  buildEndorsementToken, writeEndorsementToken,
} from '../templates/engine/.agents/scripts/endorsement-protocol.mjs';
import { generatePrescriptionId } from '../templates/engine/.agents/scripts/self-healing-prescriptions.mjs';

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

// 假 git：默认无输出（rev-parse 取不到 SHA，与真实空仓库同形）；
// 设 FAKE_GIT_SHA 时按 SHA 回给 rev-parse —— 代码复核的基准/范围绑定需要可预期的 SHA。
const FAKE_GIT = `const a = process.argv.slice(2);
if (a.includes('rev-parse') && process.env.FAKE_GIT_SHA) console.log(process.env.FAKE_GIT_SHA);
process.exit(0);
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

test('touch set: fill-plan L3 hint span is a form line, real schema lines still trip', () => {
  // fill-plan.mjs 的 L1 计划模板自带提示行（长 span，含 schema 字样）；保留即落盘不应误报
  const hint = '- L3 追加：<含 schema 变更：备份 + 回滚 SQL 就绪后执行；仅运行时 / 管线：回退上一 release tag + 配置开关预案>';
  assert.deepEqual(touchProblems(hint, 'L1'), []);
  assert.deepEqual(touchProblems(hint, 'L2'), []);
  // 防过度豁免：真实 L1 计划正文提到 schema 仍须报错
  assert.deepEqual(touchProblems('本次改动含 schema 变更', 'L1'), ['触达schema。级别写 L3。']);
});

test('touch set: bold markdown paths are collected into the plan allowlist', () => {
  const section = '改动：**src/a.mjs** 改文案';
  assert.ok(planPaths(section).has('src/a.mjs'));
  assert.deepEqual(filesOutsidePlan(['src/a.mjs'], section), []);
  assert.deepEqual(filesOutsidePlan(['src/a.mjs', 'src/b.mjs'], section), ['src/b.mjs']);
});

test('touch set: bare key=value stays out of the allowlist, --flag= and checkbox ] forms still collected', () => {
  // 审查遗留批 2026-11-23：裸 key=value 赋值不再被提取进授权面（此前会放行名为 value.json 的
  // 计划外文件，放宽「偏离即停」）；`=` 收窄为本意所在的长旗标形态（--out=x.mjs）
  const bare = '配置赋值 name=value.json 不进授权面';
  assert.equal(planPaths(bare).has('value.json'), false);
  assert.equal(planPaths(bare).has('value.js'), false);
  assert.deepEqual(filesOutsidePlan(['value.json'], bare), ['value.json']);
  const flag = '自验产物 --out=report.mjs 落盘';
  assert.ok(planPaths(flag).has('report.mjs'), '旗标形态 --out=x.mjs 仍进允许集');
  assert.deepEqual(filesOutsidePlan(['report.mjs', 'other.mjs'], flag), ['other.mjs']);
  // `]` 边界：复选框紧贴路径的清单行仍可入选允许集
  assert.ok(planPaths('- [x]src/a.mjs').has('src/a.mjs'));
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

test('renderDashboard: visualWidth, stripAnsi, and truncate handles ASCII and CJK', () => {
  assert.equal(stripAnsi('\x1b[31mhello\x1b[39m'), 'hello');
  assert.equal(visualWidth('hello'), 5);
  assert.equal(visualWidth('你好'), 4);
  assert.equal(visualWidth('\x1b[32m你好\x1b[39m world'), 10);
  assert.equal(truncate('123456789', 5), '1234…');
  assert.equal(truncate('测试文字截断', 6), '测试…');
});

test('renderDashboard: renders work-order with stage flow and pixel-perfect borders', () => {
  const root = fixture();
  const ctx = { root, pipeline: {} };
  const run = {
    runId: '20261121-223000-task',
    requirement: '实现 Pipeline 实时 TUI 阶段监控看板',
    triage: { level: 'L1', kind: 'require', module: 'pipeline', topic: 'tui-dash' },
    stage: 'implement',
    stopType: 'work-order',
    workOrder: {
      id: 3,
      kind: 'implement',
      title: '实现看板组件',
      goal: '按设计完成代码与自测',
      instructions: ['实现 renderDashboard', '补齐测试'],
    },
    docs: { entry: 'workflow/intents/t.md', spec: null, plan: 'workflow/plans/t.md' },
    events: [
      { t: '2026-11-21T12:00:00.000Z', type: 'run-created' },
      { t: '2026-11-21T12:01:00.000Z', type: 'gate', cmd: 'verify.mjs', exit: 0 },
      { t: '2026-11-21T12:02:00.000Z', type: 'work-order', id: 3 },
    ],
  };

  const width = 80;
  const lines = renderDashboard(ctx, run, { width, noColor: false });
  assert.ok(lines.length >= 15);

  // 校验包含标题与工单关键字段
  const text = lines.map(stripAnsi).join('\n');
  assert.match(text, /Pipeline 看板: 20261121-223000-task/);
  assert.match(text, /实现 Pipeline 实时 TUI 阶段监控看板/);
  assert.match(text, /工单 #3 \(implement\) 实现看板组件/);
  assert.match(text, /flow-kit run pipeline-run\.mjs next/);
  assert.match(text, /产物文档/);
  assert.match(text, /最近事件流水/);

  // 阶段流向图高亮当前阶段
  assert.match(text, /»Build«/);

  // 严格检验外框每行的视觉对齐宽度（包含 CJK 与 ANSI）
  // 排除最后一行的 footer（无外框）
  const framedLines = lines.slice(0, -1);
  for (let i = 0; i < framedLines.length; i++) {
    const vw = visualWidth(framedLines[i]);
    assert.equal(vw, width, `Line ${i} visualWidth is ${vw}, expected ${width}:\n${framedLines[i]}`);
  }
});

test('renderDashboard: renders await-confirm, gate-fail, done, and aborted stopTypes', () => {
  const root = fixture();
  const ctx = { root, pipeline: {} };

  // await-confirm
  const confirmRun = {
    runId: 'run-confirm',
    requirement: '等待用户确认',
    stage: 'plan-confirm',
    stopType: 'await-confirm',
    awaitConfirm: { doc: 'workflow/plans/t.md', points: '确认改动方案与影响面', ledger: true },
    events: [],
  };
  const confirmText = renderDashboard(ctx, confirmRun, { width: 70, noColor: true }).join('\n');
  assert.match(confirmText, /等待确认/);
  assert.match(confirmText, /next --delegated/);

  // gate-fail
  const failRun = {
    runId: 'run-fail',
    requirement: '门禁阻拦',
    stage: 'verify',
    stopType: 'gate-fail',
    gateFail: { problems: ['单元测试未通过', '存在未跟踪文件'] },
    events: [],
  };
  const failText = renderDashboard(ctx, failRun, { width: 70, noColor: true }).join('\n');
  assert.match(failText, /门禁拒绝 \(阶段: verify\)/);
  assert.match(failText, /单元测试未通过/);

  // done
  const doneRun = {
    runId: 'run-done',
    requirement: '已完工',
    stage: 'done',
    stopType: 'done',
    docs: { entry: 'workflow/intents/t.md' },
    events: [
      { t: '2026-11-21T12:00:00.000Z', type: 'gate', exit: 0 },
      { t: '2026-11-21T12:01:00.000Z', type: 'confirm' },
      { t: '2026-11-21T12:02:00.000Z', type: 'commit' },
    ],
  };
  const doneText = renderDashboard(ctx, doneRun, { width: 70, noColor: true }).join('\n');
  assert.match(doneText, /流程全部完成/);
  assert.match(doneText, /门执行 1 道/);

  // aborted
  const abortRun = {
    runId: 'run-abort',
    requirement: '放弃任务',
    stage: 'plan-draft',
    stopType: 'aborted',
    abort: { to: 'cancelled', note: '方案过时' },
    events: [],
  };
  const abortText = renderDashboard(ctx, abortRun, { width: 70, noColor: true }).join('\n');
  assert.match(abortText, /已放弃 \(cancelled\)/);
  assert.match(abortText, /方案过时/);
});

test('CLI: watch and dashboard --once snapshots active run and exits 0', () => {
  const root = fixture();
  writeRun(root, {
    stage: 'implement',
    stopType: 'work-order',
    workOrder: { id: 2, kind: 'implement', title: 'CLI 测试', goal: '测试快照模式' },
    docs: { entry: 'workflow/plans/t.md', plan: 'workflow/plans/t.md' },
  });

  const resWatch = runPipeline(root, ['watch', '--once', '--run', 'test-run']);
  assert.equal(resWatch.status, 0, resWatch.stderr || resWatch.stdout);
  assert.match(resWatch.stdout, /Pipeline 看板: test-run/);
  assert.match(resWatch.stdout, /工单 #2 \(implement\) CLI 测试/);
  assert.match(resWatch.stdout, /单次快照模式/);

  const resDash = runPipeline(root, ['dashboard', '--once', '--run', 'test-run']);
  assert.equal(resDash.status, 0, resDash.stderr || resDash.stdout);
  assert.match(resDash.stdout, /Pipeline 看板: test-run/);
  assert.match(resDash.stdout, /工单 #2 \(implement\) CLI 测试/);
  assert.match(resDash.stdout, /单次快照模式/);
});

test('parseGateName: accepts valid gate script names, rejects paths and non-mjs', () => {
  assert.equal(parseGateName('verify.mjs'), 'verify.mjs');
  assert.equal(parseGateName('check-loop.mjs'), 'check-loop.mjs');
  assert.equal(parseGateName('custom_gate.1.mjs'), 'custom_gate.1.mjs');

  assert.throws(() => parseGateName(''), /--gate 必填门脚本名/);
  assert.throws(() => parseGateName(null), /--gate 必填门脚本名/);
  assert.throws(() => parseGateName('../verify.mjs'), /只接受 \.mjs 脚本名/);
  assert.throws(() => parseGateName('foo/verify.mjs'), /只接受 \.mjs 脚本名/);
  assert.throws(() => parseGateName('verify.js'), /只接受 \.mjs 脚本名/);
  assert.throws(() => parseGateName('pipeline-run.mjs'), /只接受 \.mjs 脚本名/);
});

test('renderDashboard: renders step stopType state and actionable next step', () => {
  const ctx = { root: '/repo' };
  const stepRun = {
    runId: 'run-step-demo',
    requirement: '分步调试演示',
    stage: 'verify',
    stopType: 'step',
    docs: { entry: 'workflow/intents/t.md', plan: 'workflow/plans/t.md' },
    events: [
      { t: '2026-11-21T12:00:00.000Z', type: 'step-pause', stage: 'verify' },
    ],
  };
  const stepText = renderDashboard(ctx, stepRun, { width: 70, noColor: true }).join('\n');
  assert.match(stepText, /单步暂停 \(已就绪阶段: verify\)/);
  assert.match(stepText, /流水线已在阶段转换边界暂停/);
  assert.match(stepText, /flow-kit run pipeline-run\.mjs next --step/);
});

test('CLI: start and next with --step pauses at state transition boundaries', () => {
  const root = fixture();
  // start issues initial triage work-order
  const resStart = runPipeline(root, ['start', '用户需求', '--hint', 'kind=require level=L1 module=wiki topic=my-step-task', '--step']);
  assert.equal(resStart.status, 0, resStart.stderr || resStart.stdout);
  assert.match(resStart.stdout, /PIPELINE-STOP work-order/);

  // next with --triage and --step completes triage and pauses at transition boundary to plan-fill
  const resTriage = runPipeline(root, ['next', '--triage', 'kind=require level=L1 module=wiki topic=my-step-task', '--step']);
  assert.equal(resTriage.status, 0, resTriage.stderr || resTriage.stdout);
  assert.match(resTriage.stdout, /PIPELINE-STOP step/);
  assert.match(resTriage.stdout, /单步暂停/);
  assert.match(resTriage.stdout, /阶段就绪：plan-fill/);

  // read run file
  const runFile = fs.readdirSync(path.join(root, '.agents', 'cache', 'pipeline-runs')).find((f) => f.endsWith('.json'));
  assert.ok(runFile, 'run file must exist');
  const runData = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'cache', 'pipeline-runs', runFile), 'utf8'));
  assert.equal(runData.stopType, 'step');
  assert.equal(runData.stage, 'plan-fill');
  assert.ok(runData.events.some((e) => e.type === 'step-pause' && e.stage === 'plan-fill'));

  // next --step resumes from step-pause and enters plan-fill (which issues draft work-order)
  const resNext = runPipeline(root, ['next', '--step']);
  assert.equal(resNext.status, 0, resNext.stderr || resNext.stdout);
  assert.match(resNext.stdout, /PIPELINE-STOP work-order/);

  const runData2 = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'cache', 'pipeline-runs', runFile), 'utf8'));
  assert.ok(runData2.events.some((e) => e.type === 'step-resume' && e.stage === 'plan-fill'));
  assert.equal(runData2.stopType, 'work-order');
  assert.equal(runData2.stage, 'plan-draft');
});

test('CLI: gate subcommand executes single gate script directly', () => {
  const root = fixture();
  writeRun(root, {
    stage: 'verify',
    stopType: 'work-order',
  });

  // verify.mjs exits 0
  const resGate = runPipeline(root, ['gate', 'verify.mjs', '--run', 'test-run']);
  assert.equal(resGate.status, 0, resGate.stderr || resGate.stdout);
  assert.match(resGate.stdout, /门 verify\.mjs 验证通过 \(exit 0\)/);

  // check-extra.mjs with PIPELINE_FAKE_EXTRA_EXIT=2
  const resFail = runPipeline(root, ['gate', 'check-extra.mjs', '--run', 'test-run'], { PIPELINE_FAKE_EXTRA_EXIT: '2' });
  assert.equal(resFail.status, 2);
  assert.match(resFail.stderr, /门 check-extra\.mjs 验证未通过 \(exit 2\)/);
});

test('CLI: next --gate executes targeted gate script in verify stage and records gate-tested', () => {
  const root = fixture({ withPlan: true });
  fs.mkdirSync(path.join(root, 'workflow', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'plans', 't.md'), '# plan\n');

  writeRun(root, {
    stage: 'verify',
    stopType: 'work-order',
    docs: { entry: 'workflow/plans/t.md', plan: 'workflow/plans/t.md' },
  });

  const res = runPipeline(root, ['next', '--gate', 'check-extra.mjs', '--run', 'test-run']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /定向门 check-extra\.mjs 验证通过 \(exit 0\)/);

  const runData = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'cache', 'pipeline-runs', 'test-run.json'), 'utf8'));
  assert.ok(runData.events.some((e) => e.type === 'gate-tested' && e.script === 'check-extra.mjs' && e.exit === 0));
});

test('CLI: next --gate with a misspelled gate fails fast instead of spawning into the fix loop', () => {
  // 审查遗留批 2026-11-23：--gate 预检脚本存在（对齐 gate 子命令）——拼错门名不再 spawn exit 1 进修复环
  const root = fixture();
  writeRun(root, { stage: 'verify' });
  const res = runPipeline(root, ['next', '--gate', 'check-nonsense.mjs', '--run', 'test-run']);
  assert.equal(res.status, 1, res.stderr || res.stdout);
  assert.match(res.stderr, /门脚本不存在/);
  const runData = readRun(root);
  assert.equal(runData.stage, 'verify', 'run 停在原阶段，未进修复环');
  assert.equal(runData.stopType, 'work-order');
  assert.ok(!runData.events.some((e) => e.type === 'gate'), '未产生任何门执行事件');
});

test('CLI: next --gate outside the verify stage errors explicitly instead of being ignored', () => {
  // 审查遗留批 2026-11-23：非 verify 阶段给 --gate 显式报错（原先被静默忽略，误以为定向门已跑）
  const root = fixture();
  writeRun(root, { stage: 'triage' });
  const res = runPipeline(root, ['next', '--gate', 'verify.mjs', '--run', 'test-run']);
  assert.equal(res.status, 2, res.stderr || res.stdout);
  assert.match(res.stderr, /--gate 仅 verify 阶段可用/);
});

test('CLI: inspect --max-lines 0 renders the full artifact, default still caps at 200', () => {
  // 审查遗留批 2026-11-23：折叠提示让用户「--max-lines 0 查看全量」，但 0 曾落回 200 行——提示与实现一致
  const root = fixture();
  writeRun(root, { stage: 'verify' });
  const docLines = [];
  for (let i = 1; i <= 220; i++) docLines.push(`word-${String(i).padStart(3, '0')}`);
  fs.writeFileSync(path.join(root, 'doc.md'), `${docLines.join('\n')}\n`);

  const full = runPipeline(root, ['inspect', 'doc.md', '--max-lines', '0']);
  assert.equal(full.status, 0, full.stderr || full.stdout);
  assert.ok(full.stdout.includes('word-220'), '0 = 不限行数（含最后一行）');
  assert.ok(!full.stdout.includes('已折叠'), '0 = 全量时不出现折叠提示');

  const capped = runPipeline(root, ['inspect', 'doc.md', '--max-lines', '10']);
  assert.ok(capped.stdout.includes('word-010') && !capped.stdout.includes('word-011'), '正数按行数截断');

  const fallback = runPipeline(root, ['inspect', 'doc.md']);
  assert.ok(!fallback.stdout.includes('word-220'), '未传旗标仍按默认 200 行折叠');
  assert.ok(fallback.stdout.includes('已折叠'));
});

test('parseReviewMetadata extracts ID, model, and downgrade details', () => {
  // 1. Normal review without downgrade
  const meta1 = parseReviewMetadata('- 独立复核：通过 复核上下文：subagent-session-123 评审模型：claude-3-7-sonnet');
  assert.equal(meta1.id, 'subagent-session-123');
  assert.equal(meta1.reviewerModel, 'claude-3-7-sonnet');
  assert.equal(meta1.isDowngraded, false);
  assert.equal(meta1.downgradeReason, '');

  // 2. Review with downgrade note
  const meta2 = parseReviewMetadata('- 独立复核：通过 复核上下文：reviewer-99 (跨模型降级：高阶模型配额耗尽，降级至 host-default)');
  assert.equal(meta2.id, 'reviewer-99');
  assert.equal(meta2.isDowngraded, true);
  assert.match(meta2.downgradeReason, /高阶模型配额耗尽/);

  // 3. Review without ID
  const meta3 = parseReviewMetadata('- 独立复核：待定');
  assert.equal(meta3.id, '');
  assert.equal(meta3.isDowngraded, false);
});

test('parseReviewMetadata downgrade detection: prose mentions do not trigger, line-start declarations do', () => {
  // 审查遗留批 2026-11-23：裸词（降级/downgrade/fallback）仅认行首键值式显式声明——
  // 此前正文 prose 提及即误判，spec-review/review 每次通过都重发 review-downgrade 事件，看板恒挂黄标
  const prose1 = parseReviewMetadata('- 独立复核：通过 复核上下文：sess-9f3a2c 结论：本方案无需降级，如受限再评估 fallback 方案');
  assert.equal(prose1.isDowngraded, false, '正文提及「降级/fallback」不再触发');
  const prose2 = parseReviewMetadata('结论：如需降级：见回退预案');
  assert.equal(prose2.isDowngraded, false, '行中「降级：」不再是显式声明');
  const prose3 = parseReviewMetadata('reviewer may downgrade to L1 checks');
  assert.equal(prose3.isDowngraded, false, '行中英文 downgrade 不再触发');

  // 显式声明行（行首，容忍列表/引用前缀）仍触发并提取原因
  const decl1 = parseReviewMetadata('- 独立复核：通过 复核上下文：sess-9f3a2c\n- 降级：高阶配额耗尽，降级至 host-default');
  assert.equal(decl1.isDowngraded, true);
  assert.match(decl1.downgradeReason, /高阶配额耗尽/);
  const decl2 = parseReviewMetadata('fallback: local model only');
  assert.equal(decl2.isDowngraded, true);
  assert.equal(decl2.downgradeReason, 'local model only');
  const decl3 = parseReviewMetadata('> 降级：配额受限，转 host-default');
  assert.equal(decl3.isDowngraded, true);
});

test('pruneWorkOrderContext trims context fields and records budget savings', () => {
  // Within budget
  const smallCtx = { relatedDocs: ['a.md'], kbHits: ['hit1'], stderrTail: 'error' };
  const resSmall = pruneWorkOrderContext(smallCtx, 1200);
  assert.equal(resSmall.budget.pruned, false);
  assert.equal(resSmall.budget.savingsPercent, 0);

  // Over budget
  const largeCtx = {
    relatedDocs: ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'a.md'],
    kbHits: [
      'A'.repeat(200),
      'B'.repeat(200),
      'C'.repeat(200),
      'D'.repeat(200),
    ],
    stderrTail: Array.from({ length: 20 }, (_, i) => `Line ${i + 1}: detailed error stack dump here`).join('\n'),
  };
  const resLarge = pruneWorkOrderContext(largeCtx, 500);
  assert.equal(resLarge.budget.pruned, true);
  assert.ok(resLarge.budget.savingsPercent > 0);
  assert.equal(resLarge.relatedDocs.length, 4); // deduped & max 4
  assert.equal(resLarge.kbHits.length, 3); // max 3
  assert.ok(resLarge.kbHits[0].endsWith('...'));
  assert.ok(resLarge.stderrTail.includes('... [跳过'));
  assert.ok(resLarge.stderrTail.length <= 400);
});

test('CLI: spec-review emits review-downgrade event when metadata has downgrade declaration', () => {
  const root = fixture();
  const specRel = 'workflow/tasks/2026-11-13-test-topic/spec.md';
  const specAbs = path.join(root, specRel);
  fs.mkdirSync(path.dirname(specAbs), { recursive: true });
  fs.writeFileSync(specAbs, [
    '---',
    '状态: draft',
    '级别: L1',
    '模块: wiki',
    '---',
    '',
    '# Spec',
    '',
    '## 确认与复核',
    '- 独立复核：通过 复核上下文：reviewer-session-77 (跨模型降级：配额告警切换备用模型)',
  ].join('\n'));

  writeRun(root, {
    stage: 'spec-review',
    stopType: 'work-order',
    docs: { entry: 'workflow/intents/t.md', spec: specRel, plan: null },
  });

  const res = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /PIPELINE-STOP await-confirm/);

  const runData = readRun(root, 'test-run');
  const dg = runData.events.find((e) => e.type === 'review-downgrade');
  assert.ok(dg, 'must emit review-downgrade event');
  assert.equal(dg.stage, 'spec-review');
  assert.match(dg.reason, /配额告警/);
});

test('CLI: spec-review emits review-downgrade event when --review-downgrade flag is used', () => {
  const root = fixture();
  const specRel = 'workflow/tasks/2026-11-13-test-topic/spec.md';
  const specAbs = path.join(root, specRel);
  fs.mkdirSync(path.dirname(specAbs), { recursive: true });
  fs.writeFileSync(specAbs, [
    '---',
    '状态: draft',
    '级别: L1',
    '模块: wiki',
    '---',
    '',
    '# Spec',
    '',
    '## 确认与复核',
    '- 独立复核：通过 复核上下文：subagent-999',
  ].join('\n'));

  writeRun(root, {
    stage: 'spec-review',
    stopType: 'work-order',
    docs: { entry: 'workflow/intents/t.md', spec: specRel, plan: null },
  });

  const res = runPipeline(root, ['next', '--run', 'test-run', '--review-downgrade', '主模型限流强制降级']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /PIPELINE-STOP await-confirm/);

  const runData = readRun(root, 'test-run');
  const dg = runData.events.find((e) => e.type === 'review-downgrade');
  assert.ok(dg, 'must emit review-downgrade event');
  assert.equal(dg.reason, '主模型限流强制降级');
});

test('work-order context applies pruning and attaches budget info', () => {
  const root = fixture();
  const dispatchPath = path.join(root, '.agents', 'config', 'dispatch.json');
  fs.mkdirSync(path.dirname(dispatchPath), { recursive: true });
  fs.writeFileSync(dispatchPath, JSON.stringify({
    note: "2026-11-16 只计量不阻断",
    workOrderContextBudgetChars: 300,
  }));

  const res = runPipeline(root, ['start', '用户需求', '--hint', 'kind=require level=L1 module=wiki topic=test-budget']);
  assert.equal(res.status, 0, res.stderr || res.stdout);

  const runFile = fs.readdirSync(path.join(root, '.agents', 'cache', 'pipeline-runs')).find((f) => f.endsWith('.json'));
  assert.ok(runFile);
  const runData = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'cache', 'pipeline-runs', runFile), 'utf8'));
  assert.ok(runData.workOrder);
  assert.ok(runData.workOrder.context.budget);
  assert.equal(runData.workOrder.context.budget.budgetChars, 300);
});

test('listAllRuns discovers runs and filters by all / active / attention', () => {
  const root = fixture();
  const runsDir = path.join(root, '.agents', 'cache', 'pipeline-runs');
  fs.mkdirSync(runsDir, { recursive: true });

  const r1 = { runId: '20261122-1001-task-a', stopType: 'work-order', stage: 'triage', requirement: 'req A', events: [] };
  const r2 = { runId: '20261122-1002-task-b', stopType: 'done', stage: 'done', requirement: 'req B', events: [] };
  const r3 = { runId: '20261122-1003-task-c', stopType: 'await-confirm', stage: 'spec-confirm', requirement: 'req C', events: [] };
  const r4 = { runId: '20261122-1004-task-d', stopType: 'aborted', stage: 'plan-draft', requirement: 'req D', events: [] };

  for (const r of [r1, r2, r3, r4]) {
    fs.writeFileSync(path.join(runsDir, `${r.runId}.json`), JSON.stringify(r));
  }

  const ctx = { runsDir, root };
  const all = listAllRuns(ctx, 'all');
  assert.equal(all.length, 4);
  assert.equal(all[0].runId, '20261122-1004-task-d'); // newest first

  const active = listAllRuns(ctx, 'active');
  assert.equal(active.length, 2);
  assert.deepEqual(active.map((r) => r.runId), ['20261122-1003-task-c', '20261122-1001-task-a']);

  const attention = listAllRuns(ctx, 'attention');
  assert.equal(attention.length, 2);
  assert.deepEqual(attention.map((r) => r.runId), ['20261122-1003-task-c', '20261122-1001-task-a']);
});

test('renderDashboard formats multi-run selector header and footer', () => {
  const root = fixture();
  const run = {
    runId: '20261122-1001-task-a',
    requirement: '测试多 Run 看板切换',
    stage: 'implement',
    stopType: 'work-order',
    workOrder: { id: 1, kind: 'implement', title: '实现特性', goal: '通过所有测试' },
    docs: {},
    events: [],
  };

  const lines = renderDashboard({ root }, run, {
    selector: { current: 1, total: 3, filter: 'active' },
    noColor: true,
  });
  const text = lines.join('\n');
  assert.match(text, /Pipeline 看板 \[1\/3 · 活跃\]: 20261122-1001-task-a/);
  assert.match(text, /\[◄\/►\] 切换 Run/);
  assert.match(text, /\[F\] 过滤/);

  // 单次快照模式下无快捷键轮询文字
  const onceLines = renderDashboard({ root }, run, {
    selector: { current: 1, total: 3, filter: 'all' },
    noColor: true,
    once: true,
  });
  const onceText = onceLines.join('\n');
  assert.match(onceText, /Pipeline 看板 \[1\/3 · 全部\]: 20261122-1001-task-a/);
  assert.match(onceText, /单次快照模式/);
});

test('dashboard --once runs cleanly from CLI', () => {
  const root = fixture();
  writeRun(root, { runId: 'test-dash-run', stage: 'triage', stopType: 'work-order' });
  const res = runPipeline(root, ['dashboard', '--run', 'test-dash-run', '--once']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /Pipeline 看板: test-dash-run/);
  assert.match(res.stdout, /单次快照模式/);
});

test('renderMarkdown: formats headers, alerts, lists, and code blocks', () => {
  const md = [
    '# 主标题',
    '## 二级标题',
    '### 三级标题',
    '> [!WARNING]',
    '> 这是一个警告提示',
    '- [x] 已完成项',
    '- [ ] 待办项',
    '- 普通列表',
    '1. 步骤一',
    '```javascript',
    'const a = 1;',
    '```',
  ].join('\n');

  const lines = renderMarkdown(md, { noColor: true, width: 60 });
  const text = lines.join('\n');
  assert.match(text, /═══ 主标题 ═══/);
  assert.match(text, /─── 二级标题 ───/);
  assert.match(text, /▶ 三级标题/);
  assert.match(text, /\[WARNING\]/);
  assert.match(text, /\[✓\] 已完成项/);
  assert.match(text, /\[ \] 待办项/);
  assert.match(text, /• 普通列表/);
  assert.match(text, /1\. 步骤一/);
  assert.match(text, /\[javascript\]/);
  assert.match(text, /const a = 1;/);
});

test('inspectArtifact: resolves entry, spec, plan, work-order, problems, and risk documents', () => {
  const root = fixture();
  const ctx = { root, gitPrefix: ['git'] };

  // 1. 创建测试产物文件
  const taskDir = path.join(root, 'workflow', 'tasks', '2026-11-22-test-topic');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'intent.md'), '---\n状态: approved\n---\n# 意图说明\n测试意图正文');
  fs.writeFileSync(path.join(taskDir, 'spec.md'), '---\n状态: draft\n---\n# 规格说明\n测试规格');
  fs.writeFileSync(path.join(taskDir, 'risk-intercept.md'), '---\n状态: intercept\n---\n> [!CAUTION]\n拦截敏感权限操作');

  const run = {
    runId: '20261122-120000-test-topic',
    stage: 'plan-confirm',
    stopType: 'work-order',
    docs: {
      entry: 'workflow/tasks/2026-11-22-test-topic/intent.md',
      spec: 'workflow/tasks/2026-11-22-test-topic/spec.md',
      plan: 'workflow/tasks/2026-11-22-test-topic/plan.md',
    },
    workOrder: {
      id: 'plan-draft-1',
      kind: 'draft',
      title: '起草 Plan 执行计划',
      goal: '起草完成 plan.md',
      instructions: ['1. 填入改动方案', '2. 填入验证步骤'],
    },
    gateFail: {
      problems: ['缺少 plan.md 产物契约'],
    },
  };

  // 1. entry
  const entryArt = inspectArtifact(ctx, run, 'entry');
  assert.equal(entryArt.ok, true);
  assert.equal(entryArt.type, 'entry');
  assert.equal(entryArt.state, 'approved');
  assert.match(entryArt.content, /测试意图正文/);

  // 2. spec
  const specArt = inspectArtifact(ctx, run, 'spec');
  assert.equal(specArt.ok, true);
  assert.equal(specArt.type, 'spec');
  assert.equal(specArt.state, 'draft');

  // 3. plan (不存在)
  const planArt = inspectArtifact(ctx, run, 'plan');
  assert.equal(planArt.ok, false);
  assert.match(planArt.error, /文档尚未生成或不存在/);

  // 4. work-order
  const woArt = inspectArtifact(ctx, run, 'work-order');
  assert.equal(woArt.ok, true);
  assert.equal(woArt.type, 'work-order');
  assert.match(woArt.content, /起草 Plan 执行计划/);

  // 5. problems
  const probArt = inspectArtifact(ctx, run, 'problems');
  assert.equal(probArt.ok, true);
  assert.equal(probArt.type, 'problems');
  assert.match(probArt.content, /缺少 plan\.md 产物契约/);

  // 6. risk (自动发现在任务目录下的 risk-intercept.md)
  const riskArt = inspectArtifact(ctx, run, 'risk');
  assert.equal(riskArt.ok, true);
  assert.equal(riskArt.type, 'risk');
  assert.match(riskArt.content, /拦截敏感权限操作/);

  // 7. 直接路径查询
  const directArt = inspectArtifact(ctx, run, 'workflow/tasks/2026-11-22-test-topic/risk-intercept.md');
  assert.equal(directArt.ok, true);
  assert.equal(directArt.type, 'doc');
  assert.match(directArt.content, /拦截敏感权限操作/);

  // 8. 可用标签页
  const avail = getAvailableTargets(ctx, run);
  assert.ok(avail.includes('entry'));
  assert.ok(avail.includes('spec'));
  assert.ok(!avail.includes('plan'));
  assert.ok(avail.includes('work-order'));
  assert.ok(avail.includes('problems'));
});

test('renderInspect: formats artifact viewer layout with tabs, status, and footer', () => {
  const root = fixture();
  const ctx = { root, gitPrefix: ['git'] };
  const taskDir = path.join(root, 'workflow', 'tasks', '2026-11-22-demo');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'intent.md'), '---\n状态: approved\n---\n# 需求意图\n- 目标: 验证检视器排版');

  const run = {
    runId: '20261122-demo-task',
    stage: 'intent-confirm',
    stopType: 'await-confirm',
    docs: {
      entry: 'workflow/tasks/2026-11-22-demo/intent.md',
    },
  };

  const lines = renderInspect(ctx, run, {
    noColor: true,
    target: 'entry',
    selector: { current: 1, total: 2, filter: 'all' },
  });
  const text = lines.join('\n');
  assert.match(text, /Pipeline 产物检视 \[1\/2 · 全部\]: 20261122-demo-task/);
  assert.match(text, /阶段: intent-confirm │ 状态: await-confirm/);
  assert.match(text, /标签页: »\[1:entry\]«/);
  assert.match(text, /需求意图 \(entry\): workflow\/tasks\/2026-11-22-demo\/intent\.md/);
  assert.match(text, /状态: approved/);
  assert.match(text, /═══ 需求意图 ═══/);
  assert.match(text, /• 目标: 验证检视器排版/);
  assert.match(text, /\[Tab\] 切产物/);
  assert.match(text, /\[Esc\/B\] 看板/);
});

test('CLI: inspect subcommand formats artifacts or outputs JSON', () => {
  const root = fixture();
  const taskDir = path.join(root, 'workflow', 'tasks', '2026-11-22-cli-inspect');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'intent.md'), '---\n状态: approved\n---\n# 需求说明\n- 任务目标: CLI 产物检视通过');

  const run = {
    runId: 'test-cli-inspect-run',
    stage: 'intent-confirm',
    stopType: 'await-confirm',
    docs: {
      entry: 'workflow/tasks/2026-11-22-cli-inspect/intent.md',
    },
    workOrder: {
      id: 'wo-test',
      kind: 'review',
      title: '评审工单',
    },
  };
  writeRun(root, run);

  // 1. inspect 纯文本模式
  const resText = runPipeline(root, ['inspect', 'entry', '--run', 'test-cli-inspect-run']);
  assert.equal(resText.status, 0, resText.stderr || resText.stdout);
  assert.match(resText.stdout, /Pipeline 产物检视: test-cli-inspect-run/);
  assert.match(resText.stdout, /需求意图/);
  assert.match(resText.stdout, /CLI 产物检视通过/);

  // 2. inspect --json 机器读取模式
  const resJson = runPipeline(root, ['inspect', 'entry', '--run', 'test-cli-inspect-run', '--json']);
  assert.equal(resJson.status, 0, resJson.stderr || resJson.stdout);
  const parsed = JSON.parse(resJson.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, 'entry');
  assert.equal(parsed.state, 'approved');
  assert.match(parsed.content, /CLI 产物检视通过/);

  // 3. dashboard --once --inspect
  const resDash = runPipeline(root, ['dashboard', '--run', 'test-cli-inspect-run', '--once', '--inspect']);
  assert.equal(resDash.status, 0, resDash.stderr || resDash.stdout);
  assert.match(resDash.stdout, /Pipeline 产物检视: test-cli-inspect-run/);
  assert.match(resDash.stdout, /产物快照模式/);
});

test('analyzeGateFailure: attributes failure patterns across six error categories', () => {
  // 1. budget-exceeded
  const aBudget = analyzeGateFailure('常驻面超限：.agents/commands/pipeline-run.md 11179B > 上限 10752B');
  assert.equal(aBudget.category, 'budget-exceeded');
  assert.equal(aBudget.title, '常驻面体积超限');
  assert.deepEqual(aBudget.impactedFiles, ['.agents/commands/pipeline-run.md']);
  assert.match(aBudget.suggestedAction, /精简 \.agents\/commands\/pipeline-run\.md/);
  assert.equal(aBudget.debugCmd, 'flow-kit run rule-budget.mjs --all');

  // 2. scope-deviation
  const aScope = analyzeGateFailure('git 改动超出回填清单（偏离即停）：src/foo.mjs、lib/bar.mjs');
  assert.equal(aScope.category, 'scope-deviation');
  assert.equal(aScope.title, '改动范围超出计划 (偏离即停)');
  assert.ok(aScope.impactedFiles.includes('src/foo.mjs'));
  assert.ok(aScope.impactedFiles.includes('lib/bar.mjs'));
  assert.equal(aScope.debugCmd, 'git status -s');

  // 3. artifact-missing
  const aArt = analyzeGateFailure('阶段产物缺失：workflow/tasks/2026-11-22-demo/plan.md（plan 契约，见 pipeline.json）');
  assert.equal(aArt.category, 'artifact-missing');
  assert.equal(aArt.title, '阶段契约产物缺失');
  assert.deepEqual(aArt.impactedFiles, ['workflow/tasks/2026-11-22-demo/plan.md']);
  assert.match(aArt.debugCmd, /pipeline-run\.mjs inspect/);

  // 4. policy-drift
  const aPolicy = analyzeGateFailure('[policy-ci] ❌ 策略面不一致（机制 35 行 != policy.json 36 行）');
  assert.equal(aPolicy.category, 'policy-drift');
  assert.equal(aPolicy.title, '策略与机制注册表漂移');
  assert.ok(aPolicy.impactedFiles.includes('.agents/config/policy.json'));
  assert.equal(aPolicy.debugCmd, 'node tools/policy-check.mjs');

  // 5. template-lint
  const aLint = analyzeGateFailure('模板占位符残留：{{topic}}、{{module}}', { docPath: 'workflow/tasks/demo/spec.md' });
  assert.equal(aLint.category, 'template-lint');
  assert.equal(aLint.title, '工作流文档规范校验未通过');
  assert.deepEqual(aLint.impactedFiles, ['workflow/tasks/demo/spec.md']);
  assert.equal(aLint.debugCmd, 'flow-kit run check-pipeline-state.mjs');

  // 6. test-failure
  const rawTestOutput = `
test at tests/rule-budget.test.mjs:43:1
✖ dotnet profile fresh install passes its own shipped budgets in both languages (8818.5723ms)
  AssertionError [ERR_ASSERTION]: [zh-CN] rule-budget exit 1
  常驻面超限：.agents/commands/pipeline-run.md 11179B > 上限 10752B
`;
  // budget-exceeded 优先于通用断言
  const aTestBudget = analyzeGateFailure(rawTestOutput);
  assert.equal(aTestBudget.category, 'budget-exceeded');

  // 纯测试断言失败
  const rawPureTest = `
test at tests/unit-calc.test.mjs:15:2
✖ sum computes correct result (12.3ms)
  AssertionError [ERR_ASSERTION]: Expected 4 to equal 5
`;
  const aTest = analyzeGateFailure(rawPureTest);
  assert.equal(aTest.category, 'test-failure');
  assert.equal(aTest.title, '测试用例断言未通过');
  assert.deepEqual(aTest.impactedFiles, ['tests/unit-calc.test.mjs']);
  assert.equal(aTest.debugCmd, 'node --test tests/unit-calc.test.mjs');

  // 7. unknown
  const aUnknown = analyzeGateFailure('Some unexpected crash code: 137');
  assert.equal(aUnknown.category, 'unknown');
  assert.equal(aUnknown.title, '门禁检查未通过');
});

test('inspectArtifact and renderDashboard: surfaces Smart Fix attribution', () => {
  const root = fixture();
  const ctx = { root, gitPrefix: ['git'] };

  const analysis = {
    category: 'budget-exceeded',
    title: '常驻面体积超限',
    summary: '.agents/commands/pipeline-run.md 11179B > 上限 10752B',
    suggestedAction: '精简文档文字至上限内',
    impactedFiles: ['.agents/commands/pipeline-run.md'],
    debugCmd: 'node --test tests/rule-budget.test.mjs',
  };

  const run = {
    runId: '20261122-smart-fix-run',
    stage: 'fix',
    stopType: 'work-order',
    workOrder: {
      id: 2,
      kind: 'fix',
      title: '修复环 1/3：verify 未过',
      goal: '按失败输出修复后回跑',
      instructions: [
        '0. [智能归因]: 常驻面体积超限 - 精简文档文字至上限内',
        '   [定向调试]: node --test tests/rule-budget.test.mjs',
        '1. 读下方输出修复',
      ],
      context: {
        docPath: 'workflow/tasks/demo/plan.md',
        relatedDocs: ['.agents/commands/pipeline-run.md'],
      },
      fixAnalysis: analysis,
    },
    gateFail: {
      stage: 'verify',
      problems: ['常驻面超限：.agents/commands/pipeline-run.md 11179B > 上限 10752B'],
      analysis,
    },
  };

  // 1. inspect problems 包含智能归因与警示块
  const art = inspectArtifact(ctx, run, 'problems');
  assert.equal(art.ok, true);
  assert.match(art.content, /> \[!WARNING\] \*\*智能归因诊断\*\*: 常驻面体积超限/);
  assert.match(art.content, /> - \*\*核心原因\*\*: \.agents\/commands\/pipeline-run\.md 11179B > 上限 10752B/);
  assert.match(art.content, /> - \*\*涉及文件\*\*: `\.agents\/commands\/pipeline-run\.md`/);
  assert.match(art.content, /> - \*\*推荐调试\*\*: `node --test tests\/rule-budget\.test\.mjs`/);

  // 2. renderDashboard 展示归因与定向调试命令
  const dashLines = renderDashboard(ctx, run, { noColor: true });
  const dashText = dashLines.join('\n');
  assert.match(dashText, /💡 智能归因: 常驻面体积超限/);
  assert.match(dashText, /🔧 定向调试: node --test tests\/rule-budget\.test\.mjs/);

  // 3. gate-fail stopType 同样展示归因
  const failRun = {
    ...run,
    stopType: 'gate-fail',
    workOrder: null,
  };
  const failDash = renderDashboard(ctx, failRun, { noColor: true }).join('\n');
  assert.match(failDash, /💡 归因: 常驻面体积超限 \(budget-exceeded\)/);
  assert.match(failDash, /🔧 建议调试: node --test tests\/rule-budget\.test\.mjs/);
});

test('manifestPristine: CRLF file matches manifest sha256 computed from LF', () => {
  const root = makeTmp('pipeline-crlf-');
  const rel = 'src/example.txt';
  const lfContent = 'hello\nworld\n';
  const crlfContent = 'hello\r\nworld\r\n';
  const hash = crypto.createHash('sha256').update(lfContent, 'utf8').digest('hex');

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(root, rel), crlfContent);
  fs.writeFileSync(path.join(root, '.agents', 'install-manifest.json'), JSON.stringify({
    kit: 'agentic-flow-kit',
    files: { [rel]: hash },
  }));

  const pristine = manifestPristine({ root });
  assert.ok(pristine.has(rel), 'CRLF file should be recognized as pristine when normalized LF hash matches');
});

test('isRuntimeOrManaged: matches runtime allowlist and installer merge-blocks', () => {
  const root = makeTmp('pipeline-runtime-');
  const ctx = { root };

  // Runtime owned
  assert.equal(isRuntimeOrManaged(ctx, '.agents/cache/foo.json'), true);
  assert.equal(isRuntimeOrManaged(ctx, '.agents/config/model-roles.local.json'), true);
  assert.equal(isRuntimeOrManaged(ctx, '.agents/config/session-context.local.json'), true);
  assert.equal(isRuntimeOrManaged(ctx, '.agents/notes/runtime-env.local.md'), true);
  assert.equal(isRuntimeOrManaged(ctx, '.agents/.kit/baseline/snapshot.json'), true);
  assert.equal(isRuntimeOrManaged(ctx, '.agents/verifications.jsonl'), true);
  assert.equal(isRuntimeOrManaged(ctx, '.agents/judgments.jsonl'), true);
  // 评测凭证是可归因的零信任证据面，必须由工单在 --files 显式申报
  assert.equal(isRuntimeOrManaged(ctx, '.agents/evals/report.json'), false);
  assert.equal(isRuntimeOrManaged(ctx, '.agents/evals/results.jsonl'), false);
  assert.equal(isRuntimeOrManaged(ctx, '.agents/install-manifest.json'), true);

  // Managed merge blocks in .gitattributes and .gitignore
  fs.writeFileSync(path.join(root, '.gitattributes'), '# >>> agentic-flow-kit gitattributes\n* text=auto eol=lf\n# <<< agentic-flow-kit gitattributes\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '# >>> agentic-flow-kit ignores\n.agents/cache/\n# <<< agentic-flow-kit ignores\n');
  assert.equal(isRuntimeOrManaged(ctx, '.gitattributes'), true);
  assert.equal(isRuntimeOrManaged(ctx, '.gitignore'), true);

  // 裸名称或旧 magpie 标记不是托管块：不得豁免
  fs.writeFileSync(path.join(root, '.gitattributes'), '# <!-- magpie:begin -->\n* text=auto eol=lf\n# <!-- magpie:end -->\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '# agentic-flow-kit managed\n.agents/cache/\n');
  assert.equal(isRuntimeOrManaged(ctx, '.gitattributes'), false);
  assert.equal(isRuntimeOrManaged(ctx, '.gitignore'), false);

  // Normal user file
  assert.equal(isRuntimeOrManaged(ctx, 'src/index.js'), false);
  assert.equal(isRuntimeOrManaged(ctx, 'README.md'), false);
});

test('checkAuthorized: tolerates zero-commit cold start runtime files and gives actionable suggestions on error', () => {
  const root = fixture();
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);

  // Pristine install file with CRLF
  const pristineRel = '.agents/notes/managed.md';
  const lfText = '管理说明\n';
  const crlfText = '管理说明\r\n';
  const hash = crypto.createHash('sha256').update(lfText, 'utf8').digest('hex');
  fs.mkdirSync(path.join(root, '.agents/notes'), { recursive: true });
  fs.writeFileSync(path.join(root, pristineRel), crlfText);

  // Runtime owned untracked files
  fs.mkdirSync(path.join(root, '.agents/config'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/config/model-roles.local.json'), '{"roles":{}}\n');
  fs.mkdirSync(path.join(root, '.agents/.kit/baseline'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/.kit/baseline/snapshot.json'), '{}\n');

  // Populate all existing fixture files into manifest, with pristineRel using LF hash (while on disk it has CRLF)
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
  files[pristineRel] = hash;

  // Manifest
  fs.writeFileSync(path.join(root, '.agents/install-manifest.json'), JSON.stringify({
    kit: 'agentic-flow-kit',
    files,
  }));

  // Work order modifies only my-file.txt
  fs.writeFileSync(path.join(root, 'my-file.txt'), 'hello\n');

  const ctx = { root, gitPrefix: ['git'], runsDir: path.join(root, '.agents', 'cache', 'pipeline-runs') };
  const run = { runId: 'test-cold-start', stage: 'implement', events: [] };

  // 1. When my-file.txt is listed, check passes (runtime and CRLF pristine are exempt)
  const okRes = checkAuthorized(ctx, run, 'my-file.txt');
  assert.equal(okRes.ok, true);

  // 2. When an unexpected user file is present, check fails with actionable diagnostic
  fs.writeFileSync(path.join(root, 'unexpected.txt'), 'extra\n');
  const failRes = checkAuthorized(ctx, run, 'my-file.txt');
  assert.equal(failRes.ok, false);
  assert.match(failRes.problems[0], /git 改动超出回填清单（偏离即停）/);
  assert.match(failRes.problems[0], /git 改动超出回填清单（偏离即停）：unexpected\.txt/);
  assert.match(failRes.problems[0], /请将其加入 --files/);
});

test('checkAuthorized: run-owned workflow docs are exempt from extra but unplanned code is not', () => {
  const root = fixture();
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'baseline'], { cwd: root }).status, 0);

  // run 自身文档落在任务目录，均未提交（关单才入库）；plan 的「改动方案」只列 src/planned.mjs
  const taskDir = 'workflow/tasks/2026-11-13-test';
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write(`${taskDir}/entry.md`, '---\n状态: draft\n级别: L1\n---\n\n# 需求\n');
  write(`${taskDir}/spec.md`, '---\n状态: draft\n级别: L1\n---\n\n## 验收标准\n\n- [ ] ok\n');
  write(`${taskDir}/plan.md`, '---\n状态: draft\n级别: L1\n---\n\n## 改动方案\n\n- src/planned.mjs：改文案\n');
  write(`${taskDir}/api.md`, '# API\n');
  write(`${taskDir}/notes.md`, '# 任务内附加文档（未登记在 docs）\n');
  write('src/planned.mjs', 'export const x = 1;\n');

  const ctx = { root, gitPrefix: ['git'], runsDir: path.join(root, '.agents', 'cache', 'pipeline-runs') };
  const run = {
    runId: 'test-owned', stage: 'implement', events: [],
    createdAt: NOW, triage: { topic: 'test' },
    docs: { entry: `${taskDir}/entry.md`, spec: `${taskDir}/spec.md`, plan: `${taskDir}/plan.md`, apiDocs: `${taskDir}/api.md` },
  };

  const ownedListed = [
    run.docs.entry, run.docs.spec, run.docs.plan, run.docs.apiDocs, `${taskDir}/notes.md`, 'src/planned.mjs',
  ].join(', ');
  const okRes = checkAuthorized(ctx, run, ownedListed);
  assert.equal(okRes.ok, true, JSON.stringify(okRes.problems));
  assert.deepEqual(okRes.extra, [], 'run 自身文档与计划内代码都不应算计划外');

  // 对照：真正的计划外代码文件仍必须出现在 extra
  write('src/rogue.mjs', 'export const y = 2;\n');
  const extraRes = checkAuthorized(ctx, run, `${ownedListed}, src/rogue.mjs`);
  assert.equal(extraRes.ok, true);
  assert.deepEqual(extraRes.extra, ['src/rogue.mjs']);
});

test('checkAuthorized: 代码复核产物未跟踪时不再自锁（run 登记文档豁免 beyond）', () => {
  const root = fixture();
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'baseline'], { cwd: root }).status, 0);

  // 代码复核产物由机器生成、复核者写入背书，落盘即未跟踪；实现者的 --files 回填面里没有它
  const taskDir = 'workflow/tasks/2026-11-13-test';
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write(`${taskDir}/spec.md`, '---\n状态: draft\n---\n\n## 验收标准\n\n- [ ] ok\n');
  write(`${taskDir}/plan.md`, '---\n状态: draft\n---\n\n## 改动方案\n\n- src/planned.mjs：改文案\n');
  write(`${taskDir}/code-review.md`, '# 代码复核\n\n## 确认与复核\n\n- 独立复核：通过 复核上下文：code-sess-abc123\n');
  write('src/planned.mjs', 'export const x = 1;\n');

  const ctx = { root, gitPrefix: ['git'], runsDir: path.join(root, '.agents', 'cache', 'pipeline-runs') };
  const run = {
    runId: 'test-cr', stage: 'fix', events: [],
    createdAt: NOW, triage: { topic: 'test' },
    docs: { entry: `${taskDir}/intent.md`, spec: `${taskDir}/spec.md`, plan: `${taskDir}/plan.md`, codeReview: `${taskDir}/code-review.md` },
  };

  // 复核产物不在 --files 回填面里——不判「改动超出回填清单」（否则代码复核后的修复环必然自锁）
  const res = checkAuthorized(ctx, run, 'src/planned.mjs');
  assert.equal(res.ok, true, JSON.stringify(res.problems));
  assert.deepEqual(res.extra, []);

  // 对照：任务目录里未登记的文档仍须申报——豁免只覆盖登记过的具体文档，不放大到整个目录
  write(`${taskDir}/notes.md`, '# 未登记文档\n');
  const blocked = checkAuthorized(ctx, run, 'src/planned.mjs');
  assert.equal(blocked.ok, false, '未登记的文档不在豁免面内');
  assert.match(blocked.problems[0], /notes\.md/);
});

test('checkAuthorized: eval evidence changes stop unless declared in --files', () => {
  const root = fixture();
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'baseline'], { cwd: root }).status, 0);

  // 工单改写评测凭证：未申报 → 偏离即停；显式申报 → 放行
  fs.mkdirSync(path.join(root, '.agents/evals'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/evals/results.jsonl'), '{"ts":"2026-01-01T00:00:00Z","exitCode":0}\n');

  const ctx = { root, gitPrefix: ['git'], runsDir: path.join(root, '.agents', 'cache', 'pipeline-runs') };
  const run = { runId: 'test-eval', stage: 'implement', events: [], docs: { plan: 'workflow/plans/t.md' } };

  const blocked = checkAuthorized(ctx, run, 'workflow/plans/t.md');
  assert.equal(blocked.ok, false);
  assert.match(blocked.problems[0], /偏离即停/);
  assert.match(blocked.problems[0], /\.agents\/evals\/results\.jsonl/);

  const allowed = checkAuthorized(ctx, run, 'workflow/plans/t.md, .agents/evals/results.jsonl');
  assert.equal(allowed.ok, true);
});

// ── plan 授权面不可静默改写（承诺面指纹） ─────────────────────────────────
// plan 的「改动方案」是授权白名单本身；run 登记文档虽豁免「改动超出回填清单」，
// 但确认后改写白名单须被承诺面指纹（confirm-doc 台账 commit 字段）拦下。
const FP_TASK_DIR = 'workflow/tasks/2026-11-13-fp';
const FP_PLAN_REL = `${FP_TASK_DIR}/plan.md`;

function setupPlanFingerprintCase() {
  const root = fixture();
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'baseline'], { cwd: root }).status, 0);

  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const planText = (extra = '') => [
    '---', '状态: draft', '级别: L1', '---', '',
    '## 改动方案', '',
    '- src/planned.mjs：改文案',
    ...(extra ? [extra] : []),
    '',
  ].join('\n');
  const appendLedger = (row) => {
    fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
    fs.appendFileSync(path.join(root, '.agents', 'confirmations.jsonl'), `${JSON.stringify(row)}\n`);
  };

  write('src/planned.mjs', 'export const x = 1;\n');
  write(FP_PLAN_REL, planText());
  const ctx = { root, gitPrefix: ['git'], runsDir: path.join(root, '.agents', 'cache', 'pipeline-runs') };
  const run = {
    runId: 'test-fp', stage: 'implement', events: [],
    createdAt: NOW, triage: { topic: 'fp' },
    docs: { plan: FP_PLAN_REL },
  };
  return { root, write, planText, appendLedger, ctx, run };
}

test('checkAuthorized: plan 确认后被改写（承诺面指纹不符）即拒', () => {
  const { write, planText, appendLedger, ctx, run } = setupPlanFingerprintCase();
  appendLedger({
    ts: '2026-11-13T00:00:00.000Z', doc: FP_PLAN_REL, stage: 'approved',
    fingerprint: 'fp-original', commit: commitmentFingerprint(planText()),
  });

  // 确认后实现者往「改动方案」里加了一条（授权面被扩大）
  write(FP_PLAN_REL, planText('- src/extra.mjs：新增'));
  const res = checkAuthorized(ctx, run, 'src/planned.mjs');
  assert.equal(res.ok, false);
  assert.match(res.problems.join('\n'), /承诺面指纹/);
});

test('checkAuthorized: approved 台账行无 commit 字段时不校验 plan 指纹（存量兼容）', () => {
  const { write, planText, appendLedger, ctx, run } = setupPlanFingerprintCase();
  appendLedger({ ts: '2026-11-13T00:00:00.000Z', doc: FP_PLAN_REL, stage: 'approved', fingerprint: 'fp-legacy' });

  write(FP_PLAN_REL, planText('- src/extra.mjs：新增'));
  const res = checkAuthorized(ctx, run, 'src/planned.mjs');
  assert.equal(res.ok, true, JSON.stringify(res.problems));
});

test('checkAuthorized: 追加与当前指纹一致的 approved 行（--reconfirm）后放行', () => {
  const { write, planText, appendLedger, ctx, run } = setupPlanFingerprintCase();
  appendLedger({
    ts: '2026-11-13T00:00:00.000Z', doc: FP_PLAN_REL, stage: 'approved',
    fingerprint: 'fp-original', commit: commitmentFingerprint(planText()),
  });
  const rewritten = planText('- src/extra.mjs：新增');
  write(FP_PLAN_REL, rewritten);
  appendLedger({
    ts: '2026-11-13T01:00:00.000Z', doc: FP_PLAN_REL, stage: 'approved',
    fingerprint: 'fp-reconfirmed', commit: commitmentFingerprint(rewritten),
  });

  const res = checkAuthorized(ctx, run, 'src/planned.mjs');
  assert.equal(res.ok, true, JSON.stringify(res.problems));
});

test('checkAuthorized: plan 未改写且台账 commit 一致时放行', () => {
  const { planText, appendLedger, ctx, run } = setupPlanFingerprintCase();
  appendLedger({
    ts: '2026-11-13T00:00:00.000Z', doc: FP_PLAN_REL, stage: 'approved',
    fingerprint: 'fp-original', commit: commitmentFingerprint(planText()),
  });

  const res = checkAuthorized(ctx, run, 'src/planned.mjs');
  assert.equal(res.ok, true, JSON.stringify(res.problems));
  assert.deepEqual(res.extra, []);
});

test('L0 fast-track: validateDraftContent and closeoutComplete accept lite sections', () => {
  const l0Draft = [
    '---',
    '状态: draft',
    '级别: L0',
    '模块: wiki',
    '---',
    '',
    '# 修复微小文案',
    '',
    '## 改动方案',
    '修改 README.md 中的笔误。',
    '',
    '## 验证与验收',
    '- [ ] 文案修改正确',
    '',
  ].join('\n');

  // L0 plan passes with lite sections (empty problems array)
  const draftProbs = validateDraftContent(l0Draft, 'plan', 'L0');
  assert.equal(draftProbs.length, 0, `Expected 0 problems, got: ${draftProbs.join('; ')}`);

  // Standard L1 plan fails if missing required sections
  const l1FailProbs = validateDraftContent(l0Draft, 'plan', 'L1');
  assert.ok(l1FailProbs.length > 0);
  assert.match(l1FailProbs.join('\n'), /缺节/);

  // L0 closeoutComplete passes when criteria are checked with evidence
  const l0Done = l0Draft.replace('- [ ] 文案修改正确', '- [x] 文案修改正确（证据：commit abc）');
  const closeRes = closeoutComplete(l0Done);
  assert.equal(closeRes.ok, true, `Expected closeout ok, got: ${closeRes.problems?.join('; ')}`);
});

test('L0 fast-track: pipeline triage routes L0 directly to plan-fill with --lite', () => {
  const root = fixture();
  writeRun(root, {
    triage: null,
    stage: 'triage',
    stopType: 'work-order',
    workOrder: { id: 1, kind: 'triage' },
    docs: { entry: null, spec: null, plan: null },
  });

  const r = runPipeline(root, ['next', '--run', 'test-run', '--triage', 'kind=require level=L0 module=wiki topic=micro-fix']);
  assert.equal(r.status, 0, r.stderr || r.stdout);

  const run = readRun(root);
  // Routes directly to plan-draft (having completed plan-fill), skipping intent-fill and spec-fill
  assert.equal(run.triage.level, 'L0');
  assert.equal(run.stage, 'plan-draft');
  assert.equal(run.stopType, 'work-order');
  assert.equal(run.workOrder.kind, 'draft');
  assert.match(run.docs.plan, /plan\.md$/);
  assert.equal(run.docs.entry, run.docs.plan); // L0 plan is self-entry
});

test('resolveWorkOrderRole maps work order kinds to model roles, tiers and recommended models', () => {
  const root = fixture();
  fs.writeFileSync(
    path.join(root, '.agents', 'config', 'model-roles.local.json'),
    JSON.stringify({
      roles: {
        code: 'claude-3-5-sonnet',
        judgment: 'gemini-2.5-pro',
        review: 'o3-mini',
      },
    })
  );

  const ctx = {
    root,
    dispatch: {
      roles: {
        implement: { role: 'code', tier: 'standard', agent: 'implementer' },
        review: { role: 'review', tier: 'pro', agent: 'independent-reviewer', heterogeneous: true },
        triage: { role: 'judgment', tier: 'pro', agent: 'pr-adjudicator' },
      },
    },
    modelRoles: loadModelRolesConfig(root),
  };

  const imp = resolveWorkOrderRole(ctx, { kind: 'implement' });
  assert.equal(imp.role, 'code');
  assert.equal(imp.modelTier, 'standard');
  assert.equal(imp.agent, 'implementer');
  assert.equal(imp.recommendedModel, 'claude-3-5-sonnet');
  assert.equal(imp.heterogeneous, false);

  const rev = resolveWorkOrderRole(ctx, { kind: 'review' });
  assert.equal(rev.role, 'review');
  assert.equal(rev.modelTier, 'pro');
  assert.equal(rev.agent, 'independent-reviewer');
  assert.equal(rev.recommendedModel, 'o3-mini');
  assert.equal(rev.heterogeneous, true);

  const tri = resolveWorkOrderRole(ctx, { kind: 'triage' });
  assert.equal(tri.role, 'judgment');
  assert.equal(tri.modelTier, 'pro');
  assert.equal(tri.recommendedModel, 'gemini-2.5-pro');
});

test('handoff sheet contract building, parsing, and context pruning', () => {
  const sheet = buildHandoffSheet({
    from: 'planner',
    to: 'implementer',
    task: '实现特定功能',
    gitBaseSha: 'abc1234',
    touchSetAllowed: ['src/a.mjs', 'src/b.mjs'],
    touchSetForbidden: ['tests/'],
    notes: '注意保持纯函数',
  });
  const val = validateHandoffSheet(sheet);
  assert.equal(val.ok, true);
  assert.equal(sheet.touchSetAllowed.length, 2);

  // Markdown 解析验证
  const md = `---
from: test-designer
to: independent-reviewer
task: 复核契约
---
- 允许改动: src/foo.mjs
- 禁止改动: tests/
`;
  const parsed = parseHandoffSheet(md);
  assert.ok(parsed);
  assert.equal(parsed.from, 'test-designer');
  assert.equal(parsed.to, 'independent-reviewer');
  assert.deepEqual(parsed.touchSetAllowed, ['src/foo.mjs']);

  // pruneWorkOrderContext 裁剪防撑爆
  const oversizedList = Array.from({ length: 30 }, (_, i) => `src/file-${i}.mjs`);
  const longNote = 'A'.repeat(500);
  const pruned = pruneWorkOrderContext({
    handoff: {
      from: 'planner',
      to: 'implementer',
      task: 'task',
      touchSetAllowed: oversizedList,
      touchSetForbidden: oversizedList,
      notes: longNote,
    },
  }, 1000);
  assert.ok(pruned.handoff.touchSetAllowed.length <= 10);
  assert.ok(pruned.handoff.touchSetForbidden.length <= 10);
  assert.ok(pruned.handoff.notes.length <= 200);
});

test('inspectArtifact supports handoff target and surfaces sheet details', () => {
  const root = fixture();
  const run = {
    runId: 'test-run',
    stage: 'implement',
    stopType: 'work-order',
    workOrder: {
      id: 1,
      kind: 'implement',
      context: {
        handoff: buildHandoffSheet({
          from: 'planner',
          to: 'implementer',
          task: '功能实现',
          gitBaseSha: 'deadbeef',
          touchSetAllowed: ['src/core.mjs'],
        }),
      },
    },
    events: [],
    docs: {},
  };

  const targets = getAvailableTargets({ root }, run);
  assert.ok(targets.includes('handoff'));

  const art = inspectArtifact({ root }, run, 'handoff');
  assert.equal(art.ok, true);
  assert.equal(art.type, 'handoff');
  assert.match(art.content, /交接发起方 \(From\)\*\*:\s*planner/);
  assert.match(art.content, /交接目标方 \(To\)\*\*:\s*implementer/);
  assert.match(art.content, /deadbeef/);
  assert.match(art.content, /src\/core\.mjs/);
});

test('work order dispatch injects role and recommendedModel and prints in stopLine', () => {
  const root = fixture();
  // 注入真实 dispatch.json 和 model-roles.local.json
  const dispatchPath = path.join(REPO, 'templates', 'engine', '.agents', 'config', 'dispatch.json');
  fs.copyFileSync(dispatchPath, path.join(root, '.agents', 'config', 'dispatch.json'));
  fs.writeFileSync(
    path.join(root, '.agents', 'config', 'model-roles.local.json'),
    JSON.stringify({
      roles: {
        judgment: 'gemini-2.5-pro',
        code: 'claude-3-5-sonnet',
        review: 'gpt-4o',
      },
    })
  );

  const r = runPipeline(root, ['start', '用户需求：测试模型角色与交接注入']);
  assert.equal(r.status, 0);
  // 首停机点为 triage
  assert.match(r.stdout, /PIPELINE-STOP work-order/);
  assert.match(r.stdout, /judgment/);
  assert.match(r.stdout, /pro/);
  assert.match(r.stdout, /gemini-2\.5-pro/);
  assert.match(r.stdout, /模型指派建议/);

  const runFile = fs.readdirSync(path.join(root, '.agents', 'cache', 'pipeline-runs')).find((f) => f.endsWith('.json'));
  assert.ok(runFile, 'run file must exist');
  const run = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'cache', 'pipeline-runs', runFile), 'utf8'));
  assert.equal(run.workOrder.role, 'judgment');
  assert.equal(run.workOrder.modelTier, 'pro');
  assert.equal(run.workOrder.recommendedModel, 'gemini-2.5-pro');
  assert.equal(run.workOrder.context.role.role, 'judgment');
});

test('assembleWorkOrderContext extracts role-specific slices and budgets context', () => {
  const root = fixture();
  const planDoc = path.join(root, 'workflow', 'plans', 'demo.md');
  fs.mkdirSync(path.dirname(planDoc), { recursive: true });
  fs.writeFileSync(
    planDoc,
    `# 计划文档
## 改动方案
- 修改 \`src/engine.mjs\` 实现动态上下文装配
- 修改 \`src/review.mjs\` 实现多模型背书
## 任务拆解
- 批次 1: 契约测试
`
  );

  const specDoc = path.join(root, 'workflow', 'specs', 'demo.md');
  fs.mkdirSync(path.dirname(specDoc), { recursive: true });
  fs.writeFileSync(
    specDoc,
    `# 规格文档
## 验收标准
- [ ] 规则 1: 必须包含单元测试
- [ ] 规则 2: 必须零额外依赖
`
  );

  const run = {
    runId: 'ctx-run',
    stage: 'implement',
    docs: { plan: 'workflow/plans/demo.md', spec: 'workflow/specs/demo.md', entry: 'workflow/specs/demo.md' },
    gateFail: {
      stage: 'verify',
      problems: ['门禁 verify.mjs 失败 (exit 1)'],
      analysis: { category: 'test-failure', action: '修复测试用例' },
    },
  };

  // 1. implement 工单上下文切片
  const orderImp = {
    kind: 'implement',
    role: 'code',
    context: {
      handoff: {
        touchSetAllowed: ['src/engine.mjs'],
        gitBaseSha: '1234567',
      },
    },
  };
  const impCtx = assembleWorkOrderContext({ root }, run, orderImp);
  assert.equal(impCtx.slices.role, 'code');
  assert.equal(impCtx.slices.kind, 'implement');
  assert.match(impCtx.slices.planSlice, /修改 `src\/engine\.mjs`/);
  assert.deepEqual(impCtx.slices.allowedFiles, ['src/engine.mjs']);
  assert.equal(impCtx.slices.gitBaseSha, '1234567');

  // 2. fix 工单上下文切片
  const orderFix = { kind: 'fix', role: 'code', context: {} };
  const fixCtx = assembleWorkOrderContext({ root }, run, orderFix);
  assert.equal(fixCtx.slices.gateFailure.stage, 'verify');
  assert.equal(fixCtx.slices.gateFailure.category, 'test-failure');
  assert.ok(fixCtx.slices.verifyCmd.includes('pipeline-run.mjs next'));

  // 3. review 工单上下文切片
  const orderRev = { kind: 'review', role: 'review', context: {} };
  const revCtx = assembleWorkOrderContext({ root }, run, orderRev);
  assert.match(revCtx.slices.acceptanceCriteria, /规则 1/);
  assert.match(revCtx.slices.changePlan, /修改 `src\/engine\.mjs`/);
  assert.ok(revCtx.slices.reviewChecklist.length >= 3);

  // 4. closeout 工单上下文切片
  const orderClose = { kind: 'closeout', role: 'judgment', context: {} };
  const closeCtx = assembleWorkOrderContext({ root }, run, orderClose);
  assert.match(closeCtx.slices.acceptanceCriteria, /规则 1/);

  // 5. pruneWorkOrderContext 裁剪超限切片
  const oversizedSlices = {
    planSlice: 'P'.repeat(600),
    acceptanceCriteria: 'A'.repeat(600),
    changePlan: 'C'.repeat(600),
    allowedFiles: Array.from({ length: 20 }, (_, i) => `src/f${i}.mjs`),
  };
  const pruned = pruneWorkOrderContext({ slices: oversizedSlices }, 500);
  assert.ok(pruned.slices.planSlice.length <= 400);
  assert.ok(pruned.slices.acceptanceCriteria.length <= 400);
  assert.ok(pruned.slices.changePlan.length <= 400);
  assert.ok(pruned.slices.allowedFiles.length <= 10);
});

test('normalizeModelFamily and isHeterogeneousModel model family taxonomy', () => {
  assert.equal(normalizeModelFamily('claude-3-5-sonnet'), 'claude');
  assert.equal(normalizeModelFamily('Claude-3-7-Sonnet-20250219'), 'claude');
  assert.equal(normalizeModelFamily('anthropic/claude-3-opus'), 'claude');

  assert.equal(normalizeModelFamily('gpt-4o'), 'openai');
  assert.equal(normalizeModelFamily('o3-mini'), 'openai');
  assert.equal(normalizeModelFamily('o1-preview'), 'openai');

  assert.equal(normalizeModelFamily('gemini-2.5-pro'), 'gemini');
  assert.equal(normalizeModelFamily('google/gemini-2.0-flash'), 'gemini');

  assert.equal(normalizeModelFamily('deepseek-r1'), 'deepseek');
  assert.equal(normalizeModelFamily('deepseek-ai/DeepSeek-V3'), 'deepseek');

  assert.equal(normalizeModelFamily('qwen-max'), 'qwen');

  // 同构与异构判断
  assert.equal(isHeterogeneousModel('claude-3-5-sonnet', 'claude-3-7-sonnet'), false);
  assert.equal(isHeterogeneousModel('gpt-4o', 'o3-mini'), false);
  assert.equal(isHeterogeneousModel('claude-3-5-sonnet', 'gpt-4o'), true);
  assert.equal(isHeterogeneousModel('gemini-2.5-pro', 'deepseek-r1'), true);

  // 缺省容错（未指明模型时不强卡）
  assert.equal(isHeterogeneousModel('claude-3-5-sonnet', ''), true);
  assert.equal(isHeterogeneousModel('', 'gpt-4o'), true);
});

test('parseReviewMetadata extracts multiple reviewers and detects dual-review endorsement', () => {
  // 1. 单复核人
  const single = `- 独立复核：通过 复核上下文：chat-123456 模型：o3-mini`;
  const m1 = parseReviewMetadata(single);
  assert.equal(m1.id, 'chat-123456');
  assert.equal(m1.reviewerModel, 'o3-mini');
  assert.equal(m1.reviewers.length, 1);
  assert.equal(m1.dualEndorsed, false);

  // 2. 双复核人通过
  const dualPass = `
- 独立复核 1：通过 复核上下文：subagent-rev-1 模型：gpt-4o
- 独立复核 2：通过 复核上下文：subagent-rev-2 模型：claude-3-5-sonnet
`;
  const m2 = parseReviewMetadata(dualPass);
  assert.equal(m2.id, 'subagent-rev-1');
  assert.equal(m2.reviewers.length, 2);
  assert.equal(m2.reviewers[0].id, 'subagent-rev-1');
  assert.equal(m2.reviewers[0].reviewerModel, 'gpt-4o');
  assert.equal(m2.reviewers[1].id, 'subagent-rev-2');
  assert.equal(m2.reviewers[1].reviewerModel, 'claude-3-5-sonnet');
  assert.equal(m2.dualEndorsed, true);

  // 3. 双复核人含不通过
  const dualFail = `
- 独立复核 1：通过 复核上下文：subagent-rev-1 模型：gpt-4o
- 独立复核 2：需返工 复核上下文：subagent-rev-2 模型：claude-3-5-sonnet
`;
  const m3 = parseReviewMetadata(dualFail);
  assert.equal(m3.dualEndorsed, false);
});

test('verifyReviewEndorsement enforces heterogeneity and dual-review endorsement with downgrade escape hatch', () => {
  const ctx = {
    dispatch: {
      roles: {
        implement: { role: 'code', tier: 'standard', agent: 'implementer' },
        review: { role: 'review', tier: 'pro', agent: 'independent-reviewer', heterogeneous: true },
      },
      reviewPolicy: {
        enforceHeterogeneous: true,
        requireDualReviewLevels: ['L3'],
      },
    },
    modelRoles: {
      roles: {
        code: 'claude-3-5-sonnet',
        review: 'gpt-4o',
      },
    },
  };

  const runL1 = {
    triage: { level: 'L1' },
    events: [
      { type: 'work-order', kind: 'implement', recommendedModel: 'claude-3-5-sonnet' },
    ],
  };

  // 1. 无有效 ID 拦截
  const resNoId = verifyReviewEndorsement(ctx, runL1, 'review', { id: '' });
  assert.equal(resNoId.ok, false);
  assert.match(resNoId.problems[0], /禁止占位符/);

  // 2. 同构模型复核拦截（作者 Claude，评审 Claude，未降级）
  const resHomo = verifyReviewEndorsement(ctx, runL1, 'review', {
    id: 'chat-homo-1',
    reviewerModel: 'claude-3-7-sonnet',
    reviewers: [{ id: 'chat-homo-1', reviewerModel: 'claude-3-7-sonnet', conclusion: '通过' }],
  });
  assert.equal(resHomo.ok, false);
  assert.match(resHomo.problems[0], /同构/);

  // 3. 声明降级放行（即使同构）
  const resDowngrade = verifyReviewEndorsement(ctx, runL1, 'review', {
    id: 'chat-homo-1',
    reviewerModel: 'claude-3-7-sonnet',
    isDowngraded: true,
    downgradeReason: '单模型离线测试环境',
    reviewers: [{ id: 'chat-homo-1', reviewerModel: 'claude-3-7-sonnet', conclusion: '通过' }],
  });
  assert.equal(resDowngrade.ok, true);
  assert.equal(resDowngrade.isDowngraded, true);

  // 4. 异构模型通过（作者 Claude，评审 GPT-4o）
  const resHetero = verifyReviewEndorsement(ctx, runL1, 'review', {
    id: 'chat-hetero-1',
    reviewerModel: 'gpt-4o',
    reviewers: [{ id: 'chat-hetero-1', reviewerModel: 'gpt-4o', conclusion: '通过' }],
  });
  assert.equal(resHetero.ok, true);

  // 5. L3 触发双重背书要求：单人复核被拦截
  const runL3 = {
    triage: { level: 'L3' },
    events: [{ type: 'work-order', kind: 'implement', recommendedModel: 'claude-3-5-sonnet' }],
  };
  const resL3Single = verifyReviewEndorsement(ctx, runL3, 'review', {
    id: 'chat-hetero-1',
    reviewerModel: 'gpt-4o',
    reviewers: [{ id: 'chat-hetero-1', reviewerModel: 'gpt-4o', conclusion: '通过' }],
  });
  assert.equal(resL3Single.ok, false);
  assert.match(resL3Single.problems[0], /双模型独立复核未通过/);

  // 6. L3 双异构模型复核通过
  const resL3Dual = verifyReviewEndorsement(ctx, runL3, 'review', {
    id: 'chat-rev-1',
    reviewerModel: 'gpt-4o',
    dualEndorsed: true,
    reviewers: [
      { id: 'chat-rev-1', reviewerModel: 'gpt-4o', conclusion: '通过' },
      { id: 'chat-rev-2', reviewerModel: 'gemini-2.5-pro', conclusion: '通过' },
    ],
  });
  assert.equal(resL3Dual.ok, true);
  assert.equal(resL3Dual.dualEndorsed, true);
});

test('inspectArtifact supports context and endorsement targets', () => {
  const root = fixture();
  const run = {
    runId: 'inspect-run',
    stage: 'implement',
    stopType: 'work-order',
    docs: {
      spec: 'workflow/specs/test.md',
    },
    workOrder: {
      id: 2,
      kind: 'implement',
      role: 'code',
      modelTier: 'standard',
      agent: 'implementer',
      recommendedModel: 'claude-3-5-sonnet',
      heterogeneous: false,
      context: {
        role: { role: 'code', tier: 'standard', agent: 'implementer', recommendedModel: 'claude-3-5-sonnet' },
        budget: { originalChars: 300, prunedChars: 250, budgetChars: 1200, savingsPercent: 17 },
        slices: {
          role: 'code',
          kind: 'implement',
          planSlice: '- 修改核心文件',
        },
      },
    },
    events: [],
  };

  const specPath = path.join(root, 'workflow', 'specs', 'test.md');
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(
    specPath,
    `# 规格说明
## 确认与复核
- 独立复核 1：通过 复核上下文：rev-101 模型：gpt-4o
- 独立复核 2：通过 复核上下文：rev-102 模型：gemini-2.5-pro
`
  );

  const targets = getAvailableTargets({ root }, run);
  assert.ok(targets.includes('context'));
  assert.ok(targets.includes('endorsement'));

  const artCtx = inspectArtifact({ root }, run, 'context');
  assert.equal(artCtx.ok, true);
  assert.equal(artCtx.type, 'context');
  assert.match(artCtx.content, /claude-3-5-sonnet/);
  assert.match(artCtx.content, /修改核心文件/);

  const artEndorse = inspectArtifact({ root }, run, 'endorsement');
  assert.equal(artEndorse.ok, true);
  assert.equal(artEndorse.type, 'endorsement');
  assert.match(artEndorse.content, /rev-101/);
  assert.match(artEndorse.content, /rev-102/);
  assert.match(artEndorse.content, /已达成双模型通过/);
});

test('checkQueueBrake enforces active run limits and honors --force-queue', () => {
  const root = fixture();
  const runsDir = path.join(root, '.agents', 'cache', 'pipeline-runs');
  fs.mkdirSync(runsDir, { recursive: true });

  // 写入 3 个处于活跃状态的 runs
  for (let i = 1; i <= 3; i++) {
    const id = `run-active-${i}`;
    fs.writeFileSync(
      path.join(runsDir, `${id}.json`),
      JSON.stringify({ runId: id, stopType: 'work-order', stage: 'implement', events: [] })
    );
  }
  // 写入 1 个已结束的 run
  fs.writeFileSync(
    path.join(runsDir, 'run-done.json'),
    JSON.stringify({ runId: 'run-done', stopType: 'done', stage: 'done', events: [] })
  );

  const ctx = {
    root,
    runsDir,
    dispatch: {
      queuePolicy: {
        maxActiveRuns: 3,
        enforceQueueBrake: true,
      },
    },
  };

  // 1. 默认触发熔断
  const b1 = checkQueueBrake(ctx);
  assert.equal(b1.tripped, true);
  assert.equal(b1.activeCount, 3);
  assert.equal(b1.maxActiveRuns, 3);
  assert.match(b1.message, /活跃 Run 数量已达上限/);

  // 2. 传 force-queue 绕过
  const b2 = checkQueueBrake(ctx, { 'force-queue': true });
  assert.equal(b2.tripped, false);
  assert.equal(b2.forced, true);

  // 3. 配置关闭熔断时，即使满员也不触发
  const ctxDisabled = {
    ...ctx,
    dispatch: { queuePolicy: { maxActiveRuns: 3, enforceQueueBrake: false } },
  };
  const b3 = checkQueueBrake(ctxDisabled);
  assert.equal(b3.tripped, false);

  // 4. CLI 旗标显式开启熔断
  const b4 = checkQueueBrake(ctxDisabled, { 'queue-brake': true });
  assert.equal(b4.tripped, true);
});

test('mergeAppliedRxIds 累积去重并保持先后顺序', () => {
  assert.deepEqual(mergeAppliedRxIds(undefined, undefined), []);
  assert.deepEqual(mergeAppliedRxIds([], []), []);
  assert.deepEqual(mergeAppliedRxIds('bad', ['rx-2']), ['rx-2'], '非数组入参按空数组处理');
  assert.deepEqual(mergeAppliedRxIds(['rx-1'], ['rx-2', 'rx-1', 'rx-3']), ['rx-1', 'rx-2', 'rx-3']);
});

test('listAllRuns 保留陈旧 run 并标记 stale，队列熔断不计入', () => {
  const root = fixture();
  const runsDir = path.join(root, '.agents', 'cache', 'pipeline-runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const staleAt = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
  fs.writeFileSync(path.join(runsDir, 'run-stale.json'), JSON.stringify({
    runId: 'run-stale', stopType: 'work-order', stage: 'implement', updatedAt: staleAt, createdAt: staleAt, events: [],
  }));
  fs.writeFileSync(path.join(runsDir, 'run-fresh.json'), JSON.stringify({
    runId: 'run-fresh', stopType: 'work-order', stage: 'implement', updatedAt: new Date().toISOString(), events: [],
  }));

  const ctx = { root, runsDir };
  const active = listAllRuns(ctx, 'active');
  const stale = active.find((r) => r.runId === 'run-stale');
  assert.ok(stale, '陈旧 run 不得从 active 列表消失');
  assert.equal(stale.stale, true);
  assert.equal(stale.staleDays, 20);
  assert.equal(active.find((r) => r.runId === 'run-fresh').stale, undefined);

  const brake = checkQueueBrake({ ...ctx, dispatch: { queuePolicy: { maxActiveRuns: 2, enforceQueueBrake: true } } });
  assert.equal(brake.activeCount, 1);
  assert.deepEqual(brake.activeRunIds, ['run-fresh']);
  assert.equal(brake.tripped, false);

  assert.match(renderDashboard(ctx, stale, { width: 80, noColor: true }).join('\n'), /20 天未更新/);
});

test('generatePostMortem extracts failure gates, smart-fix categories and derives actionable prescriptions', () => {
  const root = fixture();
  const ctx = {
    root,
    prescriptionsFile: path.join(root, '.agents', 'notes', 'prescriptions.json'),
  };

  const runWithFailures = {
    runId: '20261125-auth-fix',
    triage: { module: 'auth', level: 'L2', topic: 'auth-fix' },
    retries: { verify: 2 },
    events: [
      { t: '2026-11-25T12:00:00Z', type: 'route', from: 'verify', to: 'fix', attempt: 1, cap: 2 },
      { t: '2026-11-25T12:05:00Z', type: 'gate-fail', stage: 'verify' },
    ],
    gateFail: {
      stage: 'verify',
      problems: ['触点未授权: src/auth/token.mjs 不在 plan.md 白名单内'],
      analysis: { category: 'touch-set', title: '未授权文件修改' },
    },
    lastFiles: ['src/auth/token.mjs'],
  };

  const rx = generatePostMortem(ctx, runWithFailures, { persist: true });
  assert.equal(rx.runId, '20261125-auth-fix');
  assert.equal(rx.cleanPass, undefined);
  assert.ok(rx.occurredGates.includes('verify'));
  assert.ok(rx.categories.includes('touch-set'));
  assert.ok(rx.prescriptions.some((p) => p.includes('plan.md 白名单')));
  assert.equal(runWithFailures.postMortem.id, rx.id);

  // 验证持久化落盘：结构化处方逐条入库，类别/置信度不丢
  const stored = loadPrescriptions(ctx);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].category, 'touch-set');
  assert.equal(stored[0].confidence, 0.85);
  assert.equal(stored[0].runId, '20261125-auth-fix');
  assert.ok(stored[0].prescriptions.some((p) => p.includes('plan.md 白名单')));

  // 测试 clean pass
  const cleanRun = {
    runId: '20261125-clean',
    triage: { module: 'auth', level: 'L1' },
    retries: {},
    events: [],
  };
  const cleanRx = generatePostMortem(ctx, cleanRun);
  assert.equal(cleanRx.cleanPass, true);
});

test('generatePostMortem persists each structured prescription and keeps existing hit counts', () => {
  const run = {
    runId: '20261125-multi-rx',
    triage: { module: 'auth', level: 'L2' },
    retries: {},
    events: [],
    gateFail: {
      stage: 'verify',
      problems: ['触点未授权: src/a.mjs 不在 plan.md 白名单内', '测试失败 FAIL tests/a.test.mjs'],
    },
    lastFiles: ['src/a.mjs'],
  };

  // (a) 同时触发 touch-set 与 test-failure → 两条各自入库，类别与置信度不丢
  const root = fixture();
  const ctx = { root, prescriptionsFile: path.join(root, '.agents', 'notes', 'prescriptions.json') };
  generatePostMortem(ctx, run, { persist: true });
  const stored = loadPrescriptions(ctx);
  assert.equal(stored.length, 2);
  const touchRx = stored.find((p) => p.category === 'touch-set');
  const testRx = stored.find((p) => p.category === 'test-failure');
  assert.ok(touchRx, 'touch-set 处方须落盘');
  assert.ok(testRx, 'test-failure 处方须落盘');
  assert.equal(touchRx.confidence, 0.85);
  assert.equal(testRx.confidence, 0.8);

  // (b) 同一 run 再次提炼 → 同 id 不重复入库
  generatePostMortem(ctx, run, { persist: true });
  assert.equal(loadPrescriptions(ctx).length, 2);

  // (c) 库里已有同 id 记录 → 保留其命中计数，不覆盖也不重复
  const root2 = fixture();
  const ctx2 = { root: root2, prescriptionsFile: path.join(root2, '.agents', 'notes', 'prescriptions.json') };
  const pinnedId = generatePrescriptionId('touch-set', '计划外文件修改触点阻断');
  savePrescriptions(ctx2, [{
    id: pinnedId,
    category: 'touch-set',
    failurePattern: '计划外文件修改触点阻断',
    confidence: 0.5,
    hitCount: 3,
    actionableFix: '历史沉淀的触点修复处方',
    module: 'auth',
  }]);
  generatePostMortem(ctx2, run, { persist: true });
  const merged = loadPrescriptions(ctx2);
  const pinned = merged.filter((p) => p.id === pinnedId);
  assert.equal(pinned.length, 1, '同 id 不得重复入库');
  assert.equal(pinned[0].confidence, 0.5);
  assert.equal(pinned[0].hitCount, 3);
  assert.equal(merged.length, 2);
});

test('findMatchingPrescriptions matches by module or affected file paths and backflows into assembleWorkOrderContext', () => {
  const root = fixture();
  const ctx = {
    root,
    prescriptionsFile: path.join(root, '.agents', 'notes', 'prescriptions.json'),
  };

  const historyRx = [
    {
      id: 'rx-old-1',
      runId: 'run-old-1',
      module: 'billing',
      affectedFiles: ['src/billing/calc.mjs'],
      prescriptions: ['计费必须包含阶梯折扣防溢出检查'],
    },
  ];
  savePrescriptions(ctx, historyRx);

  // 1. 模块匹配
  const hitByModule = findMatchingPrescriptions(ctx, { module: 'billing' });
  assert.equal(hitByModule.length, 1);
  assert.equal(hitByModule[0].id, 'rx-old-1');

  // 2. 文件重合匹配
  const hitByFile = findMatchingPrescriptions(ctx, { module: 'other', files: ['src/billing/calc.mjs'] });
  assert.equal(hitByFile.length, 1);
  assert.equal(hitByFile[0].id, 'rx-old-1');

  // 3. 回流注入工单上下文
  const run = {
    runId: 'run-new-bill',
    triage: { module: 'billing', level: 'L1' },
    docs: {},
    lastFiles: ['src/billing/calc.mjs'],
  };
  const assembled = assembleWorkOrderContext(ctx, run, {
    kind: 'implement',
    role: 'code',
    context: { files: ['src/billing/calc.mjs'] },
  });
  assert.ok(Array.isArray(assembled.slices.prescriptions));
  assert.ok(assembled.slices.prescriptions.some((p) => p.includes('计费必须包含阶梯折扣防溢出检查')));

  // 4. 经过 pruneWorkOrderContext 裁剪预算
  const pruned = pruneWorkOrderContext(assembled, 1200);
  assert.ok(pruned.budget);
  assert.ok(Array.isArray(pruned.slices.prescriptions));
});

test('inspectArtifact supports prescription and postmortem targets', () => {
  const root = fixture();
  const ctx = {
    root,
    prescriptionsFile: path.join(root, '.agents', 'notes', 'prescriptions.json'),
  };

  const run = {
    runId: 'run-rx-test',
    triage: { module: 'engine' },
    postMortem: {
      id: 'rx-test',
      runId: 'run-rx-test',
      module: 'engine',
      retriesCount: 2,
      occurredGates: ['verify'],
      categories: ['arch'],
      affectedFiles: ['src/core/router.mjs'],
      prescriptions: ['触发架构防线阻断，杜绝跨层直接调用'],
    },
    docs: {},
    events: [],
  };

  // 目标包含 prescription
  const targets = getAvailableTargets(ctx, run);
  assert.ok(targets.includes('prescription'));

  // inspect prescription
  const art1 = inspectArtifact(ctx, run, 'prescription');
  assert.equal(art1.ok, true);
  assert.equal(art1.type, 'prescription');
  assert.match(art1.content, /run-rx-test/);
  assert.match(art1.content, /杜绝跨层直接调用/);

  // 别名 postmortem
  const art2 = inspectArtifact(ctx, run, 'postmortem');
  assert.equal(art2.ok, true);
  assert.equal(art2.type, 'prescription');
  assert.match(art2.content, /杜绝跨层直接调用/);
});

test('isApprovedConclusion recognizes approved conclusions and rejects negated ones', () => {
  assert.equal(isApprovedConclusion('通过'), true);
  assert.equal(isApprovedConclusion('已通过'), true);
  assert.equal(isApprovedConclusion('approved'), true);
  assert.equal(isApprovedConclusion('Approved'), true);
  assert.equal(isApprovedConclusion('LGTM'), true);
  assert.equal(isApprovedConclusion('pass'), true);

  assert.equal(isApprovedConclusion('未通过'), false);
  assert.equal(isApprovedConclusion('不通过'), false);
  assert.equal(isApprovedConclusion('未能通过'), false);
  assert.equal(isApprovedConclusion('不予通过'), false);
  assert.equal(isApprovedConclusion('无法通过'), false);
  assert.equal(isApprovedConclusion('暂不通过'), false);
  assert.equal(isApprovedConclusion('驳回'), false);
  assert.equal(isApprovedConclusion('拒绝'), false);
  assert.equal(isApprovedConclusion('disapproved'), false);
  assert.equal(isApprovedConclusion('failed'), false);
  assert.equal(isApprovedConclusion('rejected'), false);
  assert.equal(isApprovedConclusion('not approved'), false);
  assert.equal(isApprovedConclusion('not ok'), false);
  assert.equal(isApprovedConclusion('NACK'), false);
  assert.equal(isApprovedConclusion(''), false);
  assert.equal(isApprovedConclusion(null), false);
});

test('parseReviewMetadata treats missing or negated conclusions as not approved', () => {
  const negated = [
    '- 复核：不通过，复核上下文：rev-aaaa11',
    '- 独立复核：不予通过 复核上下文：rev-aaaa11',
    '- 独立复核：无法通过 复核上下文：rev-aaaa11',
    '- 复核人：gpt-4o，复核上下文：rev-aaaa11，发现 3 个 P1 问题',
    '- 评审 2：未通过 复核上下文：reviewer-000006',
  ];
  for (const line of negated) {
    const meta = parseReviewMetadata(line);
    assert.equal(meta.reviewers.length, 1, line);
    assert.equal(isApprovedConclusion(meta.reviewers[0].conclusion), false, line);
  }

  const approved = [
    '- 独立复核：通过 复核上下文：code-sess-abc123 模型：gpt-4o',
    '- 独立复核：通过（复核上下文：<rev-aaaa11>；reviewed by gpt-4o）',
    '- 二次复核：通过 模型：gpt-4o 复核上下文：reviewer-000002',
    '- 独立复核：通过（上一轮未通过的问题已修复） 复核上下文：reviewer-000003',
    '- 复核：通过，复核上下文：rev-aaaa11',
    // 带序号的写法（旧版即支持）仍是可识别的结论行
    '- 复核 1：通过 复核上下文：reviewer-000004',
    '- 评审二：通过 复核上下文：reviewer-000005',
  ];
  for (const line of approved) {
    const meta = parseReviewMetadata(line);
    assert.equal(meta.reviewers.length, 1, line);
    assert.equal(isApprovedConclusion(meta.reviewers[0].conclusion), true, line);
  }
});

test('parseHandoffSheet supports Windows drive letter paths and validateHandoffSheet rejects directory traversal', () => {
  const md = [
    '# Handoff Sheet',
    '- from: code',
    '- to: test',
    '- task: 2026-11-25-test',
    '- touchSetAllowed:',
    '  - C:\\Users\\Administrator\\project\\src\\main.mjs',
    '  - D:/data/test.json',
    '- notes: Windows drive letter paths support',
  ].join('\n');

  const sheet = parseHandoffSheet(md);
  assert.ok(sheet != null);
  assert.equal(sheet.from, 'code');
  assert.equal(sheet.to, 'test');
  assert.equal(sheet.task, '2026-11-25-test');
  assert.ok(sheet.touchSetAllowed.length >= 2);
  assert.ok(sheet.touchSetAllowed.some((f) => f.includes('main.mjs')));

  // validateHandoffSheet rejects path traversal
  const badSheet = {
    ...sheet,
    touchSetAllowed: ['../../etc/passwd'],
  };
  const valRes = validateHandoffSheet(badSheet);
  assert.equal(valRes.ok, false);
  assert.ok(valRes.problems.some((e) => e.includes('非法路径穿越')));
});

test('parseReviewMetadata deduplicates reviewers by ID and honors explicit downgrade in brackets or line-starts', () => {
  const text = [
    '- 独立复核：通过 复核上下文：reviewer-dup 模型：claude-3-7-sonnet',
    '- 独立复核：通过 复核上下文：reviewer-dup 模型：claude-3-7-sonnet',
    '- 独立复核：通过 复核上下文：reviewer-unique 模型：gpt-4o',
    '(跨模型降级：网络受限转单模型)',
  ].join('\n');

  const meta = parseReviewMetadata(text);
  assert.equal(meta.reviewers.length, 2, '相同 ID 必须去重');
  assert.equal(meta.isDowngraded, true);
  assert.match(meta.downgradeReason, /网络受限转单模型/);

  // 正文提及无冒号键值不判定为降级
  const prose = '- 独立复核：通过 复核上下文：rev-1 结论：通过 本次未发生跨模型降级，模型配额充足';
  const metaProse = parseReviewMetadata(prose);
  assert.equal(metaProse.isDowngraded, false);
});

test('verifyReviewEndorsement enforces approval, heterogeneous models, disallows same reviewer, and honors enforceHeterogeneous: false', () => {
  const metaRejected = {
    id: 'rev-1',
    reviewerModel: 'claude-3-7-sonnet',
    reviewers: [{ id: 'rev-1', reviewerModel: 'claude-3-7-sonnet', conclusion: '未通过' }],
    dualEndorsed: false,
    isDowngraded: false,
  };
  const resRej = verifyReviewEndorsement(null, null, 'review', metaRejected, { authorModel: 'gpt-4o' });
  assert.equal(resRej.ok, false);
  assert.ok(resRej.problems.some((p) => p.includes('未通过或驳回')));

  // 双复核人 ID 相同
  const metaSameId = {
    id: 'rev-1',
    reviewerModel: 'claude-3-7-sonnet',
    reviewers: [
      { id: 'rev-1', reviewerModel: 'claude-3-7-sonnet', conclusion: '通过' },
      { id: 'rev-1', reviewerModel: 'gpt-4o', conclusion: '通过' },
    ],
    dualEndorsed: true,
    isDowngraded: false,
  };
  const resSame = verifyReviewEndorsement(null, null, 'review', metaSameId, { dualReview: true, authorModel: 'gemini-2.0-flash' });
  assert.equal(resSame.ok, false);
  assert.ok(resSame.problems.some((p) => p.includes('相同') || p.includes('同一会话')));

  // 异构要求未声明 reviewerModel
  const metaNoModel = {
    id: 'rev-1',
    reviewerModel: '',
    reviewers: [{ id: 'rev-1', reviewerModel: '', conclusion: '通过' }],
    dualEndorsed: false,
    isDowngraded: false,
  };
  const resNoModel = verifyReviewEndorsement(null, null, 'review', metaNoModel, { heterogeneous: true, authorModel: 'gpt-4o' });
  assert.equal(resNoModel.ok, false);
  assert.ok(resNoModel.problems.some((p) => p.includes('未检测到复核模型')));

  // 单源开关关闭：enforceHeterogeneous === false 时不硬阻断同构模型
  const metaHomogeneous = {
    id: 'rev-1',
    reviewerModel: 'gpt-4o',
    reviewers: [{ id: 'rev-1', reviewerModel: 'gpt-4o', conclusion: '通过' }],
    dualEndorsed: false,
    isDowngraded: false,
  };
  const ctxWithPolicy = {
    dispatch: {
      reviewPolicy: { enforceHeterogeneous: false },
    },
  };
  const resPolicyBypass = verifyReviewEndorsement(ctxWithPolicy, null, 'review', metaHomogeneous, {
    heterogeneous: true,
    authorModel: 'gpt-4o',
  });
  assert.equal(resPolicyBypass.ok, true);
});

test('verifyReviewEndorsement reads object-shaped model-roles as author model fallback', () => {
  const run = { triage: { level: 'L2' }, events: [] };
  const reviewMeta = (model) => parseReviewMetadata(`- 独立复核：通过 模型：${model} 复核上下文：rev-aaaa11`);

  // 对象形状的 roles.code / roles.judgment：作者模型取 model 字段，同族复核判同构
  const ctxObjectRoles = {
    dispatch: { reviewPolicy: { enforceHeterogeneous: true } },
    modelRoles: { roles: { code: { model: 'claude-3-5-sonnet' }, judgment: { model: 'claude-3-5-sonnet' } } },
  };
  const objSame = verifyReviewEndorsement(ctxObjectRoles, run, 'code-review', reviewMeta('claude-3-7-sonnet'));
  assert.equal(objSame.ok, false);
  assert.ok(objSame.problems.some((p) => p.includes('同构')));

  const objHetero = verifyReviewEndorsement(ctxObjectRoles, run, 'code-review', reviewMeta('gpt-4o'));
  assert.equal(objHetero.ok, true, objHetero.problems.join('；'));

  // 字符串形状：结论与对象形状一致
  const ctxStringRoles = {
    dispatch: { reviewPolicy: { enforceHeterogeneous: true } },
    modelRoles: { roles: { code: 'claude-3-5-sonnet', judgment: 'claude-3-5-sonnet' } },
  };
  const strSame = verifyReviewEndorsement(ctxStringRoles, run, 'code-review', reviewMeta('claude-3-7-sonnet'));
  assert.equal(strSame.ok, false);
  assert.ok(strSame.problems.some((p) => p.includes('同构')));

  const strHetero = verifyReviewEndorsement(ctxStringRoles, run, 'code-review', reviewMeta('gpt-4o'));
  assert.equal(strHetero.ok, true, strHetero.problems.join('；'));
});

test('loadPrescriptions backs up corrupt JSON file, savePrescriptions writes atomically, and findMatchingPrescriptions respects slash boundaries', () => {
  const root = fixture();
  const notesDir = path.join(root, '.agents', 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  const rxFile = path.join(notesDir, 'prescriptions.json');
  fs.writeFileSync(rxFile, 'MALFORMED JSON {{{');

  const ctx = { root, prescriptionsFile: rxFile };
  // 读取损坏文件，不应抛出异常，应生成 corrupt 备份并返回空数组
  const list = loadPrescriptions(ctx);
  assert.deepEqual(list, []);
  const entries = fs.readdirSync(notesDir);
  assert.ok(entries.some((e) => e.startsWith('prescriptions.json.corrupt-')));

  // 原子保存
  savePrescriptions(ctx, [
    {
      id: 'rx-bill-1',
      module: 'billing',
      affectedFiles: ['src/billing/calc.mjs'],
      prescriptions: ['防溢出检查'],
    },
  ]);
  const loaded = loadPrescriptions(ctx);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'rx-bill-1');

  // 斜杠边界防假阳性：src/bi 不应命中 src/billing/calc.mjs
  const noMatch = findMatchingPrescriptions(ctx, { module: 'other', files: ['src/bi'] });
  assert.equal(noMatch.length, 0);

  // 前缀目录匹配：src/billing 应命中 src/billing/calc.mjs
  const matchDir = findMatchingPrescriptions(ctx, { module: 'other', files: ['src/billing'] });
  assert.equal(matchDir.length, 1);
});

// ── 代码 diff 独立复核（2026-11-25 修复） ─────────────────────────────────
// 缺陷：review 阶段只读 spec 的「确认与复核」并复用其背书行——那行是 spec-review 阶段
// （实现开始之前）写的，代码提交本身从未被独立复核过；L2/L3 的「双机交叉背书」实际校验的是
// 规格复核行。修法：对代码 diff 另签复核工单，背书行写入代码复核产物并绑定复核范围。

const CR_BASE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const CR_HEAD = '0f1e2d3c4b5a69788796a5b4c3d2e1f009182736';
const CR_TASK_DIR = 'workflow/tasks/2026-11-13-test';
const CR_REL = `${CR_TASK_DIR}/code-review.md`;

// 造一个停在指定阶段的 run：带代码复核基准/范围，spec 可选带合法复核行。
function setupCodeReviewRun(root, {
  stage = 'code-review', level = 'L2', baseSha = CR_BASE, headSha = CR_HEAD,
  files = ['src/a.mjs'], withSpecEndorsement = false,
} = {}) {
  fs.mkdirSync(path.join(root, CR_TASK_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, CR_TASK_DIR, 'spec.md'), [
    '# Spec', '', '## 验收标准', '', '- [ ] 功能可用', '', '## 确认与复核', '',
    withSpecEndorsement ? '- 独立复核：通过 复核上下文：spec-sess-777 模型：gpt-4o' : '',
    '',
  ].join('\n'));
  return writeRun(root, {
    stage,
    stopType: 'work-order',
    triage: { kind: 'require', level, module: 'wiki', topic: 'test' },
    docs: { entry: `${CR_TASK_DIR}/intent.md`, spec: `${CR_TASK_DIR}/spec.md`, plan: 'workflow/plans/t.md', codeReview: CR_REL },
    codeBaseSha: baseSha,
    codeReview: { baseSha, headSha, files },
  });
}

function writeCodeReviewDoc(root, { base = CR_BASE, head = CR_HEAD, endorsement = '- 独立复核：通过 复核上下文：code-sess-abc123 模型：gpt-4o', withBase = true } = {}) {
  fs.mkdirSync(path.join(root, CR_TASK_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, CR_REL), [
    '# 代码复核', '',
    ...(withBase ? [`- 复核基准 SHA: \`${base}\``, `- 复核范围: \`${base}..${head}\``] : []),
    '', '## 确认与复核', '', endorsement, '',
  ].join('\n'));
}

test('review 阶段签发代码 diff 独立复核工单，不复用 spec 的背书行', () => {
  const root = fixture();
  // spec 里已有合法复核行——旧行为会直接读它放行；新行为必须仍签发代码复核工单
  setupCodeReviewRun(root, { stage: 'review', withSpecEndorsement: true });
  const r = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const run = readRun(root);
  assert.equal(run.stopType, 'work-order', 'review 阶段签发复核工单后停在 work-order');
  assert.equal(run.stage, 'code-review', '工单指向代码复核阶段（等独立背书）');
  assert.equal(run.workOrder.kind, 'review');
  assert.match(run.workOrder.title, /独立复核代码 diff/);
  // 工单落点是代码复核产物，不是 spec
  assert.equal(run.workOrder.context.docPath, CR_REL);
  assert.notEqual(run.workOrder.context.docPath, `${CR_TASK_DIR}/spec.md`);
  // 工单上下文带复核范围与触及文件——复核者据此定点读 diff
  assert.equal(run.workOrder.context.slices.codeDiff.base, CR_BASE);
  assert.equal(run.workOrder.context.slices.codeDiff.head, CR_HEAD);
  assert.deepEqual(run.workOrder.context.slices.codeDiff.files, ['src/a.mjs']);
  // 复核产物已生成并绑定基准与范围
  const doc = fs.readFileSync(path.join(root, CR_REL), 'utf8');
  assert.match(doc, /复核基准 SHA: `a1b2c3d4/);
  assert.match(doc, /复核范围: `a1b2c3d4/);
  assert.match(doc, /## 确认与复核/);
  assert.ok(run.events.some((e) => e.type === 'handoff' && e.toStage === 'code-review'));
});

test('代码复核门拒绝「只有 spec 背书」——代码 diff 未经独立复核不得进关单', () => {
  const root = fixture();
  setupCodeReviewRun(root, { stage: 'code-review', withSpecEndorsement: true });
  const r = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.match(r.stdout + r.stderr, /代码复核/);
  const run = readRun(root);
  assert.equal(run.stopType, 'gate-fail');
  assert.notEqual(run.stage, 'closeout', '未经代码复核不得进关单');
});

test('代码复核产物未绑定复核基准 → 判红（拿 spec 复核行冒充不成立）', () => {
  const root = fixture();
  setupCodeReviewRun(root, { stage: 'code-review' });
  // 把一条合法背书行抄进代码复核产物，但没有机器写入的基准绑定——不认
  writeCodeReviewDoc(root, { withBase: false });
  const r = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.match(r.stdout + r.stderr, /复核基准/);
  assert.equal(readRun(root).stopType, 'gate-fail');
});

test('代码复核产物绑定基准且有独立背书 → 通过到 closeout 并记 code-review 事件', () => {
  const root = fixture();
  setupCodeReviewRun(root, { stage: 'code-review' });
  writeCodeReviewDoc(root);
  const r = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const run = readRun(root);
  assert.equal(run.stage, 'closeout');
  const ev = run.events.find((e) => e.type === 'code-review');
  assert.ok(ev, '须记 code-review 事件');
  assert.equal(ev.baseSha, CR_BASE);
  assert.equal(ev.reviewers, 1);
});

test('代码复核结论「未通过」→ 签发修复工单，不静默放过', () => {
  const root = fixture();
  setupCodeReviewRun(root, { stage: 'code-review' });
  writeCodeReviewDoc(root, { endorsement: '- 独立复核：未通过 复核上下文：code-sess-abc123 模型：gpt-4o' });
  const r = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const run = readRun(root);
  assert.equal(run.stopType, 'work-order');
  assert.equal(run.workOrder.kind, 'fix', '复核否决应转入修复环');
  assert.equal(run.stage, 'fix');
});

test('代码复核背书未交付 → 重签复核工单（不误判成代码缺陷）', () => {
  const root = fixture();
  setupCodeReviewRun(root, { stage: 'code-review' });
  // 骨架在位但复核者还没写背书行——这是「还没交」，不是「代码有缺陷」
  writeCodeReviewDoc(root, { endorsement: '' });
  const r = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const run = readRun(root);
  assert.equal(run.stopType, 'work-order');
  assert.equal(run.workOrder.kind, 'review', '背书未交付应重签复核工单等交付');
  assert.notEqual(run.workOrder.kind, 'fix', '不得把「还没交背书」当成代码缺陷派修复单');
  assert.equal(run.stage, 'code-review');
});

test('代码在复核工单签发后变更 → 旧复核失效，重签复核工单（新范围）', () => {
  const root = fixture();
  setupCodeReviewRun(root, { stage: 'code-review' });
  writeCodeReviewDoc(root);
  const newHead = '1111222233334444555566667777888899990000';
  const r = runPipeline(root, ['next', '--run', 'test-run'], { FAKE_GIT_SHA: newHead });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const run = readRun(root);
  assert.equal(run.stopType, 'work-order');
  assert.equal(run.workOrder.kind, 'review', '范围变了须重签复核工单');
  assert.equal(run.stage, 'code-review');
  const doc = fs.readFileSync(path.join(root, CR_REL), 'utf8');
  assert.match(doc, new RegExp(newHead), '复核范围随代码前移');
});

test('代码范围前移后，台账里旧范围的合法凭证不得代替新复核放行', () => {
  const root = fixture();
  setupCodeReviewRun(root, { stage: 'code-review' });
  // 产物绑定旧范围，背书行由台账凭证提供（复核者尚未在产物里写背书行）
  writeCodeReviewDoc(root, { endorsement: '' });
  writeEndorsementToken(root, buildEndorsementToken({
    doc: CR_REL,
    commitmentFingerprint: `${CR_BASE}..${CR_HEAD}`,
    endorsements: [
      { role: 'auditor', model: 'gpt-4o', sessionId: 'sess-oldreview1', conclusion: 'approved' },
    ],
  }));

  // 代码在复核之后又被改动：HEAD 前移，旧范围的凭证不得放行
  const newHead = '1111222233334444555566667777888899990000';
  const r1 = runPipeline(root, ['next', '--run', 'test-run'], { FAKE_GIT_SHA: newHead });
  assert.equal(r1.status, 0, r1.stderr || r1.stdout);
  const run1 = readRun(root);
  assert.equal(run1.stopType, 'work-order', '范围前移须重签复核工单');
  assert.equal(run1.stage, 'code-review');
  assert.equal(run1.workOrder.kind, 'review');

  // 同一新范围再跑一次：台账里只剩旧范围凭证，仍须等新复核，不得进 closeout
  const r2 = runPipeline(root, ['next', '--run', 'test-run'], { FAKE_GIT_SHA: newHead });
  assert.equal(r2.status, 0, r2.stderr || r2.stdout);
  const run2 = readRun(root);
  assert.equal(run2.stopType, 'work-order');
  assert.equal(run2.stage, 'code-review');
  assert.equal(run2.workOrder.kind, 'review', '旧范围凭证不得为新范围放行');
});

test('端到端：verify 绿并提交代码后停在代码复核，不再直接进关单', () => {
  const root = fixture();
  // 真 git 仓库——代码提交与复核基准/范围都要真实 SHA
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['config', 'user.email', 't@t'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['config', 'user.name', 't'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: root }).status, 0);
  const baseSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();

  // 实现阶段留下的代码改动（未提交）
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 1;\n');

  writeRun(root, {
    stage: 'verify',
    stopType: 'work-order',
    triage: { kind: 'require', level: 'L2', module: 'wiki', topic: 'test' },
    docs: { entry: 'workflow/intents/t.md', spec: null, plan: 'workflow/plans/t.md', codeReview: CR_REL },
  });

  const r = runPipeline(root, ['next', '--run', 'test-run'], { PIPELINE_RUN_GIT_BIN: 'git' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const run = readRun(root);

  // 代码已提交
  const headSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  assert.notEqual(headSha, baseSha, 'verify 绿后应落一笔代码提交');
  assert.ok(run.events.some((e) => e.type === 'commit' && e.sha));

  // 复核范围 = 实现前基准..代码提交头
  assert.equal(run.codeReview.baseSha, baseSha);
  assert.equal(run.codeReview.headSha, headSha);
  assert.deepEqual(run.codeReview.files, ['src/a.mjs']);

  // 关键：停在代码复核工单上，不直接进关单
  assert.equal(run.stopType, 'work-order');
  assert.equal(run.stage, 'code-review');
  assert.equal(run.workOrder.kind, 'review');
  assert.match(run.workOrder.title, /独立复核代码 diff/);

  // 复核产物绑定真实基准
  const doc = fs.readFileSync(path.join(root, CR_REL), 'utf8');
  assert.match(doc, new RegExp(`复核基准 SHA: \`${baseSha}\``));
  assert.match(doc, new RegExp(`复核范围: \`${baseSha}\\.\\.${headSha}\``));
});

test('parseCodeReviewRange 解析机器写入的基准与范围', () => {
  const r = parseCodeReviewRange('- 复核基准 SHA: `abc1234`\n- 复核范围: `abc1234..def5678`');
  assert.equal(r.base, 'abc1234');
  assert.equal(r.head, 'def5678');
  assert.deepEqual(parseCodeReviewRange('没有基准行'), { base: '', head: '' });
});

test('ensureCodeReviewDoc 幂等：范围不变保留既有背书行，范围变了重写骨架', () => {
  const root = fixture();
  setupCodeReviewRun(root, { stage: 'review' });
  const ctx = { root };
  const run = readRun(root);
  assert.equal(ensureCodeReviewDoc(ctx, run, { baseSha: CR_BASE, headSha: CR_HEAD, files: ['src/a.mjs'] }), CR_REL);
  const first = fs.readFileSync(path.join(root, CR_REL), 'utf8');
  fs.appendFileSync(path.join(root, CR_REL), '\n- 独立复核：通过 复核上下文：code-sess-abc123\n');

  // 范围不变 → 背书行保留
  ensureCodeReviewDoc(ctx, run, { baseSha: CR_BASE, headSha: CR_HEAD, files: ['src/a.mjs'] });
  const kept = fs.readFileSync(path.join(root, CR_REL), 'utf8');
  assert.match(kept, /code-sess-abc123/, '范围不变时不得擦掉已写的背书行');
  assert.equal(kept, first + '\n- 独立复核：通过 复核上下文：code-sess-abc123\n');

  // 范围变了 → 重写骨架（旧背书随旧范围失效）
  ensureCodeReviewDoc(ctx, run, { baseSha: CR_BASE, headSha: CR_HEAD + '1', files: ['src/a.mjs'] });
  const rewritten = fs.readFileSync(path.join(root, CR_REL), 'utf8');
  assert.doesNotMatch(rewritten, /code-sess-abc123/, '范围变了旧背书失效');
  assert.match(rewritten, /复核范围: `a1b2c3d4/);
});


test('存量 run 停 review 且无 codeReview：按 HEAD^..HEAD 兜底并签发复核工单', () => {
  const root = fixture();
  // 真 git 仓库——HEAD 与父提交都取真实 SHA
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['config', 'user.email', 't@t'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['config', 'user.name', 't'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: root }).status, 0);
  const baseSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();

  // 引擎升级前已提交的代码改动（单独一笔提交）
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 1;\n');
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['commit', '-q', '-m', 'code'], { cwd: root }).status, 0);
  const headSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();

  // 存量 run：停在 review，没有 run.codeReview
  writeRun(root, {
    stage: 'review',
    stopType: 'work-order',
    triage: { kind: 'require', level: 'L2', module: 'wiki', topic: 'test' },
    docs: { entry: 'workflow/intents/t.md', spec: null, plan: 'workflow/plans/t.md', codeReview: CR_REL },
  });

  const r = runPipeline(root, ['next', '--run', 'test-run'], { PIPELINE_RUN_GIT_BIN: 'git' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const run = readRun(root);
  assert.equal(run.stopType, 'work-order');
  assert.equal(run.stage, 'code-review');
  assert.equal(run.codeReview.baseSha, baseSha, '兜底基准 = HEAD 的父提交');
  assert.equal(run.codeReview.headSha, headSha);
  assert.deepEqual(run.codeReview.files, ['src/a.mjs'], '只收录代码文件，不含 workflow/ 与运行态路径');
  assert.ok(run.events.some((e) => e.type === 'code-review' && e.fallback === true), '兜底须留 code-review/fallback 事件');
});

test('review 阶段无 codeReview 且 git 基准不可得时仍按原文案 gate-fail', () => {
  const root = fixture();
  writeRun(root, {
    stage: 'review',
    stopType: 'work-order',
    triage: { kind: 'require', level: 'L2', module: 'wiki', topic: 'test' },
    docs: { entry: 'workflow/intents/t.md', spec: null, plan: 'workflow/plans/t.md', codeReview: CR_REL },
  });

  // 夹具默认假 git：rev-parse 无输出 → 兜底不可得
  const r = runPipeline(root, ['next', '--run', 'test-run']);
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const run = readRun(root);
  assert.equal(run.stopType, 'gate-fail');
  assert.match(run.gateFail.problems.join('\n'), /代码复核基准缺失——verify 绿后未记录代码改动基准，无法界定复核范围/);
});

test('端到端：凭证签署代码复核正确范围后放行；范围写错仍停在复核工单', () => {
  const root = fixture();
  setupCodeReviewRun(root, { stage: 'code-review' });
  // 产物只有骨架（无背书行）：台账凭证是唯一交付通道
  writeCodeReviewDoc(root, { endorsement: '' });
  const endorsementCli = path.join(REPO, 'templates', 'engine', '.agents', 'scripts', 'endorsement-protocol.mjs');
  const sign = (commitment, session) => spawnSync(process.execPath, [
    endorsementCli, 'sign', '--doc', CR_REL, '--commitment', commitment,
    '--session', session, '--model', 'gpt-4o', '--conclusion', 'approved', '--root', root, '--json',
  ], { cwd: root, encoding: 'utf8', timeout: 60000 });

  // 范围写错：台账里的凭证不得为本次复核放行
  const wrongHead = '1111222233334444555566667777888899990000';
  const wrong = sign(`${CR_BASE}..${wrongHead}`, 'sess-code-wrong1');
  assert.equal(wrong.status, 0, wrong.stderr || wrong.stdout);
  const r1 = runPipeline(root, ['next', '--run', 'test-run'], { FAKE_GIT_SHA: CR_HEAD });
  assert.equal(r1.status, 0, r1.stderr || r1.stdout);
  const run1 = readRun(root);
  assert.equal(run1.stage, 'code-review');
  assert.equal(run1.workOrder.kind, 'review', '签署范围写错不得放行');

  // 按机器写入的复核范围签署 → 放行到关单
  const good = sign(`${CR_BASE}..${CR_HEAD}`, 'sess-code-good1');
  assert.equal(good.status, 0, good.stderr || good.stdout);
  const r2 = runPipeline(root, ['next', '--run', 'test-run'], { FAKE_GIT_SHA: CR_HEAD });
  assert.equal(r2.status, 0, r2.stderr || r2.stdout);
  const run2 = readRun(root);
  assert.equal(run2.stage, 'closeout');
  const ev = run2.events.find((e) => e.type === 'code-review');
  assert.ok(ev, '须记 code-review 事件');
  assert.equal(ev.reviewers, 1);
});
