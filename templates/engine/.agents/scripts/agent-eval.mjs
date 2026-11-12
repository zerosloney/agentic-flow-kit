#!/usr/bin/env node
// agent-eval.mjs — 行为评测门（AI-native QA）
//
// 背景（Anthropic《The AI-native SDLC playbook》）：evals 是 AI 时代的 QA。
// 当技能 / 命令 / 角色 / 模型别名变化时，静态门无法回答“行为是否还一样”，
// 必须用固定任务集跑一次行为评测，并把结果与「被改动的配置面」绑定成凭证。
//
// 本脚本只做三件事，不调用任何模型：
//   1. 给「评测敏感面」算一个内容签名（skills/commands/roles/model 配置等）；
//   2. record 落一条评测凭证（通过率 + 任务数 + 模型 + 签名）；
//   3. check 校验当前签名是否有新鲜、达标、可追溯的凭证。
//
// 评测本身仍由既有 `.agents/skills/eval/SKILL.md` 的任务集流程执行；
// 本脚本负责把「跑过没有、跑的是不是当前配置」变成机器可判的门。
//
// 用法：
//   node .agents/scripts/agent-eval.mjs check [--advisory] [--json]
//   node .agents/scripts/agent-eval.mjs record --pass-rate 0.9 --tasks 10 --model opus [--note "..."]
//   node .agents/scripts/agent-eval.mjs status [--json]
//   node .agents/scripts/agent-eval.mjs signature
//
// 选项：
//   --root <dir>        目标根（默认 cwd）
//   --files a,b         只对指定文件算签名（测试/定向复核）
//   --threshold <0..1>  通过率阈值（默认取配置）
//   --max-age-days <N>  凭证有效期（默认取配置）
//
// 退出码：check 通过 0；无凭证/过期/不达标 1（--advisory 时仍为 0 并打 WARN）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_CONFIG = {
  version: 1,
  // 评测敏感面：这些文件变化会改变智能体行为。
  sensitive: [
    '.agents/skills/**',
    '.agents/commands/**',
    '.agents/roles/**',
    '.agents/config/model-roles.json',
    '.agents/config/steering.json',
    '.agents/config/pipeline.json',
    // 门禁自身的阈值/敏感面提交也属于“行为面”变更：改配置必须重新评测。
    '.agents/config/agent-eval.json',
  ],
  results: '.agents/evals/results.jsonl',
  threshold: 0.8,
  maxAgeDays: 30,
  // 凭证必须可追溯：少于该任务数不接受 record（eval/SKILL.md 要求 5–10 条）
  minTasks: 5,
  advisory: true,
};

const SKIP_DIRS = new Set(['.git', 'node_modules', '.agents/cache', '.agents/tmp', 'tmp']);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function loadConfig(root) {
  const file = path.join(root, '.agents', 'config', 'agent-eval.json');
  const raw = readJson(file);
  return { ...DEFAULT_CONFIG, ...(raw || {}) };
}

function globToRegExp(glob) {
  const g = String(glob).replace(/\\/g, '/');
  let out = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        out += '.*';
        i += 1;
        if (g[i + 1] === '/') i += 1;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function isSensitive(rel, patterns) {
  const norm = String(rel).replace(/\\/g, '/');
  return (patterns || []).some((p) => globToRegExp(p).test(norm));
}

function walk(root, rel, out) {
  let ents;
  try {
    ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(childRel)) continue;
      walk(root, childRel, out);
    } else if (ent.isFile()) out.push(childRel);
  }
}

export function sensitiveFiles(root, cfg = loadConfig(root), only = null) {
  let files = [];
  if (only && only.length) files = only.map((f) => String(f).replace(/\\/g, '/'));
  else walk(root, '', files);
  return files.filter((f) => isSensitive(f, cfg.sensitive)).sort();
}

// 内容签名：只覆盖评测敏感面，避免无关改动让凭证失效。
export function treeSignature(root, cfg = loadConfig(root), only = null) {
  const files = sensitiveFiles(root, cfg, only);
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(root, rel));
    } catch {
      buf = Buffer.from('<missing>');
    }
    h.update(rel);
    h.update('\0');
    h.update(buf);
    h.update('\0');
  }
  return { signature: h.digest('hex'), files };
}

export function readResults(root, cfg = loadConfig(root)) {
  const file = path.join(root, cfg.results);
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* 坏行忽略：凭证是 append-only 的，不能因一行损坏阻塞 */
    }
  }
  return rows;
}

function ageDays(ts, now = Date.now()) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return Infinity;
  return (now - t) / 86400000;
}

