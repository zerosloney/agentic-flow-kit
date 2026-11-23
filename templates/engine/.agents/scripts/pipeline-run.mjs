#!/usr/bin/env node
// pipeline-run — 跨宿主全自动闭环执行器
// 用途：把六阶段闭环的确定性部分代码化为状态机——start/next/status/watch/abort 五子命令；
//       AI 槽位经工单协议交宿主执行，人件门到点即停、next --delegated "<原话>" 逐份过 confirm-doc。
// 红线：绝不 spawn AI 会话 / 零依赖 / git 永不 --no-verify / 永不伪造原话 / 永不直改文档状态（唯一入口 confirm-doc）。
// 契约：工单协议与停机点语义单源 `.agents/commands/pipeline-run.md`；run 事件流 schema 单源本文件 emit() 调用点
//       （type ∈ gate / work-order / stop / triage / confirm / commit / done）。变更须走引擎面变更流程。
// 阶段机对齐（2026-10-28）：修复类 L2/L3 产 spec；L3 spec 复核与 L2/L3 实现后复核的工单均要求「复核上下文」
// 落盘行（格式单源 .agents/roles/independent-reviewer.md）；L1 plan 工单 relatedDocs 指向 new-task.md。
// 与 .agents/commands/ 手动闭环二选一，禁混用。
// 存储：.agents/cache/pipeline-runs/<runId>.json（gitignored 缓存态，非权威——workflow/ 文档 + confirmations.jsonl 是唯一真相源）。
// 注入（测试钩子）：PIPELINE_RUN_ROOT（仓库根，默认 cwd）/
//       PIPELINE_RUN_BIN（门脚本目录，默认 <root>/.agents/scripts）/ PIPELINE_RUN_GIT_BIN（git 命令前缀，空格分隔，默认 "git"）/
//       PIPELINE_RUN_TODAY（文档日期锚定，默认当天——测试固定日期消除时钟依赖，2026-10-03 实证：测试硬编码日期跨日即红）。
//       npm 不直接调用——测试门统一走 verify.mjs。
// 用法：
//   flow-kit run pipeline-run.mjs start "<需求原文>" [--hint "kind=require level=L1 module=wiki"] [--step]
//   flow-kit run pipeline-run.mjs next [--run <id>] [--triage "kind=|level=|module=|topic="] [--delegated "<原话>"] [--files "a,b"]
//                                   [--retry <0-5>] [--parallel "check-a.mjs,check-b.mjs"] [--step] [--gate <gate.mjs>] [--interactive-gate]
//   flow-kit run pipeline-run.mjs resume [--run <id>] [--retry <0-5>] [--parallel "…"] [--step]
//   flow-kit run pipeline-run.mjs gate <gate.mjs> [--run <id>] [--retry <0-5>]
//   flow-kit run pipeline-run.mjs status [--run <id>] [--adopt] [--json]
//   flow-kit run pipeline-run.mjs watch [--run <id>] [--interval 2] [--once]
//   flow-kit run pipeline-run.mjs dashboard [--run <id>] [--interval 2] [--once] [--inspect]
//   flow-kit run pipeline-run.mjs inspect [target] [--run <id>] [--max-lines <n>] [--json]
//   flow-kit run pipeline-run.mjs abort --run <id> [--to superseded|cancelled] [--delegated "<原话>"]
// 断点续跑（R3-5）：门执行前把 run 标 inFlight 并落盘，进程被杀后 next/resume 自动从该门重入；
//       docsCommit 以 HEAD 同主题提交判幂等，避免续跑重复提交。
// 重试（R3-5）：--retry N 仅作用于 verify 门，N 次重试后仍红才停 gate-fail；每次尝试记 retry 事件。
// 并行分支（R3-5）：--parallel 列出的附加门与 verify.mjs 并发执行，任一非零即整体非零。
// 阶段产物契约（R3-5）：`.agents/config/pipeline.json` 的 stageArtifacts 逐阶段校验产物存在且非空。
// 测试面：tests/pipeline-executor.test.mjs（引擎外包测试，本脚本仍不内嵌测试）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { touchProblems, externalReviewId, parseReviewMetadata, filesOutsidePlan } from './touch-set.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const KINDS = ['require', 'fix', 'verify', 'review', 'deploy']; // kind 词表单源（§25 预判执法段已于 2026-10-28 随 hygiene 退役，故仅本文件与工单 --hint/--triage 消费）
const LEVELS = ['L0', 'L1', 'L2', 'L3'];
const TERMINAL = ['done', 'superseded', 'cancelled', 'closed'];
const GIT_NEVER_FLAGS = ['--no-verify', '-n']; // 不变量：任何 git 调用不得携带（防御性断言，正常路径不会拼出）

function fail(msg, code = 1) { console.error('❌ ' + msg); process.exit(code); }
const nowIso = () => new Date().toISOString();
const today = () => process.env.PIPELINE_RUN_TODAY || nowIso().slice(0, 10);
// pipeline 任务目录（2026-11-16，仅自动化路径）：产物收进 workflow/tasks/<date>-<topic>/，
// 与手动路径（intents/plans/specs）隔离——手动扫描器不扫 tasks/，两类文档互不干扰。
const taskDirRel = (run) => `workflow/tasks/${today()}-${run.triage?.topic || 'task'}`;
const pad = (n) => String(n).padStart(2, '0');

// ── 环境解析（测试注入点） ─────────────────────────────────────────────
function ctxEnv(overrideRoot) {
  const root = path.resolve(overrideRoot || process.env.PIPELINE_RUN_ROOT || process.cwd());
  const bin = path.resolve(process.env.PIPELINE_RUN_BIN || process.env.FLOW_KIT_RUNTIME_SCRIPTS || path.join(root, '.agents', 'scripts'));
  // 空格分隔；支持双引号包裹（Windows 的 process.execPath 常在「Program Files」下）。
  const gitPrefix = (process.env.PIPELINE_RUN_GIT_BIN || 'git')
    .match(/"[^"]+"|\S+/g)?.map((x) => x.replace(/^"|"$/g, '')) || ['git'];
  return {
    root,
    bin,
    gitPrefix,
    runsDir: path.join(root, '.agents', 'cache', 'pipeline-runs'),
    pipeline: loadPipelineConfig(root),
    dispatch: loadDispatchConfig(root),
  };
}

// 阶段产物契约（R3-5）：可选配置，缺失/非法时退回空对象（不改变旧行为）。
function loadPipelineConfig(root) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'config', 'pipeline.json'), 'utf8'));
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch { return {}; }
}

// 派发与预算配置（可选，缺失/非法时退回空对象）
function loadDispatchConfig(root) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'config', 'dispatch.json'), 'utf8'));
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch { return {}; }
}

// {entry}|{spec}|{plan}|{apiDocs} 从 run.docs 解析；未指定的产物跳过校验（如 fix 流程无 plan）。
export function resolveArtifact(template, docs) {
  return String(template)
    .replace(/\{(entry|spec|plan|apiDocs)\}/g, (_, k) => (docs && docs[k]) || '')
    .trim();
}

export function stageArtifactProblems(read, stage, docs, cfg) {
  const list = cfg?.stageArtifacts?.[stage];
  if (!Array.isArray(list)) return [];
  const problems = [];
  for (const tpl of list) {
    const rel = resolveArtifact(tpl, docs);
    if (!rel) continue;
    const text = read(rel);
    if (text == null) problems.push(`阶段产物缺失：${rel}（${stage} 契约，见 .agents/config/pipeline.json stageArtifacts）`);
    else if (!String(text).trim()) problems.push(`阶段产物为空：${rel}（${stage} 契约）`);
  }
  return problems;
}

// 失败路由表（R6-1）：onFail[stage] = {to, retry}，retry 是该阶段允许的最大失败次数（含），
// 第 retry 次失败即停。未声明的阶段退回自身且 retry=0，与表引入前行为一致；非法配置同样回退，不抛。
export function failRoute(cfg, stage) {
  const e = cfg?.onFail?.[stage];
  const to = typeof e?.to === 'string' && e.to ? e.to : stage;
  const retry = Number.isInteger(e?.retry) && e.retry >= 0 && e.retry <= 5 ? e.retry : 0;
  return { to, retry };
}

// per-stage 失败计数的唯一 mutation 点：stopGateFail（仅正常路由路径——route:false 短路径
// 不消耗退回预算）与 verify 非耗尽分支各调一次，不双计数。
function bumpRetry(run, stage) {
  run.retries = run.retries || {};
  run.retries[stage] = (run.retries[stage] || 0) + 1;
  return run.retries[stage];
}

function moduleList(ctx) {
  try {
    return fs.readFileSync(path.join(ctx.root, '.agents', 'config', 'workflow-modules.txt'), 'utf8')
      .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch { return ['backend', 'frontend', 'ui', 'infra', 'integration', 'pipeline', 'wiki']; } // 夹具缺表时的回退默认（warning 由调用方打）
}

// ── run 文件（原子写；事件 append-only） ──────────────────────────────
function runFileOf(ctx, runId) { return path.join(ctx.runsDir, `${runId}.json`); }

function loadRun(ctx, runId) {
  const f = runFileOf(ctx, runId);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function saveRun(ctx, run) {
  fs.mkdirSync(ctx.runsDir, { recursive: true });
  run.updatedAt = nowIso();
  const f = runFileOf(ctx, run.runId);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2) + '\n');
  fs.renameSync(tmp, f);
}

function emit(run, ev) { run.events.push({ t: nowIso(), ...ev }); }

function latestRunId(ctx) {
  if (!fs.existsSync(ctx.runsDir)) return null;
  const ids = fs.readdirSync(ctx.runsDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  for (let i = ids.length - 1; i >= 0; i--) {
    const r = loadRun(ctx, ids[i]);
    if (r && !['done', 'aborted'].includes(r.stopType)) return ids[i];
  }
  return ids[ids.length - 1] || null;
}

export function listAllRuns(ctx, filter = 'all') {
  if (!fs.existsSync(ctx.runsDir)) return [];
  const ids = fs.readdirSync(ctx.runsDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort().reverse();
  const runs = [];
  for (const id of ids) {
    const r = loadRun(ctx, id);
    if (!r) continue;
    if (filter === 'active') {
      if (['done', 'aborted'].includes(r.stopType)) continue;
    } else if (filter === 'attention') {
      if (!['work-order', 'await-confirm', 'gate-fail', 'step'].includes(r.stopType)) continue;
    }
    runs.push(r);
  }
  return runs;
}

function newRunId(requirement) {
  const d = new Date();
  const ascii = (requirement.toLowerCase().match(/[a-z0-9]{2,}/g) || []).slice(0, 3).join('-') || 'task';
  const rand = Math.random().toString(36).slice(2, 6);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${ascii}-${rand}`;
}

// ── 门执行（唯一子进程出口；记录真实退出码） ──────────────────────────
function gateCmd(script, args) { return `flow-kit run ${script}${args.length ? ' ' + args.join(' ') : ''}`; }

// CLI 参数校验错误统一走 fail(msg, 2)（用法错误），不让栈回溯泄到用户输出。
function usage(fn) {
  try { return fn(); } catch (e) { return fail(e.message, 2); }
}

// 门执行前先落 inFlight（R3-5 断点续跑）：进程被杀后 run 文件仍标记中断阶段。
function beginGate(ctx, run) {
  run.inFlight = { stage: run.stage, since: nowIso() };
  saveRun(ctx, run);
}

function endGate(ctx, run, ev) {
  run.inFlight = null;
  emit(run, ev);
  saveRun(ctx, run);
}

function runNode(ctx, run, script, args) {
  const scriptPath = path.join(ctx.bin, script);
  const cmd = gateCmd(script, args);
  const t0 = Date.now();
  beginGate(ctx, run);
  // PIPELINE_RUN_ID 注入（verify-evidence 复核 P2-1）：verify.mjs 绿行据此绑定 runId
  //（对质链与 run 事件流同源，docsCommit 格式已含同一 runId）
  const p = spawnSync(process.execPath, [scriptPath, ...args], { cwd: ctx.root, encoding: 'utf8', windowsHide: true, env: { ...process.env, PIPELINE_RUN_ID: run.runId } });
  const ms = Date.now() - t0;
  const exit = p.status ?? 1;
  endGate(ctx, run, { type: 'gate', cmd, exit, ms });
  return { exit, stdout: p.stdout || '', stderr: p.stderr || '' };
}

// 并行门分支（R3-5）：spawn 并发，全部结束后聚合；事件带 parallel 组号。
function runNodeAsync(ctx, run, script, args, group) {
  const scriptPath = path.join(ctx.bin, script);
  const cmd = gateCmd(script, args);
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ctx.root, windowsHide: true, env: { ...process.env, PIPELINE_RUN_ID: run.runId },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      const exit = code ?? 1;
      emit(run, { type: 'gate', cmd, exit, ms: Date.now() - t0, ...(group ? { parallel: group } : {}) });
      saveRun(ctx, run); // inFlight 由 runGateGroup 在所有分支结束后清除
      resolve({ exit, stdout, stderr, script });
    });
  });
}

function mergeGateResults(results) {
  const fail = results.find((r) => r.exit !== 0);
  const exit = fail ? (fail.exit || 1) : 0;
  const stdout = results.map((r) => r.stdout).join('');
  const stderr = results.map((r) => (results.length > 1 ? `[${r.script}]\n${r.stderr}` : r.stderr)).join('');
  return { exit, stdout, stderr };
}

// 重试预算（R3-5）：cap 为额外尝试次数；每次失败记 retry 事件并落盘，耗尽后返回最后一次结果。
async function runGateGroup(ctx, run, stage, jobs, cap = 0) {
  const group = jobs.length > 1 ? `p-${run.events.filter((e) => e.type === 'gate' && e.parallel).length + 1}` : null;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    beginGate(ctx, run);
    const results = jobs.length > 1
      ? await Promise.all(jobs.map((j) => runNodeAsync(ctx, run, j.script, j.args || [], group)))
      : [await runNodeAsync(ctx, run, jobs[0].script, jobs[0].args || [])];
    run.inFlight = null;
    saveRun(ctx, run);
    const merged = mergeGateResults(results);
    if (merged.exit === 0 || attempt > cap) return merged;
    emit(run, { type: 'retry', stage, attempt, cap, exit: merged.exit });
    saveRun(ctx, run);
  }
}

function runGit(ctx, run, args, { optional = false } = {}) {
  if (args.some((a) => GIT_NEVER_FLAGS.includes(a))) fail('不变量破坏：git 调用携带禁用旗标', 1);
  const cmd = `git ${args.join(' ')}`;
  const t0 = Date.now();
  const p = spawnSync(ctx.gitPrefix[0], [...ctx.gitPrefix.slice(1), ...args], { cwd: ctx.root, encoding: 'utf8', windowsHide: true });
  const ms = Date.now() - t0;
  const exit = p.status ?? 1;
  // optional：探测类调用（如空仓库的 git log）失败不记 gate 事件，避免污染门失败计数。
  if (!optional || exit === 0) {
    emit(run, { type: 'gate', cmd, exit, ms });
    saveRun(ctx, run); // 事件落盘：断点续跑时 git 侧已发生的事实不丢
  }
  return { exit, stdout: p.stdout || '', stderr: p.stderr || '' };
}

// ── 文档读取/校验 ──────────────────────────────────────────────────────
function readDoc(ctx, rel) {
  try { return fs.readFileSync(path.join(ctx.root, rel), 'utf8'); } catch { return null; }
}
function fmGet(text, key) {
  const m = text.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  return m ? m.slice(key.length + 1).trim() : null;
}
// 关单即归档（confirm-doc archive-on-close）：文档落终态后可能已被 git mv 到
// workflow/archive/<月>/<类型>/。活跃路径缺失时回落到归档路径——否则 pendOf 会把
// 已归档的终态件重新算作待确认，关单永远停在 await-confirm「余 1 份」。
const DOC_DIRS = ['intents', 'specs', 'plans', 'incidents'];
export function resolveDocRel(ctx, rel) {
  if (!rel || readDoc(ctx, rel) !== null) return rel;
  const parts = String(rel).replace(/\\/g, '/').split('/');
  const base = parts.pop();
  const dir = parts.pop();
  let months = [];
  try { months = fs.readdirSync(path.join(ctx.root, 'workflow', 'archive')).sort().reverse(); } catch { return rel; }
  for (const m of months) {
    for (const d of DOC_DIRS.includes(dir) ? [dir] : DOC_DIRS) {
      const cand = ['workflow', 'archive', m, d, base].join('/');
      if (readDoc(ctx, cand) !== null) return cand;
    }
  }
  return rel;
}
function docState(ctx, rel) { const t = readDoc(ctx, resolveDocRel(ctx, rel)); return t ? fmGet(t, '状态') : null; }

// 占位符判定（复核 P1-3 收窄，2026-10-02）：先剔除 code span（`…`）与引号串（"…"）——
// 正文合法的命令语法占位（如 `next --delegated "<原话>"`）几乎总在 code span 内，
// 模板实占位符（如 <为什么做；写明需求来源…>）从不包 code span；再匹配剩余裸尖括号。
export function placeholdersIn(text) {
  const stripped = String(text)
    .replace(/^```[\s\S]*?^```$/gm, '') // 复核 P2-B：跨行 code fence 整块剔除（围栏内命令示例占位不属模板占位符）
    .replace(/`[^`\n]*`/g, '')
    .replace(/"[^"\n]*"/g, '');
  const hits = [];
  for (const re of [/<[^>\n]{1,60}>/g, /YYYY-MM-DD 用户/g]) {
    let m; while ((m = re.exec(stripped))) hits.push(m[0]);
  }
  return [...new Set(hits)].slice(0, 5);
}

function sectionBody(text, title) {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim() === `## ${title}` || l.trim() === `## ${title}（L1 微改动无实质内容可删本节，不硬填）` || l.trim().startsWith(`## ${title}`));
  if (i < 0) return null;
  const body = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (/^##\s/.test(lines[j])) break;
    body.push(lines[j]);
  }
  return body.join('\n').trim();
}

export function validateDraftContent(text, kind, level) {
  const problems = [];
  if (!text) return ['文件不存在或为空'];
  const state = fmGet(text, '状态');
  if (!state) problems.push('frontmatter 缺「状态:」行');
  if (kind !== 'incident' && !fmGet(text, '级别')) problems.push('frontmatter 缺「级别:」行');
  const ph = placeholdersIn(text);
  if (ph.length) problems.push(`模板占位符残留：${ph.join('、')}`);
  const isLite = level === 'L0' || level === 'L1';
  const required = {
    intent: isLite ? ['背景与问题', '目标', '验收标准'] : ['背景与问题', '历史教训/防复发', '目标', '非目标', '约束', '验收标准'],
    spec: ['功能行为', '数据流', '系统改动', '约束遵守映射'],
    plan: isLite ? ['入口', '改动方案', '约束与风险', '验证计划', '验收标准'] : ['改动方案', '任务拆解', '执行顺序', '验证计划'],
    incident: ['时间线', '根因', '复盘三件套'],
  }[kind] || [];
  for (const sec of required) {
    const b = sectionBody(text, sec);
    if (b === null) {
      if (isLite && ['非目标', '约束', '任务拆解', '执行顺序', '约束与风险', ...(level === 'L0' ? ['入口'] : [])].includes(sec)) continue;
      if (isLite && (sec === '验证计划' || sec === '验收标准') && sectionBody(text, '验证与验收') !== null) continue;
      problems.push(`缺节：## ${sec}`);
    } else if (!b) {
      problems.push(`节为空：## ${sec}`);
    }
  }
  return problems;
}

export function closeoutComplete(text) {
  let body = sectionBody(text, '验收标准');
  if (body === null) body = sectionBody(text, '验证与验收');
  if (body === null) return { ok: false, problems: ['缺「## 验收标准」或「## 验证与验收」节'] };
  const lines = body.split(/\r?\n/);
  const open = lines.filter((l) => /^\s*-\s\[\s\]\s/.test(l));
  // 复核 P2-6：证据冒号后须直接跟内容（非空白、非收括号）——「（证据：）」空值不算过
  const checkedNoEv = lines.filter((l) => /^\s*-\s\[x\]\s/.test(l) && !/证据[:：][^）\s]/.test(l));
  const problems = [];
  if (open.length) problems.push(`未勾验收 ${open.length} 条`);
  if (checkedNoEv.length) problems.push(`已勾缺证据 ${checkedNoEv.length} 条`);
  return { ok: problems.length === 0, problems };
}

function summarizeDoc(text) {
  const body = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('---') && !/^状态:|^级别:|^日期:|^模块:|^备注:|^risk_level:/.test(l));
  return body.slice(0, 3).join(' / ').slice(0, 200);
}

