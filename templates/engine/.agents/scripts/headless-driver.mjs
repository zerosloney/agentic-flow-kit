#!/usr/bin/env node
// headless-driver.mjs
// 受控无头代理驱动器与影子试跑引擎（Headless Driver & Shadow Execution Engine）
//
// 职责：
//   1. 驱动器适配层与执行器契约（支持进程子命令与 Mock 驱动，提供标准化 stdio 捕获与阶段标记提取）；
//   2. 防死循环与熔断预算控制器（步数预算、总耗时熔断、连续失败熔断、状态指纹空转死循环拦截、外部 stop.signal 监听）；
//   3. 影子工作区隔离试跑与阶段闭环调度（在独立临时沙箱中执行完整流水线长跑，捕获 diff 并生成试跑复盘报告）；
//   4. 命令行交互与安全驱动入口。
//
// 零外部依赖，纯 Node.js 标准库实现。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------
// 1. 常量与错误状态定义
// ---------------------------------------------------------------------

export const DRIVER_STATUS = {
  SUCCESS: 'success',
  FAILED: 'failed',
  EXCEEDED_STEP_BUDGET: 'exceeded_step_budget',
  TIMEOUT: 'timeout',
  CIRCUIT_BREAKER_TRIGGERED: 'circuit_breaker_triggered',
  STALL_DETECTED: 'stall_detected',
  ABORTED_BY_SIGNAL: 'aborted_by_signal',
};

export const DEFAULT_BUDGET_CONFIG = {
  maxSteps: 10,
  maxWallClockMs: 60000,
  maxConsecutiveFailures: 3,
  stallWindowSize: 3,
};

function cleanSubprocessEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

// ---------------------------------------------------------------------
// 2. 驱动器适配层与执行器契约 (Driver Adapter Interface)
// ---------------------------------------------------------------------

/**
 * 创建驱动器适配器实例
 * @param {object} options
 * @param {'process'|'mock'|'script'} options.type - 适配器类型
 * @param {string} options.command - 可执行命令（process 模式）
 * @param {Array<string>} options.args - 命令参数
 * @param {Function} options.mockFn - 模拟执行函数 (context) => { status, stdout, stderr }
 * @returns {object} 统一适配器对象
 */
export function createDriverAdapter(options = {}) {
  const type = options.type || 'mock';

  return {
    type,
    command: options.command || '',
    args: options.args || [],
    cwd: options.cwd || process.cwd(),
    env: options.env || {},
    mockFn: typeof options.mockFn === 'function' ? options.mockFn : null,

    /**
     * 执行单步指令
     * @param {object} context
     * @returns {object} 执行结果
     */
    executeStep(context = {}) {
      const startTime = Date.now();
      const workspaceDir = context.workspaceDir || this.cwd;

      if (this.type === 'mock') {
        if (!this.mockFn) {
          return {
            status: 0,
            stdout: '[mock] 默认空操作执行完成\n',
            stderr: '',
            durationMs: Date.now() - startTime,
            parsedEvents: ['default_noop'],
          };
        }
        const mockRes = this.mockFn(context) || {};
        const durationMs = Date.now() - startTime;
        const stdout = String(mockRes.stdout || '');
        const stderr = String(mockRes.stderr || '');
        return {
          status: mockRes.status ?? 0,
          stdout,
          stderr,
          durationMs,
          parsedEvents: parseDriverEvents(stdout, stderr),
        };
      }

      if (this.type === 'process' || this.type === 'script') {
        if (!this.command) {
          throw new Error('process 适配器必须提供 command 参数');
        }

        const runArgs = [...this.args, ...(context.extraArgs || [])];
        const res = spawnSync(this.command, runArgs, {
          cwd: workspaceDir,
          env: cleanSubprocessEnv(this.env),
          encoding: 'utf8',
          timeout: context.timeoutMs || 30000,
        });

        const durationMs = Date.now() - startTime;
        const stdout = res.stdout || '';
        const stderr = res.stderr || '';

        return {
          status: res.status ?? (res.error ? 1 : 0),
          stdout,
          stderr,
          durationMs,
          error: res.error,
          parsedEvents: parseDriverEvents(stdout, stderr),
        };
      }

      throw new Error(`未知驱动器适配器类型: ${this.type}`);
    },
  };
}

/**
 * 解析驱动输出中的关键事件与标记
 * @param {string} stdout
 * @param {string} stderr
 * @returns {Array<string>} 提取到的结构化事件
 */