export function evaluate(root, { now = Date.now(), only = null } = {}) {
  const cfg = loadConfig(root);
  const { signature, files } = treeSignature(root, cfg, only);
  if (!files.length) {
    return { ok: true, reason: 'no-sensitive-files', signature, files: [], cfg };
  }
  const rows = readResults(root, cfg);
  const hits = rows.filter((r) => r && r.signature === signature);
  const fresh = hits.filter((r) => ageDays(r.ts, now) <= cfg.maxAgeDays);
  const passing = fresh.filter((r) => Number(r.passRate) >= cfg.threshold);
  if (!hits.length) return { ok: false, reason: 'no-eval-for-tree', signature, files, cfg };
  if (!fresh.length) return { ok: false, reason: 'eval-expired', signature, files, cfg };
  if (!passing.length) return { ok: false, reason: 'eval-below-threshold', signature, files, cfg };
  const latest = passing.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];
  return { ok: true, reason: 'pass', signature, files, cfg, record: latest };
}

export function recordEval(root, { passRate, tasks = 0, model = '', note = '', signature = null, now = new Date() } = {}) {
  const rate = Number(passRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('pass-rate 必须是 0..1');
  const cfg = loadConfig(root);
  const sig = signature || treeSignature(root, cfg).signature;
  const row = {
    ts: now.toISOString(),
    signature: sig,
    passRate: rate,
    tasks: Number(tasks) || 0,
    model: String(model || ''),
    note: String(note || ''),
  };
  const file = path.join(root, cfg.results);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  return row;
}

// ---- CLI ----
function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'check';
  const root = path.resolve(argOf(argv, 'root', process.cwd()));
  const only = argOf(argv, 'files');
  const json = argv.includes('--json');

  if (cmd === 'signature') {
    const { signature, files } = treeSignature(root, loadConfig(root), only ? String(only).split(',') : null);
    console.log(json ? JSON.stringify({ signature, files }, null, 2) : signature);
    return 0;
  }

  if (cmd === 'record') {
    const cfg = loadConfig(root);
    const rawRate = argOf(argv, 'pass-rate');
    const rawTasks = argOf(argv, 'tasks');
    const rawModel = argOf(argv, 'model');
    // 不带值（或后面紧跟另一个 flag）时 argOf 返回 true；绝不能把它当成 1.0 落账。
    if (rawRate === true || rawRate == null || !Number.isFinite(Number(rawRate))) {
      console.error('record 需要 --pass-rate <0..1>（必须是真实评测结果）');
      return 2;
    }
    const tasks = rawTasks === true ? NaN : Number(rawTasks ?? 0);
    const minTasks = Number(cfg.minTasks ?? 5);
    if (!Number.isFinite(tasks) || tasks < minTasks) {
      console.error(`record 需要 --tasks >= ${minTasks}（凭证必须可追溯）`);
      return 2;
    }
    if (rawModel === true || !String(rawModel || '').trim()) {
      console.error('record 需要 --model <评测模型>（凭证必须可追溯）');
      return 2;
    }
    const row = recordEval(root, {
      passRate: Number(rawRate),
      tasks,
      model: String(rawModel).trim(),
      note: argOf(argv, 'note', '') === true ? '' : String(argOf(argv, 'note', '')),
    });
    console.log(`recorded eval ${row.signature.slice(0, 12)} passRate=${row.passRate} tasks=${row.tasks}`);
    return 0;
  }

  const result = evaluate(root, { only: only ? String(only).split(',') : null });
  if (cmd === 'status' || json) {
    console.log(json ? JSON.stringify(result, null, 2) : `signature=${result.signature.slice(0, 12)} ok=${result.ok} reason=${result.reason}`);
    return 0;
  }

  const advisory = argv.includes('--advisory') || result.cfg.advisory;
  if (result.ok) {
    console.log(`✅ agent-eval: ${result.reason}`);
    return 0;
  }
  const msg = `agent-eval: ${result.reason}（签名 ${result.signature.slice(0, 12)}，${result.files.length} 个敏感文件）`;
  if (advisory) {
    console.log(`⚠ WARN ${msg}；按 .agents/skills/eval/SKILL.md 跑一次并用 record 落凭证`);
    return 0;
  }
  console.error(`✗ ${msg}；按 .agents/skills/eval/SKILL.md 跑一次并用 record 落凭证`);
  return 1;
}

const isMain = process.argv[1] && process.argv[1].endsWith('agent-eval.mjs');
if (isMain) process.exit(main());