// ── 工单上下文精简与 Token 预算（Option 2） ─────────────────────────────
export function pruneWorkOrderContext(context, budgetChars = 1200) {
  if (!context || typeof context !== 'object') {
    return { budget: { originalChars: 0, prunedChars: 0, budgetChars, pruned: false, savingsPercent: 0 } };
  }
  const originalChars = JSON.stringify(context).length;
  if (originalChars <= budgetChars) {
    return {
      ...context,
      budget: { originalChars, prunedChars: originalChars, budgetChars, pruned: false, savingsPercent: 0 },
    };
  }

  const prunedContext = { ...context };

  // 1. 去重并保留前 4 条关联文档
  if (Array.isArray(prunedContext.relatedDocs)) {
    prunedContext.relatedDocs = [...new Set(prunedContext.relatedDocs)].slice(0, 4);
  }

  // 2. 智能裁剪 kbHits：至多保留前 3 条，单条超 120 字符截断
  if (Array.isArray(prunedContext.kbHits)) {
    prunedContext.kbHits = prunedContext.kbHits.slice(0, 3).map((h) => {
      const s = String(h || '');
      return s.length > 120 ? s.slice(0, 117) + '...' : s;
    });
  }

  // 3. 智能折叠 stderrTail：首 3 行错误 + 尾 5 行退出，中间行折叠，总长不超过 400 字符
  if (typeof prunedContext.stderrTail === 'string' && prunedContext.stderrTail) {
    const lines = prunedContext.stderrTail.split(/\r?\n/).filter(Boolean);
    if (lines.length > 8) {
      const head = lines.slice(0, 3);
      const tail = lines.slice(-5);
      const skipped = lines.length - 8;
      prunedContext.stderrTail = [...head, `... [跳过 ${skipped} 行堆栈/输出] ...`, ...tail].join('\n');
    }
    if (prunedContext.stderrTail.length > 400) {
      prunedContext.stderrTail = prunedContext.stderrTail.slice(0, 397) + '...';
    }
  }

  const prunedChars = JSON.stringify(prunedContext).length;
  const pruned = prunedChars < originalChars;
  const savingsPercent = originalChars > 0 ? Math.max(0, Math.round(((originalChars - prunedChars) / originalChars) * 100)) : 0;

  prunedContext.budget = {
    originalChars,
    prunedChars,
    budgetChars,
    pruned,
    savingsPercent,
  };

  return prunedContext;
}

