#!/usr/bin/env node
// timeline-trace.mjs
// 时间轴时序轨迹与回溯对质引擎（Timeline Trace & Time-Travel Debugger）
//
// 职责：
//   1. 时序事件流契约与追加记录器（按 runId 分片追加存储 .agents/traces/<run-id>.timeline.jsonl）；
//   2. 关键帧提取与时间旅行状态投影器（支持任意时刻状态还原与关键跃迁帧识别）；
//   3. 快照差异对质与离线复盘包导出（支持一键导出包含时序链、凭证与产物的 post-mortem bundle 与独立交互式 HTML）；
//   4. 命令行交互与调试查询入口。
//
// 零外部依赖，纯 Node.js 标准库实现。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadPrescriptionStore } from './self-healing-prescriptions.mjs';
import { t } from './lang.mjs';

// ---------------------------------------------------------------------
// 1. 常量与事件契约定义
// ---------------------------------------------------------------------

export const TIMELINE_EVENT_TYPES = [
  'RUN_STARTED',
  'STAGE_ENTER',
  'STAGE_LEAVE',
  'STEP_EXECUTED',
  'GATE_EVALUATED',
  'STATUS_ROLLBACK',
  'TOUCH_SET_CHECKED',
  'ENDORSEMENT_RECORDED',
  'PRESCRIPTION_APPLIED',
  'CIRCUIT_BREAKER_HALTED',
  'RUN_COMPLETED',
];

export const TIMELINE_STATUS = {
  SUCCESS: 'success',
  FAILED: 'failed',
  IN_PROGRESS: 'in_progress',
  ROLLBACK: 'rollback',
  HALTED: 'halted',
};

let lastAllocatedEpoch = 0;

/**
 * 创建标准时序事件记录
 * @param {object} opts
 * @returns {object} 标准化事件对象
 */
export function createTimelineEvent(opts = {}) {
  let nowIso;
  if (opts.timestamp) {
    nowIso = typeof opts.timestamp === 'string' ? opts.timestamp : new Date(opts.timestamp).toISOString();
  } else {
    let now = Date.now();
    if (now <= lastAllocatedEpoch) {
      now = lastAllocatedEpoch + 1;
    }
    lastAllocatedEpoch = now;
    nowIso = new Date(now).toISOString();
  }
  const runId = String(opts.runId || 'default-run').trim();
  const seq = Number(opts.seq) || 1;
  const rawType = String(opts.eventType || 'STEP_EXECUTED').trim().toUpperCase();
  const eventType = TIMELINE_EVENT_TYPES.includes(rawType) ? rawType : 'STEP_EXECUTED';

  const raw = `${runId}:${seq}:${nowIso}:${eventType}`;
  const eventId = opts.eventId || `evt-${crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 8)}`;

  return {
    eventId,
    runId,
    seq,
    timestamp: nowIso,
    eventType,
    stage: String(opts.stage || 'unknown').trim(),
    actor: String(opts.actor || 'system').trim(),
    status: opts.status || TIMELINE_STATUS.SUCCESS,
    summary: String(opts.summary || '').trim(),
    payload: opts.payload && typeof opts.payload === 'object' ? opts.payload : {},
    snapshotHash: opts.snapshotHash ? String(opts.snapshotHash).trim() : null,
  };
}

/**
 * 追加写入时序事件到分片存储
 * @param {string} root - 项目根目录
 * @param {object} event - 时序事件
 * @returns {string} 实际落盘的文件路径
 */
export function appendTimelineEvent(root, event = {}) {
  const normalized = createTimelineEvent(event);
  const traceDir = path.join(root, '.agents', 'traces');
  fs.mkdirSync(traceDir, { recursive: true });

  const safeRunId = normalized.runId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const traceFile = path.join(traceDir, `${safeRunId}.timeline.jsonl`);

  const line = `${JSON.stringify(normalized)}\n`;
  fs.appendFileSync(traceFile, line, 'utf8');

  return traceFile;
}

/**
 * 加载指定 runId 的全量时序轨迹，按行解析：损坏行跳过并计数，不丢整条链
 * @param {string} root - 项目根目录
 * @param {string} runId - 运行标识
 * @returns {{ events: Array<object>, skippedLines: number, totalLines: number }}
 */
