// tests/timeline-trace.test.mjs
// 时间轴时序轨迹与回溯对质引擎全套单元测试

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  TIMELINE_EVENT_TYPES,
  TIMELINE_STATUS,
  createTimelineEvent,
  appendTimelineEvent,
  loadTimelineTrace,
  buildKeyframeIndex,
  queryTimelineEvents,
  projectStateAtTimestamp,
  diffTimelineNodes,
  exportPostMortemBundle,
  renderPostMortemHtml,
  parseArgs,
} from '../templates/engine/.agents/scripts/timeline-trace.mjs';
import { savePrescriptions } from '../templates/engine/.agents/scripts/self-healing-prescriptions.mjs';

describe('Unit 1: 时序事件流契约与追加记录器', () => {
  let tmpRoot = null;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-test-root-'));
  });

  afterEach(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('createTimelineEvent 生成规范事件对象', () => {
    const event = createTimelineEvent({
      runId: 'run-alpha',
      seq: 1,
      eventType: 'STAGE_ENTER',
      stage: 'plan',
      actor: 'planner',
      status: TIMELINE_STATUS.SUCCESS,
      summary: '进入规划阶段',
      snapshotHash: 'hash-abc',
    });

    assert.ok(event.eventId.startsWith('evt-'));
    assert.equal(event.runId, 'run-alpha');
    assert.equal(event.seq, 1);
    assert.equal(event.eventType, 'STAGE_ENTER');
    assert.equal(event.stage, 'plan');
    assert.equal(event.snapshotHash, 'hash-abc');
  });

  test('appendTimelineEvent 与 loadTimelineTrace 实现分片落盘与有序回放', () => {
    const runId = 'run-test-101';
    appendTimelineEvent(tmpRoot, {
      runId,
      seq: 1,
      eventType: 'RUN_STARTED',
      stage: 'init',
      summary: '流水线启动',
    });
    appendTimelineEvent(tmpRoot, {
      runId,
      seq: 2,
      eventType: 'STAGE_ENTER',
      stage: 'plan',
      summary: '进入计划阶段',
    });

    const events = loadTimelineTrace(tmpRoot, runId);
    assert.equal(events.length, 2);
    assert.equal(events[0].seq, 1);
    assert.equal(events[0].eventType, 'RUN_STARTED');
    assert.equal(events[1].seq, 2);
    assert.equal(events[1].stage, 'plan');
  });
});