// ── 智能门禁失败归因分析（Smart Fix Attribution） ────────────────────────
export function analyzeGateFailure(input, context = {}) {
  const parts = [];
  if (Array.isArray(input)) parts.push(...input.map(String));
  else if (input != null) parts.push(String(input));
  if (Array.isArray(context.problems)) parts.push(...context.problems.map(String));
  const text = parts.join('\n');
  const docPath = context.docPath || '';

  // 1. 常驻面 / 体积预算超限 (budget-exceeded)
  const mBudget = text.match(/(?:常驻面超限|超上限|budget exceeded)[：:]\s*([^\s:：]+)\s+(\d+B?)\s*>\s*(?:(?:上限|limit)\s*)?(\d+B?)/i)
    || text.match(/([^\s:：]+\.md)\s+(\d+B?)\s*>\s*(?:(?:上限|limit)\s*)?(\d+B?)/i);
  if (mBudget) {
    const file = mBudget[1].replace(/\\/g, '/');
    const actual = mBudget[2];
    const limit = mBudget[3];
    return {
      category: 'budget-exceeded',
      title: '常驻面体积超限',
      summary: `${file} 体积 (${actual}) 超过预算上限 (${limit})`,
      suggestedAction: `精简 ${file} 正文与历史注释，或依一进一出原则将非核心描述下沉至 skills/`,
      impactedFiles: [file],
      debugCmd: 'flow-kit run rule-budget.mjs --all',
    };
  }

  // 2. 范围偏离 / 偏离即停 / 未授权文件改动 (scope-deviation)
  const mScope = text.match(/(?:git 改动超出回填清单|超出回填清单|偏离即停|计划外)[^：:\n]*[：:]\s*([^\n]+)/i);
  if (mScope) {
    const fileListStr = mScope[1].trim();
    const rawFiles = fileListStr.split(/[、,，\s]+/).filter(Boolean).map((f) => f.replace(/^['"`]|['"`]$/g, '').replace(/\\/g, '/'));
    const files = rawFiles.filter((f) => f && !f.startsWith('--') && !f.includes('改 plan'));
    return {
      category: 'scope-deviation',
      title: '改动范围超出计划 (偏离即停)',
      summary: `检测到计划外文件变更: ${files.join('、') || fileListStr}`,
      suggestedAction: '若属必须改动，通过 --files 补齐回填清单；若超出方案，须向用户请求原话授权 (next --delegated)',
      impactedFiles: files,
      debugCmd: 'git status -s',
    };
  }

  // 3. 阶段产物契约缺失 (artifact-missing)
  const mArt = text.match(/(?:阶段产物(?:缺失|为空)|缺少\s+([\w./-]+\.md)\s+产物契约)[：:]?\s*([^\n（(]+)?/i);
  if (mArt) {
    const file = (mArt[2] || mArt[1] || '').trim().replace(/\\/g, '/');
    return {
      category: 'artifact-missing',
      title: '阶段契约产物缺失',
      summary: `当前阶段必需产物未就绪: ${file || '契约文档缺失'}`,
      suggestedAction: `检查前置阶段起草结果，确保 ${file || '指定产物'} 写入并在任务目录落盘`,
      impactedFiles: file ? [file] : [],
      debugCmd: 'flow-kit run pipeline-run.mjs inspect',
    };
  }

  // 4. 策略与机制一致性漂移 (policy-drift)
  if (/\[policy-ci\]|策略面不一致|机制未登记|mechanisms\.required|policy-check/i.test(text)) {
    return {
      category: 'policy-drift',
      title: '策略与机制注册表漂移',
      summary: 'policy.json 与 mechanism-registry.md 策略配置存在未登记机制或不一致',
      suggestedAction: '运行 node tools/policy-check.mjs 进行双向核对，同步机制注册表与 policy 配置',
      impactedFiles: ['.agents/config/mechanism-registry.md', '.agents/config/policy.json'],
      debugCmd: 'node tools/policy-check.mjs',
    };
  }

  // 5. 工作流文档格式/规范不合规 (template-lint)
  const mLint = text.match(/(?:模板占位符残留|frontmatter 缺|缺节|未勾验收)[：:]?\s*([^\n]+)?/i);
  if (mLint) {
    return {
      category: 'template-lint',
      title: '工作流文档规范校验未通过',
      summary: `文档规范错误: ${mLint[0].trim()}`,
      suggestedAction: '编辑文档补齐缺失章节/frontmatter、清理 {{占位符}} 并勾选验收项',
      impactedFiles: docPath ? [docPath] : [],
      debugCmd: 'flow-kit run check-pipeline-state.mjs',
    };
  }

  // 6. 单元/集成测试断言失败 (test-failure)
  const mTestFile = text.match(/(?:test at|FAIL|FAIL tests\/)\s*([^\s:]+\.test\.(?:mjs|js|ts|cjs))(?::(\d+))?/i)
    || text.match(/([\w./\\-]+\.test\.(?:mjs|js|ts|cjs))/i);
  const mAssert = text.match(/(?:AssertionError|ERR_ASSERTION)[^\n]*?(?:\[.*?\])?\s*([^\n]+)/i)
    || text.match(/✖\s+([^\n]+?)\s+\((\d+(?:\.\d+)?ms)\)/i);

  if (mTestFile || mAssert || /assert\.\w+\s*failed/i.test(text)) {
    const testFile = mTestFile ? mTestFile[1].replace(/\\/g, '/') : null;
    const testLine = mTestFile?.[2] ? `:${mTestFile[2]}` : '';
    const failDetail = mAssert ? mAssert[1].trim() : '断言失败';
    return {
      category: 'test-failure',
      title: '测试用例断言未通过',
      summary: testFile ? `测试 ${testFile}${testLine} 失败: ${failDetail}` : `断言失败: ${failDetail}`,
      suggestedAction: testFile ? `修复 ${testFile} 涉及的逻辑实现并复测` : '检查代码实现是否满足测试前置条件与边界要求',
      impactedFiles: testFile ? [testFile] : [],
      debugCmd: testFile ? `node --test ${testFile}` : 'flow-kit run pipeline-run.mjs gate verify.mjs',
    };
  }

  // 7. 通用未知门禁错误 (unknown)
  return {
    category: 'unknown',
    title: '门禁检查未通过',
    summary: '门禁返回非零退出码，具体原因参见错误日志',
    suggestedAction: '查看详细错误输出定位异常，单门调试复验',
    impactedFiles: [],
    debugCmd: 'flow-kit run pipeline-run.mjs gate verify.mjs',
  };
}

// ── 工单构建 ───────────────────────────────────────────────────────────
function wo(ctxOrRun, runOrO, oOrNothing) {
  let ctx, run, o;
  if (oOrNothing !== undefined) {
    ctx = ctxOrRun;
    run = runOrO;
    o = oOrNothing;
  } else {
    run = ctxOrRun;
    o = runOrO;
    ctx = null;
  }
  const order = { id: (run.events.filter((e) => e.type === 'work-order').length + 1), ...o };
  const budgetChars = ctx?.dispatch?.workOrderContextBudgetChars || 1200;
  if (order.context) {
    order.context = pruneWorkOrderContext(order.context, budgetChars);
  }
  return order;
}
function issueWO(ctx, run, order, nextStage) {
  if (order.context && (!order.context.budget || order.context.budget.budgetChars !== (ctx?.dispatch?.workOrderContextBudgetChars || 1200))) {
    order.context = pruneWorkOrderContext(order.context, ctx?.dispatch?.workOrderContextBudgetChars || 1200);
  }
  run.workOrder = order;
  run.stopType = 'work-order';
  run.stage = nextStage;
  emit(run, { type: 'work-order', id: order.id, kind: order.kind });
  emit(run, { type: 'stop', stopType: 'work-order', workOrderId: order.id });
  saveRun(ctx, run);
  printRun(ctx, run);
  process.exit(0);
}
function stopConfirm(ctx, run, docRel, points, ledger) {
  run.workOrder = null;
  run.stopType = 'await-confirm';
  run.awaitConfirm = { doc: docRel, points, ledger: !!ledger };
  emit(run, { type: 'stop', stopType: 'await-confirm', doc: docRel });
  saveRun(ctx, run);
  printRun(ctx, run);
  process.exit(0);
}
function stopGateFail(ctx, run, stage, problems, exitHint, opts = {}) {
  const analysis = analyzeGateFailure(problems, { stage, problems });
  run.workOrder = null;
  run.stopType = 'gate-fail';
  run.stage = stage;
  run.gateFail = { stage, problems, analysis };
  // stage 留在失败处，nextTarget 记退回目标（R6-1）；route:false 用于前置条件失败与 verify-only
  // 短路径——不消耗退回预算（commands/pipeline-run.md），retries 不动、原地停。
  const { to, retry } = failRoute(ctx.pipeline, stage);
  if (opts.route === false) {
    run.nextTarget = null;
  } else {
    const attempt = bumpRetry(run, stage);
    run.nextTarget = attempt >= retry ? null : to;
    if (run.nextTarget) emit(run, { type: 'route', from: stage, to, attempt, cap: retry });
  }
  emit(run, { type: 'stop', stopType: 'gate-fail', stage });
  saveRun(ctx, run);
  printRun(ctx, run, problems);
  process.exit(2);
}
function stopDone(ctx, run) {
  run.workOrder = null;
  run.stopType = 'done';
  run.stage = 'done';
  emit(run, { type: 'done' });
  emit(run, { type: 'stop', stopType: 'done' });
  saveRun(ctx, run);
  printRun(ctx, run);
  process.exit(0);
}
function stopStep(ctx, run, nextStage) {
  run.workOrder = null;
  run.stopType = 'step';
  run.stage = nextStage;
  emit(run, { type: 'step-pause', stage: nextStage });
  emit(run, { type: 'stop', stopType: 'step', stage: nextStage });
  saveRun(ctx, run);
  printRun(ctx, run);
  process.exit(0);
}

// ── 输出（人类可读 + 机器标记） ────────────────────────────────────────
export function stageBar(run) {
  const s = run.stage;
  const mk = (name, pos) => (pos === 'cur' ? '[●' + name + ']' : pos === 'past' ? '[✓' + name + ']' : '[…' + name + ']');
  const seq = run.triage?.kind === 'verify' ? [['Verify', s === 'verify' || s === 'done']]
    : run.triage?.kind === 'review' ? [['Review', s === 'review-only' || s === 'done']]
      : run.triage?.kind === 'deploy' ? [['Checklist', ['deploy-check', 'deploy-prep'].includes(s)], ['Authorize', s === 'deploy-await' || s === 'done']]
        : [['Plan', ((run.triage?.level === 'L0' || run.triage?.level === 'L1') && run.triage?.kind !== 'fix'
            ? ['plan-fill', 'plan-draft', 'plan-confirm', 'triage']
            : ['intent-fill', 'intent-draft', 'intent-confirm', 'incident-fill', 'incident-draft', 'incident-confirm', 'triage']).includes(s)],
          ['Design', ['spec-fill', 'spec-draft', 'spec-review', 'spec-confirm'].includes(s)],
          ['Build', ((run.triage?.level === 'L0' || run.triage?.level === 'L1') && run.triage?.kind !== 'fix'
            ? ['changes-confirm', 'implement', 'fix', 'changes-verify']
            : ['plan-fill', 'plan-draft', 'plan-confirm', 'changes-confirm', 'implement', 'fix', 'changes-verify']).includes(s)],
          ['Test', ['verify', 'review', 'closeout', 'done-confirm', 'incident-fixed-confirm', 'incident-closed-confirm', 'direct-commit'].includes(s) || s === 'done']];
  const curIdx = seq.findIndex(([, cur]) => cur);
  return seq.map(([name], i) => mk(name, i < curIdx ? 'past' : i === curIdx ? 'cur' : 'future')).join(' ');
}

function printRun(ctx, run, problems) {
  const lv = run.triage ? ` ${run.triage.level}·${run.triage.kind}` : '';
  console.log(`\n▶ pipeline-run ${run.runId}${lv}  ${stageBar(run)}`);
  if (run.inFlight) console.log(`↻ 中断于 ${run.inFlight.stage}（自 ${run.inFlight.since}）——next 或 resume 会从该门重入`);
  if (run.nextTarget) console.log(`↩ 退回 ${run.nextTarget} 重做（${run.stage} 失败 ${run.retries?.[run.stage] || 0}/${failRoute(ctx.pipeline, run.stage).retry}）——next 生效`);
  const dgs = (run.events || []).filter((e) => e.type === 'review-downgrade');
  if (dgs.length) {
    const lastDg = dgs[dgs.length - 1];
    console.log(`⚠️ [评审降级] ${lastDg.reason || '跨模型评审自适应降级'}${lastDg.reviewer ? ` (${lastDg.reviewer})` : ''}`);
  }
  if (run.stopType === 'work-order' && run.workOrder) {
    const w = run.workOrder;
    console.log(`\n== 工单 #${w.id}（${w.kind}）${w.title} ==`);
    console.log(`目标：${w.goal}`);
    for (const s of w.instructions) console.log(`  ${s}`);
    if (w.fixAnalysis && w.fixAnalysis.category !== 'unknown') {
      console.log(`💡 [智能归因] ${w.fixAnalysis.title}：${w.fixAnalysis.summary}`);
      if (w.fixAnalysis.debugCmd) console.log(`🔧 [定向调试] ${w.fixAnalysis.debugCmd}`);
    }
    if (w.context?.budget?.pruned) {
      console.log(`[上下文预算] 已按预算精简：${w.context.budget.originalChars}c → ${w.context.budget.prunedChars}c (节约 ${w.context.budget.savingsPercent}%)`);
    }
    if (w.context?.kbHits?.length) console.log(`查重命中：\n  ${w.context.kbHits.slice(0, 6).join('\n  ')}`);
    if (w.context?.stderrTail) console.log(`上次门失败输出（尾 20 行）：\n  ${w.context.stderrTail}`);
    console.log('约束：');
    for (const c of w.constraints) console.log(`  - ${c}`);
    console.log('验收（脚本机器校验）：');
    for (const a of w.acceptance) console.log(`  - ${a}`);
    console.log(`\n完成工单后回跑：flow-kit run pipeline-run.mjs next${run.docs?.entry ? '' : ''}`);
  } else if (run.stopType === 'await-confirm' && run.awaitConfirm) {
    const c = run.awaitConfirm;
    console.log(`\n== 等待确认 ==${c.ledger ? `（文档：${c.doc}，将经 confirm-doc 代录入台账）` : '（对话级确认，记 run 事件不进台账）'}`);
    console.log(`要点：${c.points}`);
    console.log(`用户确认后回跑：next --delegated "<用户原话>"`);
  } else if (run.stopType === 'gate-fail') {
    console.log(`\n== 门拒绝（exit 2，不绕不吞——修复后原路重跑 next）==`);
    for (const p of problems || run.gateFail?.problems || []) console.log(`  - ${p}`);
    const analysis = run.gateFail?.analysis || analyzeGateFailure(problems || run.gateFail?.problems || [], { stage: run.stage });
    if (analysis && analysis.category !== 'unknown') {
      console.log(`\n💡 智能归因: [${analysis.title}] ${analysis.summary}`);
      console.log(`🎯 推荐动作: ${analysis.suggestedAction}`);
      if (analysis.impactedFiles?.length) console.log(`📁 涉及文件: ${analysis.impactedFiles.join(', ')}`);
      if (analysis.debugCmd) console.log(`🔧 定向命令: ${analysis.debugCmd}`);
    }
    console.log(`\n调试与定向重试建议：`);
    console.log(`  - 单门调试：flow-kit run pipeline-run.mjs gate <门脚本名.mjs> [--run ${run.runId}]`);
    console.log(`  - 定向验证：flow-kit run pipeline-run.mjs next --gate <门脚本名.mjs> [--run ${run.runId}]`);
    console.log(`  - 单步重入：flow-kit run pipeline-run.mjs next --step [--run ${run.runId}]`);
  } else if (run.stopType === 'step') {
    console.log(`\n== 单步暂停 ==`);
    console.log(`  阶段就绪：${run.stage}`);
    console.log(`  继续推进：flow-kit run pipeline-run.mjs next${run.runId ? ` --run ${run.runId}` : ''} [--step]`);
  } else if (run.stopType === 'done') {
    console.log(`\n== 完成 ==`);
    const gates = run.events.filter((e) => e.type === 'gate');
    const fails = gates.filter((e) => e.exit !== 0).length;
    console.log(`  需求：${run.requirement}`);
    console.log(`  门执行 ${gates.length} 道（非零 ${fails}）；确认 ${run.events.filter((e) => e.type === 'confirm').length} 次；提交 ${run.events.filter((e) => e.type === 'commit').length} 笔`);
    // apiDocs 是声明式兜底派生（未声明 {apiDocs} 也会派生），文件未产物时标「未产物」而非 '?'——
    // '?' 表示「存在但状态未知」，与不存在混用会误导（条目 37，2026-11-18 实测发现）。
    for (const d of [...new Set([run.docs?.entry, run.docs?.spec, run.docs?.plan, run.docs?.apiDocs].filter(Boolean))]) console.log(`  文档：${d}（${docState(ctx, d) || (fs.existsSync(resolveDocRel(ctx, d)) ? '?' : '未产物')}）`);
  } else if (run.stopType === 'aborted') {
    console.log(`\n== 已放弃（${run.abort?.to || ''}）== ${run.abort?.note || ''}`);
  }
  const stopLine = run.stopType === 'work-order' ? `PIPELINE-STOP work-order ${run.runId} ${run.workOrder?.id}`
    : run.stopType === 'await-confirm' ? `PIPELINE-STOP await-confirm ${run.runId} ${run.awaitConfirm?.doc || ''}`
      : run.stopType === 'gate-fail' ? `PIPELINE-STOP gate-fail ${run.runId} ${run.stage}`
        : run.stopType === 'step' ? `PIPELINE-STOP step ${run.runId} ${run.stage}`
          : run.stopType === 'aborted' ? `PIPELINE-STOP aborted ${run.runId}`
            : `PIPELINE-STOP done ${run.runId}`;
  console.log(stopLine.trim());
}

// ── 实时 TUI 阶段监控看板 ─────────────────────────────────────────────
const ESC = '\x1b';
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

export function stripAnsi(s) {
  return String(s ?? '').replace(ANSI_RE, '');
}

const WIDE_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

export function visualWidth(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) w += WIDE_RE.test(ch) ? 2 : 1;
  return w;
}

export function truncate(s, maxW) {
  const str = String(s ?? '');
  if (visualWidth(str) <= maxW) return str;
  let res = '';
  let curW = 0;
  const targetW = Math.max(1, maxW - 1);
  for (const ch of str) {
    const cw = WIDE_RE.test(ch) ? 2 : 1;
    if (curW + cw > targetW) break;
    res += ch;
    curW += cw;
  }
  return res + '…';
}

export function truncateAnsi(s, maxW) {
  const str = String(s ?? '');
  if (visualWidth(str) <= maxW) return str;
  let res = '';
  let curW = 0;
  const targetW = Math.max(1, maxW - 1);
  let inEscape = false;
  let escapeBuf = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\x1b') {
      inEscape = true;
      escapeBuf = ch;
      continue;
    }
    if (inEscape) {
      escapeBuf += ch;
      if (/[A-Za-z]/.test(ch)) {
        inEscape = false;
        res += escapeBuf;
        escapeBuf = '';
      }
      continue;
    }
    const cw = WIDE_RE.test(ch) ? 2 : 1;
    if (curW + cw > targetW) break;
    res += ch;
    curW += cw;
  }
  return res + (str.includes('\x1b') ? '…\x1b[0m' : '…');
}

function padRight(s, targetW) {
  const str = String(s ?? '');
  const vw = visualWidth(str);
  if (vw >= targetW) return truncateAnsi(str, targetW);
  return str + ' '.repeat(targetW - vw);
}

function makeColor(noColor) {
  if (noColor) {
    const id = (x) => String(x ?? '');
    return {
      bold: id, dim: id, cyan: id, green: id, yellow: id, red: id, magenta: id, blue: id, gray: id,
      bgCyan: id, bgGreen: id, bgYellow: id, bgRed: id, bgBlue: id,
    };
  }
  const p = (code, reset) => (x) => `${ESC}${code}${String(x ?? '')}${ESC}${reset}`;
  return {
    bold: p('[1m', '[22m'),
    dim: p('[2m', '[22m'),
    cyan: p('[36m', '[39m'),
    green: p('[32m', '[39m'),
    yellow: p('[33m', '[39m'),
    red: p('[31m', '[39m'),
    magenta: p('[35m', '[39m'),
    blue: p('[34m', '[39m'),
    gray: p('[90m', '[39m'),
    bgCyan: p('[46;30m', '[49;39m'),
    bgGreen: p('[42;30m', '[49;39m'),
    bgYellow: p('[43;30m', '[49;39m'),
    bgRed: p('[41;37m', '[49;39m'),
    bgBlue: p('[44;37m', '[49;39m'),
  };
}

export function renderDashboard(ctx, run, options = {}) {
  const width = Math.max(50, Number(options.width) || 80);
  const W = width - 4; // 内部对齐宽度
  const noColor = options.noColor ?? Boolean(process.env.NO_COLOR);
  const clr = makeColor(noColor);
  const lines = [];

  const topBorder = (title) => {
    const tw = visualWidth(title);
    return clr.cyan('┌─ ') + clr.bold(title) + ' ' + clr.cyan('─'.repeat(Math.max(0, W - tw - 1)) + '┐');
  };
  const sectionDivider = (title) => {
    const tw = visualWidth(title);
    return clr.cyan('├─ ') + clr.bold(title) + ' ' + clr.cyan('─'.repeat(Math.max(0, W - tw - 1)) + '┤');
  };
  const row = (content) => `${clr.cyan('│')} ${padRight(content, W)} ${clr.cyan('│')}`;
  const bottomBorder = () => clr.cyan('└' + '─'.repeat(W + 2) + '┘');

  // 1. 顶部基础信息与阶段流向图
  const sel = options.selector;
  let title = `Pipeline 看板: ${run.runId}`;
  if (sel && sel.total > 0) {
    const filterText = sel.filter === 'active' ? '活跃' : sel.filter === 'attention' ? '需关注' : '全部';
    title = `Pipeline 看板 [${sel.current}/${sel.total} · ${filterText}]: ${run.runId}`;
  }
  lines.push(topBorder(title));

  const lv = run.triage ? `${run.triage.level} · ${run.triage.kind} · ${run.triage.module || 'repo'} · ${run.triage.topic || 'task'}` : '待分流 (pending triage)';
  lines.push(row(`需求: ${truncate(run.requirement, W - 6)}`));
  lines.push(row(`标签: ${clr.cyan(lv)}`));

  // 阶段序列
  const s = run.stage;
  const seq = run.triage?.kind === 'verify' ? [['Verify', s === 'verify' || s === 'done']]
    : run.triage?.kind === 'review' ? [['Review', s === 'review-only' || s === 'done']]
      : run.triage?.kind === 'deploy' ? [['Checklist', ['deploy-check', 'deploy-prep'].includes(s)], ['Authorize', s === 'deploy-await' || s === 'done']]
        : [['Plan', ((run.triage?.level === 'L0' || run.triage?.level === 'L1') && run.triage?.kind !== 'fix'
            ? ['plan-fill', 'plan-draft', 'plan-confirm', 'triage']
            : ['intent-fill', 'intent-draft', 'intent-confirm', 'incident-fill', 'incident-draft', 'incident-confirm', 'triage']).includes(s)],
          ['Design', ['spec-fill', 'spec-draft', 'spec-review', 'spec-confirm'].includes(s)],
          ['Build', ((run.triage?.level === 'L0' || run.triage?.level === 'L1') && run.triage?.kind !== 'fix'
            ? ['changes-confirm', 'implement', 'fix', 'changes-verify']
            : ['plan-fill', 'plan-draft', 'plan-confirm', 'changes-confirm', 'implement', 'fix', 'changes-verify']).includes(s)],
          ['Test', ['verify', 'review', 'closeout', 'done-confirm', 'incident-fixed-confirm', 'incident-closed-confirm', 'direct-commit'].includes(s) || s === 'done']];
  const curIdx = seq.findIndex(([, cur]) => cur);

  const stageItems = seq.map(([name], i) => {
    if (i < curIdx) return clr.green(`[✓ ${name}]`);
    if (i === curIdx) return clr.bold(clr.cyan(`»${name}«`));
    return clr.dim(`[… ${name}]`);
  });
  stageItems.push(s === 'done' ? clr.green('[✓ Done]') : clr.dim('[… Done]'));
  const stageFlow = stageItems.join(clr.dim(' ──▶ '));
  lines.push(row(`流向: ${stageFlow}`));

  // 状态概览行
  let stateDesc = `阶段: ${s} │ 停机类型: ${run.stopType}`;
  if (run.inFlight) stateDesc += ` │ ${clr.yellow(`↻ 中断于 ${run.inFlight.stage}`)}`;
  if (run.nextTarget) stateDesc += ` │ ${clr.red(`↩ 退回 ${run.nextTarget}`)}`;
  if ((run.events || []).some((e) => e.type === 'review-downgrade')) stateDesc += ` │ ${clr.yellow('[评审降级]')}`;
  lines.push(row(truncate(stateDesc, W)));

  // 2. 当前停机点详情卡片
  lines.push(sectionDivider('当前停机状态'));
  if (run.stopType === 'work-order' && run.workOrder) {
    const w = run.workOrder;
    lines.push(row(clr.bold(clr.yellow(`工单 #${w.id} (${w.kind}) ${truncate(w.title, W - 20)}`))));
    if (w.goal) lines.push(row(`目标: ${truncate(w.goal, W - 6)}`));
    if (w.fixAnalysis && w.fixAnalysis.category !== 'unknown') {
      lines.push(row(`  ${clr.yellow('💡 智能归因:')} ${clr.bold(w.fixAnalysis.title)}: ${truncate(w.fixAnalysis.summary, W - 18)}`));
      if (w.fixAnalysis.debugCmd) {
        lines.push(row(`  ${clr.dim('🔧 定向调试:')} ${clr.cyan(truncate(w.fixAnalysis.debugCmd, W - 16))}`));
      }
    }
    if (w.context?.budget?.pruned) {
      lines.push(row(`  ${clr.green('⚡ 上下文预算:')} ${w.context.budget.originalChars}c → ${w.context.budget.prunedChars}c (节约 ${w.context.budget.savingsPercent}%)`));
    }
    if (w.instructions?.length) {
      for (const ins of w.instructions.slice(0, 2)) {
        lines.push(row(`  ${clr.dim('•')} ${truncate(ins, W - 4)}`));
      }
    }
    const nextCmd = `flow-kit run pipeline-run.mjs next${w.kind === 'implement' || w.kind === 'fix' ? ' --files "<git-status-files>"' : ''}`;
    lines.push(row(`${clr.cyan('▶ 下一步:')} ${clr.bold(nextCmd)}`));
  } else if (run.stopType === 'await-confirm' && run.awaitConfirm) {
    const c = run.awaitConfirm;
    lines.push(row(clr.bold(clr.yellow(`等待确认${c.ledger ? ' (台账级文档确认)' : ' (对话级确认)'}`))));
    if (c.doc) lines.push(row(`文档: ${c.doc}`));
    if (c.points) lines.push(row(`要点: ${truncate(c.points, W - 6)}`));
    lines.push(row(`${clr.cyan('▶ 下一步:')} ${clr.bold('flow-kit run pipeline-run.mjs next --delegated "<用户原话>"')}`));
  } else if (run.stopType === 'gate-fail') {
    lines.push(row(clr.bold(clr.red(`门禁拒绝 (阶段: ${run.stage})`))));
    const probs = options.problems || run.gateFail?.problems || [];
    const analysis = run.gateFail?.analysis || (probs.length ? analyzeGateFailure(probs, { stage: run.stage }) : null);
    if (analysis && analysis.category !== 'unknown') {
      lines.push(row(`  ${clr.yellow('💡 归因:')} ${clr.bold(analysis.title)} (${analysis.category})`));
      lines.push(row(`     ${truncate(analysis.summary, W - 6)}`));
      if (analysis.debugCmd) {
        lines.push(row(`  ${clr.cyan('🔧 建议调试:')} ${truncate(analysis.debugCmd, W - 16)}`));
      }
    }
    if (probs.length) {
      for (const p of probs.slice(0, 3)) {
        lines.push(row(`  ${clr.red('✖')} ${truncate(p, W - 4)}`));
      }
    }
    lines.push(row(`${clr.cyan('▶ 下一步:')} 修复上述问题后原路重跑 ${clr.bold('flow-kit run pipeline-run.mjs next')}`));
  } else if (run.stopType === 'done') {
    lines.push(row(clr.bold(clr.green('流程全部完成 (All Stages Completed)'))));
    const gates = (run.events || []).filter((e) => e.type === 'gate');
    const fails = gates.filter((e) => e.exit !== 0).length;
    const confirms = (run.events || []).filter((e) => e.type === 'confirm').length;
    const commits = (run.events || []).filter((e) => e.type === 'commit').length;
    lines.push(row(`统计: 门执行 ${gates.length} 道 (失败 ${fails}) │ 确认 ${confirms} 次 │ 提交 ${commits} 笔`));
    lines.push(row(`${clr.green('✔')} 所有闭环门禁已全数通过`));
  } else if (run.stopType === 'aborted') {
    lines.push(row(clr.bold(clr.red(`已放弃 (${run.abort?.to || 'cancelled'})`))));
    if (run.abort?.note) lines.push(row(`说明: ${truncate(run.abort.note, W - 6)}`));
    lines.push(row(`${clr.dim('⊘')} 任务已终止`));
  } else if (run.stopType === 'step') {
    lines.push(row(clr.bold(clr.cyan(`单步暂停 (已就绪阶段: ${run.stage})`))));
    lines.push(row(`流水线已在阶段转换边界暂停，等待人工确认或单步推进。`));
    lines.push(row(`${clr.cyan('▶ 下一步:')} 单步推进 ${clr.bold('flow-kit run pipeline-run.mjs next --step')} 或全速继续 ${clr.bold('flow-kit run pipeline-run.mjs next')}`));
  } else {
    lines.push(row(`状态: ${run.stopType}`));
  }

  // 3. 产物文档表格
  lines.push(sectionDivider('产物文档'));
  const docList = [
    ['entry', run.docs?.entry],
    ['spec', run.docs?.spec],
    ['plan', run.docs?.plan],
    ['apiDocs', run.docs?.apiDocs],
  ].filter(([, p]) => Boolean(p));

  if (docList.length === 0) {
    lines.push(row(clr.dim('  (暂无关联工作流文档)')));
  } else {
    for (const [type, rel] of docList) {
      const rawSt = docState(ctx, rel);
      const absPath = resolveDocRel(ctx, rel);
      const st = rawSt || (fs.existsSync(absPath) ? '?' : '未产物');
      const badge = (st === 'approved' || st === 'done') ? clr.green(`[${st}]`)
        : st === 'draft' ? clr.yellow(`[${st}]`)
        : st === '未产物' ? clr.dim(`[${st}]`)
        : clr.red(`[${st}]`);
      const typeCol = padRight(type, 8);
      const relCol = padRight(truncate(rel, Math.max(10, W - 24)), Math.max(10, W - 22));
      lines.push(row(`  ${clr.dim(typeCol)} ${relCol} ${badge}`));
    }
  }

  // 4. 最近事件流水
  lines.push(sectionDivider('最近事件流水'));
  const recent = (run.events || []).slice(-5);
  if (recent.length === 0) {
    lines.push(row(clr.dim('  (暂无事件流水)')));
  } else {
    for (const e of recent) {
      const time = (e.t || '').slice(11, 19) || '--:--:--';
      const type = padRight(e.type || 'event', 11);
      const bits = [];
      if (e.cmd) bits.push(`${e.cmd}${e.exit !== undefined ? ` [exit ${e.exit}]` : ''}`);
      if (e.doc) bits.push(e.doc);
      if (e.quote) bits.push(`「${e.quote}」`);
      if (e.subject) bits.push(e.subject);
      if (e.type === 'retry') bits.push(`attempt ${e.attempt}/${e.cap}`);
      if (e.type === 'resume') bits.push(`from ${e.stage}`);
      if (e.type === 'review-downgrade') bits.push(`[降级] ${e.reason || ''}`);
      if (e.id) bits.push(`#${e.id}`);
      const detail = bits.join(' │ ') || '-';
      lines.push(row(`  ${clr.dim(time)} │ ${clr.cyan(type)} │ ${truncate(detail, Math.max(10, W - 26))}`));
    }
  }

  // 5. 底栏与快捷键说明
  lines.push(bottomBorder());
  const tStr = String(options.now || nowIso()).slice(11, 19);
  const navHelp = options.selector && options.selector.total > 1
    ? ` ${clr.bold('[◄/►]')} 切换 Run  ${clr.dim('│')}  ${clr.bold('[F]')} 过滤  ${clr.dim('│')}`
    : (options.selector ? ` ${clr.bold('[F]')} 过滤  ${clr.dim('│')}` : '');
  const footer = options.once
    ? clr.dim(` (单次快照模式 · ${tStr})`)
    : `${navHelp} ${clr.bold('[V]')} 检视产物  ${clr.dim('│')}  ${clr.bold('[R]')} 刷新  ${clr.dim('│')}  ${clr.bold('[Q]')} 退出  ${clr.dim(`(每 ${options.interval || 2}s 自动轮询 · ${tStr})`)}`;
  lines.push(footer);

  return lines;
}

// ── Markdown 终端高亮与排版 ───────────────────────────────────────────
export function renderMarkdown(text, options = {}) {
  const width = Math.max(40, Number(options.width) || 80);
  const noColor = options.noColor ?? Boolean(process.env.NO_COLOR);
  const clr = makeColor(noColor);
  const rawLines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCode = false;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const trimmed = raw.trim();

    // Code fence
    if (trimmed.startsWith('```')) {
      inCode = !inCode;
      const lang = trimmed.slice(3).trim();
      out.push(clr.gray(inCode ? `┌─── [${lang || 'code'}] ` + '─'.repeat(Math.max(0, width - 12 - (lang ? lang.length : 4))) : '└───' + '─'.repeat(Math.max(0, width - 4))));
      continue;
    }
    if (inCode) {
      out.push(clr.gray('│ ') + clr.dim(raw));
      continue;
    }

    // Dividers
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push(clr.dim('─'.repeat(Math.min(width, 60))));
      continue;
    }

    // GitHub alerts: > [!NOTE], > [!TIP], > [!WARNING], > [!CAUTION], > [!IMPORTANT]
    const alertMatch = trimmed.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|CRITICAL)\]/i);
    if (alertMatch) {
      const type = alertMatch[1].toUpperCase();
      let alertTag = `ℹ [NOTE]`;
      let alertFn = clr.cyan;
      if (type === 'TIP') { alertTag = `💡 [TIP]`; alertFn = clr.green; }
      else if (type === 'IMPORTANT') { alertTag = `★ [IMPORTANT]`; alertFn = clr.magenta; }
      else if (type === 'WARNING') { alertTag = `⚠ [WARNING]`; alertFn = clr.yellow; }
      else if (type === 'CAUTION' || type === 'CRITICAL') { alertTag = `⛔ [${type}]`; alertFn = clr.red; }
      out.push(alertFn(clr.bold(`┌─ ${alertTag} ` + '─'.repeat(Math.max(0, width - alertTag.length - 6)))));
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const content = trimmed.replace(/^>\s*/, '');
      out.push(clr.cyan('│ ') + clr.dim(content));
      continue;
    }

    // Headers
    if (trimmed.startsWith('# ')) {
      const title = trimmed.slice(2);
      out.push('');
      out.push(clr.bold(clr.cyan(`═══ ${title} ═══`)));
      continue;
    }
    if (trimmed.startsWith('## ')) {
      const title = trimmed.slice(3);
      out.push('');
      out.push(clr.bold(clr.cyan(`─── ${title} ───`)));
      continue;
    }
    if (trimmed.startsWith('### ')) {
      const title = trimmed.slice(4);
      out.push(clr.bold(clr.yellow(`▶ ${title}`)));
      continue;
    }

    // Table rows
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        out.push(clr.dim('├' + '─'.repeat(Math.min(width - 2, 50)) + '┤'));
      } else {
        const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
        out.push(clr.cyan('│ ') + cells.join(clr.cyan(' │ ')) + clr.cyan(' │'));
      }
      continue;
    }

    // Task list / bullets
    if (/^[\*\-]\s*\[([ xX])\]/.test(trimmed)) {
      const checked = /^[\*\-]\s*\[[xX]\]/.test(trimmed);
      const rest = trimmed.replace(/^[\*\-]\s*\[[ xX]\]\s*/, '');
      out.push(checked ? clr.green('  [✓] ') + rest : clr.dim('  [ ] ') + rest);
      continue;
    }
    if (/^[\*\-]\s+/.test(trimmed)) {
      out.push(clr.cyan('  • ') + trimmed.replace(/^[\*\-]\s+/, ''));
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const numMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
      if (numMatch) {
        out.push(clr.yellow(`  ${numMatch[1]} `) + numMatch[2]);
        continue;
      }
    }

    // Frontmatter fence
    if (trimmed === '---') {
      out.push(clr.dim('┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈'));
      continue;
    }

    // Regular line with inline formatting
    let line = raw;
    line = line.replace(/\*\*([^*]+)\*\*/g, (_, m) => clr.bold(m));
    line = line.replace(/`([^`]+)`/g, (_, m) => clr.yellow(m));
    out.push(line);
  }

  return out;
}

// ── 产物提取与检视 ─────────────────────────────────────────────────────
export function inspectArtifact(ctx, run, target) {
  const norm = String(target || '').trim();
  const lower = norm.toLowerCase();

  // 1. 直接文件路径检查
  if (norm.includes('/') || norm.includes('\\') || norm.endsWith('.md')) {
    const absPath = path.isAbsolute(norm) ? norm : path.join(ctx.root, norm);
    if (fs.existsSync(absPath)) {
      try {
        const text = fs.readFileSync(absPath, 'utf8');
        const st = fmGet(text, '状态');
        return {
          ok: true,
          type: 'doc',
          rel: path.relative(ctx.root, absPath).replace(/\\/g, '/'),
          title: `文件产物: ${path.basename(absPath)}`,
          state: st || 'raw',
          content: text,
        };
      } catch (err) {
        return { ok: false, type: 'doc', rel: norm, error: `读取文件失败: ${err.message}` };
      }
    }
  }

  // 2. 具名产物类型检索
  if (lower === 'entry' || lower === 'intent') {
    const rel = run.docs?.entry;
    if (!rel) return { ok: false, type: 'entry', error: '当前 Run 尚未关联 entry/intent 文档' };
    const text = readDoc(ctx, rel);
    if (text === null) return { ok: false, type: 'entry', rel, error: `文档尚未生成或不存在：${rel}` };
    return { ok: true, type: 'entry', rel, title: `需求意图 (entry): ${rel}`, state: docState(ctx, rel) || 'unknown', content: text };
  }

  if (lower === 'spec') {
    const rel = run.docs?.spec;
    if (!rel) return { ok: false, type: 'spec', error: '当前 Run 尚未关联 spec 规格文档' };
    const text = readDoc(ctx, rel);
    if (text === null) return { ok: false, type: 'spec', rel, error: `文档尚未生成或不存在：${rel}` };
    return { ok: true, type: 'spec', rel, title: `技术规格 (spec): ${rel}`, state: docState(ctx, rel) || 'unknown', content: text };
  }

  if (lower === 'plan') {
    const rel = run.docs?.plan;
    if (!rel) return { ok: false, type: 'plan', error: '当前 Run 尚未关联 plan 执行计划文档' };
    const text = readDoc(ctx, rel);
    if (text === null) return { ok: false, type: 'plan', rel, error: `文档尚未生成或不存在：${rel}` };
    return { ok: true, type: 'plan', rel, title: `执行计划 (plan): ${rel}`, state: docState(ctx, rel) || 'unknown', content: text };
  }

  if (lower === 'api' || lower === 'apidocs') {
    const rel = run.docs?.apiDocs;
    if (!rel) return { ok: false, type: 'api', error: '当前 Run 尚未关联 api.md 文档契约' };
    const text = readDoc(ctx, rel);
    if (text === null) return { ok: false, type: 'api', rel, error: `文档尚未生成或不存在：${rel}` };
    return { ok: true, type: 'api', rel, title: `API 契约 (apiDocs): ${rel}`, state: docState(ctx, rel) || 'unknown', content: text };
  }

  if (lower === 'work-order' || lower === 'workorder' || lower === 'wo' || lower === 'order') {
    const w = run.workOrder;
    if (!w) return { ok: false, type: 'work-order', error: '当前 Run 无活跃工单' };
    const lines = [
      `# 工单 #${w.id} (${w.kind}) ${w.title || ''}`,
      '',
      `- **目标**: ${w.goal || '未说明'}`,
      `- **当前阶段**: ${run.stage}`,
    ];
    if (w.context?.budget?.pruned) {
      lines.push(`- **上下文预算**: ${w.context.budget.originalChars}c → ${w.context.budget.prunedChars}c (节约 ${w.context.budget.savingsPercent}%)`);
    }
    if (w.instructions?.length) {
      lines.push('', '## 执行指令');
      w.instructions.forEach((ins, idx) => lines.push(`${idx + 1}. ${ins}`));
    }
    if (w.relatedDocs?.length) {
      lines.push('', '## 关联参考文档');
      w.relatedDocs.forEach((d) => lines.push(`- \`${d}\``));
    }
    if (w.kbHits?.length) {
      lines.push('', '## 知识库匹配参考');
      w.kbHits.forEach((hit) => lines.push(`- ${hit}`));
    }
    if (w.context?.stderrTail) {
      lines.push('', '## 上次门禁失败日志 (截断)', '```', w.context.stderrTail, '```');
    }
    return { ok: true, type: 'work-order', title: `工单 #${w.id} (${w.kind})`, content: lines.join('\n') };
  }

  if (lower === 'problems' || lower === 'problem' || lower === 'fail' || lower === 'gate') {
    const probs = run.gateFail?.problems || [];
    const recentGates = (run.events || []).filter((e) => e.type === 'gate' && e.exit !== 0);
    const analysis = run.gateFail?.analysis || run.workOrder?.fixAnalysis || (probs.length ? analyzeGateFailure(probs, { stage: run.stage }) : null);
    if (!probs.length && !recentGates.length && (!analysis || analysis.category === 'unknown')) {
      return { ok: true, type: 'problems', title: '门禁检查正常', content: '### 门禁检查状态\n\n- 当前阶段无门禁失败问题 (No gate problems recorded)' };
    }
    const lines = [`# 门禁拒绝记录 (阶段: ${run.gateFail?.stage || run.stage})`, ''];
    if (analysis && analysis.category !== 'unknown') {
      lines.push(`> [!WARNING] **智能归因诊断**: ${analysis.title} (\`${analysis.category}\`)`);
      lines.push(`> - **核心原因**: ${analysis.summary}`);
      if (analysis.impactedFiles?.length) {
        lines.push(`> - **涉及文件**: ${analysis.impactedFiles.map((f) => `\`${f}\``).join('、')}`);
      }
      lines.push(`> - **修复建议**: ${analysis.suggestedAction}`);
      if (analysis.debugCmd) {
        lines.push(`> - **推荐调试**: \`${analysis.debugCmd}\``);
      }
      lines.push('');
    }
    if (probs.length) {
      lines.push('## 拦截问题清单');
      probs.forEach((p, idx) => lines.push(`${idx + 1}. ✖ ${p}`));
    }
    if (recentGates.length) {
      lines.push('', '## 失败门禁列表');
      recentGates.forEach((g) => lines.push(`- \`${g.cmd}\` [退出码: ${g.exit}] (${(g.t || '').slice(11, 19)})`));
    }
    return { ok: true, type: 'problems', title: `门禁拦截记录 (${probs.length} 项问题)`, content: lines.join('\n') };
  }

  if (lower === 'risk' || lower === 'intercept' || lower === 'risk-intercept' || lower === 'risk-intercept.md') {
    const candidates = [
      path.join(taskDirRel(run), 'risk-intercept.md'),
      'workflow/intents/risk-intercept.md',
    ];
    for (const c of candidates) {
      const text = readDoc(ctx, c);
      if (text !== null) {
        return { ok: true, type: 'risk', rel: c, title: `风控阻断记录: ${c}`, state: docState(ctx, c) || 'intercept', content: text };
      }
    }
    try {
      const wfDir = path.join(ctx.root, 'workflow');
      if (fs.existsSync(wfDir)) {
        const queue = [wfDir];
        while (queue.length > 0) {
          const d = queue.shift();
          const entries = fs.readdirSync(d, { withFileTypes: true });
          for (const ent of entries) {
            const full = path.join(d, ent.name);
            if (ent.isDirectory()) queue.push(full);
            else if (ent.isFile() && ent.name.includes('risk-intercept')) {
              const rel = path.relative(ctx.root, full).replace(/\\/g, '/');
              const text = fs.readFileSync(full, 'utf8');
              return { ok: true, type: 'risk', rel, title: `风控阻断记录: ${rel}`, state: docState(ctx, rel) || 'intercept', content: text };
            }
          }
        }
      }
    } catch {}
    return { ok: false, type: 'risk', error: '未发现 risk-intercept.md 风险拦截产物文档' };
  }

  if (lower === 'diff') {
    const r = spawnSync(ctx.gitPrefix[0], [...ctx.gitPrefix.slice(1), 'diff', 'HEAD'], { cwd: ctx.root, encoding: 'utf8', windowsHide: true });
    const diff = r.stdout || '';
    if (!diff.trim()) {
      return { ok: true, type: 'diff', title: 'Git 工作区差异', content: '### Git Diff\n\n- 当前工作区与 HEAD 无差异 (Working tree clean)' };
    }
    return { ok: true, type: 'diff', title: 'Git 工作区差异 (git diff HEAD)', content: '```diff\n' + diff + '\n```' };
  }

  // 3. Fallback / 自动目标
  if (!norm || lower === 'auto') {
    if (run.stopType === 'work-order' && run.workOrder) return inspectArtifact(ctx, run, 'work-order');
    if (run.stopType === 'gate-fail') return inspectArtifact(ctx, run, 'problems');
    if (run.stage?.startsWith('plan') && run.docs?.plan) return inspectArtifact(ctx, run, 'plan');
    if (run.stage?.startsWith('spec') && run.docs?.spec) return inspectArtifact(ctx, run, 'spec');
    if (run.docs?.entry) return inspectArtifact(ctx, run, 'entry');
    if (run.docs?.plan) return inspectArtifact(ctx, run, 'plan');
    return inspectArtifact(ctx, run, 'work-order');
  }

  return { ok: false, type: 'unknown', error: `未知产物目标：${norm}（支持: entry | spec | plan | api | work-order | problems | risk | diff 或直接文件相对路径）` };
}

