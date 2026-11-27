// board-watchdog.mjs — 看板看门狗巡检与熔断状态机
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { sanitizeExecEnv } from './execution-guardrails.mjs';

export const DEFAULT_WATCHDOG_CONFIG = {
  timeoutThresholdMs: 15 * 60 * 1000, // 15 分钟停滞超时
  warningThresholdMs: 8 * 60 * 1000,  // 8 分钟停滞预警
  stallWindowSize: 3,
};

export function detectRunWatchdogAlert(run, options = {}) {
  if (!run || typeof run !== 'object') return null;
  const now = options.now ?? Date.now();
  const timeoutMs = options.timeoutThresholdMs ?? DEFAULT_WATCHDOG_CONFIG.timeoutThresholdMs;
  const warningMs = options.warningThresholdMs ?? DEFAULT_WATCHDOG_CONFIG.warningThresholdMs;

  // 终态任务不产生活跃停滞告警
  if (['done', 'aborted'].includes(run.stopType)) return null;

  const events = Array.isArray(run.events) ? run.events : [];
  const lastActiveTs = Date.parse(run.updatedAt || run.createdAt || 0);
  const elapsedMs = Number.isFinite(lastActiveTs) && lastActiveTs > 0 ? Math.max(0, now - lastActiveTs) : 0;

  // 1. 外部或主动熔断标记
  if (run.circuitBreak) {
    return {
      runId: run.runId,
      stage: run.stage || 'unknown',
      type: 'circuit_break',
      severity: 'critical',
      elapsedMs,
      message: `流水线已被看门狗紧急熔断: ${run.circuitBreak.reason || 'manual_circuit_break'}`,
      suggestedAction: 'archive',
    };
  }

  // 2. 连续门禁失败或重试触顶 (retry cap exhausted)
  const route = run.route || (run.nextTarget ? [...events].reverse().find((e) => e.type === 'route' && e.from === run.stage) : null);
  if (run.stopType === 'gate-fail' && route && route.attempt >= route.cap) {
    return {
      runId: run.runId,
      stage: run.stage || 'verify',
      type: 'retry_cap',
      severity: 'critical',
      elapsedMs,
      message: `阶段 [${run.stage || 'verify'}] 质量修复回环已达上限 (${route.attempt}/${route.cap} 次)，无法自动收敛`,
      suggestedAction: 'human_confirm',
    };
  }

  // 3. 门禁连续同质报错空转震荡 (loop oscillation)
  const gateEvents = events.filter((e) => e.type === 'gate');
  if (gateEvents.length >= 3) {
    const recent3 = gateEvents.slice(-3);
    const allFailed = recent3.every((e) => e.exit !== 0);
    const sameGate = recent3.every((e) => e.gate === recent3[0].gate);
    const sameExit = recent3.every((e) => e.exit === recent3[0].exit);
    if (allFailed && sameGate && sameExit) {
      return {
        runId: run.runId,
        stage: run.stage || 'verify',
        type: 'loop_oscillation',
        severity: 'critical',
        elapsedMs,
        message: `检测到门禁 [${recent3[0].gate}] 连续 ${recent3.length} 次报错退出码 ${recent3[0].exit}，陷入死循环震荡`,
        suggestedAction: 'circuit_break',
      };
    }
  }

  // 4. 阶段停滞/超时无心跳 (timeout)
  if (elapsedMs >= timeoutMs) {
    return {
      runId: run.runId,
      stage: run.stage || 'unknown',
      type: 'timeout',
      severity: 'critical',
      elapsedMs,
      message: `流水线在 [${run.stage || '当前阶段'}] 已停滞 ${Math.round(elapsedMs / 60000)} 分钟无响应（心跳超时，可能由于 Agent 卡死或环境中断）`,
      suggestedAction: 'circuit_break',
    };
  }
  if (elapsedMs >= warningMs) {
    return {
      runId: run.runId,
      stage: run.stage || 'unknown',
      type: 'timeout',
      severity: 'warning',
      elapsedMs,
      message: `流水线在 [${run.stage || '当前阶段'}] 已持续 ${Math.round(elapsedMs / 60000)} 分钟未更新状态（接近超时阈值）`,
      suggestedAction: 'inspect',
    };
  }

  return null;
}

