// metrics-core.mjs — workflow 指标口径共享内核（2026-10-23 board-engine-views A2 抽取）
// 单源纪律：闭环漏斗 / 复核效果 / 中位周期的**计算口径**只此一份——gen-workflow-metrics.mjs（metrics.md
// 月度快照）与 workflow-board-server.mjs（看板引擎视图）共同 import；改动任一消费方不得复制逻辑。
// 本模块只放纯函数与一次性只读采集（git log / 台账分片扫描），无写盘、无主流程。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// 闭环漏斗「协议前」占比阈值（单源，2026-10-23 P2）：s26 动作阈值与 gen-workflow-metrics 的
// legacy 占比告警共用；此前两处各写 0.30 字面量，靠测试钉同值。
export const FUNNEL_LEGACY_RATIO_LIMIT = 0.30;

// ── R3-7 可观测与成本：纯聚合内核（observability.mjs 消费；不读盘、不写盘） ──

export function percentile(values, p = 0.5) {
  const nums = (values || []).filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  const idx = (nums.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? nums[lo] : nums[lo] + (nums[hi] - nums[lo]) * (idx - lo);
}

export const round1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

const STAGE_RE = /^flow-kit run ([A-Za-z0-9._-]+)/;

/** 门事件 → 稳定阶段名：脚本名或 git 子命令；避免参数/路径把同一门拆成多桶。 */
export function stageLabel(cmd) {
  const s = String(cmd || '').trim();
  const m = STAGE_RE.exec(s);
  if (m) return m[1].replace(/\.mjs$/, '');
  const git = /^git\s+([A-Za-z-]+)/.exec(s);
  if (git) return `git ${git[1]}`;
  return s.split(/\s+/)[0] || 'unknown';
}

export function runDurationMs(run) {
  const events = Array.isArray(run?.events) ? run.events : [];
  const start = Date.parse(run?.createdAt || events[0]?.t || '');
  const end = Date.parse(run?.updatedAt || events[events.length - 1]?.t || '');
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start;
  if (events.length >= 2) {
    const a = Date.parse(events[0].t);
    const b = Date.parse(events[events.length - 1].t);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) return b - a;
  }
  return null;
}

/** 按 run 汇总：完成/中止、总时长分位、门次数与失败、阶段耗时。 */
export function summarizeRuns(runs, { since = 0 } = {}) {
  const items = (runs || []).filter((run) => {
    const t = Date.parse(run?.createdAt || run?.events?.[0]?.t || '');
    return Number.isFinite(t) && t >= since;
  });
  const byStopType = {};
  const durations = [];
  const stages = new Map();
  let gates = 0;
  let failed = 0;
  for (const run of items) {
    const stop = String(run.stopType || (run.events || []).find((e) => e.type === 'stop')?.stopType || 'unknown');
    byStopType[stop] = (byStopType[stop] || 0) + 1;
    const d = runDurationMs(run);
    if (d != null) durations.push(d);
    for (const ev of run.events || []) {
      if (ev.type !== 'gate') continue;
      gates += 1;
      if (ev.exit !== 0) failed += 1;
      const label = stageLabel(ev.cmd);
      if (!stages.has(label)) stages.set(label, { stage: label, count: 0, failed: 0, ms: [] });
      const row = stages.get(label);
      row.count += 1;
      if (ev.exit !== 0) row.failed += 1;
      if (Number.isFinite(ev.ms)) row.ms.push(ev.ms);
    }
  }
  const byStage = [...stages.values()]
    .map((row) => ({
      stage: row.stage,
      count: row.count,
      failed: row.failed,
      medianMs: round1(percentile(row.ms, 0.5)),
      p90Ms: round1(percentile(row.ms, 0.9)),
      maxMs: round1(percentile(row.ms, 1)),
    }))
    .sort((a, b) => (b.p90Ms || 0) - (a.p90Ms || 0));
  return {
    total: items.length,
    completed: byStopType.done || 0,
    aborted: byStopType.aborted || 0,
    byStopType,
    durationMs: {
      p50: round1(percentile(durations, 0.5)),
      p90: round1(percentile(durations, 0.9)),
      avg: round1(durations.length ? durations.reduce((s, x) => s + x, 0) / durations.length : null),
      max: round1(percentile(durations, 1)),
    },
    gates: { total: gates, failed },
    byStage,
  };
}