export function getAvailableTargets(ctx, run) {
  const targets = [];
  if (run.docs?.entry && readDoc(ctx, run.docs.entry) !== null) targets.push('entry');
  if (run.docs?.spec && readDoc(ctx, run.docs.spec) !== null) targets.push('spec');
  if (run.docs?.plan && readDoc(ctx, run.docs.plan) !== null) targets.push('plan');
  if (run.docs?.apiDocs && readDoc(ctx, run.docs.apiDocs) !== null) targets.push('api');
  if (run.workOrder) targets.push('work-order');
  if ((run.gateFail?.problems || []).length || (run.events || []).some((e) => e.type === 'gate' && e.exit !== 0)) targets.push('problems');
  return targets.length ? targets : ['work-order'];
}

export function renderInspect(ctx, run, options = {}) {
  const width = Math.max(50, Number(options.width) || 80);
  const W = width - 4;
  const noColor = options.noColor ?? Boolean(process.env.NO_COLOR);
  const clr = makeColor(noColor);
  const lines = [];

  const topBorder = (title) => {
    const tw = visualWidth(title);
    return clr.cyan('┌─ ') + clr.bold(title) + ' ' + clr.cyan('─'.repeat(Math.max(0, W - tw - 1)) + '┐');
  };
  const sectionDivider = (title) => {
    const tw = visualWidth(title);
    return clr.cyan('├─ ') + clr.bold(title) + ' ' + clr.cyan('─'.repeat(Math.max(0, W - tw - 1)) + '┤');
  };
  const row = (content) => `${clr.cyan('│')} ${padRight(content, W)} ${clr.cyan('│')}`;
  const bottomBorder = () => clr.cyan('└' + '─'.repeat(W + 2) + '┘');

  const avail = getAvailableTargets(ctx, run);
  let activeTarget = options.target || avail[0];
  const art = inspectArtifact(ctx, run, activeTarget);

  // 1. Header
  const sel = options.selector;
  let title = `Pipeline 产物检视: ${run.runId}`;
  if (sel && sel.total > 0) {
    const filterText = sel.filter === 'active' ? '活跃' : sel.filter === 'attention' ? '需关注' : '全部';
    title = `Pipeline 产物检视 [${sel.current}/${sel.total} · ${filterText}]: ${run.runId}`;
  }
  lines.push(topBorder(title));

  const stageInfo = `阶段: ${run.stage} │ 状态: ${run.stopType}`;
  lines.push(row(truncate(stageInfo, W)));

  // Tabs
  const tabItems = avail.map((t, i) => {
    const isCur = t === (art.type || activeTarget);
    const label = `[${i + 1}:${t}]`;
    return isCur ? clr.bold(clr.cyan(`»${label}«`)) : clr.dim(label);
  });
  lines.push(row(`标签页: ${tabItems.join(' ')}`));

  // 2. Content Section
  const dividerTitle = art.ok ? (art.title || `产物内容: ${activeTarget}`) : `产物未就绪: ${activeTarget}`;
  lines.push(sectionDivider(truncate(dividerTitle, W - 6)));

  if (!art.ok) {
    lines.push(row(clr.yellow(`⚠️ ${art.error || '未找到该产物'}`)));
    lines.push(row(clr.dim(`  提示: 当前阶段可能尚未生成该产物，或指定的目标名称不存在。`)));
  } else {
    if (art.state) {
      lines.push(row(`${clr.dim('状态:')} ${clr.bold(clr.green(art.state))}${art.rel ? ` │ ${clr.dim('路径:')} ${art.rel}` : ''}`));
      lines.push(row(clr.dim('─'.repeat(W))));
    }
    const rendered = renderMarkdown(art.content, { width: W - 2, noColor });
    const offset = Math.max(0, Number(options.scrollOffset) || 0);
    const maxL = options.maxLines !== undefined && options.maxLines > 0 ? options.maxLines : (options.once ? 200 : 18);
    const slice = rendered.slice(offset, offset + maxL);

    for (const l of slice) {
      lines.push(row(l));
    }
    if (rendered.length > offset + maxL) {
      lines.push(row(clr.dim(`... (剩余 ${rendered.length - (offset + maxL)} 行已折叠，按 ▼/j 往下滚动或 CLI 加 --max-lines 0 查看全量)`)));
    }
  }

  // 3. Footer
  lines.push(bottomBorder());
  const tStr = String(options.now || nowIso()).slice(11, 19);
  const navHelp = options.selector && options.selector.total > 1
    ? ` ${clr.bold('[◄/►]')} 切换 Run  ${clr.dim('│')}`
    : '';
  const tabHelp = avail.length > 1 ? `[1-${avail.length}/Tab]` : '[Tab]';
  const footer = options.once
    ? clr.dim(` (产物快照模式 · ${tStr})`)
    : `${navHelp} ${clr.bold(tabHelp)} 切产物  ${clr.dim('│')}  ${clr.bold('[▲/▼/j/k]')} 滚动  ${clr.dim('│')}  ${clr.bold('[Esc/B]')} 看板  ${clr.dim('│')}  ${clr.bold('[Q]')} 退出  ${clr.dim(`(${tStr})`)}`;
  lines.push(footer);

  return lines;
}

