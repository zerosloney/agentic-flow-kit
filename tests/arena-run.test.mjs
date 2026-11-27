import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import {
  initArena,
  listArenaTopics,
  statusArena,
  evalArena,
  reportArena,
  adoptArena,
  cleanupArena,
  readArenaMeta,
  GIT,
} from '../templates/engine/.agents/scripts/arena-run.mjs';

const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../templates/engine/.agents/scripts/arena-run.mjs'
);

function initTestRepo() {
  const dir = makeTmp('arena-test-');
  spawnSync(GIT, ['init', '-q'], { cwd: dir });
  spawnSync(GIT, ['config', 'user.name', 'ArenaTester'], { cwd: dir });
  spawnSync(GIT, ['config', 'user.email', 'arena@example.com'], { cwd: dir });
  spawnSync(GIT, ['config', 'commit.gpgsign', 'false'], { cwd: dir });

  // 基础文件与提交
  fs.writeFileSync(path.join(dir, 'math.js'), 'export function add(a, b) { return a + b; }\n', 'utf8');
  fs.writeFileSync(
    path.join(dir, 'test.js'),
    `import assert from 'node:assert/strict';\nimport { add } from './math.js';\nassert.equal(add(1, 2), 3);\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'arena-test', type: 'module', scripts: { test: 'node test.js' } }, null, 2),
    'utf8'
  );

  spawnSync(GIT, ['add', '.'], { cwd: dir });
  spawnSync(GIT, ['commit', '-m', 'chore: initial commit'], { cwd: dir });
  return dir;
}

test('initArena: 正常初始化派生独立 worktree 与元数据', () => {
  const root = initTestRepo();
  const meta = initArena({
    root,
    topic: 'calc-opt',
    arms: ['plan-fast', 'plan-safe'],
  });

  assert.equal(meta.topic, 'calc-opt');
  assert.equal(meta.status, 'open');
  assert.ok(meta.baseCommit);
  assert.ok(meta.arms['plan-fast']);
  assert.ok(meta.arms['plan-safe']);

  // 验证工作树物理目录创建
  const fastDir = path.join(root, meta.arms['plan-fast'].dir);
  const safeDir = path.join(root, meta.arms['plan-safe'].dir);
  assert.ok(fs.existsSync(fastDir));
  assert.ok(fs.existsSync(safeDir));

  // 验证 worktree 带有基础文件
  assert.ok(fs.existsSync(path.join(fastDir, 'math.js')));
  assert.ok(fs.existsSync(path.join(safeDir, 'math.js')));

  // 清理
  cleanupArena({ root, topic: 'calc-opt' });
});

test('initArena: 校验参数有效性 (topic 与 arms 数量)', () => {
  const root = initTestRepo();

  assert.throws(
    () => initArena({ root, topic: 'bad/topic', arms: ['a', 'b'] }),
    /--topic 必须为合法/
  );

  assert.throws(
    () => initArena({ root, topic: 'valid-topic', arms: ['only-one'] }),
    /打擂至少需要 2 个候选臂/
  );
});

test('statusArena: 正确汇报各臂未提交脏文件与改动统计', () => {
  const root = initTestRepo();
  initArena({
    root,
    topic: 'perf-duel',
    arms: ['arm-a', 'arm-b'],
  });

  const meta = readArenaMeta(root, 'perf-duel');
  const dirA = path.join(root, meta.arms['arm-a'].dir);

  // 在 arm-a 修改 math.js
  fs.writeFileSync(path.join(dirA, 'math.js'), 'export function add(a, b) { return (a | 0) + (b | 0); }\n', 'utf8');

  const st = statusArena({ root, topic: 'perf-duel' });
  assert.equal(st.status, 'open');
  assert.equal(st.arms['arm-a'].dirty, true);
  assert.equal(st.arms['arm-b'].dirty, false);
  assert.ok(st.arms['arm-a'].diffStat.includes('math.js'));

  cleanupArena({ root, topic: 'perf-duel' });
});

test('evalArena & reportArena: 机器独立跑测、生成对质矩阵并识别胜出底座', () => {
  const root = initTestRepo();
  initArena({
    root,
    topic: 'algo-bakeoff',
    arms: ['plan-correct', 'plan-broken'],
  });

  const meta = readArenaMeta(root, 'algo-bakeoff');
  const correctDir = path.join(root, meta.arms['plan-correct'].dir);
  const brokenDir = path.join(root, meta.arms['plan-broken'].dir);

  // plan-correct: 保持正确并添加乘法函数
  fs.appendFileSync(path.join(correctDir, 'math.js'), 'export function mul(a, b) { return a * b; }\n');

  // plan-broken: 破坏加法函数使其抛错
  fs.writeFileSync(path.join(brokenDir, 'math.js'), 'export function add(a, b) { throw new Error("broken"); }\n');

  // 执行评测
  const evaluated = evalArena({
    root,
    topic: 'algo-bakeoff',
    testCmd: 'node test.js',
  });

  assert.equal(evaluated.arms['plan-correct'].evaluation.testStatus, 'PASS');
  assert.equal(evaluated.arms['plan-correct'].evaluation.exitCode, 0);
  assert.ok(evaluated.arms['plan-correct'].evaluation.durationMs >= 0);
  assert.equal(evaluated.arms['plan-correct'].evaluation.diff.filesChanged, 1);
  assert.ok(evaluated.arms['plan-correct'].evaluation.diff.insertions > 0);

  assert.equal(evaluated.arms['plan-broken'].evaluation.testStatus, 'FAIL');
  assert.notEqual(evaluated.arms['plan-broken'].evaluation.exitCode, 0);

  // 验证对质报告生成
  const reportPath = path.join(root, 'tradeoffs.md');
  const md = reportArena({
    root,
    topic: 'algo-bakeoff',
    output: reportPath,
  });

  assert.ok(md.includes('### 方案打擂实测对质矩阵'));
  assert.ok(md.includes('plan-correct'));
  assert.ok(md.includes('✅ PASS'));
  assert.ok(md.includes('🌟 推荐底座'));
  assert.ok(md.includes('plan-broken'));
  assert.ok(md.includes('❌ FAIL'));
  assert.ok(md.includes('⚠️ 测试未通过'));

  assert.ok(fs.existsSync(reportPath));
  assert.equal(fs.readFileSync(reportPath, 'utf8'), md);

  cleanupArena({ root, topic: 'algo-bakeoff' });
});

test('adoptArena: 成功将胜出臂改动应用至主工程并支持 clean 收擂', () => {
  const root = initTestRepo();
  initArena({
    root,
    topic: 'feature-duel',
    arms: ['winner-arm', 'loser-arm'],
  });

  const meta = readArenaMeta(root, 'feature-duel');
  const winDir = path.join(root, meta.arms['winner-arm'].dir);

  // 在 winner-arm 新增工具文件
  fs.writeFileSync(path.join(winDir, 'util.js'), 'export const VERSION = "2.0";\n', 'utf8');

  // 采纳 winner-arm
  const adoptRes = adoptArena({
    root,
    topic: 'feature-duel',
    arm: 'winner-arm',
    clean: true,
  });

  assert.equal(adoptRes.ok, true);
  assert.equal(adoptRes.adoptedArm, 'winner-arm');
  assert.equal(adoptRes.cleaned, true);

  // 验证主工程收到了 winner-arm 的新文件
  assert.ok(fs.existsSync(path.join(root, 'util.js')));
  assert.equal(
    fs.readFileSync(path.join(root, 'util.js'), 'utf8').replace(/\r\n/g, '\n'),
    'export const VERSION = "2.0";\n'
  );

  // 验证 clean 后沙盒已移除
  assert.equal(fs.existsSync(path.join(root, '.agents', 'arena', 'feature-duel')), false);
});

test('CLI 完整闭环: init -> status -> cleanup 命令行调用', () => {
  const root = initTestRepo();

  // init via CLI
  const rInit = spawnSync(process.execPath, [
    SCRIPT_PATH,
    'init',
    '--topic', 'cli-duel',
    '--arms', 'arm-x,arm-y',
    '--root', root,
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(rInit.status, 0, rInit.stderr);
  const initData = JSON.parse(rInit.stdout);
  assert.equal(initData.topic, 'cli-duel');

  // status via CLI
  const rStatus = spawnSync(process.execPath, [
    SCRIPT_PATH,
    'status',
    '--topic', 'cli-duel',
    '--root', root,
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(rStatus.status, 0, rStatus.stderr);
  const statusData = JSON.parse(rStatus.stdout);
  assert.equal(statusData.status, 'open');
  assert.ok(statusData.arms['arm-x']);

  // cleanup via CLI
  const rClean = spawnSync(process.execPath, [
    SCRIPT_PATH,
    'cleanup',
    '--topic', 'cli-duel',
    '--root', root,
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(rClean.status, 0, rClean.stderr);
  assert.equal(fs.existsSync(path.join(root, '.agents', 'arena', 'cli-duel')), false);
});

test('evalArena: CLI --timeout-ms 透传到各臂跑测（此前恒 120s 默认）', () => {
  // 审查遗留批 2026-11-23：经 CLI 分发传极小超时，臂被杀判 FAIL 且耗时极短——证明 timeoutMs 生效
  const root = initTestRepo();
  initArena({ root, topic: 'timeout-duel', arms: ['arm-slow', 'arm-also-slow'] });

  const rEval = spawnSync(process.execPath, [
    SCRIPT_PATH,
    'eval',
    '--topic', 'timeout-duel',
    '--test-cmd', 'node test.js',
    '--timeout-ms', '1',
    '--root', root,
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(rEval.status, 0, rEval.stderr);
  const evaluated = JSON.parse(rEval.stdout);
  for (const arm of ['arm-slow', 'arm-also-slow']) {
    assert.equal(evaluated.arms[arm].evaluation.testStatus, 'FAIL', `${arm} 被 1ms 超时杀掉`);
    assert.ok(evaluated.arms[arm].evaluation.durationMs < 5000, `${arm} 耗时远小于 120s 默认值，透传生效`);
  }

  cleanupArena({ root, topic: 'timeout-duel' });
});

test('reportArena: MISSING_WORKTREE 按 skip 展示不计失败，报告不再崩溃', () => {
  // 审查遗留批 2026-11-23：缺失臂原按 ❌ FAIL 展示且 durationMs/diff 字段缺失会 TypeError 崩掉整份报告
  const root = initTestRepo();
  initArena({ root, topic: 'missing-duel', arms: ['arm-alive', 'arm-gone'] });

  const meta = readArenaMeta(root, 'missing-duel');
  fs.rmSync(path.join(root, meta.arms['arm-gone'].dir), { recursive: true, force: true });

  const evaluated = evalArena({ root, topic: 'missing-duel', testCmd: 'node test.js' });
  assert.equal(evaluated.arms['arm-gone'].evaluation.testStatus, 'MISSING_WORKTREE');
  assert.equal(evaluated.arms['arm-gone'].evaluation.exitCode, -1);
  assert.equal(evaluated.arms['arm-alive'].evaluation.testStatus, 'PASS');

  const md = reportArena({ root, topic: 'missing-duel' });
  assert.ok(md.includes('⏭️ SKIP (工作树缺失)'), '缺失臂按 skip 展示');
  assert.ok(md.includes('工作树缺失（跳过，不计失败）'), 'verdict 不计失败');
  assert.ok(!md.includes('❌ FAIL'), '缺失臂不再误报 FAIL（唯一存活臂 PASS）');
  assert.ok(md.includes('🌟 推荐底座'), '存活臂照常参与裁决推荐');

  cleanupArena({ root, topic: 'missing-duel' });
});

test('initArena: 支持分配多模型归属并在元数据中正确记录', () => {
  const root = initTestRepo();
  try {
    const meta = initArena({
      root,
      topic: 'multi-model-duel',
      arms: ['arm-gpt', 'arm-claude'],
      models: ['gpt-4o', 'claude-3-5-sonnet'],
    });

    assert.equal(meta.arms['arm-gpt'].model, 'gpt-4o');
    assert.equal(meta.arms['arm-claude'].model, 'claude-3-5-sonnet');

    const topics = listArenaTopics(root);
    assert.ok(topics.some((t) => t.topic === 'multi-model-duel' && t.armsCount === 2));
  } finally {
    cleanupArena({ root, topic: 'multi-model-duel', force: true });
  }
});

test('evalArena & reportArena: 生成 5 维 Rubric 评分卡、综合效能分与 ASCII 雷达图', () => {
  const root = initTestRepo();
  try {
    initArena({
      root,
      topic: 'radar-duel',
      arms: ['arm-fast', 'arm-safe'],
      models: 'gpt-4o,claude-3-5-sonnet',
    });

    const meta = readArenaMeta(root, 'radar-duel');
    const fastDir = path.join(root, meta.arms['arm-fast'].dir);
    // 给 arm-fast 编写正常优化代码
    fs.writeFileSync(
      path.join(fastDir, 'math.js'),
      'export function add(a, b) { return (a | 0) + (b | 0); }\n',
      'utf8'
    );

    const evaluated = evalArena({ root, topic: 'radar-duel', testCmd: 'node test.js' });
    const fastEval = evaluated.arms['arm-fast'].evaluation;
    assert.equal(fastEval.testStatus, 'PASS');
    assert.ok(fastEval.scores, '应包含 5 维 Rubric 评分');
    assert.equal(typeof fastEval.scores.taskCompletion, 'number');
    assert.equal(typeof fastEval.scores.gatePassRate, 'number');
    assert.equal(typeof fastEval.scores.sandboxCompliance, 'number');
    assert.equal(typeof fastEval.scores.testImpactPrecision, 'number');
    assert.equal(typeof fastEval.scores.stepEfficiency, 'number');
    assert.equal(typeof fastEval.compositeScore, 'number');
    assert.ok(fastEval.compositeScore > 0, '综合效能分应大于 0');

    const md = reportArena({ root, topic: 'radar-duel' });
    assert.ok(md.includes('方案打擂实测对质矩阵'));
    assert.ok(md.includes('模型'));
    assert.ok(md.includes('gpt-4o'));
    assert.ok(md.includes('claude-3-5-sonnet'));
    assert.ok(md.includes('综合评分'));
    assert.ok(md.includes('多维评分卡对质细项'));
    assert.ok(md.includes('维度评分卡'));
  } finally {
    cleanupArena({ root, topic: 'radar-duel', force: true });
  }
});

test('evalArena: 接入执行护栏拦截高危 testCmd 并脱敏输出', () => {
  const root = initTestRepo();
  initArena({
    root,
    topic: 'guardrail-duel',
    arms: ['arm-a', 'arm-b'],
  });
  try {
    assert.throws(
      () => evalArena({ root, topic: 'guardrail-duel', testCmd: 'sudo rm -rf /' }),
      (err) => err.code === 'UNSAFE_TEST_CMD',
    );
  } finally {
    cleanupArena({ root, topic: 'guardrail-duel', force: true });
  }
});