function usageCost(row, pricing) {
  if (Number.isFinite(row.costUsd)) return row.costUsd;
  const price = pricing?.[row.model];
  if (!price) return null;
  const input = Number(row.inputTokens) || 0;
  const output = Number(row.outputTokens) || 0;
  const cost = (input / 1e6) * (Number(price.inputPerMTok) || 0) + (output / 1e6) * (Number(price.outputPerMTok) || 0);
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

function emptyUsageBucket(key) {
  return { key, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, pricedCalls: 0, latencyMs: [], failures: 0 };
}

function finalizeUsageBucket(b) {
  return {
    key: b.key,
    calls: b.calls,
    inputTokens: b.inputTokens,
    outputTokens: b.outputTokens,
    tokens: b.inputTokens + b.outputTokens,
    costUsd: Math.round(b.costUsd * 1e6) / 1e6,
    pricedCalls: b.pricedCalls,
    unpricedCalls: b.calls - b.pricedCalls,
    latencyMs: {
      p50: round1(percentile(b.latencyMs, 0.5)),
      p90: round1(percentile(b.latencyMs, 0.9)),
    },
    failures: b.failures,
  };
}

/** 角色 / 模型成本与延迟。rows 为 .agents/usage.jsonl；pricing 缺省时只统计 token 与墙钟。 */
export function summarizeUsage(rows, { since = 0, pricing = {} } = {}) {
  const items = (rows || []).filter((row) => {
    const t = Date.parse(row?.ts || '');
    return Number.isFinite(t) && t >= since;
  });
  const byRole = new Map();
  const byModel = new Map();
  const totals = emptyUsageBucket('total');
  for (const row of items) {
    const role = String(row.role || 'unknown');
    const model = String(row.model || 'unknown');
    const input = Number(row.inputTokens) || 0;
    const output = Number(row.outputTokens) || 0;
    const cost = usageCost(row, pricing);
    const latency = Number(row.latencyMs);
    const failed = row.outcome === 'fail';
    for (const [map, key] of [[byRole, role], [byModel, model]]) {
      if (!map.has(key)) map.set(key, emptyUsageBucket(key));
      const b = map.get(key);
      b.calls += 1;
      b.inputTokens += input;
      b.outputTokens += output;
      if (cost != null) { b.costUsd += cost; b.pricedCalls += 1; }
      if (Number.isFinite(latency)) b.latencyMs.push(latency);
      if (failed) b.failures += 1;
    }
    totals.calls += 1;
    totals.inputTokens += input;
    totals.outputTokens += output;
    if (cost != null) { totals.costUsd += cost; totals.pricedCalls += 1; }
    if (Number.isFinite(latency)) totals.latencyMs.push(latency);
    if (failed) totals.failures += 1;
  }
  const finalize = (map) => [...map.values()].map(finalizeUsageBucket).sort((a, b) => b.calls - a.calls);
  return { total: finalizeUsageBucket(totals), byRole: finalize(byRole), byModel: finalize(byModel) };
}

/** 模型质量时间线：按模型逐条评测；drop ≥ regressionDrop 或 pass→fail 记为回归。 */
export function evalTimeline(entries, { since = 0, regressionDrop = 0.05 } = {}) {
  const items = (entries || [])
    .filter((e) => {
      const t = Date.parse(e?.ts || '');
      return Number.isFinite(t) && t >= since;
    })
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const byModel = new Map();
  for (const e of items) {
    const model = String(e.model || 'unknown');
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model).push({
      ts: e.ts,
      signature: e.signature || '',
      passRate: Number(e.passRate),
      tasks: Number(e.tasks) || 0,
      outcome: e.outcome || null,
    });
  }
  const models = [];
  const regressions = [];
  for (const [model, points] of byModel) {
    let regressed = false;
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const cur = points[i];
      const drop = prev.passRate - cur.passRate;
      const flipped = prev.outcome === 'pass' && cur.outcome === 'fail';
      if (!Number.isFinite(drop)) continue;
      if (drop >= regressionDrop || flipped) {
        regressed = true;
        regressions.push({
          model,
          ts: cur.ts,
          from: prev.passRate,
          to: cur.passRate,
          delta: Math.round((cur.passRate - prev.passRate) * 1000) / 1000,
          fromSignature: prev.signature,
          toSignature: cur.signature,
        });
      }
    }
    const first = points[0];
    const latest = points[points.length - 1];
    models.push({
      model,
      points,
      latest,
      delta: first && latest ? Math.round((latest.passRate - first.passRate) * 1000) / 1000 : null,
      regressed,
    });
  }
  return { models: models.sort((a, b) => String(b.latest.ts).localeCompare(String(a.latest.ts))), regressions };
}