// ── triage / 路径 ──────────────────────────────────────────────────────
export function parseKV(s) {
  const out = {};
  for (const part of String(s || '').split(/\s+/).filter(Boolean)) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

// --parallel（R3-5）：只接受包内门脚本名，拒绝路径分隔符/上级目录。
export function parseParallelList(s) {
  const names = String(s || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const name of names) {
    if (!/^[A-Za-z0-9._-]+\.mjs$/.test(name) || name === 'pipeline-run.mjs') {
      throw new Error(`--parallel 只接受门脚本名（如 check-loop.mjs）：${name}`);
    }
    if (!out.some((j) => j.script === name)) out.push({ script: name, args: [] });
  }
  return out;
}

// --gate（定向门验证/单门调试）：只接受 .mjs 门脚本名，拒绝目录穿越与 pipeline-run.mjs 自身。
export function parseGateName(s) {
  if (!s || typeof s !== 'string') throw new Error('--gate 必填门脚本名：--gate verify.mjs');
  const name = s.trim();
  if (!/^[A-Za-z0-9._-]+\.mjs$/.test(name) || name === 'pipeline-run.mjs') {
    throw new Error(`门脚本只接受 .mjs 脚本名（如 verify.mjs、check-loop.mjs）：${name}`);
  }
  return name;
}

export function parseRetryCap(v) {
  if (v === undefined) return 0;
  if (v === true) throw new Error('--retry 须带次数：--retry 2');
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 5) throw new Error('--retry 须为 0-5 的整数');
  return n;
}

function validateTriage(ctx, kv) {
  const problems = [];
  if (!KINDS.includes(kv.kind)) problems.push(`kind 须为 ${KINDS.join('|')}`);
  if (!LEVELS.includes(kv.level)) problems.push(`level 须为 ${LEVELS.join('|')}`);
  const mods = moduleList(ctx);
  // 空词表 = 不校验模块枚举（与 profiles 模板注释的契约一致）；非空才拒绝表外值。
  if (mods.length && kv.module && !mods.includes(kv.module)) problems.push(`module 须在词表内：${mods.join('|')}`);
  if (kv.topic && !/^[a-z0-9][a-z0-9-]*$/.test(kv.topic)) problems.push('topic 须为英文 kebab-case');
  return problems;
}

// ── 状态机（next 的全部合法推进） ──────────────────────────────────────
function confirmGate(ctx, run, docRel, quote, to) {
  const args = [docRel];
  if (to) args.push('--to', to);
  if (quote) args.push('--delegated', quote);
  const r = runNode(ctx, run, 'confirm-doc.mjs', args);
  if (r.exit !== 0) {
    const tail = (r.stderr || r.stdout).split(/\r?\n/).filter(Boolean).slice(-6).join(' | ');
    return { ok: false, msg: `confirm-doc exit ${r.exit}：${tail}` };
  }
  emit(run, { type: 'confirm', doc: docRel, to: to || nextConfirmTarget(docState(ctx, docRel), docRel), source: quote ? 'chat-delegated' : 'tty', ...(quote ? { quote } : {}) });
  return { ok: true };
}
// 语义上 confirm-doc 自行决定目标态（approved/done/fixed/closed）；事件里记录结果态
function nextConfirmTarget(curState, docRel) { return curState || 'approved'; }

// 断点续跑幂等（R3-5）：上一次 confirm-doc 已把文档推入 approved 但后续提交/落盘失败时，
// 重入不得再调 confirm-doc——否则它会按 approved→done 继续前向，跳过 implement。
// 文档 frontmatter 是唯一真相源：已是 approved 即认定确认已完成，仅补 run 事件。
function confirmOrResume(ctx, run, docRel, quote) {
  if (docState(ctx, docRel) === 'approved') {
    emit(run, { type: 'confirm', doc: docRel, to: 'approved', source: 'resume', ...(quote ? { quote } : {}) });
    saveRun(ctx, run);
    return { ok: true, resumed: true };
  }
  return confirmGate(ctx, run, docRel, quote);
}

// （decouple-flow-kit）原 managedFaceCheck（提交集命中 kit.json managed 台账 / 包源
// templates/_agents/ 时自动跑 bin/flow-kit.mjs sync 刷台账）已随 kit 双源机制退役整段删除——
// 引擎配置（kit.json，2026-10-08 迁移为 .agents/config/engine.json）不再有 managed 字段、仓内无
// templates/ 包源，该函数在本仓恒早退返回空集。

function docsCommit(ctx, run, files, subject) {
  const commitFiles = [...new Set(files)];
  // 断点续跑幂等（R3-5）：上次提交成功、落盘前被杀 → HEAD 已是同主题提交，不重复提交。
  const head = runGit(ctx, run, ['log', '-1', '--format=%s'], { optional: true });
  if (head.exit === 0 && head.stdout.trim() === subject) {
    const sha = runGit(ctx, run, ['rev-parse', '--short', 'HEAD']);
    emit(run, { type: 'commit', sha: sha.stdout.trim(), subject, resumed: true });
    saveRun(ctx, run);
    return { ok: true };
  }
  const add = runGit(ctx, run, ['add', ...commitFiles]);
  if (add.exit !== 0) return { ok: false, msg: `git add 失败：${add.stderr.slice(0, 200)}` };
  const c = runGit(ctx, run, ['commit', '-m', subject]);
  if (c.exit !== 0) return { ok: false, msg: `git commit 失败：${(c.stderr || c.stdout).split(/\r?\n/).filter(Boolean).slice(-4).join(' | ')}` };
  const sha = runGit(ctx, run, ['rev-parse', '--short', 'HEAD']);
  emit(run, { type: 'commit', sha: sha.stdout.trim(), subject });
  return { ok: true };
}

// 安装产物（manifest 有记录且磁盘哈希未变）不是工单改动：fresh install 尚未提交基线时，
// git status 会把全部托管文件列为 untracked，旧逻辑误判为「改动超出回填清单」。
export function manifestPristine(ctx) {
  const pristine = new Set();
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(ctx.root, '.agents', 'install-manifest.json'), 'utf8'));
  } catch {
    return pristine;
  }
  for (const [rel, hash] of Object.entries(manifest.files || {})) {
    try {
      const buf = fs.readFileSync(path.join(ctx.root, rel));
      const rawHash = crypto.createHash('sha256').update(buf).digest('hex');
      if (rawHash === hash) {
        pristine.add(rel);
      } else {
        // CRLF 兼容容错：Windows 或 core.autocrlf 转换下的文本文件归一为 LF 后比对
        const norm = buf.toString('utf8').replace(/\r\n/g, '\n');
        if (crypto.createHash('sha256').update(norm, 'utf8').digest('hex') === hash) {
          pristine.add(rel);
        }
      }
    } catch {
      /* 缺失/不可读：不算 pristine，按普通改动处理 */
    }
  }
  return pristine;
}

function changedFiles(ctx, run) {
  const r = runGit(ctx, run, ['status', '--porcelain', '-u']); // -u：展开 untracked 目录为逐文件（防「src/」折叠误报越权）
  if (r.exit !== 0) return null;
  const pristine = manifestPristine(ctx);
  // manifest 本身是安装器元数据，不是任何工单的改动面（fresh install 时同样 untracked）。
  pristine.add('.agents/install-manifest.json');
  const out = [];
  for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) {
    let p = line.slice(3).trim();
    if (p.includes(' -> ')) {
      // 复核 P2-2：rename 行收录 old+new 两路径——旧路径的删除同样属改动面（防改名逃逸越权）
      for (const q of p.split(' -> ')) {
        const n = q.trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
        if (n && !pristine.has(n)) out.push(n);
      }
      continue;
    }
    p = p.replace(/^"|"$/g, '').replace(/\\/g, '/');
    if (!pristine.has(p)) out.push(p);
  }
  return out;
}

// 脚本自身管理的运行态路径——confirm/gate/gen-index 副产物，不属宿主越权面（沙箱演练实证，2026-10-02）
// 运行期产物豁免（2026-11-18 条目 36 实测定位，与 manifestPristine 同纪律）：零提交基线装户首跑误报
// 「偏离即停」的三来源——① `.agents/notes/engine-map.md`：GENERATED_ONLY，装期生成、从不进 manifest；
// ② `tmp/`：verify 门自产日志目录（verify.mjs 落 `tmp/verify-*.log`，已随 .gitignore.engine 忽略）；
// ③ `workflow/effective-policy.md`：自愈生成物（engine-artifacts 门漂移即重生成，渲染含当日日期、逐日
// 合法漂移，rehash 无意义）。安全性同既有注释：三者真值源（policy.json / mechanism-registry /
// engine.json / 引擎模板）均在 manifest 内受 pristine 保护，机器改动会被自愈覆盖或本就是机器输出。
// 冷启动与运行期白名单（完整覆盖安装期本地配置、基线快照与凭证产物）：
const RUNTIME_OWNED = [
  '.agents/cache/',
  '.agents/confirmations.jsonl',
  '.agents/confirmations.d/',
  'workflow/INDEX.md',
  '.agents/notes/engine-map.md',
  'workflow/effective-policy.md',
  'tmp/',
  '.agents/.kit/',
  '.agents/config/model-roles.local.json',
  '.agents/config/session-context.local.json',
  '.agents/notes/runtime-env.local.md',
  '.agents/verifications.jsonl',
  '.agents/judgments.jsonl',
  '.agents/install-manifest.json',
];

export function isRuntimeOrManaged(ctx, file) {
  if (RUNTIME_OWNED.some((ro) => (ro.endsWith('/') ? file.startsWith(ro) : file === ro))) return true;
  if (file === '.gitattributes' || file === '.gitignore') {
    try {
      const content = fs.readFileSync(path.join(ctx.root, file), 'utf8');
      if (content.includes('# >>> agentic-flow-kit')) return true;
    } catch {}
  }
  return false;
}

// run 自身拥有的文档（intent/incident/spec/plan/api 等）：到关单才随提交入库，implement/fix 回填时
// 必然同时出现在 git status 与 --files 中；不豁免则每单合法回填都会被判「计划外」而自锁 await-confirm。
// 仅豁免登记过的具体文档与本 run 的任务目录，不放大为整个 workflow/ 目录；run.docs 为空时不做豁免。
function runOwnedPaths(run) {
  const docs = run && run.docs;
  if (!docs) return [];
  const owned = Object.values(docs).filter((p) => typeof p === 'string' && p).map((p) => p.replace(/\\/g, '/'));
  if (!owned.length) return [];
  // 任务目录优先取 docs 已落入 workflow/tasks/<task>/ 的前缀（跨日续跑仍指向原目录），
  // 否则按 run 创建日 + topic 还原 taskDirRel 的写法。
  const taskPrefix = owned.map((p) => p.match(/^(workflow\/tasks\/[^/]+\/)/)).find(Boolean);
  if (taskPrefix) owned.push(taskPrefix[1].replace(/\/$/, ''));
  else {
    const date = String(run.createdAt || '').slice(0, 10);
    const topic = run.triage && run.triage.topic;
    if (date && topic) owned.push(`workflow/tasks/${date}-${topic}`);
  }
  return owned;
}

export function checkAuthorized(ctx, run, filesCsv) {
  const listed = String(filesCsv || '').split(/[,，]/).map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
  if (!listed.length) return { ok: false, problems: ['须以 --files 回填本工单实际改动的文件清单（逗号分隔）'] };
  const changed = changedFiles(ctx, run);
  if (changed === null) return { ok: false, problems: ['git status 失败，无法核对改动面'] };
  const beyond = changed.filter((c) =>
    !listed.includes(c) && !isRuntimeOrManaged(ctx, c));
  if (beyond.length) {
    return {
      ok: false,
      problems: [
        `git 改动超出回填清单（偏离即停）：${beyond.join('、')}（若属本工单计划内改动，请将其加入 --files；若是未提交的基线残留，可先 git commit 提交干净基线）`,
      ],
    };
  }
  const section = sectionBody(readDoc(ctx, run.docs?.plan) || '', '改动方案') || '';
  const owned = runOwnedPaths(run);
  const isOwned = (f) => owned.some((o) => f === o || f.startsWith(`${o}/`));
  const extra = filesOutsidePlan(listed, section).filter((c) => !isRuntimeOrManaged(ctx, c) && !isOwned(c));
  run.lastFiles = listed;
  return { ok: true, extra };
}