export function loadTimelineTraceReport(root, runId) {
  if (!runId) return { events: [], skippedLines: 0, totalLines: 0 };
  const safeRunId = String(runId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const traceFile = path.join(root, '.agents', 'traces', `${safeRunId}.timeline.jsonl`);

  if (!fs.existsSync(traceFile)) return { events: [], skippedLines: 0, totalLines: 0 };

  let content = '';
  try {
    content = fs.readFileSync(traceFile, 'utf8');
  } catch {
    return { events: [], skippedLines: 0, totalLines: 0 };
  }

  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const events = [];
  let skippedLines = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) events.push(parsed);
      else skippedLines += 1;
    } catch {
      skippedLines += 1;
    }
  }
  events.sort((a, b) => a.seq - b.seq);
  return { events, skippedLines, totalLines: lines.length };
}

/**
 * 加载指定 runId 的全量时序轨迹
 * @param {string} root - 项目根目录
 * @param {string} runId - 运行标识
 * @returns {Array<object>} 时序事件数组
 */
export function loadTimelineTrace(root, runId) {
  return loadTimelineTraceReport(root, runId).events;
}

// ---------------------------------------------------------------------
// 2. 关键帧提取与时间旅行状态投影 (Keyframe Replay & Time Travel)
// ---------------------------------------------------------------------

/**
 * 构建关键帧索引（筛选出引起系统状态重大变迁的节点）
 * @param {Array<object>} events
 * @returns {Array<object>} 关键帧事件列表
 */
export function buildKeyframeIndex(events = []) {
  const keyframeTypes = new Set([
    'RUN_STARTED',
    'STAGE_ENTER',
    'GATE_EVALUATED',
    'STATUS_ROLLBACK',
    'CIRCUIT_BREAKER_HALTED',
    'RUN_COMPLETED',
  ]);

  return events.filter((e) => keyframeTypes.has(e.eventType));
}

/**
 * 按多维条件过滤时序事件
 * @param {Array<object>} events
 * @param {object} filter
 * @returns {Array<object>}
 */
export function queryTimelineEvents(events = [], filter = {}) {
  return events.filter((e) => {
    if (filter.stage && e.stage !== filter.stage) return false;
    if (filter.eventType && e.eventType !== filter.eventType) return false;
    if (filter.status && e.status !== filter.status) return false;
    if (filter.actor && e.actor !== filter.actor) return false;
    if (filter.fromTime && new Date(e.timestamp) < new Date(filter.fromTime)) return false;
    if (filter.toTime && new Date(e.timestamp) > new Date(filter.toTime)) return false;
    return true;
  });
}

/**
 * 时间旅行投影器：还原流水线在任意历史时间点的状态
 * @param {Array<object>} events - 全量事件
 * @param {string|number|Date|object} targetTime - 目标时间切片或目标事件对象
 * @param {object} [opts] - 投影选项 (e.g. maxSeq)
 * @returns {object} 历史时刻的状态切片投影
 */
export function projectStateAtTimestamp(events = [], targetTime, opts = {}) {
  let targetEpoch;
  let maxSeq = opts.maxSeq != null ? Number(opts.maxSeq) : null;

  if (typeof targetTime === 'object' && targetTime !== null && !(targetTime instanceof Date)) {
    targetEpoch = new Date(targetTime.timestamp).getTime();
    if (maxSeq === null && targetTime.seq != null) {
      maxSeq = Number(targetTime.seq);
    }
  } else {
    targetEpoch = new Date(targetTime).getTime();
  }
  const targetDate = new Date(targetEpoch);

  // 截取目标时间点之前发生的所有事件
  const historicalEvents = events
    .filter((e) => {
      const eEpoch = new Date(e.timestamp).getTime();
      if (eEpoch > targetEpoch) return false;
      if (eEpoch === targetEpoch && maxSeq !== null && e.seq > maxSeq) return false;
      return true;
    })
    .sort((a, b) => a.seq - b.seq);

  if (historicalEvents.length === 0) {
    return {
      active: false,
      timestamp: targetDate.toISOString(),
      currentStage: null,
      lastEvent: null,
      totalStepsExecuted: 0,
      stageHistory: [],
      gatesEvaluated: [],
      rollbacksCount: 0,
      lastSnapshotHash: null,
    };
  }

  let currentStage = 'unknown';
  const stageHistory = [];
  const gatesEvaluated = [];
  let rollbacksCount = 0;
  let lastSnapshotHash = null;
  let runStarted = false;
  let runCompleted = false;

  for (const e of historicalEvents) {
    if (e.eventType === 'RUN_STARTED') runStarted = true;
    if (e.eventType === 'RUN_COMPLETED') runCompleted = true;

    if (e.eventType === 'STAGE_ENTER') {
      currentStage = e.stage;
      stageHistory.push(e.stage);
    }

    if (e.eventType === 'GATE_EVALUATED') {
      gatesEvaluated.push({
        gateName: e.payload?.gateName || e.summary || 'unnamed',
        stage: e.stage,
        passed: e.status === TIMELINE_STATUS.SUCCESS,
        timestamp: e.timestamp,
      });
    }

    if (e.eventType === 'STATUS_ROLLBACK') {
      rollbacksCount += 1;
    }

    if (e.snapshotHash) {
      lastSnapshotHash = e.snapshotHash;
    }
  }

  const lastEvent = historicalEvents[historicalEvents.length - 1];

  return {
    active: runStarted && !runCompleted,
    timestamp: targetDate.toISOString(),
    currentStage: lastEvent.stage || currentStage,
    lastEvent,
    totalStepsExecuted: historicalEvents.length,
    stageHistory: [...new Set(stageHistory)],
    gatesEvaluated,
    rollbacksCount,
    lastSnapshotHash,
  };
}

