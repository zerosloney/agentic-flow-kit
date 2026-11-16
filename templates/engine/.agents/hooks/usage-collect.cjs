#!/usr/bin/env node
// usage-collect.cjs — Claude Code PostToolUse(Agent) usage 观测腿（随包分发于 templates/engine/.agents/hooks/，
// 经 `flow-kit hook usage-collect` 调起；安装器按 registry claude hooks.events 把 PostToolUse/Agent
// 条目编译进宿主 settings.json）。证据来源：Claude Code 官方 hooks 文档（2026-11 核实）——
// PostToolUse matcher=Agent 的 stdin 载荷 tool_response 含 usage（input/output/cache tokens 分解）、
// totalTokens、totalDurationMs、totalToolUseCount、resolvedModel、agentId，只覆盖该子代理最后一次
// API 请求；Stop 载荷无 token 字段。其余宿主无公开证据，不接线。
// 契约（行 schema 单源对齐 .agents/scripts/usage-log.mjs，observability.mjs 聚消费）：
//   1) 纯观测：只追加 .agents/usage.jsonl，不改历史；不回写、不拦截，stdout 保持干净（hook 协议无决策）。
//   2) 诚实边界：不读宿主 transcript、不推测 token；usage（input/output tokens 数值）缺失 →
//      静默零写入、exit 0；任何异常都不阻塞宿主会话。
//   3) 字段映射：role='agent'（子代理凭据统一标记，语义角色宿主侧不可得）、model=resolvedModel、
//      run=agentId、inputTokens=usage.input_tokens、outputTokens=usage.output_tokens、
//      latencyMs=totalDurationMs；cache_* token 与 totalTokens 不落账（行 schema 无此字段，
//      不得混入 inputTokens）。
//   4) root 解析：FLOW_KIT_PROJECT_ROOT 优先（`flow-kit hook` 入口注入），否则 payload.cwd 向上找
//      .agents/install-manifest.json（hook 进程 cwd 不可依赖，同 codex-gate.cjs）；非 flow-kit 仓 → exit 0。
const fs = require('node:fs');
const path = require('node:path');

const LEDGER_REL = '.agents/usage.jsonl';

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.agents', 'install-manifest.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function nonNegative(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// 载荷 → usage 行。返回 null = 无可采凭据（零写入），不抛错。
function buildRow(data) {
  const response = data && typeof data === 'object' ? data.tool_response : null;
  if (!response || typeof response !== 'object') return null;
  const usage = response.usage;
  const input = nonNegative(usage && typeof usage === 'object' ? usage.input_tokens : null);
  const output = nonNegative(usage && typeof usage === 'object' ? usage.output_tokens : null);
  if (input == null && output == null) return null; // 关键 token 字段缺失：不推测、零写入
  const row = {
    ts: new Date().toISOString(),
    role: 'agent',
    model: String(response.resolvedModel || '').trim() || 'unknown',
  };
  const agentId = String(response.agentId || '').trim();
  if (agentId) row.run = agentId;
  if (input != null) row.inputTokens = input;
  if (output != null) row.outputTokens = output;
  const latency = nonNegative(response.totalDurationMs);
  if (latency != null) row.latencyMs = latency;
  return row;
}

function collect() {
  let input = Buffer.alloc(0);
  try { input = fs.readFileSync(0); } catch { /* 无 stdin = 无凭据 */ }
  if (!input.length) process.exit(0);
  let data;
  try { data = JSON.parse(input.toString('utf8')); } catch { process.exit(0); }
  const root = process.env.FLOW_KIT_PROJECT_ROOT || findRoot(data.cwd || process.cwd());
  if (!root) process.exit(0); // 非 flow-kit 仓：no-op
  const row = buildRow(data);
  if (!row) process.exit(0);
  try {
    fs.mkdirSync(path.join(root, path.dirname(LEDGER_REL)), { recursive: true });
    fs.appendFileSync(path.join(root, LEDGER_REL), `${JSON.stringify(row)}\n`);
  } catch { /* 台账不可写：观测腿不拦截会话，静默退出 */ }
  process.exit(0);
}

// CLI 守卫：只在被直接执行时消费 stdin（宿主 settings.json 与 `flow-kit hook usage-collect` 均为
// 直执行，node <file> 的 argv[1] 即本文件）；被 require 时无副作用。
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) collect();