// locateDeployTarget：deploy 对象定位——--triage topic 显式优先，否则取 workflow/{intents,incidents}
// 最新终态入口（文件名日期序）；同名 spec 存在才纳入（L1 无 spec 合法），plan 恒须同名在位。
// pipeline 任务目录（workflow/tasks/<task>/，仅自动化路径产物）同样纳入候选，spec/plan 在目录内定位。
function locateDeployTarget(ctx, run) {
  const all = [];
  for (const dir of ['intents', 'incidents']) {
    const d = path.join(ctx.root, 'workflow', dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const rel = `workflow/${dir}/${f}`;
      if (['done', 'closed'].includes(docState(ctx, rel))) all.push({ rel, base: f.replace(/\.md$/, '') });
    }
  }
  const tasksDir = path.join(ctx.root, 'workflow', 'tasks');
  if (fs.existsSync(tasksDir)) {
    for (const t of fs.readdirSync(tasksDir)) {
      const tdir = path.join(tasksDir, t);
      if (!fs.existsSync(tdir) || !fs.statSync(tdir).isDirectory()) continue;
      for (const f of ['intent.md', 'incident.md', 'plan.md']) {
        const rel = `workflow/tasks/${t}/${f}`;
        if (!fs.existsSync(path.join(ctx.root, rel))) continue;
        if (['done', 'closed'].includes(docState(ctx, rel))) all.push({ rel, base: t, taskDir: `workflow/tasks/${t}` });
        break;
      }
    }
  }
  if (!all.length) return { entry: null };
  all.sort((a, b) => b.base.localeCompare(a.base));
  const topic = run.triage?.topic && run.triage.topic !== 'task' ? run.triage.topic : null;
  // 复核 P2-C 收紧：topic 须与去日期前缀后的主题段等值——子串匹配会误命中（topic=run 命中 pipeline-run）
  const hit = topic ? all.find((x) => x.base.replace(/^\d{4}-\d{2}-\d{2}-/, '') === topic) : all[0];
  if (!hit) return { entry: null };
  if (hit.taskDir) {
    const specRel = `${hit.taskDir}/spec.md`;
    return {
      entry: hit.rel,
      spec: fs.existsSync(path.join(ctx.root, specRel)) ? specRel : null,
      plan: `${hit.taskDir}/plan.md`,
    };
  }
  const specRel = `workflow/specs/${hit.base}.md`;
  return {
    entry: hit.rel,
    spec: fs.existsSync(path.join(ctx.root, specRel)) ? specRel : null,
    plan: `workflow/plans/${hit.base}.md`,
  };
}

function briefReq(run) { return run.requirement.replace(/\s+/g, ' ').slice(0, 40); }

function kbGate(ctx, run, types) {
  const words = (run.requirement.toLowerCase().match(/[a-z0-9]{2,}/g) || []).slice(0, 2);
  const kw = words.length ? words : [run.requirement.slice(0, 6)];
  const r = runNode(ctx, run, 'kb-search.mjs', [...kw, '--scope', 'workflow', '--type', types, '-n', '6']);
  const hits = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('📄')).slice(0, 6);
  return { exit: r.exit, hits };
}

