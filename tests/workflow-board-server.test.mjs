import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseRunFile,
  runCard,
  activeRunsCount,
  safeRunPath,
} from '../templates/engine/.agents/scripts/workflow-board-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const INDEX_HTML = path.join(REPO, 'templates', 'engine', '.agents', 'board', 'index.html');

test('parseRunFile 解析与校验规则', () => {
  assert.equal(parseRunFile('not a json'), null, '非 JSON 字符串返回 null');
  assert.equal(parseRunFile(''), null, '空字符串返回 null');
  assert.equal(parseRunFile('[]'), null, '数组返回 null');
  assert.equal(parseRunFile('null'), null, 'null 返回 null');
  assert.equal(parseRunFile('{"foo":"bar"}'), null, '缺少 runId 返回 null');
  assert.equal(parseRunFile('{"runId":""}'), null, '空 runId 返回 null');
  assert.equal(parseRunFile('{"runId":123}'), null, '非字符串 runId 返回 null');

  const valid = parseRunFile('{"runId":"2026-11-21-test-run","stage":"implement"}');
  assert.ok(valid);
  assert.equal(valid.runId, '2026-11-21-test-run');
  assert.equal(valid.stage, 'implement');
});

test('runCard 产物、阶段流与退回路由投影', () => {
  const mockRun = {
    runId: '2026-11-21-feat-test',
    requirement: '实现 pipeline 看板测试',
    stage: 'fix',
    stopType: 'work-order',
    updatedAt: '2026-11-21T12:00:00.000Z',
    triage: { kind: 'feat', level: 'L2', module: 'board' },
    nextTarget: 'plan',
    docs: {
      entry: 'intents/2026-11-21-test.md',
      spec: 'specs/2026-11-21-test/spec.md',
      plan: 'plans/2026-11-21-test.md',
      apiDocs: ['api-docs/test.md'],
    },
    retries: { fix: 1 },
    workOrder: {
      id: 42,
      kind: 'fix',
      title: '修复门禁阻断',
      goal: '修复测试不通过项',
    },
    awaitConfirm: {
      doc: 'specs/2026-11-21-test/spec.md',
      points: '请确认测试范围',
      ledger: true,
    },
    gateFail: {
      gate: 'check-loop',
      exit: 1,
      hint: '闭环检验未通过',
    },
    events: [
      { type: 'run-created', t: '2026-11-21T11:50:00.000Z' },
      { type: 'route', from: 'fix', to: 'plan', attempt: 1, cap: 2, t: '2026-11-21T11:55:00.000Z' },
    ],
  };

  const card = runCard(mockRun);
  assert.equal(card.runId, '2026-11-21-feat-test');
  assert.equal(card.requirement, '实现 pipeline 看板测试');
  assert.equal(card.stage, 'fix');
  assert.equal(card.stopType, 'work-order');
  assert.equal(card.eventCount, 2);
  assert.equal(card.nextTarget, 'plan');

  // 退回指示器
  assert.ok(card.stageBar.includes('↩ 退回 plan（fix 1/2）'));
  assert.deepEqual(card.route, { to: 'plan', from: 'fix', attempt: 1, cap: 2 });

  // 产物投影
  assert.deepEqual(card.docs, mockRun.docs);
  assert.deepEqual(card.retries, { fix: 1 });

  // 关键字段投影
  assert.deepEqual(card.workOrder, {
    id: 42,
    kind: 'fix',
    title: '修复门禁阻断',
    goal: '修复测试不通过项',
  });
  assert.deepEqual(card.awaitConfirm, {
    doc: 'specs/2026-11-21-test/spec.md',
    points: '请确认测试范围',
    ledger: true,
  });
  assert.deepEqual(card.gateFail, {
    gate: 'check-loop',
    exit: 1,
    hint: '闭环检验未通过',
  });
});

test('runCard 缺省字段容错兜底', () => {
  const minimal = { runId: '2026-11-21-min' };
  const card = runCard(minimal);
  assert.equal(card.runId, '2026-11-21-min');
  assert.equal(card.requirement, '');
  assert.equal(card.stage, '');
  assert.equal(card.stopType, '');
  assert.equal(card.eventCount, 0);
  assert.equal(card.nextTarget, null);
  assert.equal(card.docs, null);
  assert.equal(card.route, null);
  assert.equal(card.workOrder, null);
  assert.equal(card.awaitConfirm, null);
  assert.equal(card.gateFail, null);
});

test('activeRunsCount 准确识别非终态流水线', () => {
  const runs = [
    { runId: 'r1', stopType: 'work-order' },
    { runId: 'r2', stopType: 'await-confirm' },
    { runId: 'r3', stopType: 'gate-fail' },
    { runId: 'r4', stopType: 'done' },
    { runId: 'r5', stopType: 'aborted' },
    { runId: 'r6', stopType: '' },
    null,
  ];

  assert.equal(activeRunsCount(runs), 3, '只有 work-order/await-confirm/gate-fail 等运行中态计入 active');
});

test('safeRunPath 白名单校验防穿越', () => {
  assert.equal(safeRunPath('../secret.json'), null);
  assert.equal(safeRunPath('../../etc/passwd.json'), null);
  assert.equal(safeRunPath('run.txt'), null);
  assert.equal(safeRunPath('run.js'), null);

  const safe = safeRunPath('2026-11-21-test.json');
  assert.ok(safe);
  assert.ok(safe.endsWith(path.join('pipeline-runs', '2026-11-21-test.json')));
});

test('Web 看板 index.html 阶段图、产物流与呼吸徽标静态结构检查', () => {
  assert.ok(fs.existsSync(INDEX_HTML), 'index.html 必须存在');
  const html = fs.readFileSync(INDEX_HTML, 'utf8');

  // 1. 顶部呼吸灯与徽标
  assert.ok(html.includes('id="runs-badge"'), '导航栏应包含 runs-badge 徽标');
  assert.ok(html.includes('badge-pulse'), '徽标样式应包含 badge-pulse');

  // 2. 抽屉 tab
  assert.ok(html.includes('data-tab="overview"'), '抽屉应包含 overview tab');
  assert.ok(html.includes('data-tab="artifacts"'), '抽屉应包含 artifacts tab');

  // 3. 阶段流图与产物标签 CSS
  assert.ok(html.includes('.stage-flow'), '应包含 .stage-flow 样式');
  assert.ok(html.includes('.sf-node'), '应包含 .sf-node 样式');
  assert.ok(html.includes('.sf-arrow'), '应包含 .sf-arrow 样式');
  assert.ok(html.includes('.route-pill'), '应包含 .route-pill 样式');
  assert.ok(html.includes('.art-tag'), '应包含 .art-tag 样式');

  // 4. JS 核心函数定义
  assert.ok(html.includes('function getStageSequence('), '应定义 getStageSequence');
  assert.ok(html.includes('function renderStageFlowHtml('), '应定义 renderStageFlowHtml');
  assert.ok(html.includes('function renderArtifactsHtml('), '应定义 renderArtifactsHtml');
  assert.ok(html.includes('function loadRunOverview('), '应定义 loadRunOverview');
  assert.ok(html.includes('function loadRunArtifacts('), '应定义 loadRunArtifacts');
  assert.ok(html.includes('data.activeRuns'), 'refreshBoard 中应处理 data.activeRuns');
});