export function parseDriverEvents(stdout = '', stderr = '') {
  const combined = `${stdout}\n${stderr}`;
  const events = [];

  const stageMatch = combined.match(/\[stage:([a-zA-Z0-9_-]+)\]/g);
  if (stageMatch) {
    for (const m of stageMatch) {
      events.push(m.replace(/[\[\]]/g, ''));
    }
  }

  const gateMatch = combined.match(/\[gate:(pass|fail|blocked)\]/gi);
  if (gateMatch) {
    for (const m of gateMatch) {
      events.push(m.replace(/[\[\]]/g, '').toLowerCase());
    }
  }

  if (/SyntaxError|ReferenceError|TypeError/i.test(combined)) {
    events.push('error:syntax_or_type');
  }

  if (/FAIL|test failed|assert\.equal/i.test(combined)) {
    events.push('error:test_failure');
  }

  return events;
}

// ---------------------------------------------------------------------
// 2. 防死循环与熔断预算控制器 (Step Budget Guard & Stall Detector)
// ---------------------------------------------------------------------

/**
 * 步数与耗时预算控制器
 */
export class StepBudgetGuard {
  constructor(config = {}) {
    this.maxSteps = Number(config.maxSteps) || DEFAULT_BUDGET_CONFIG.maxSteps;
    this.maxWallClockMs = Number(config.maxWallClockMs) || DEFAULT_BUDGET_CONFIG.maxWallClockMs;
    this.maxConsecutiveFailures = Number(config.maxConsecutiveFailures) || DEFAULT_BUDGET_CONFIG.maxConsecutiveFailures;

    this.stepsExecuted = 0;
    this.consecutiveFailures = 0;
    this.startTime = Date.now();
    this.history = [];
  }

  /**
   * 记录执行步并判定是否触发熔断
   * @param {object} stepRecord
   * @returns {{ halted: boolean, reason?: string, status?: string }}
   */
  recordStep(stepRecord = {}) {
    this.stepsExecuted += 1;
    const now = Date.now();
    const elapsedMs = now - this.startTime;

    const isSuccess = stepRecord.status === 0 || stepRecord.status === 'success';
    if (isSuccess) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures += 1;
    }

    this.history.push({
      step: this.stepsExecuted,
      isSuccess,
      elapsedMs,
      ...stepRecord,
    });

    // 1. 最大步数预算熔断
    if (this.stepsExecuted > this.maxSteps) {
      return {
        halted: true,
        status: DRIVER_STATUS.EXCEEDED_STEP_BUDGET,
        reason: `超过最大步数预算限制（当前 ${this.stepsExecuted} 步，上限 ${this.maxSteps} 步）`,
      };
    }

    // 2. 总耗时超时熔断
    if (elapsedMs > this.maxWallClockMs) {
      return {
        halted: true,
        status: DRIVER_STATUS.TIMEOUT,
        reason: `执行总耗时超限（已耗时 ${elapsedMs}ms，预算上限 ${this.maxWallClockMs}ms）`,
      };
    }

    // 3. 连续失败熔断
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      return {
        halted: true,
        status: DRIVER_STATUS.CIRCUIT_BREAKER_TRIGGERED,
        reason: `触发连续失败熔断（连续 ${this.consecutiveFailures} 步失败，上限 ${this.maxConsecutiveFailures}）`,
      };
    }

    return { halted: false };
  }
}

/**
 * 空转与死循环检测器（基于滑动窗口指纹比对）
 */
export class StallDetector {
  constructor(windowSize = 3) {
    this.windowSize = Math.max(2, windowSize);
    this.fingerprints = [];
  }

  /**
   * 计算单步特征指纹
   * @param {object} stepData
   * @returns {string} SHA-256 摘要
   */
  computeFingerprint(stepData = {}) {
    const raw = [
      String(stepData.stage || ''),
      String(stepData.status || ''),
      String(stepData.stdout || '').trim().slice(0, 300),
      String(stepData.stderr || '').trim().slice(0, 300),
      Array.isArray(stepData.modifiedFiles) ? stepData.modifiedFiles.sort().join(',') : '',
    ].join('::');

    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16);
  }

  /**
   * 记录步数据并检查是否检测到死循环
   * @param {object} stepData
   * @returns {{ stalled: boolean, reason?: string }}
   */
  checkStall(stepData = {}) {
    const fp = this.computeFingerprint(stepData);
    this.fingerprints.push(fp);

    if (this.fingerprints.length > this.windowSize) {
      this.fingerprints.shift();
    }

    if (this.fingerprints.length >= this.windowSize) {
      const allEqual = this.fingerprints.every((val) => val === this.fingerprints[0]);
      if (allEqual) {
        return {
          stalled: true,
          reason: `检测到连续 ${this.windowSize} 步状态与输出完全无变化。触发防死循环停机。`,
        };
      }
    }

    return { stalled: false };
  }
}

