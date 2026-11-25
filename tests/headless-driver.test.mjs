// tests/headless-driver.test.mjs
// 受控无头代理驱动器与影子试跑引擎全套单元测试

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  DRIVER_STATUS,
  createDriverAdapter,
  parseDriverEvents,
  StepBudgetGuard,
  StallDetector,
  checkStopSignal,
  createShadowWorkspace,
  scanFileTreeHashes,
  diffFileTrees,
  runShadowExecution,
  parseArgs,
} from '../templates/engine/.agents/scripts/headless-driver.mjs';

describe('Unit 1: 驱动器适配层与执行器契约', () => {
  test('createDriverAdapter 能够在 mock 模式下执行并提取事件', () => {
    const adapter = createDriverAdapter({
      type: 'mock',
      mockFn: (ctx) => ({
        status: 0,
        stdout: `[stage:${ctx.stage}] 执行完毕 [gate:pass]\n`,
      }),
    });

    const res = adapter.executeStep({ stage: 'implement' });
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('[stage:implement]'));
    assert.ok(res.parsedEvents.includes('stage:implement'));
    assert.ok(res.parsedEvents.includes('gate:pass'));
  });

  test('createDriverAdapter 能够在 process 模式下调用真实子命令', () => {
    const adapter = createDriverAdapter({
      type: 'process',
      command: process.execPath,
      args: ['-e', 'console.log("[gate:pass] OK")'],
    });

    const res = adapter.executeStep();
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('[gate:pass] OK'));
    assert.ok(res.parsedEvents.includes('gate:pass'));
  });

  test('parseDriverEvents 能够从异常输出中精准提取错误分类', () => {
    const stdout = 'Running verification...';
    const stderr = 'ReferenceError: invalidToken is not defined\nFAIL in tests/gate.test.mjs';
    const events = parseDriverEvents(stdout, stderr);

    assert.ok(events.includes('error:syntax_or_type'));
    assert.ok(events.includes('error:test_failure'));
  });
});

describe('Unit 2: 防死循环与熔断预算控制器', () => {
  test('StepBudgetGuard 正确处理步数超限熔断', () => {
    const guard = new StepBudgetGuard({ maxSteps: 3 });

    assert.equal(guard.recordStep({ status: 0 }).halted, false);
    assert.equal(guard.recordStep({ status: 0 }).halted, false);
    assert.equal(guard.recordStep({ status: 0 }).halted, false);

    // 第 4 步超过 maxSteps: 3
    const res = guard.recordStep({ status: 0 });
    assert.equal(res.halted, true);
    assert.equal(res.status, DRIVER_STATUS.EXCEEDED_STEP_BUDGET);
  });

  test('StepBudgetGuard 连续失败次数达到上限触发熔断', () => {
    const guard = new StepBudgetGuard({ maxConsecutiveFailures: 2 });

    assert.equal(guard.recordStep({ status: 1 }).halted, false);
    const res = guard.recordStep({ status: 1 });
    assert.equal(res.halted, true);
    assert.equal(res.status, DRIVER_STATUS.CIRCUIT_BREAKER_TRIGGERED);
  });

  test('StallDetector 连续 3 步状态指纹一致时精准检测死循环', () => {
    const detector = new StallDetector(3);

    const stepPayload = {
      stage: 'implement',
      status: 1,
      stdout: 'same error repeatedly',
      stderr: 'error details',
    };

    assert.equal(detector.checkStall(stepPayload).stalled, false);
    assert.equal(detector.checkStall(stepPayload).stalled, false);

    // 第 3 步相同触发死循环
    const res = detector.checkStall(stepPayload);
    assert.equal(res.stalled, true);
    assert.ok(res.reason.includes('死循环'));
  });

  test('checkStopSignal 能够检测到外部停机信号文件', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-signal-test-'));
    try {
      assert.equal(checkStopSignal(tmpDir).stop, false);

      const signalPath = path.join(tmpDir, 'stop.signal');
      fs.writeFileSync(signalPath, '人工紧急制动', 'utf8');

      const check = checkStopSignal(tmpDir);
      assert.equal(check.stop, true);
      assert.ok(check.reason.includes('人工紧急制动'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Unit 3: 影子工作区隔离与试跑调度', () => {
  let tmpRoot = null;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-driver-test-'));
    fs.writeFileSync(path.join(tmpRoot, 'index.js'), 'console.log("hello");', 'utf8');
  });

  afterEach(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('createShadowWorkspace 隔离复制文件且能干净清理', () => {
    const { shadowDir, cleanup } = createShadowWorkspace(tmpRoot);
    assert.ok(fs.existsSync(path.join(shadowDir, 'index.js')));

    cleanup();
    assert.equal(fs.existsSync(shadowDir), false);
  });

  test('diffFileTrees 能够精准捕获新增、修改与删除的文件', () => {
    const initialMap = new Map([
      ['file-a.txt', 'hash1'],
      ['file-b.txt', 'hash2'],
    ]);
    const finalMap = new Map([
      ['file-a.txt', 'hash1-modified'],
      ['file-c.txt', 'hash3'],
    ]);

    const diff = diffFileTrees(initialMap, finalMap);
    assert.deepEqual(diff.modified, ['file-a.txt']);
    assert.deepEqual(diff.created, ['file-c.txt']);
    assert.deepEqual(diff.deleted, ['file-b.txt']);
  });

  test('runShadowExecution 能够成功执行全阶段影子试跑', () => {
    const adapter = createDriverAdapter({
      type: 'mock',
      mockFn: (ctx) => {
        // 在 implement 阶段向工作区写入文件
        if (ctx.stage === 'implement') {
          fs.writeFileSync(path.join(ctx.workspaceDir, 'output.txt'), 'generated artifact', 'utf8');
        }
        return { status: 0, stdout: `Stage ${ctx.stage} finished` };
      },
    });

    const report = runShadowExecution({
      root: tmpRoot,
      adapter,
      stages: ['plan', 'implement', 'verify'],
      dryRun: true,
    });

    assert.equal(report.success, true);
    assert.equal(report.status, DRIVER_STATUS.SUCCESS);
    assert.equal(report.stagesCompleted.length, 3);
    assert.ok(report.fileChanges.created.includes('output.txt'));
  });

  test('runShadowExecution 遭遇连续失败时优雅熔断终止', () => {
    const adapter = createDriverAdapter({
      type: 'mock',
      mockFn: () => ({ status: 1, stdout: 'step failed constantly' }),
    });

    const report = runShadowExecution({
      root: tmpRoot,
      adapter,
      budgetConfig: { maxConsecutiveFailures: 2 },
      stages: ['plan', 'implement', 'verify'],
      dryRun: true,
    });

    assert.equal(report.success, false);
    assert.equal(report.status, DRIVER_STATUS.CIRCUIT_BREAKER_TRIGGERED);
  });

  test('parseArgs 能够正确解析命令行参数', () => {
    const args = parseArgs(['shadow', '--max-steps', '20', '--timeout-ms', '90000', '--keep']);
    assert.equal(args.command, 'shadow');
    assert.equal(args.maxSteps, 20);
    assert.equal(args.maxWallClockMs, 90000);
    assert.equal(args.dryRun, false);
  });
});