export function inspectWatchdog(runs, options = {}) {
  const now = options.now ?? Date.now();
  const root = options.root || process.cwd();
  const list = Array.isArray(runs) ? runs : (typeof options.scanRuns === 'function' ? options.scanRuns() : []);
  const alerts = [];

  // 外部停机信号检查
  const stopSignalFile = path.join(root, '.agents', 'stop.signal');
  if (fs.existsSync(stopSignalFile)) {
    let reason = '存在 .agents/stop.signal 外部手动停机信号';
    try {
      const c = fs.readFileSync(stopSignalFile, 'utf8').trim();
      if (c) reason = c;
    } catch {}
    alerts.push({
      runId: '*',
      stage: '*',
      type: 'stop_signal',
      severity: 'critical',
      elapsedMs: 0,
      message: `全局停机信号激活: ${reason}`,
      suggestedAction: 'circuit_break',
    });
  }

  const activeRuns = [];
  let circuitBrokenCount = 0;

  for (const r of list) {
    const isTerminal = ['done', 'aborted'].includes(r.stopType);
    if (!isTerminal) {
      activeRuns.push(r);
    }
    if (r.stopType === 'aborted' || r.circuitBreak) {
      circuitBrokenCount += 1;
    }
    const alert = detectRunWatchdogAlert(r, { ...options, now });
    if (alert) {
      alerts.push(alert);
    }
  }

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;
  const stalledCount = alerts.filter((a) => a.runId !== '*').length;

  let healthScore = 100;
  if (activeRuns.length > 0) {
    healthScore = Math.max(0, 100 - (criticalCount * 35 + warningCount * 15));
  } else if (alerts.length > 0) {
    healthScore = 50;
  }

  const status = criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'ok';

  return {
    ok: true,
    timestamp: new Date(now).toISOString(),
    status,
    health: status,
    activeRuns: activeRuns.length,
    stalledRuns: stalledCount,
    criticalAlerts: criticalCount,
    warningAlerts: warningCount,
    summary: {
      totalRuns: list.length,
      activeRuns: activeRuns.length,
      healthyRuns: Math.max(0, activeRuns.length - stalledCount),
      stalledRuns: stalledCount,
      circuitBrokenRuns: circuitBrokenCount,
      healthScore,
      criticalAlerts: criticalCount,
      warningAlerts: warningCount,
    },
    alerts,
    config: {
      timeoutThresholdMs: options.timeoutThresholdMs ?? DEFAULT_WATCHDOG_CONFIG.timeoutThresholdMs,
      warningThresholdMs: options.warningThresholdMs ?? DEFAULT_WATCHDOG_CONFIG.warningThresholdMs,
      stallWindowSize: options.stallWindowSize ?? DEFAULT_WATCHDOG_CONFIG.stallWindowSize,
    },
  };
}

export async function executeCircuitBreak(runId, options = {}) {
  const root = options.root || process.cwd();
  const scriptsDir = options.scriptsDir || path.join(root, '.agents', 'scripts');
  const reason = options.reason || '看门狗检测到任务停滞并执行紧急熔断';
  const to = options.to || 'cancelled';
  const validRunId = typeof options.isValidRunId === 'function'
    ? options.isValidRunId(runId)
    : /^[a-zA-Z0-9._-]+$/.test(String(runId || ''));

  if (!validRunId) {
    throw new Error('非法的 runId 格式');
  }

  let runsDir = path.join(root, '.agents', 'cache', 'pipeline-runs');
  if (!fs.existsSync(runsDir)) {
    const fallbackDir = path.join(root, '.agents', 'pipeline-runs');
    if (fs.existsSync(fallbackDir)) runsDir = fallbackDir;
  }
  const rel = `${runId}.json`;
  const abs = path.resolve(runsDir, rel);
  if (!abs.startsWith(runsDir + path.sep) || !fs.existsSync(abs)) {
    throw new Error(`找不到 run 文件: ${rel}`);
  }

  // 1. 读取原 run 文件
  let run;
  try {
    run = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new Error(`读取 run 文件失败: ${e.message}`);
  }

  // 2. 标记熔断状态
  run.stopType = 'aborted';
  run.abort = {
    to,
    note: `[WATCHDOG_CIRCUIT_BREAK] ${reason}`,
  };
  run.circuitBreak = {
    triggeredAt: new Date().toISOString(),
    reason,
    by: options.by || 'watchdog',
  };
  if (!Array.isArray(run.events)) run.events = [];
  run.events.push({
    type: 'circuit-break',
    by: options.by || 'watchdog',
    reason,
    to,
    ts: new Date().toISOString(),
  });
  run.updatedAt = new Date().toISOString();

  // 3. 原子落盘
  const tmp = `${abs}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2), 'utf8');
  fs.renameSync(tmp, abs);

  // 4. 尝试异步调用 pipeline-run.mjs abort 确保文档状态与索引同步（若脚本存在）
  const script = path.join(scriptsDir, 'pipeline-run.mjs');
  if (!options.skipExec && fs.existsSync(script)) {
    execFile(process.execPath, [script, 'abort', '--run', runId, '--to', to, '--delegated', reason], {
      cwd: root,
      env: sanitizeExecEnv({ ...process.env, FLOW_KIT_PROJECT_ROOT: root, FLOW_KIT_RUNTIME_SCRIPTS: scriptsDir }),
      encoding: 'utf8',
      windowsHide: true,
    }, (err) => {
      if (err) {
        // pipeline-run 补跑失败仅作为日志提示，不影响状态机已熔断的事实
      }
    });
  }

  return {
    ok: true,
    runId,
    status: 'aborted',
    reason,
    circuitBreak: run.circuitBreak,
  };
}