describe('Unit 2: 关键帧回放与时间旅行状态投影', () => {
  const baseTime = new Date('2026-11-25T10:00:00.000Z').getTime();

  const mockEvents = [
    createTimelineEvent({
      runId: 'run-travel',
      seq: 1,
      timestamp: new Date(baseTime).toISOString(),
      eventType: 'RUN_STARTED',
      stage: 'init',
    }),
    createTimelineEvent({
      runId: 'run-travel',
      seq: 2,
      timestamp: new Date(baseTime + 10000).toISOString(),
      eventType: 'STAGE_ENTER',
      stage: 'implement',
    }),
    createTimelineEvent({
      runId: 'run-travel',
      seq: 3,
      timestamp: new Date(baseTime + 20000).toISOString(),
      eventType: 'GATE_EVALUATED',
      stage: 'implement',
      status: TIMELINE_STATUS.FAILED,
      payload: { gateName: 'unit-test-gate' },
    }),
    createTimelineEvent({
      runId: 'run-travel',
      seq: 4,
      timestamp: new Date(baseTime + 30000).toISOString(),
      eventType: 'STATUS_ROLLBACK',
      stage: 'implement',
      summary: '测试不通过，回滚至修复循环',
    }),
    createTimelineEvent({
      runId: 'run-travel',
      seq: 5,
      timestamp: new Date(baseTime + 50000).toISOString(),
      eventType: 'GATE_EVALUATED',
      stage: 'implement',
      status: TIMELINE_STATUS.SUCCESS,
      payload: { gateName: 'unit-test-gate' },
    }),
  ];

  test('buildKeyframeIndex 筛选核心跃迁节点', () => {
    const keyframes = buildKeyframeIndex(mockEvents);
    assert.equal(keyframes.length, 5); // 5个均为核心变迁类型
  });

  test('queryTimelineEvents 支持阶段与事件类型多维过滤', () => {
    const gates = queryTimelineEvents(mockEvents, { eventType: 'GATE_EVALUATED' });
    assert.equal(gates.length, 2);

    const implementEvents = queryTimelineEvents(mockEvents, { stage: 'implement' });
    assert.equal(implementEvents.length, 4);
  });

  test('projectStateAtTimestamp 准确时间旅行到指定时刻还原历史切片', () => {
    // 1. 还原到第 15 秒（在进入 implement 之后，但尚未发生门禁评估与回滚）
    const snapshot15s = projectStateAtTimestamp(mockEvents, new Date(baseTime + 15000));
    assert.equal(snapshot15s.active, true);
    assert.equal(snapshot15s.currentStage, 'implement');
    assert.equal(snapshot15s.totalStepsExecuted, 2);
    assert.equal(snapshot15s.rollbacksCount, 0);
    assert.equal(snapshot15s.gatesEvaluated.length, 0);

    // 2. 还原到第 35 秒（发生了一次门禁失败与回滚）
    const snapshot35s = projectStateAtTimestamp(mockEvents, new Date(baseTime + 35000));
    assert.equal(snapshot35s.totalStepsExecuted, 4);
    assert.equal(snapshot35s.rollbacksCount, 1);
    assert.equal(snapshot35s.gatesEvaluated.length, 1);
    assert.equal(snapshot35s.gatesEvaluated[0].passed, false);
  });

  test('createTimelineEvent 保证同毫秒快速追加时的时间戳单调递增', () => {
    const e1 = createTimelineEvent({ seq: 1 });
    const e2 = createTimelineEvent({ seq: 2 });
    assert.ok(new Date(e2.timestamp).getTime() > new Date(e1.timestamp).getTime(), '无显式时间戳时应严格单调递增');
  });

  test('projectStateAtTimestamp 支持事件对象或 opts.maxSeq 消除同刻裁决歧义', () => {
    const sameTime = '2026-11-25T12:00:00.000Z';
    const evts = [
      createTimelineEvent({ seq: 1, timestamp: sameTime, eventType: 'RUN_STARTED' }),
      createTimelineEvent({ seq: 2, timestamp: sameTime, eventType: 'STATUS_ROLLBACK' }),
      createTimelineEvent({ seq: 3, timestamp: sameTime, eventType: 'STEP_EXECUTED' }),
    ];
    // 传入目标事件对象
    const projByEvent = projectStateAtTimestamp(evts, evts[1]);
    assert.equal(projByEvent.totalStepsExecuted, 2);
    assert.equal(projByEvent.rollbacksCount, 1);

    // 传入 timestamp + maxSeq
    const projByMaxSeq = projectStateAtTimestamp(evts, sameTime, { maxSeq: 2 });
    assert.equal(projByMaxSeq.totalStepsExecuted, 2);
  });
});