async function advance(ctx, run, opt) {
  const stepMode = Boolean(opt.step);
  const L = () => run.triage.level;
  const K = () => run.triage.kind;
  const entry = () => run.docs.entry;
  const topic = () => run.triage.topic;

  // {apiDocs} 兜底派生：triage 分支已派生；此处覆盖「引擎升级前创建的旧 run」（triage 不重入），
  // 保证声明即校验契约对存量 run 同样生效（幂等 ||，不覆盖既有值/自定义值）。
  if (run.triage && run.docs) run.docs.apiDocs = run.docs.apiDocs || `${taskDirRel(run)}/api.md`;

  // 断点续跑（R3-5）：上次进程在门执行中被杀 → 记 resume 事件后从同一阶段重入。
  // 产物完整性（R6-2）：resume 事件带 artifacts/missing；缺失由下方产物契约门拦住，不会跳过重跑。
  if (run.inFlight) {
    const stage = run.inFlight.stage;
    const missing = stageArtifactProblems((rel) => readDoc(ctx, rel), stage, run.docs, ctx.pipeline);
    emit(run, {
      type: 'resume', stage, since: run.inFlight.since,
      artifacts: missing.length ? 'missing' : 'complete', ...(missing.length ? { missing } : {}),
    });
    run.inFlight = null;
    saveRun(ctx, run);
  }

  // 失败路由（R6-1）：停机期间 stage 留在失败处，nextTarget 记退回目标；本次从目标阶段重入。
  if (run.nextTarget) {
    emit(run, { type: 'route-enter', from: run.stage, to: run.nextTarget });
    run.stage = run.nextTarget;
    run.nextTarget = null;
    saveRun(ctx, run);
  }

  // 单步恢复：若此前停机在 step 转换边界，记 step-resume 事件
  if (run.stopType === 'step') {
    emit(run, { type: 'step-resume', stage: run.stage });
    saveRun(ctx, run);
  }

  // 工单型停机点的复验（进入对应阶段时先校验上一工单产出）
  while (true) {
    const s = run.stage;

    // 阶段产物契约（R3-5）：先校验本阶段声明的产物，再走阶段逻辑。
    const artifactProblems = stageArtifactProblems((rel) => readDoc(ctx, rel), s, run.docs, ctx.pipeline);
    // 产物缺失是前置条件不满足，不是门拒绝成果：不消耗失败预算、不退回，补回产物后原阶段重跑。
    if (artifactProblems.length) stopGateFail(ctx, run, s, artifactProblems, undefined, { route: false });

    if (s === 'triage') {
      if (!run.triage) {
        if (!opt.triage) {
          issueWO(ctx, run, wo(run, {
            kind: 'triage', title: '判级与分类', goal: '读需求与 new-task.md 判级闭集，输出 kind/level/module/topic',
            instructions: [
              '1. 读 .agents/commands/new-task.md §1 风险定级（L0 极简道 / L1 默认档 / L2 触达面闭集 / L3 结构面）',
              `2. 对需求定级：「${run.requirement}」${run.hint ? `（预判参考：${run.hint}）` : ''}`,
              '3. 回填：next --triage "kind=require|fix|verify|review|deploy level=L0-L3 module=<词表> topic=<英文kebab>"',
            ],
            context: { docPath: '.agents/commands/new-task.md', kbHits: [], stderrTail: '', relatedDocs: ['workflow/INDEX.md'] },
            constraints: ['按 new-task.md §1 定级。命中闭集词就写到该档。'],
            acceptance: ['枚举合法', '级别不低于闭集词要求'],
          }), 'triage');
        }
        const kv = parseKV(opt.triage);
        const problems = validateTriage(ctx, kv);
        problems.push(...touchProblems(run.requirement, kv.level));
        if (problems.length) stopGateFail(ctx, run, 'triage', problems);
        run.triage = { kind: kv.kind, level: kv.level, module: kv.module || moduleList(ctx)[0] || 'general', topic: kv.topic || 'task', decidedBy: run.hint ? 'hint+ai' : 'ai', decidedAt: nowIso() };
        emit(run, { type: 'triage', ...run.triage });
        run.docs = run.docs || { entry: null, spec: null, plan: null };
        // {apiDocs} 声明式占位符：与 intent/spec/plan 同目录族（taskDir 下 api.md），triage 定题后即可派生；
        // 项目触达 API 契约面时自行在 stageArtifacts 声明，模板默认不强制（未声明 = 跳过校验）。
        run.docs.apiDocs = run.docs.apiDocs || `${taskDirRel(run)}/api.md`;
        // 路由
        run.stage = K() === 'verify' ? 'verify' : K() === 'review' ? 'review-only' : K() === 'deploy' ? 'deploy-check'
          : K() === 'fix' ? 'incident-fill' : ((L() === 'L0' || L() === 'L1') ? 'plan-fill' : 'intent-fill');
        if (stepMode) stopStep(ctx, run, run.stage);
        continue;
      }
      run.stage = 'intent-fill';
      if (stepMode) stopStep(ctx, run, run.stage);
      continue;
    }

    if (s === 'intent-fill' || s === 'incident-fill') {
      const isInc = s === 'incident-fill';
      const rel = `${taskDirRel(run)}/${isInc ? 'incident.md' : 'intent.md'}`;
      run.docs.entry = rel;
      const st = docState(ctx, rel);
      if (!st) {
        const kb = kbGate(ctx, run, isInc ? 'incidents,plans' : 'intents,specs,plans');
        run.lastKbHits = kb.hits;
        if (isInc) {
          // incident 无 fill-* 工具：从 _TEMPLATE.md 复制骨架（机器步骤，记事件）
          const tplPath = path.join(ctx.root, 'workflow', 'incidents', '_TEMPLATE.md');
          try {
            fs.mkdirSync(path.dirname(path.join(ctx.root, rel)), { recursive: true });
            fs.copyFileSync(tplPath, path.join(ctx.root, rel));
            emit(run, { type: 'gate', cmd: `cp workflow/incidents/_TEMPLATE.md ${rel}`, exit: 0, ms: 0 });
          } catch (e) { stopGateFail(ctx, run, s, [`incident 模板复制失败：${e.message}`]); }
        } else {
          const r = runNode(ctx, run, 'fill-intent.mjs', ['--module', run.triage.module, '--level', L(), '--topic', topic(), '--output', rel, '--notes', `pipeline-run ${run.runId}`]);
          if (r.exit !== 0) stopGateFail(ctx, run, s, [`fill-intent exit ${r.exit}：${(r.stderr || r.stdout).split(/\r?\n/).slice(-3).join(' | ')}`]);
        }
      }
      run.stage = isInc ? 'incident-draft' : 'intent-draft';
      issueWO(ctx, run, wo(run, {
        kind: 'draft', title: `起草 ${isInc ? 'incident' : 'intent'}：${rel}`, goal: isInc ? '填实事故 4 节 + 复盘三件套' : `填实 intent 各节（${L()} 省节规则见模板注释）`,
        instructions: isInc ? [
          '1. 按模板填：时间线 / 根因 / 为什么没拦住 / 复盘三件套',
          '2. 先查同类：kb-search 命中已附（如有）',
          '3. 完成后回跑 next——脚本校验 frontmatter/节完整/占位符',
        ] : [
          '1. 骨架已由 fill-intent 生成，填实各节正文（背景/教训/目标/非目标/约束/验收）',
          '2. 验收标准逐条可测试（写不出判据=还没想清楚）',
          '3. 查重命中（如有）在「历史教训/防复发」节引用',
          '4. 完成后回跑 next——脚本校验 frontmatter/节完整/占位符',
        ],
        context: { docPath: rel, kbHits: run.lastKbHits || [], stderrTail: '', relatedDocs: ['.agents/commands/stages.md'] },
        constraints: ['只改该文档本身；命名英文 kebab-case；正文不写「状态：/级别：」行'],
        acceptance: ['frontmatter 键完整', '必填节非空（L1 省节合法）', '无模板占位符残留'],
      }), run.stage);
    }

    if (s === 'intent-draft' || s === 'incident-draft') {
      const kind = s === 'incident-draft' ? 'incident' : 'intent';
      const problems = validateDraftContent(readDoc(ctx, entry()), kind, L());
      if (problems.length) stopGateFail(ctx, run, s, problems);
      const text = readDoc(ctx, entry());
      run.stage = kind === 'incident' ? 'incident-confirm' : 'intent-confirm';
      stopConfirm(ctx, run, entry(), summarizeDoc(text), kind !== 'incident');
    }

    if (s === 'intent-confirm' || s === 'incident-confirm') {
      const ledger = s !== 'incident-confirm';
      if (!opt.delegated) stopConfirm(ctx, run, entry(), run.awaitConfirm?.points || summarizeDoc(readDoc(ctx, entry()) || ''), ledger);
      if (ledger) {
        const r = confirmGate(ctx, run, entry(), opt.delegated);
        if (!r.ok) stopGateFail(ctx, run, s, [r.msg]);
      } else {
        emit(run, { type: 'confirm', doc: entry(), to: 'draft-ok', source: 'conversation', quote: opt.delegated });
      }
      run.stage = (L() === 'L0' || L() === 'L1') ? 'plan-fill' : 'spec-fill';
      if (stepMode) stopStep(ctx, run, run.stage);
      continue;
    }

    if (s === 'spec-fill') {
      const rel = `${taskDirRel(run)}/spec.md`;
      run.docs.spec = rel;
      if (!docState(ctx, rel)) {
        const r = runNode(ctx, run, 'fill-spec.mjs', ['--level', L(), '--topic', topic(), '--output', rel]);
        if (r.exit !== 0) stopGateFail(ctx, run, s, [`fill-spec exit ${r.exit}（G1 前置门或参数）：${(r.stderr || r.stdout).split(/\r?\n/).slice(-3).join(' | ')}`]);
      }
      run.stage = 'spec-draft';
      issueWO(ctx, run, wo(run, {
        kind: 'draft', title: `起草 spec：${rel}`, goal: '设计规格 4 节（功能行为/数据流/系统改动/约束遵守映射）',
        instructions: [
          '1. 骨架已由 fill-spec 生成，填实 4 节',
          '2. 约束遵守映射逐条对照根 AGENTS.md 红线，逐条回应',
          '3. 多方案取舍列选项交用户（spec 确认时定）',
          '4. 完成后回跑 next——脚本机器校验',
        ],
        context: { docPath: rel, kbHits: [], stderrTail: '', relatedDocs: ['.agents/commands/stages.md'] },
        constraints: ['只改该文档；页面/交互形态禁止自行推定'],
        acceptance: ['4 节齐全非空', '无占位符残留'],
      }), 'spec-draft');
    }

    if (s === 'spec-draft') {
      const problems = validateDraftContent(readDoc(ctx, run.docs.spec), 'spec', L());
      if (problems.length) stopGateFail(ctx, run, s, problems);
      if (L() === 'L2' || L() === 'L3') {
        run.stage = 'spec-review';
        issueWO(ctx, run, wo(run, {
          kind: 'review', title: `独立复核 spec：${run.docs.spec}`, goal: '另开外部会话或子代理。只读。写入复核行。',
          instructions: [
            '另开外部会话或子代理。只读。',
            '写入一行：- 独立复核：<结论> 复核上下文：<id>',
            'id 取该会话或子代理标识。禁止占位符。',
          ],
          context: { docPath: run.docs.spec, kbHits: [], stderrTail: '', relatedDocs: [] },
          constraints: ['只写「确认与复核」一节。'],
          acceptance: ['复核上下文是外部会话或子代理 id'],
        }), 'spec-review');
      }
      run.stage = 'spec-confirm';
      stopConfirm(ctx, run, run.docs.spec, summarizeDoc(readDoc(ctx, run.docs.spec)), true);
    }

    if (s === 'spec-review') {
      const body = sectionBody(readDoc(ctx, run.docs.spec) || '', '确认与复核') || '';
      const meta = parseReviewMetadata(body);
      if (!meta.id) stopGateFail(ctx, run, s, ['写 - 独立复核：<结论> 复核上下文：<外部会话或子代理 id>。禁止占位符。']);
      if (meta.isDowngraded || opt.reviewDowngrade) {
        emit(run, {
          type: 'review-downgrade',
          stage: s,
          reason: opt.reviewDowngrade || meta.downgradeReason || '跨模型评审自适应降级',
          reviewer: meta.reviewerModel || 'default',
        });
      }
      run.stage = 'spec-confirm';
      stopConfirm(ctx, run, run.docs.spec, summarizeDoc(readDoc(ctx, run.docs.spec)), true);
    }

    if (s === 'spec-confirm') {
      if (!opt.delegated) stopConfirm(ctx, run, run.docs.spec, run.awaitConfirm?.points || '', true);
      const r = confirmOrResume(ctx, run, run.docs.spec, opt.delegated);
      if (!r.ok) stopGateFail(ctx, run, s, [r.msg]);
      run.stage = 'plan-fill';
      if (stepMode) stopStep(ctx, run, run.stage);
      continue;
    }

    if (s === 'plan-fill') {
      const rel = `${taskDirRel(run)}/plan.md`;
      run.docs.plan = rel;
      if ((L() === 'L0' || L() === 'L1') && K() !== 'fix') run.docs.entry = rel;
      if (!docState(ctx, rel)) {
        const r = runNode(ctx, run, 'fill-plan.mjs', ['--level', L(), ...(L() === 'L0' ? ['--lite'] : []), '--topic', topic(), '--output', rel]);
        if (r.exit !== 0) stopGateFail(ctx, run, s, [`fill-plan exit ${r.exit}（G1 前置门或参数）：${(r.stderr || r.stdout).split(/\r?\n/).slice(-3).join(' | ')}`]);
      }
      run.stage = 'plan-draft';
      issueWO(ctx, run, wo(run, {
        kind: 'draft', title: `起草 plan：${rel}`, goal: `计划文档（${(L() === 'L0' || L() === 'L1') ? (L() === 'L0' ? 'L0 极简三节：入口/改动方案/验证与验收' : 'L1 五节：入口/改动方案/约束与风险/验证计划/验收标准') : '完整 4 节：改动方案/任务拆解/执行顺序/验证计划'}）`,
        instructions: [
          '1. 骨架已由 fill-plan 生成，填实各节',
          '2. 改动方案逐文件列「做什么+判据」——后续 implement 工单的授权面以此为准',
          '3. 验证计划对齐入口验收标准',
          '4. 完成后回跑 next——脚本机器校验',
        ],
        context: { docPath: rel, kbHits: [], stderrTail: '', relatedDocs: [(L() === 'L0' || L() === 'L1') && K() !== 'fix' ? '.agents/commands/new-task.md' : '.agents/commands/stages.md'] },
        constraints: ['只改该文档'],
        acceptance: ['节齐全非空', '无占位符残留'],
      }), 'plan-draft');
    }

    if (s === 'plan-draft') {
      const problems = validateDraftContent(readDoc(ctx, run.docs.plan), 'plan', L());
      if (problems.length) stopGateFail(ctx, run, s, problems);
      run.stage = 'plan-confirm';
      stopConfirm(ctx, run, run.docs.plan, summarizeDoc(readDoc(ctx, run.docs.plan)), true);
    }

    if (s === 'plan-confirm') {
      if (!opt.delegated) stopConfirm(ctx, run, run.docs.plan, run.awaitConfirm?.points || '', true);
      const r = confirmOrResume(ctx, run, run.docs.plan, opt.delegated);
      if (!r.ok) stopGateFail(ctx, run, s, [r.msg]);
      // 批次一：入口(+spec)+plan 全 approved → 一笔 docs 提交（配对门要求树内成对）
      // L1 的 entry 就是 plan，去重后只提交一份。
      const files = [...new Set([entry(), run.docs.spec, run.docs.plan].filter(Boolean))];
      const batchLabel = run.docs.spec ? '三件套' : K() === 'fix' ? 'incident+plan' : 'plan';
      const subject = `docs(workflow): ${topic()} ${batchLabel} approved——${briefReq(run)}`;
      const c = docsCommit(ctx, run, files, subject);
      if (!c.ok) stopGateFail(ctx, run, s, [c.msg]);
      run.stage = 'changes-confirm';
      stopConfirm(ctx, run, run.docs.plan, (sectionBody(readDoc(ctx, run.docs.plan) || '', '改动方案') || '').split(/\r?\n/).slice(0, 5).join(' / ').slice(0, 200), false);
    }

    if (s === 'changes-confirm') {
      if (!opt.delegated) stopConfirm(ctx, run, run.awaitConfirm?.doc || '', run.awaitConfirm?.points || '', false);
      emit(run, { type: 'confirm', doc: '改动清单', to: 'ok', source: 'conversation', quote: opt.delegated });
      run.stage = 'implement';
      const planFiles = (readDoc(ctx, run.docs.plan).match(/[\w./-]+\.(?:mjs|md|json|txt|cjs|sh|yml|yaml)/g) || []);
      issueWO(ctx, run, wo(run, {
        kind: 'implement', title: `实现：${briefReq(run)}`, goal: '按 plan 改动方案实现 + 自验',
        instructions: [
          '1. 按 plan §改动方案逐文件实现（判据照条目）',
          '2. 自验：跑 plan §验证计划所列静态门命令',
          '3. 偏离即停：改公共接口/计划外文件/新依赖 → 不做，停机向用户上报',
          '4. 完成后回填改动文件清单：next --files "a.mjs,b.md"',
        ],
        context: { docPath: run.docs.plan, kbHits: [], stderrTail: '', relatedDocs: planFiles.slice(0, 8) },
        constraints: ['只改「改动方案」列出的路径。--files 与 git status 一致。计划外路径停等确认。'],
        acceptance: ['git 改动 ⊆ --files', '--files ⊆ 改动方案，或已 --delegated'],
      }), 'implement');
    }

    if (s === 'implement' || s === 'fix') {
      if (!opt.files) { printRun(ctx, run); process.exit(0); } // 无 --files 重入：重发当前工单（run.workOrder 保留）
      const a = checkAuthorized(ctx, run, opt.files);
      if (!a.ok) stopGateFail(ctx, run, s, a.problems);
      if (a.extra.length && !opt.delegated) {
        stopConfirm(ctx, run, run.docs.plan || '', `计划外：${a.extra.join('、')}。改 plan，或 next --delegated "<原话>" 放行。`, false);
      }
      if (a.extra.length) emit(run, { type: 'confirm', doc: run.docs.plan || '', to: 'files', source: 'conversation', quote: opt.delegated });
      run.stage = 'verify';
      if (stepMode) stopStep(ctx, run, run.stage);
      continue;
    }

    if (s === 'verify') {
      // 并行分支 + 重试（R3-5）：附加门与 verify 并发；--retry 只增加门重跑次数，不掩盖失败。
      const jobs = opt.gate
        ? [{ script: opt.gate, args: [] }]
        : [{ script: 'verify.mjs', args: [] }, ...(opt.parallel || [])];
      if (opt.interactiveGate) {
        console.log(`\n[门禁交互] 准备执行门: ${jobs.map((j) => j.script).join(' + ')} (阶段: ${s}, retry: ${opt.retry || 0})`);
        if (process.stdin.isTTY) {
          process.stdout.write('  按回车键继续执行门禁...');
          const buf = Buffer.alloc(1);
          try { fs.readSync(0, buf, 0, 1); } catch {}
          console.log('');
        }
      }
      const r = await runGateGroup(ctx, run, s, jobs, opt.retry || 0);
      if (opt.gate && opt.gate !== 'verify.mjs') {
        if (r.exit === 0) {
          console.log(`\n✅ 定向门 ${opt.gate} 验证通过 (exit 0)`);
          emit(run, { type: 'gate-tested', script: opt.gate, exit: 0 });
          saveRun(ctx, run);
          printRun(ctx, run);
          process.exit(0);
        } else {
          console.error(`\n❌ 定向门 ${opt.gate} 验证未通过 (exit ${r.exit})`);
          emit(run, { type: 'gate-tested', script: opt.gate, exit: r.exit });
          saveRun(ctx, run);
          printRun(ctx, run, [`定向门 ${opt.gate} 验证未通过 (exit ${r.exit})`]);
          process.exit(2);
        }
      }
      if (K() === 'verify') { // verify-only 短路径：不带修复环，绿即收、败即停
        if (r.exit === 0) stopDone(ctx, run);
        stopGateFail(ctx, run, s, ['verify 未过（verify-only 不带修复环——人工处理后重跑，或立正式任务走闭环）'], undefined, { route: false });
      }
      if (r.exit === 0) {
        run.retries = { ...(run.retries || {}), [s]: 0 };
        // 代码提交（沙箱演练实证的缺口，2026-10-02）：verify 绿后、复核/关单前落一笔——
        // 文件集 = 当前非运行态、非 workflow 文档的改动（均已过 --files 授权核对）
        const codeFiles = (changedFiles(ctx, run) || []).filter((c) =>
          !RUNTIME_OWNED.some((ro) => (ro.endsWith('/') ? c.startsWith(ro) : c === ro)) && !c.startsWith('workflow/'));
        if (codeFiles.length) {
          const verb = K() === 'fix' ? 'fix' : 'feat';
          const c = docsCommit(ctx, run, codeFiles, `${verb}(${run.triage.module}): ${briefReq(run)}（pipeline-run ${run.runId}）`);
          if (!c.ok) stopGateFail(ctx, run, s, [c.msg]);
        }
        run.stage = (L() === 'L2' || L() === 'L3') ? 'review' : 'closeout';
        if (stepMode) stopStep(ctx, run, run.stage);
        continue;
      }
      const { to, retry } = failRoute(ctx.pipeline, s);
      const attempt = (run.retries?.[s] || 0) + 1;
      const tail = (r.stderr || r.stdout).split(/\r?\n/).filter(Boolean).slice(-20).join('\n');
      const analysis = analyzeGateFailure(r.stderr || r.stdout, { stage: s, docPath: run.docs?.plan });
      if (attempt >= retry) {
        stopGateFail(ctx, run, s, [retry > 0
          ? `修复环超限（${retry} 次）——人工介入或 abort`
          : 'verify 未过（该阶段未声明失败路由——人工处理后重跑 next）']);
      }
      bumpRetry(run, s);
      // 退回事件与 stopGateFail（L380）同语义：verify→fix 走本专用分支不经 stopGateFail，
      // 不补则 run 事件账本看不到路由历史（条目 37，2026-11-18 实测发现）。
      emit(run, { type: 'route', from: s, to, attempt, cap: retry });
      run.stage = to;
      const fixRelatedDocs = Array.from(new Set([
        ...analysis.impactedFiles,
        ...(run.docs?.plan ? [run.docs.plan] : []),
      ])).slice(0, 8);
      const fixInstructions = [
        ...(analysis.category !== 'unknown' ? [
          `0. [智能归因]: ${analysis.title} - ${analysis.suggestedAction}`,
          ...(analysis.debugCmd ? [`   [定向调试]: ${analysis.debugCmd}`] : []),
        ] : []),
        '1. 读下方「上次门失败输出」定位失败项',
        '2. 修复（授权面仍以 plan 为准，偏离即停）',
        '3. 完成后回填：next --files "…"（脚本重核对改动面并重跑 verify）',
      ];
      issueWO(ctx, run, wo(run, {
        kind: 'fix', title: `修复环 ${attempt}/${retry}：verify 未过`, goal: '按失败输出修复后回跑',
        instructions: fixInstructions,
        context: { docPath: run.docs.plan, kbHits: [], stderrTail: tail, relatedDocs: fixRelatedDocs },
        constraints: ['不绕门不改门；不 --no-verify'],
        acceptance: ['git 改动 ⊆ 回填清单', 'verify.mjs 重跑全绿'],
        fixAnalysis: analysis,
      }), to);
    }

    if (s === 'review') {
      const target = run.docs.spec || entry();
      const body = sectionBody(readDoc(ctx, target) || '', '确认与复核') || '';
      const meta = parseReviewMetadata(body);
      if (!meta.id) {
        stopGateFail(ctx, run, s, ['写 - 独立复核：<结论> 复核上下文：<外部会话或子代理 id>。禁止占位符。']);
      }
      if (meta.isDowngraded || opt.reviewDowngrade) {
        emit(run, {
          type: 'review-downgrade',
          stage: s,
          reason: opt.reviewDowngrade || meta.downgradeReason || '跨模型评审自适应降级',
          reviewer: meta.reviewerModel || 'default',
        });
      }
      run.stage = K() === 'fix' ? 'closeout' : 'closeout';
      if (stepMode) stopStep(ctx, run, run.stage);
      continue;
    }

    if (s === 'closeout') {
      if (K() !== 'fix') {
        const co = closeoutComplete(readDoc(ctx, entry()) || '');
        if (!co.ok) {
          issueWO(ctx, run, wo(run, {
            kind: 'closeout', title: `勾验收补证据：${entry()}`, goal: '关单前逐条勾验入口文档验收标准并补证据',
            instructions: [
              '1. 逐条核验「## 验收标准」：达成改 [x] 并补「（证据：<commit SHA/测试名/输出>）」',
              '2. 未达成的不得勾——如实留 [ ] 并在下方说明',
              '3. 完成后回跑 next（脚本校验全勾+证据在）',
            ],
            context: { docPath: entry(), kbHits: [], stderrTail: '', relatedDocs: [run.docs.plan].filter(Boolean) },
            constraints: ['只改入口文档验收节；证据须真实（SHA/用例名/命令输出）'],
            acceptance: ['验收行全 [x] 且每条含 证据：'],
          }), 'closeout');
        }
      }
      run.stage = K() === 'fix' ? 'incident-fixed-confirm' : 'done-confirm';
      stopConfirm(ctx, run, entry(), '关单确认（done）——逐份原话', true);
    }

    if (s === 'done-confirm' || s === 'incident-fixed-confirm' || s === 'incident-closed-confirm') {
      const finalize = () => {
        runNode(ctx, run, 'gen-workflow-index.mjs', []);
        const files = [...new Set([entry(), run.docs.spec, run.docs.plan].filter(Boolean))]
          .map((f) => resolveDocRel(ctx, f));
        const c = docsCommit(ctx, run, [...files, 'workflow/INDEX.md'], `docs(workflow): ${topic()} 关单——终态落定（pipeline-run ${run.runId}）`);
        if (!c.ok) stopGateFail(ctx, run, s, [c.msg]);
        stopDone(ctx, run);
      };
      const pendOf = () => {
        const pend = [];
        if (K() === 'fix') {
          const st = docState(ctx, entry());
          if (!['fixed', 'closed'].includes(st)) pend.push(entry());
          if (st === 'fixed') pend.push(entry()); // 两跳：fixed 之后还需 closed
          if (run.docs.plan && !TERMINAL.includes(docState(ctx, run.docs.plan))) pend.push(run.docs.plan);
        } else {
          for (const rel of [...new Set([entry(), run.docs.spec, run.docs.plan].filter(Boolean))]) {
            if (!TERMINAL.includes(docState(ctx, rel))) pend.push(rel);
          }
        }
        return pend;
      };
      const label = K() === 'fix' ? 'incident 两跳（open→fixed→closed）与 plan 关单' : 'done 关单';
      const pend0 = pendOf();
      if (!pend0.length) finalize();
      if (!opt.delegated) stopConfirm(ctx, run, pend0[0], `${label}——逐份原话，一次一份（余 ${pend0.length} 份）`, true);
      const r = confirmGate(ctx, run, pend0[0], opt.delegated);
      if (!r.ok) stopGateFail(ctx, run, s, [r.msg]);
      const rest = pendOf(); // 一次一份：确认成功即停机，下一份须新原话（confirm-gate-one-per-call 教训）
      if (!rest.length) finalize();
      stopConfirm(ctx, run, rest[0], `${label}——逐份原话，一次一份（余 ${rest.length} 份）`, true);
    }

    if (s === 'verify-only') {
      run.stage = 'verify';
      if (stepMode) stopStep(ctx, run, run.stage);
      continue;
    }
    if (s === 'review-only') {
      if (opt.done) stopDone(ctx, run); // 评审清单交付即收（宿主向用户汇报后回填 --done）
      issueWO(ctx, run, wo(run, {
        kind: 'review', title: '横切评审', goal: '按 .agents/commands/review.md 产出 P0/P1/P2 分级清单交用户定性',
        instructions: ['1. 读 review.md 与评审对象', '2. 机器兜底项先跑门，AI 自查项列清单', '3. 结论交用户定性与合入时机'],
        context: { docPath: '.agents/commands/review.md', kbHits: [], stderrTail: '', relatedDocs: [] },
        constraints: ['只读评审；定性归用户'],
        acceptance: ['清单产出（P0/P1/P2 分级）'],
      }), 'review-only');
    }

    if (s === 'deploy-check') {
      // 复核 P1-2 补实现（2026-10-02 用户拍板）：deploy-prep 工单 + 三件 done 机器校验（spec §功能行为 deploy-prep 变体）
      const target = locateDeployTarget(ctx, run);
      if (!target.entry) stopGateFail(ctx, run, s, ['找不到可上线的对象——workflow/{intents,incidents} 无终态（done/closed）入口；或以 --triage topic=<主题> 显式指定。注：deploy 面向 L2/L3 入口（deploy.md §2 配对检查口径），L1 plan 交付不走上线管线。']);
      run.deployTarget = target;
      issueWO(ctx, run, wo(run, {
        kind: 'deploy-prep', title: `上线清单核对：${target.entry}`, goal: '回归清单人工核对 + 三件同名 done 机器校验，全过到授权点',
        instructions: [
          '1. 核对 workflow/regression-checklist.md 回归必过条目（活文档）',
          '2. 抽查最近历史 incident 的防复发条目',
          '3. 完成后回跑 next——脚本机器校验：check-loop 门 + 三件同名 done',
          '4. 全过停授权点；打 tag 由宿主按 git 纪律执行（脚本不代办）',
        ],
        context: { docPath: 'workflow/regression-checklist.md', kbHits: [], stderrTail: '', relatedDocs: [target.entry, target.spec, target.plan].filter(Boolean) },
        constraints: ['只读核对；发现缺口停机上报，不带病上线'],
        acceptance: ['check-loop 门 exit 0（脚本执行）', '三件同名 done：入口+spec（如有）+plan 全终态（脚本执行）'],
      }), 'deploy-prep');
    }

    if (s === 'deploy-prep') {
      const t = run.deployTarget;
      const r = runNode(ctx, run, 'check-loop.mjs', []);
      if (r.exit !== 0) stopGateFail(ctx, run, s, ['check-loop 未过——文档闭环有断档，先补齐再谈上线']);
      const gaps = [];
      const entrySt = docState(ctx, t.entry);
      if (!['done', 'closed'].includes(entrySt)) gaps.push(`${t.entry}（${entrySt || '缺失'}——须 done/closed）`);
      if (t.spec) {
        const st = docState(ctx, t.spec);
        if (st !== 'done') gaps.push(`${t.spec}（${st || '缺失'}——须 done）`);
      }
      const planSt = docState(ctx, t.plan);
      if (planSt !== 'done') gaps.push(`${t.plan}（${planSt || '缺失'}——须 done）`);
      if (gaps.length) stopGateFail(ctx, run, s, [`三件同名 done 未满足（spec §校验规则 deploy-prep 行）：${gaps.join('；')}`]);
      run.stage = 'deploy-await';
      stopConfirm(ctx, run, '', `上线授权——对象 ${t.entry}（仅用户本人；tag 由宿主按 git 纪律执行，脚本不代办）`, false);
    }

    if (s === 'deploy-await') {
      if (!opt.delegated) stopConfirm(ctx, run, '', `上线授权——对象 ${run.deployTarget?.entry || ''}：用户明确说「上」后回跑 next --delegated "<原话>"；打 tag 由宿主执行`, false);
      emit(run, { type: 'confirm', doc: 'deploy', to: 'authorized', source: 'conversation', quote: opt.delegated });
      stopDone(ctx, run);
    }

    if (s === 'done') stopDone(ctx, run);
    fail(`未知阶段：${s}（run 文件可能损坏——status --adopt 重建，或删 run 重来）`, 1);
  }
}