/**
 * 检查是否存在外部停机信号
 * @param {string} workspaceDir
 * @returns {{ stop: boolean, signalFile?: string, reason?: string }}
 */
export function checkStopSignal(workspaceDir) {
  if (!workspaceDir) return { stop: false };

  const signalFiles = [
    path.join(workspaceDir, '.agents', 'stop.signal'),
    path.join(workspaceDir, 'stop.signal'),
  ];

  for (const f of signalFiles) {
    if (fs.existsSync(f)) {
      let content = '外部手动信号';
      try {
        content = fs.readFileSync(f, 'utf8').trim() || content;
      } catch {
        // ignore
      }
      return {
        stop: true,
        signalFile: f,
        reason: `检测到停机信号文件 ${path.basename(f)}: ${content}`,
      };
    }
  }

  return { stop: false };
}

// ---------------------------------------------------------------------
// 3. 影子工作区隔离与试跑调度 (Shadow Workspace & Execution Engine)
// ---------------------------------------------------------------------

/**
 * 递归复制目录（排除临时与大型产物）
 * @param {string} src
 * @param {string} dest
 */
export function copyDirectoryFiltered(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.tmp') {
        continue;
      }
      copyDirectoryFiltered(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 建立隔离影子工作区
 * @param {string} sourceRoot
 * @param {object} options
 * @returns {{ shadowDir: string, cleanup: Function }}
 */
export function createShadowWorkspace(sourceRoot, options = {}) {
  const prefix = options.prefix || 'agent-shadow-run-';
  const shadowDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  if (sourceRoot && fs.existsSync(sourceRoot)) {
    copyDirectoryFiltered(sourceRoot, shadowDir);
  }

  const cleanup = () => {
    try {
      fs.rmSync(shadowDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  return {
    shadowDir,
    cleanup,
  };
}

/**
 * 扫描工作区文件树哈希清单
 * @param {string} dir
 * @param {string} base
 * @returns {Map<string, string>}
 */
export function scanFileTreeHashes(dir, base = '') {
  const map = new Map();
  if (!fs.existsSync(dir)) return map;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const sub = scanFileTreeHashes(full, rel);
      for (const [k, v] of sub) map.set(k, v);
    } else if (entry.isFile()) {
      try {
        const content = fs.readFileSync(full);
        const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
        map.set(rel, hash);
      } catch {
        // ignore
      }
    }
  }

  return map;
}

/**
 * 比对两棵文件树的差异列表
 * @param {Map<string, string>} initialMap
 * @param {Map<string, string>} finalMap
 * @returns {{ modified: Array<string>, created: Array<string>, deleted: Array<string> }}
 */
export function diffFileTrees(initialMap, finalMap) {
  const modified = [];
  const created = [];
  const deleted = [];

  for (const [file, hash] of finalMap) {
    if (!initialMap.has(file)) {
      created.push(file);
    } else if (initialMap.get(file) !== hash) {
      modified.push(file);
    }
  }

  for (const [file] of initialMap) {
    if (!finalMap.has(file)) {
      deleted.push(file);
    }
  }

  return {
    modified: modified.sort(),
    created: created.sort(),
    deleted: deleted.sort(),
    allChanges: [...modified, ...created, ...deleted].sort(),
  };
}

/**
 * 运行受控影子试跑
 * @param {object} options
 * @param {string} options.root - 宿主仓库根目录
 * @param {object} options.adapter - 驱动器适配器
 * @param {object} options.budgetConfig - 预算与熔断参数
 * @param {Array<string>} options.stages - 流水线阶段列表
 * @param {boolean} options.dryRun - 试跑后是否自动清理沙箱
 * @returns {object} 影子试跑全量复盘报告
 */
export function runShadowExecution(options = {}) {
  const root = options.root || process.cwd();
  const adapter = options.adapter || createDriverAdapter({ type: 'mock' });
  const budget = new StepBudgetGuard(options.budgetConfig || {});
  const stallDetector = new StallDetector(options.budgetConfig?.stallWindowSize || 3);
  const stages = Array.isArray(options.stages) && options.stages.length > 0
    ? options.stages
    : ['plan', 'implement', 'verify', 'review'];

  // 1. 创建隔离影子沙箱
  const { shadowDir, cleanup } = createShadowWorkspace(root, { prefix: 'shadow-exec-' });

  const initialFiles = scanFileTreeHashes(shadowDir);
  const stepHistory = [];
  let currentStageIndex = 0;
  let finalStatus = DRIVER_STATUS.SUCCESS;
  let haltReason = '';

  const runStartTime = Date.now();

  try {
    while (currentStageIndex < stages.length) {
      const currentStage = stages[currentStageIndex];

      // 检查外部信号
      const signalCheck = checkStopSignal(shadowDir);
      if (signalCheck.stop) {
        finalStatus = DRIVER_STATUS.ABORTED_BY_SIGNAL;
        haltReason = signalCheck.reason || '收到外部停机信号';
        break;
      }

      // 执行驱动步
      const stepContext = {
        workspaceDir: shadowDir,
        stage: currentStage,
        stepIndex: budget.stepsExecuted + 1,
      };

      const execResult = adapter.executeStep(stepContext);

      // 死循环空转检查
      const stallCheck = stallDetector.checkStall({
        stage: currentStage,
        status: execResult.status,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      });

      if (stallCheck.stalled) {
        finalStatus = DRIVER_STATUS.STALL_DETECTED;
        haltReason = stallCheck.reason || '触发死循环停机';
        break;
      }

      // 预算控制器记录
      const budgetCheck = budget.recordStep({
        stage: currentStage,
        status: execResult.status,
        durationMs: execResult.durationMs,
        events: execResult.parsedEvents,
      });

      stepHistory.push({
        step: budget.stepsExecuted,
        stage: currentStage,
        durationMs: execResult.durationMs,
        status: execResult.status,
        events: execResult.parsedEvents,
      });

      if (budgetCheck.halted) {
        finalStatus = budgetCheck.status || DRIVER_STATUS.CIRCUIT_BREAKER_TRIGGERED;
        haltReason = budgetCheck.reason || '触发预算控制器停机';
        break;
      }

      // 阶段推进（若执行通过则进入下一阶段，若失败且未熔断则可在当前阶段重试）
      if (execResult.status === 0) {
        currentStageIndex += 1;
      }
    }

    const finalFiles = scanFileTreeHashes(shadowDir);
    const fileDiff = diffFileTrees(initialFiles, finalFiles);
    const totalDurationMs = Date.now() - runStartTime;

    const report = {
      success: finalStatus === DRIVER_STATUS.SUCCESS,
      status: finalStatus,
      haltReason: haltReason || (finalStatus === DRIVER_STATUS.SUCCESS ? '阶段闭环执行成功' : '试跑终止'),
      stagesCompleted: stages.slice(0, currentStageIndex),
      remainingStages: stages.slice(currentStageIndex),
      totalSteps: budget.stepsExecuted,
      totalDurationMs,
      fileChanges: fileDiff,
      stepHistory,
      shadowDir: options.dryRun ? null : shadowDir,
    };

    return report;
  } finally {
    if (options.dryRun || options.autoCleanup !== false) {
      cleanup();
    }
  }
}

// ---------------------------------------------------------------------
// 4. 命令行交互入口 (CLI Entry)
// ---------------------------------------------------------------------

export function parseArgs(args = []) {
  const result = {
    command: 'help',
    maxSteps: 10,
    maxWallClockMs: 60000,
    dryRun: true,
    stages: ['plan', 'implement', 'verify'],
    raw: args,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'shadow' || arg === 'status' || arg === 'help') {
      result.command = arg;
    } else if (arg === '--max-steps' && args[i + 1]) {
      result.maxSteps = Number(args[++i]) || 10;
    } else if (arg === '--timeout-ms' && args[i + 1]) {
      result.maxWallClockMs = Number(args[++i]) || 60000;
    } else if (arg === '--keep') {
      result.dryRun = false;
    }
  }

  return result;
}

export function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();

  if (args.command === 'help') {
    console.log('用法: node headless-driver.mjs <command> [options]');
    console.log('');
    console.log('命令:');
    console.log('  shadow    启动隔离影子试跑并全景复盘');
    console.log('');
    console.log('选项:');
    console.log('  --max-steps <n>     最大步数预算（默认 10）');
    console.log('  --timeout-ms <ms>   总超时时间（默认 60000ms）');
    console.log('  --keep              保留影子工作区（默认自动清理）');
    process.exit(0);
  }

  if (args.command === 'shadow') {
    const report = runShadowExecution({
      root,
      budgetConfig: {
        maxSteps: args.maxSteps,
        maxWallClockMs: args.maxWallClockMs,
      },
      dryRun: args.dryRun,
    });
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.success ? 0 : 1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