/**
 * 对质比对两个时序节点之间的差异
 * @param {object} eventA
 * @param {object} eventB
 * @returns {object} 节点间演进差异
 */
export function diffTimelineNodes(eventA = {}, eventB = {}) {
  const timeA = new Date(eventA.timestamp || 0).getTime();
  const timeB = new Date(eventB.timestamp || 0).getTime();
  const durationMs = Math.abs(timeB - timeA);

  const stageTransition = eventA.stage !== eventB.stage
    ? { from: eventA.stage, to: eventB.stage }
    : null;

  const snapshotChanged = eventA.snapshotHash !== eventB.snapshotHash;

  return {
    nodeA: { eventId: eventA.eventId, seq: eventA.seq, stage: eventA.stage, status: eventA.status },
    nodeB: { eventId: eventB.eventId, seq: eventB.seq, stage: eventB.stage, status: eventB.status },
    durationMs,
    stageTransition,
    snapshotChanged,
    hashA: eventA.snapshotHash,
    hashB: eventB.snapshotHash,
  };
}

// ---------------------------------------------------------------------
// 3. 离线复盘包导出与报告渲染 (Post-Mortem Bundle & Report)
// ---------------------------------------------------------------------

/**
 * 导出离线复盘包（Post-Mortem Bundle）
 * @param {string} root - 项目根目录
 * @param {string} runId - 运行标识
 * @param {object} options
 * @returns {object} 离线复盘包对象
 */