// ── 子命令 ─────────────────────────────────────────────────────────────
const BOOL_FLAGS = new Set(['adopt', 'json', 'done', 'once', 'step', 'interactive-gate', 'inspect']); // 复核 P2-5：布尔旗标不吞下一参
function parseArgs(argv) {
  const out = { cmd: argv[0], positional: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (BOOL_FLAGS.has(k)) {
        out[k] = true;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          out[k] = next;
          i++;
        } else {
          out[k] = true;
        }
      }
    } else out.positional.push(a);
  }
  return out;
}

function resolveRun(ctx, a) {
  const id = a.run || latestRunId(ctx);
  if (!id) fail('无活跃 run——先 start "<需求原文>"');
  const run = loadRun(ctx, id);
  if (!run) fail(`run 文件不存在或损坏：${id}（status --adopt 可按文档现状重建）`);
  return run;
}

const isMain = process.argv[1] && process.argv[1].endsWith('pipeline-run.mjs');
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  const ctx = ctxEnv();
  const cmd = a.cmd;

  if (cmd === 'start') {
    const req = a.positional[0];
    if (!req) fail('start 必填需求原文：start "<需求>" [--hint "kind=… level=… module=…"]');
    const runId = newRunId(req);
    const run = {
      runId, requirement: req, hint: a.hint || '', createdAt: nowIso(), updatedAt: nowIso(),
      triage: null, stage: 'triage', stopType: 'work-order', workOrder: null, awaitConfirm: null,
      retries: {}, nextTarget: null, docs: { entry: null, spec: null, plan: null },
      lastKbHits: [], lastFiles: [], events: [],
    };
    emit(run, { type: 'run-created', requirement: req });
    saveRun(ctx, run);
    await advance(ctx, run, { step: a.step === true }); // 首停机点 = triage 工单
  } else if (cmd === 'next' || cmd === 'resume') {
    const run = resolveRun(ctx, a);
    if (cmd === 'resume' && !run.inFlight) {
      console.log(`无断点可续：run ${run.runId} 未处于中断态（stage=${run.stage} stopType=${run.stopType}）`);
      process.exit(0);
    }
    if (run.stopType === 'done' || run.stopType === 'aborted') { printRun(ctx, run); process.exit(0); }
    await advance(ctx, run, {
      triage: typeof a.triage === 'string' ? a.triage : undefined,
      delegated: typeof a.delegated === 'string' ? a.delegated : undefined,
      files: typeof a.files === 'string' ? a.files : undefined,
      parallel: typeof a.parallel === 'string' ? usage(() => parseParallelList(a.parallel)) : [],
      retry: usage(() => parseRetryCap(a.retry)),
      done: a.done === true,
      step: a.step === true,
      gate: typeof a.gate === 'string' ? usage(() => parseGateName(a.gate)) : undefined,
      interactiveGate: a['interactive-gate'] === true,
      reviewDowngrade: typeof a['review-downgrade'] === 'string'
        ? a['review-downgrade']
        : (a['review-downgrade'] === true ? '跨模型评审自适应降级' : undefined),
    });
  } else if (cmd === 'status') {
    if (a.adopt) { adoptRun(ctx, a); process.exit(0); }
    const run = resolveRun(ctx, a);
    if (a.json) { console.log(JSON.stringify(run, null, 2)); process.exit(0); }
    printRun(ctx, run);
    console.log(`\n事件流水（${run.events.length}）：`);
    for (const e of run.events) {
      const bits = [e.t.slice(11, 19), e.type];
      if (e.cmd) bits.push(`${e.cmd.slice(0, 70)}${e.exit !== 0 ? ` [exit ${e.exit}]` : ''}`);
      if (e.doc) bits.push(e.doc);
      if (e.quote) bits.push(`原话「${e.quote.slice(0, 30)}」`);
      if (e.subject) bits.push(e.subject.slice(0, 50));
      if (e.type === 'retry') bits.push(`attempt ${e.attempt}/${e.cap} exit ${e.exit}`);
      if (e.type === 'resume') bits.push(`from ${e.stage}`);
      if (e.type === 'step-pause') bits.push(`paused at ${e.stage}`);
      if (e.type === 'step-resume') bits.push(`resumed at ${e.stage}`);
      if (e.type === 'gate-tested') bits.push(`tested ${e.script} exit ${e.exit}`);
      if (e.type === 'review-downgrade') bits.push(`[评审降级] ${e.reason || ''}${e.reviewer ? ` (${e.reviewer})` : ''}`);
      if (e.parallel) bits.push(e.parallel);
      if (e.id) bits.push(`#${e.id}`);
      console.log('  ' + bits.join(' | '));
    }
    process.exit(0);
  } else if (cmd === 'watch' || cmd === 'dashboard') {
    const interval = Math.max(1, Number(a.interval) || 2);
    const once = Boolean(a.once);
    let filterMode = typeof a.filter === 'string' && ['all', 'active', 'attention'].includes(a.filter)
      ? a.filter
      : 'all';
    let viewMode = a.inspect ? 'inspect' : 'dashboard';
    let inspectTarget = typeof a.inspect === 'string' ? a.inspect : (a.positional[0] || undefined);
    let scrollOffset = 0;

    let runList = listAllRuns(ctx, filterMode);
    if (!runList.length && filterMode !== 'all') {
      filterMode = 'all';
      runList = listAllRuns(ctx, filterMode);
    }
    if (!runList.length) {
      console.log('无 run');
      process.exit(0);
    }

    let activeIndex = 0;
    if (a.run) {
      const idx = runList.findIndex((r) => r.runId === a.run);
      if (idx >= 0) activeIndex = idx;
    } else {
      const latest = latestRunId(ctx);
      if (latest) {
        const idx = runList.findIndex((r) => r.runId === latest);
        if (idx >= 0) activeIndex = idx;
      }
    }

    const run = runList[activeIndex] || runList[0];

    if (once) {
      const opts = {
        width: Math.max(60, Math.min(100, process.stdout.columns || 80)),
        now: nowIso(),
        once: true,
        target: inspectTarget,
        selector: runList.length > 1 ? { current: activeIndex + 1, total: runList.length, filter: filterMode } : undefined,
      };
      const lines = viewMode === 'inspect'
        ? renderInspect(ctx, run, opts)
        : renderDashboard(ctx, run, opts);
      console.log(lines.join('\n'));
      process.exit(0);
    }

    const render = () => {
      const freshList = listAllRuns(ctx, filterMode);
      if (freshList.length) {
        runList = freshList;
        if (activeIndex >= runList.length) activeIndex = Math.max(0, runList.length - 1);
      }
      const currentRun = runList[activeIndex] || run;
      const opts = {
        width: Math.max(60, Math.min(100, process.stdout.columns || 80)),
        now: nowIso(),
        interval,
        target: inspectTarget,
        scrollOffset,
        selector: { current: activeIndex + 1, total: runList.length, filter: filterMode },
      };
      const lines = viewMode === 'inspect'
        ? renderInspect(ctx, currentRun, opts)
        : renderDashboard(ctx, currentRun, opts);
      if (process.stdout.isTTY) {
        process.stdout.write('\x1b[H' + lines.join('\n') + '\n\x1b[J');
      } else {
        console.log(lines.join('\n'));
      }
    };

    const cleanup = () => {
      if (process.stdout.isTTY) {
        process.stdout.write('\x1b[?25h');
      }
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        try { process.stdin.setRawMode(false); } catch {}
        process.stdin.pause();
      }
    };

    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('exit', () => cleanup());

    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[?25l\x1b[2J\x1b[H');
    }

    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (key) => {
        if (key === '\u0003' || key === 'q' || key === 'Q') {
          cleanup();
          process.exit(0);
        } else if (key === 'r' || key === 'R') {
          render();
        } else if (key === 'v' || key === 'V') {
          viewMode = viewMode === 'dashboard' ? 'inspect' : 'dashboard';
          scrollOffset = 0;
          render();
        } else if (key === '\u001b' || key === 'b' || key === 'B') {
          if (viewMode === 'inspect') {
            viewMode = 'dashboard';
            scrollOffset = 0;
            render();
          }
        } else if (key === 'w' || key === 'W') {
          viewMode = 'inspect';
          inspectTarget = 'work-order';
          scrollOffset = 0;
          render();
        } else if (key === 'p' || key === 'P') {
          viewMode = 'inspect';
          inspectTarget = 'problems';
          scrollOffset = 0;
          render();
        } else if (key === '1') {
          if (viewMode === 'inspect') { inspectTarget = 'entry'; scrollOffset = 0; render(); }
        } else if (key === '2') {
          if (viewMode === 'inspect') { inspectTarget = 'spec'; scrollOffset = 0; render(); }
        } else if (key === '3') {
          if (viewMode === 'inspect') { inspectTarget = 'plan'; scrollOffset = 0; render(); }
        } else if (key === '4') {
          if (viewMode === 'inspect') { inspectTarget = 'work-order'; scrollOffset = 0; render(); }
        } else if (key === '5') {
          if (viewMode === 'inspect') { inspectTarget = 'problems'; scrollOffset = 0; render(); }
        } else if (key === '\t') {
          if (viewMode === 'inspect') {
            const currentRun = runList[activeIndex] || run;
            const avail = getAvailableTargets(ctx, currentRun);
            const curIdx = avail.indexOf(inspectTarget || avail[0]);
            const nextIdx = (curIdx + 1) % avail.length;
            inspectTarget = avail[nextIdx];
            scrollOffset = 0;
            render();
          } else if (runList.length > 1) {
            activeIndex = (activeIndex + 1) % runList.length;
            render();
          }
        } else if (key === '\u001b[B' || key === 'j' || key === 'J') {
          if (viewMode === 'inspect') {
            scrollOffset += 3;
            render();
          }
        } else if (key === '\u001b[A' || key === 'k' || key === 'K') {
          if (viewMode === 'inspect') {
            scrollOffset = Math.max(0, scrollOffset - 3);
            render();
          }
        } else if (key === 'g') {
          if (viewMode === 'inspect') {
            scrollOffset = 0;
            render();
          }
        } else if (key === '\u001b[D' || key === 'h' || key === 'H' || key === '[') {
          if (runList.length > 1) {
            activeIndex = (activeIndex - 1 + runList.length) % runList.length;
            render();
          }
        } else if (key === '\u001b[C' || key === 'l' || key === 'L' || key === 'n' || key === 'N' || key === ']') {
          if (runList.length > 1) {
            activeIndex = (activeIndex + 1) % runList.length;
            render();
          }
        } else if (key === 'f' || key === 'F') {
          const filters = ['all', 'active', 'attention'];
          const nextIdx = (filters.indexOf(filterMode) + 1) % filters.length;
          filterMode = filters[nextIdx];
          const filtered = listAllRuns(ctx, filterMode);
          if (filtered.length) {
            runList = filtered;
            activeIndex = 0;
          }
          render();
        } else if (key === 'a' || key === 'A') {
          filterMode = 'all';
          const all = listAllRuns(ctx, 'all');
          if (all.length) {
            runList = all;
            activeIndex = 0;
          }
          render();
        }
      });
    }

    render();
    setInterval(render, interval * 1000);
  } else if (cmd === 'inspect') {
    const run = resolveRun(ctx, a);
    const target = a.positional[0] || a.target;
    const maxLines = a['max-lines'] !== undefined ? Number(a['max-lines']) : 0;
    if (a.json) {
      const art = inspectArtifact(ctx, run, target);
      console.log(JSON.stringify(art, null, 2));
      process.exit(0);
    }
    const lines = renderInspect(ctx, run, {
      width: Math.max(60, Math.min(100, process.stdout.columns || 80)),
      target,
      maxLines,
      once: true,
    });
    console.log(lines.join('\n'));
    process.exit(0);
  } else if (cmd === 'abort') {
    if (!a.run) fail('abort 必填 --run <id>');
    const run = loadRun(ctx, a.run);
    if (!run) fail(`run 不存在：${a.run}`);
    const to = a.to === true ? 'cancelled' : (a.to || 'cancelled');
    if (!['superseded', 'cancelled'].includes(to)) fail('--to 须为 superseded|cancelled');
    const manual = [];
    const flipped = [];
    for (const rel of [run.docs?.entry, run.docs?.spec, run.docs?.plan].filter(Boolean)) {
      const st = docState(ctx, rel);
      if (['approved'].includes(st)) {
        const r = confirmGate(ctx, run, rel, typeof a.delegated === 'string' ? a.delegated : '', to);
        if (r.ok) flipped.push(rel); else manual.push(rel);
      }
    }
    if (flipped.length) {
      runNode(ctx, run, 'gen-workflow-index.mjs', []); // 复核 P2-3：提交前重生成，防陈旧索引入库
      const c = docsCommit(ctx, run, [...flipped, 'workflow/INDEX.md'], `docs(workflow): ${run.triage?.topic || 'task'} 放弃——${to}`);
      if (!c.ok) console.log('⚠️ 放弃态 docs 提交失败（可手工补交）');
    }
    run.stopType = 'aborted';
    run.abort = { to, note: manual.length ? `以下文档须用户终端亲跑 confirm-doc --to ${to}：${manual.join('、')}` : '' };
    emit(run, { type: 'abort', to });
    saveRun(ctx, run);
    printRun(ctx, run);
    process.exit(0);
  } else if (cmd === 'gate') {
    const run = resolveRun(ctx, a);
    const script = a.positional[0] || a.gate;
    if (!script) fail('gate 必填门脚本名：flow-kit run pipeline-run.mjs gate <script.mjs> [--run <id>]');
    const gateName = usage(() => parseGateName(script));
    const scriptPath = path.join(ctx.bin, gateName);
    if (!fs.existsSync(scriptPath)) fail(`门脚本不存在：${gateName}（预期位置: ${scriptPath}）`);
    const cap = usage(() => parseRetryCap(a.retry));
    console.log(`\n🔍 开始执行单门调试: ${gateName} (run: ${run.runId}, stage: ${run.stage}, retryCap: ${cap})...`);
    const r = await runGateGroup(ctx, run, `${run.stage}-gate-debug`, [{ script: gateName, args: [] }], cap);
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.exit === 0) {
      console.log(`\n✅ 门 ${gateName} 验证通过 (exit 0)`);
      process.exit(0);
    } else {
      console.error(`\n❌ 门 ${gateName} 验证未通过 (exit ${r.exit})`);
      process.exit(2);
    }
  } else {
    fail(`未知命令：${cmd ?? ''}（start | next | status | watch | dashboard | inspect | abort | gate，用法见文件头注释）`);
  }
}

// ── adopt：run 文件丢失/损坏时按文档现状重建（尽力而为，非权威仲裁） ──
function adoptRun(ctx, a) {
  const id = a.run || latestRunId(ctx);
  if (!id) fail('无可 adopt 的 run id');
  const topic = (id.split('-').slice(2, -1).join('-')) || 'task';
  const find = (dir) => {
    const d = path.join(ctx.root, 'workflow', dir);
    if (!fs.existsSync(d)) return null;
    const hit = fs.readdirSync(d).map((f) => f.replace(/\.md$/, '')).filter((b) => b.includes(topic) && !b.startsWith('_'))
      .sort().pop();
    return hit ? `workflow/${dir}/${hit}.md` : null;
  };
  const entry = find('intents') || find('incidents');
  const spec = find('specs');
  const plan = find('plans');
  if (!entry && !plan) fail(`按 topic「${topic}」未找到任何 workflow 文档——无法重建`);
  const run = {
    runId: id, requirement: `(adopted ${nowIso()}——原需求原文已不可考，见 git 历史)`, hint: '', createdAt: nowIso(), updatedAt: nowIso(),
    triage: { kind: entry && entry.includes('incidents') ? 'fix' : 'require', level: 'L1', module: 'pipeline', topic, decidedBy: 'adopt', decidedAt: nowIso() },
    stage: 'adopted', stopType: 'work-order', workOrder: null, awaitConfirm: null, retries: {}, nextTarget: null,
    docs: { entry, spec, plan }, lastKbHits: [], lastFiles: [], events: [{ t: nowIso(), type: 'adopt', entry, spec, plan }],
  };
  saveRun(ctx, run);
  console.log(`✅ 已重建 run ${id}（stage=adopted）——文档现状：`);
  for (const [k, rel] of Object.entries(run.docs)) if (rel) console.log(`  ${k}: ${rel}（${docState(ctx, rel) || '缺失'}）`);
  console.log('  提示：adopt 不推断断点位置——按文档现状人工续走（next 会按 stage 拒绝，请对照事件缺失情况手动接续或另起 run）');
}

export default { parseKV, validateDraftContent, closeoutComplete, placeholdersIn, stageBar, renderDashboard, stripAnsi, visualWidth, truncate, truncateAnsi, parseGateName, pruneWorkOrderContext, listAllRuns, renderMarkdown, inspectArtifact, getAvailableTargets, renderInspect, analyzeGateFailure, manifestPristine, isRuntimeOrManaged, checkAuthorized };