/** 两次报告快照的数值差分：只比较两侧都存在的路径，缺一侧不计入。 */
export function diffReports(current, baseline, paths = []) {
  const get = (obj, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), obj);
  const out = [];
  for (const path of paths) {
    const before = get(baseline, path);
    const after = get(current, path);
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
    const delta = after - before;
    out.push({
      path,
      before,
      after,
      delta: Math.round(delta * 1000) / 1000,
      pct: before === 0 ? null : Math.round((delta / before) * 1000) / 10,
    });
  }
  return out;
}

export function cycleDays(addedIso, terminalTs) {
  if (!addedIso || !terminalTs) return null;
  const days = (Date.parse(terminalTs) - Date.parse(addedIso)) / 86400000;
  if (!Number.isFinite(days) || days < 0) return null;
  return days;
}

// 日历整月差（2026-10-23 P2）：退役窗口「连续 6 月」按日历月算，不用 183 天近似。
// 未满整月不计（1-15 → 7-14 = 5，1-15 → 7-15 = 6）；非法输入 null；未来时间按 0。
export function calendarMonthsBetween(from, to = Date.now()) {
  const a = new Date(from);
  const b = new Date(to);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return null;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  return Math.max(0, months);
}

// 一次 git log：路径 → 首次加入提交的 committer 时间。失败（非 git / 命令失败）返回 null，调用方整列写 —。
export function loadFirstAdded(cwd = process.cwd()) {
  let r;
  try {
    r = spawnSync('git', [
      'log', '--reverse', '--diff-filter=A', '--format=%cI', '--name-only', '--',
      'workflow/intents', 'workflow/specs', 'workflow/plans', 'workflow/incidents', 'workflow/archive',
    ], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
  if (!r || r.status !== 0) return null;
  const map = new Map();
  let ts = null;
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) { ts = trimmed; continue; }
    const p = trimmed.replace(/\\/g, '/');
    if (ts && !map.has(p)) map.set(p, ts);
  }
  return map;
}