describe('Unit 3: 快照差异对质与离线复盘包导出', () => {
  let tmpRoot = null;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-export-root-'));
  });

  afterEach(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('diffTimelineNodes 能够计算节点间耗时与状态迁移', () => {
    const nodeA = createTimelineEvent({
      seq: 1,
      timestamp: '2026-11-25T10:00:00.000Z',
      stage: 'plan',
      snapshotHash: 'hash-1',
    });
    const nodeB = createTimelineEvent({
      seq: 2,
      timestamp: '2026-11-25T10:01:00.000Z',
      stage: 'implement',
      snapshotHash: 'hash-2',
    });

    const diff = diffTimelineNodes(nodeA, nodeB);
    assert.equal(diff.durationMs, 60000);
    assert.deepEqual(diff.stageTransition, { from: 'plan', to: 'implement' });
    assert.equal(diff.snapshotChanged, true);
  });

  test('exportPostMortemBundle 与 renderPostMortemHtml 导出完整复盘包', () => {
    const runId = 'run-pm-bundle-01';
    appendTimelineEvent(tmpRoot, {
      runId,
      seq: 1,
      eventType: 'RUN_STARTED',
      stage: 'plan',
      summary: '开工',
    });
    appendTimelineEvent(tmpRoot, {
      runId,
      seq: 2,
      eventType: 'RUN_COMPLETED',
      stage: 'review',
      status: TIMELINE_STATUS.SUCCESS,
      summary: '完工签收',
    });

    const bundle = exportPostMortemBundle(tmpRoot, runId);
    assert.equal(bundle.runId, runId);
    assert.equal(bundle.metrics.totalEvents, 2);
    assert.ok(fs.existsSync(bundle.bundleFile));

    const html = renderPostMortemHtml(bundle);
    assert.ok(html.includes(`流水线时序复盘 — ${runId}`));
    assert.ok(html.includes('RUN_COMPLETED'));
  });

  test('parseArgs 能够正确解析 CLI 命令行选项', () => {
    const args = parseArgs(['query', '--run', 'run-xyz', '--stage', 'verify']);
    assert.equal(args.command, 'query');
    assert.equal(args.runId, 'run-xyz');
    assert.equal(args.stage, 'verify');
  });

  test('exportPostMortemBundle 从 canonical 处方库 (.agents/notes/prescriptions.json) 收集处方', () => {
    const runId = 'run-pm-bundle-rx';
    appendTimelineEvent(tmpRoot, {
      runId,
      seq: 1,
      eventType: 'RUN_STARTED',
      stage: 'plan',
      summary: '开工',
    });

    const rxFile = path.join(tmpRoot, '.agents', 'notes', 'prescriptions.json');
    const saved = savePrescriptions(rxFile, [
      {
        category: 'touch-set',
        failurePattern: 'Modified file outside touch-set',
        rootCause: '未遵守触点范围',
        actionableFix: '仅允许修改声明过的文件',
      },
    ]);
    assert.equal(saved, true);
    assert.ok(fs.existsSync(rxFile), 'canonical 处方库应落盘');

    const bundle = exportPostMortemBundle(tmpRoot, runId);
    assert.equal(bundle.metrics.prescriptionsCount, 1);
    assert.equal(bundle.prescriptions.length, 1);
    assert.equal(bundle.prescriptions[0].category, 'touch-set');
  });

  test('exportPostMortemBundle 在 canonical 缺失时只读回退旧版 .agents/prescriptions.jsonl', () => {
    fs.mkdirSync(path.join(tmpRoot, '.agents'), { recursive: true });
    const legacyFile = path.join(tmpRoot, '.agents', 'prescriptions.jsonl');
    fs.writeFileSync(
      legacyFile,
      `${JSON.stringify({
        category: 'touch-set',
        failurePattern: 'legacy pattern',
        rootCause: 'legacy cause',
        actionableFix: 'legacy fix',
      })}\n`,
      'utf8',
    );

    const bundle = exportPostMortemBundle(tmpRoot, 'run-pm-bundle-legacy', { saveToFile: false });
    assert.equal(bundle.metrics.prescriptionsCount, 1);
    assert.equal(bundle.prescriptions[0].actionableFix, 'legacy fix');
    assert.ok(fs.existsSync(legacyFile), '旧版处方文件应保持存在');
    assert.equal(
      fs.existsSync(path.join(tmpRoot, '.agents', 'notes', 'prescriptions.json')),
      false,
      '回退路径不得写回 canonical 处方库',
    );
  });
});