export function exportPostMortemBundle(root, runId, options = {}) {
  const { events, skippedLines, totalLines } = loadTimelineTraceReport(root, runId);
  const keyframes = buildKeyframeIndex(events);

  // 尝试收集背书分片
  const endorsements = [];
  const endDir = path.join(root, '.agents', 'endorsements.d');
  if (fs.existsSync(endDir)) {
    try {
      const files = fs.readdirSync(endDir);
      for (const f of files) {
        if (f.endsWith('.jsonl')) {
          const lines = fs.readFileSync(path.join(endDir, f), 'utf8').split('\n').filter(Boolean);
          for (const l of lines) {
            try {
              const item = JSON.parse(l);
              if (!item.runId || item.runId === runId) endorsements.push(item);
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 尝试收集自愈处方
  const prescriptions = loadPrescriptionStore(root);

  const bundle = {
    bundleVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    runId,
    metrics: {
      totalEvents: events.length,
      skippedLines,
      keyframesCount: keyframes.length,
      endorsementsCount: endorsements.length,
      prescriptionsCount: prescriptions.length,
    },
    keyframes,
    events,
    endorsements,
    prescriptions,
  };

  if (skippedLines > 0) {
    bundle.warnings = [`跳过 ${skippedLines}/${totalLines} 行损坏记录——复盘包不完整`];
  }

  if (options.saveToFile !== false) {
    const traceDir = path.join(root, '.agents', 'traces');
    fs.mkdirSync(traceDir, { recursive: true });
    const bundleFile = path.join(traceDir, `${runId}.post-mortem.json`);
    fs.writeFileSync(bundleFile, JSON.stringify(bundle, null, 2), 'utf8');
    bundle.bundleFile = bundleFile;
  }

  return bundle;
}

/**
 * 渲染独立的离线交互式复盘 HTML 页面
 * @param {object} bundle
 * @returns {string} HTML 源码
 */
export function renderPostMortemHtml(bundle = {}) {
  const runId = bundle.runId || 'unknown';
  const totalEvents = bundle.metrics?.totalEvents || 0;
  const events = bundle.events || [];

  const timelineRows = events
    .map(
      (e) => `
    <tr class="event-row event-${(e.status || 'success').toLowerCase()}">
      <td>${e.seq}</td>
      <td>${e.timestamp.slice(11, 19)}</td>
      <td><span class="badge stage-badge">${e.stage}</span></td>
      <td><code>${e.eventType}</code></td>
      <td><span class="status-tag ${e.status}">${e.status}</span></td>
      <td>${escapeHtml(e.summary || '')}</td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>流水线时序复盘 — ${runId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    h1 { margin-bottom: 4px; font-size: 20px; color: #38bdf8; }
    .meta { font-size: 13px; color: #94a3b8; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #1e293b; }
    th { background: #1e293b; color: #cbd5e1; font-weight: 600; }
    tr:hover { background: #1e293b55; }
    .badge { padding: 2px 6px; border-radius: 4px; font-size: 11px; background: #334155; color: #e2e8f0; }
    .status-tag.success { color: #4ade80; font-weight: bold; }
    .status-tag.failed { color: #f87171; font-weight: bold; }
    .status-tag.rollback { color: #fbbf24; font-weight: bold; }
  </style>
</head>
<body>
  <h1>时间轴时序复盘: ${runId}</h1>
  <div class="meta">总事件数: ${totalEvents} | 导出时间: ${bundle.exportedAt || ''}</div>
  <table>
    <thead>
      <tr><th>#</th><th>时间</th><th>阶段</th><th>事件类型</th><th>状态</th><th>概要说明</th></tr>
    </thead>
    <tbody>${timelineRows}</tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------
// 4. 命令行交互入口 (CLI Entry)
// ---------------------------------------------------------------------

export function parseArgs(args = []) {
  const result = {
    command: 'help',
    runId: '',
    stage: '',
    export: false,
    raw: args,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'append' || arg === 'query' || arg === 'export' || arg === 'replay') {
      result.command = arg;
    } else if (arg === '--run' && args[i + 1]) {
      result.runId = args[++i];
    } else if (arg === '--stage' && args[i + 1]) {
      result.stage = args[++i];
    }
  }

  return result;
}

export function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();

  if (args.command === 'help') {
    console.log(t(
      [
        '用法: node timeline-trace.mjs <command> [options]',
        '',
        '命令:',
        '  query   查询指定 runId 的时序事件链',
        '  export  导出指定 runId 的离线复盘包与可视化 HTML',
        '',
        '选项:',
        '  --run <id>       指定流水线运行 ID',
        '  --stage <name>   按阶段过滤',
      ].join('\n'),
      [
        'Usage: node timeline-trace.mjs <command> [options]',
        '',
        'Commands:',
        '  query   Query the timeline for a run id',
        '  export  Export the offline review bundle and HTML',
        '',
        'Options:',
        '  --run <id>       Pipeline run id',
        '  --stage <name>   Filter by stage',
      ].join('\n'),
    ));
    process.exit(0);
  }

  if (args.command === 'query') {
    if (!args.runId) {
      console.error(t('错误: 请通过 --run 指定 runId', 'Error: pass --run <id>'));
      process.exit(1);
    }
    const { events, skippedLines, totalLines } = loadTimelineTraceReport(root, args.runId);
    if (skippedLines > 0) {
      console.error(t(
        `[timeline] 警告: 跳过 ${skippedLines}/${totalLines} 行损坏记录——查询结果不完整`,
        `[timeline] warning: skipped ${skippedLines}/${totalLines} corrupt lines — query is incomplete`,
      ));
    }
    const filtered = queryTimelineEvents(events, { stage: args.stage });
    console.log(JSON.stringify(filtered, null, 2));
    process.exit(skippedLines > 0 && events.length === 0 ? 1 : 0);
  }

  if (args.command === 'export') {
    if (!args.runId) {
      console.error(t('错误: 请通过 --run 指定 runId', 'Error: pass --run <id>'));
      process.exit(1);
    }
    const bundle = exportPostMortemBundle(root, args.runId);
    for (const warning of bundle.warnings || []) {
      console.error(t(`[timeline] 警告: ${warning}`, `[timeline] warning: ${warning}`));
    }
    console.log(t(
      `[timeline] 成功导出复盘包: ${bundle.bundleFile}`,
      `[timeline] exported review bundle: ${bundle.bundleFile}`,
    ));
    process.exit(bundle.metrics.skippedLines > 0 && bundle.metrics.totalEvents === 0 ? 1 : 0);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