export function funnelFromLedger(entries, month, firstAdded) {
  const byDoc = new Map();
  for (const e of entries) {
    if (typeof e.doc !== 'string' || typeof e.ts !== 'string') continue;
    if (!byDoc.has(e.doc)) byDoc.set(e.doc, []);
    byDoc.get(e.doc).push(e);
  }
  const res = { closed: 0, full: 0, legacy: 0, once: 0, rework: 0, ledgerRows: 0, days: [], items: [] };
  for (const e of entries) if (typeof e.ts === 'string' && e.ts.slice(0, 7) === month) res.ledgerRows++;
  for (const [doc, rs] of byDoc) {
    rs.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    const nonRevert = rs.filter((r) => !/^revert-/.test(String(r.stage || '')));
    const terminals = nonRevert.filter((r) => r.stage === 'done' || r.stage === 'closed');
    if (!terminals.length) continue; // 未收口件不进漏斗桶（仍计台账行数）
    const lastTerm = terminals[terminals.length - 1];
    if (String(lastTerm.ts).slice(0, 7) !== month) continue; // 月度归桶 = 终态行所在月
    // 确认阶段按件型（复核 P2-3 收口）：docs=approved；incidents=fixed（两跳确认门 fixed→closed，
    // 永无 approved 行——按 approved 判会把已走确认门的 incident 误归协议前）
    const isInc = doc.includes('/incidents/');
    const confirmStage = isInc ? 'fixed' : 'approved';
    const confirms = nonRevert.filter((r) => r.stage === confirmStage);
    const hasChain = confirms.length >= 1;
    const hasRevert = rs.some((r) => /^revert-/.test(String(r.stage || '')));
    const kind = !hasChain ? 'legacy' : (hasRevert || confirms.length >= 2 || terminals.length >= 2 ? 'rework' : 'once');
    const added = firstAdded ? firstAdded.get(String(doc).replace(/\\/g, '/')) : null;
    const days = cycleDays(added, lastTerm.ts);
    res.closed++;
    if (kind === 'legacy') res.legacy++;
    else { res.full++; res[kind === 'once' ? 'once' : 'rework']++; }
    if (days != null) res.days.push(days);
    res.items.push({ doc, kind, days: days == null ? '—' : days.toFixed(1) });
  }
  return res;
}

// 中位周期渲染（median-display）：真实的极小值不得被印成 `0.0`——四舍五入会得 0.0 时写 `<0.1`
// 显式表达「非零但极小」；null 仍写 `—`（口径与 metrics.md 表头声明一致）。
export function fmtMedianDays(v) {
  if (v == null) return '—';
  const s = v.toFixed(1);
  return s === '0.0' && v > 0 ? '<0.1' : s;
}

// 复核效果台账扫描（workflow/reviews.d/ 意见级处置分片）：一行 = 一次独立复核事件，
// 采纳+拒绝+误报 = 意见数。坏分片/自洽破坏抛错不静默（与 gen-workflow-metrics 同一口径）。
export function scanReviews(workflowDir = 'workflow') {
  const dir = path.join(workflowDir, 'reviews.d');
  if (!fs.existsSync(dir)) return {};
  const byMonth = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const p = path.join(dir, f);
    let text;
    try {
      text = fs.readFileSync(p, 'utf8');
    } catch (e) {
      throw new Error(`复核效果台账分片不可读：${p}（${e.message}）——坏分片不静默跳过`);
    }
    for (const line of text.split(/\r?\n/)) {
      if (!/^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(line)) continue; // 表头/分隔线/注记行跳过
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      const bad = cells.length < 8 || [3, 4, 5, 6].some((i) => !/^\d+$/.test(cells[i]));
      if (bad) throw new Error(`复核效果台账行字段非法（8 列起，意见数/采纳/拒绝/误报须为非负整数）：${p}\n  行：${line.trim()}`);
      const [total, adopted, rejected, misreport] = [3, 4, 5, 6].map((i) => Number(cells[i]));
      if (adopted + rejected + misreport !== total) {
        throw new Error(`复核效果台账自洽破坏（采纳 ${adopted} + 拒绝 ${rejected} + 误报 ${misreport} = ${adopted + rejected + misreport} ≠ 意见数 ${total}）：${p}\n  行：${line.trim()}`);
      }
      const b = (byMonth[cells[0].slice(0, 7)] ||= { events: 0, total: 0, adopted: 0, rejected: 0, misreport: 0 });
      b.events++;
      b.total += total;
      b.adopted += adopted;
      b.rejected += rejected;
      b.misreport += misreport;
    }
  }
  return byMonth;
}
