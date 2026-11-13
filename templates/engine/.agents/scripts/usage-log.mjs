#!/usr/bin/env node
// usage-log.mjs — 角色 / 模型调用凭据（observability 的输入）
//
// 背景（R3-7）：成本与延迟不能只看门禁耗时。宿主 / 主智能体在派发子代理后，
// 把可得的 token、墙钟与费用追加到 `.agents/usage.jsonl`（gitignore 运行态）；
// observability.mjs 按 run / 角色 / 模型聚合，并能导出 Prometheus / OTLP JSON。
//
// 诚实边界：
//   - 本脚本不抓宿主私有 transcript，不推测 token；拿不到的字段就不写。
//   - `costUsd` 可由调用方直接给，或由 observability 按 config pricing 从 token 换算。
//   - 只追加，不改历史；行内字段缺失即“未知”，聚合时单列 unpricedCalls。
//
// 用法：
//   flow-kit run usage-log.mjs append --role verifier --model <id> \
//     [--run <runId>] [--input-tokens N] [--output-tokens N] \
//     [--cost-usd N] [--latency-ms N] [--outcome pass|fail] [--ref path]
//   flow-kit run usage-log.mjs list [--days 30] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.FLOW_KIT_PROJECT_ROOT || path.resolve(SCRIPT_DIR, '..', '..');
export const LEDGER_REL = '.agents/usage.jsonl';
export const OUTCOMES = new Set(['pass', 'fail']);

function ledgerPath(root) {
  return path.join(root, LEDGER_REL);
}

function nonNegative(name, value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} 必须是非负数：${value}`);
  return n;
}

export function buildUsageRow({
  role, model, run = '', inputTokens, outputTokens, costUsd, latencyMs, outcome = '', ref = '', now = new Date(),
} = {}) {
  if (typeof role !== 'string' || typeof model !== 'string') throw new Error('--role / --model 需要取值');
  const r = role.trim();
  const m = model.trim();
  if (!r) throw new Error('--role 不能为空');
  if (!m) throw new Error('--model 不能为空');
  const out = String(outcome || '').trim();
  if (out && !OUTCOMES.has(out)) throw new Error(`--outcome 只能是 pass / fail：${out}`);
  const row = { ts: now.toISOString(), role: r, model: m };
  if (String(run || '').trim()) row.run = String(run).trim();
  const input = nonNegative('input-tokens', inputTokens);
  const output = nonNegative('output-tokens', outputTokens);
  const cost = nonNegative('cost-usd', costUsd);
  const latency = nonNegative('latency-ms', latencyMs);
  if (input != null) row.inputTokens = input;
  if (output != null) row.outputTokens = output;
  if (cost != null) row.costUsd = cost;
  if (latency != null) row.latencyMs = latency;
  if (out) row.outcome = out;
  if (String(ref || '').trim()) row.ref = String(ref).trim();
  return row;
}

export function appendUsage(root, row) {
  fs.mkdirSync(path.dirname(ledgerPath(root)), { recursive: true });
  fs.appendFileSync(ledgerPath(root), `${JSON.stringify(row)}\n`);
  return row;
}

export function readUsage(root, { days = 30, now = Date.now() } = {}) {
  let text = '';
  try {
    text = fs.readFileSync(ledgerPath(root), 'utf8');
  } catch {
    return [];
  }
  const since = now - days * 86400000;
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const t = Date.parse(row?.ts || '');
    if (Number.isFinite(t) && t >= since) rows.push(row);
  }
  return rows;
}

function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'append';
  const root = path.resolve(argOf(argv, 'root', process.env.FLOW_KIT_PROJECT_ROOT || process.cwd()));
  try {
    if (sub === 'list') {
      const days = Number(argOf(argv, 'days', 30)) || 30;
      const rows = readUsage(root, { days });
      if (argv.includes('--json')) {
        console.log(JSON.stringify(rows, null, 2));
        return 0;
      }
      if (!rows.length) {
        console.log(`usage-log: 无记录（${LEDGER_REL}，近 ${days} 天）`);
        return 0;
      }
      for (const row of rows) {
        const tokens = `${row.inputTokens ?? '?'}/${row.outputTokens ?? '?'}`;
        const cost = row.costUsd == null ? '—' : `$${row.costUsd}`;
        console.log(`${row.ts}\t${row.role}\t${row.model}\ttokens=${tokens}\tcost=${cost}\tlatency=${row.latencyMs ?? '—'}ms${row.outcome ? `\t${row.outcome}` : ''}`);
      }
      return 0;
    }
    if (sub !== 'append') {
      console.error(`usage-log: 未知子命令 ${sub}（append|list）`);
      return 2;
    }
    const row = buildUsageRow({
      role: argOf(argv, 'role', ''),
      model: argOf(argv, 'model', ''),
      run: argOf(argv, 'run', ''),
      inputTokens: argOf(argv, 'input-tokens', null),
      outputTokens: argOf(argv, 'output-tokens', null),
      costUsd: argOf(argv, 'cost-usd', null),
      latencyMs: argOf(argv, 'latency-ms', null),
      outcome: argOf(argv, 'outcome', ''),
      ref: argOf(argv, 'ref', ''),
    });
    appendUsage(root, row);
    console.log(`usage-log: ${row.role}/${row.model}${row.run ? ` run=${row.run}` : ''} → ${LEDGER_REL}`);
    return 0;
  } catch (err) {
    console.error(`usage-log: ${err.message}`);
    return 2;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exit(main());
