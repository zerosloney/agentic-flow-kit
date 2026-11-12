#!/usr/bin/env node
// dream-run — 离线梦境最小审计（2026-11-11，对照 Anthropic《The components of agent memory》）
// 定位：可手动/定时触发的只读审计编排器。不发明新判定，只编排现有脚本完成「离线梦境」
//   职能：修剪陈旧(A) / 拓扑修复(B) / Judge 对账(C) / 错类候选(D) / 记忆负债(E) /
//   冷数据候选(E2) / 主张依据(G，只报告 quote 还在不在) / 经验回放(H，会话摘要) /
//   记忆表示(I，memory-wiki) / 注入层预算与上浮候选(J) / 交付结果指标(K)，
//   末尾追加 AI Judge 阶段(F)：抽取活跃 workflow 文档 + git 历史 + 确认/验证台账证据，
//   生成抽样审计简报（tmp/dream-judge-brief-<date>.md），交由主智能体在下个会话委托
//   independent-reviewer 角色核验——脚本只做采样与证据收集，判断由 AI 执行。
//
// 用法：
//   node .agents/scripts/dream-run.mjs                     # dry-run：只读审计 + AI 抽样简报
//   node .agents/scripts/dream-run.mjs --execute           # 执行安全修复（仅归档 + 重生成索引）
//   node .agents/scripts/dream-run.mjs --report <path>     # 自定义报告路径（默认 tmp/dream-report-<date>.md）
//   node .agents/scripts/dream-run.mjs --judge-count <N>   # AI 抽样文档数（默认 3，0 = 跳过）
//   node .agents/scripts/dream-run.mjs --no-judge          # 跳过 AI Judge 阶段
//
// 安全边界：
//   - 默认 dry-run 零写操作；--execute 只做「终态件归档 + 索引重生成」，不改写任何文档内容
//   - 不自动 commit / push（根 AGENTS.md 禁令）；报告落 tmp/（gitignore）
//   - 错类合并、指纹异常等需判断项只出候选，由主智能体/用户处置
// 单源口径：全部阶段复用现有脚本，无新台账、新规则、新常驻成本；所有 spawn 带 windowsHide
//   （Windows 无控制台父进程派生控制台子进程会闪窗，见 runtime-env.md §6.4）。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recheckClaims } from './claims.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CHECK_LOOP_ROOT || path.resolve(SCRIPT_DIR, '..', '..');
const TMP_DIR = path.join(ROOT, 'tmp');

// ---------- 参数解析 ----------
const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const NO_JUDGE = args.includes('--no-judge');
const reportIdx = args.indexOf('--report');
const REPORT_PATH = reportIdx >= 0 && args[reportIdx + 1]
  ? path.resolve(ROOT, args[reportIdx + 1])
  : path.join(TMP_DIR, `dream-report-${today()}.md`);
const judgeIdx = args.indexOf('--judge-count');
const JUDGE_COUNT = judgeIdx >= 0 ? Number.parseInt(args[judgeIdx + 1], 10) : 3;
if (Number.isNaN(JUDGE_COUNT) || JUDGE_COUNT < 0) {
  console.error('--judge-count 须为非负整数');
  process.exit(2);
}

// ---------- 工具 ----------
function today() {
  return new Date().toISOString().slice(0, 10);
}

function run(relScript, scriptArgs = [], opts = {}) {
  const r = spawnSync('node', [relScript, ...scriptArgs], {
    encoding: 'utf8',
    cwd: ROOT,
    windowsHide: true,
    ...opts,
  });
  if (r.error) return { ok: false, out: '', err: r.error.message, status: -1 };
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || ''), status: r.status };
}

function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', cwd: ROOT, windowsHide: true, ...opts });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const lines = [];
const add = (s = '') => lines.push(s);
const indent = (s, pad = '  ') => String(s).split('\n').map((l) => `${pad}${l}`).join('\n');
const section = (t) => { lines.push(`\n## ${t}\n`); };

// 非终态即活跃：intents/specs/plans 终态 = done/superseded/cancelled；incidents 终态 = closed
const TERMINAL = new Set(['done', 'superseded', 'cancelled', 'closed']);
const DOC_TYPES = ['intents', 'specs', 'plans', 'incidents'];

// ---------- 阶段 A：终态件归档 ----------
section('A. 终态件归档（archive-sweep --window 21）');
const sweep = run(path.join('.agents', 'scripts', 'archive-sweep.mjs'),
  ['--window', '21', ...(EXECUTE ? ['--execute'] : [])]);
add(sweep.ok ? sweep.out.trim() : `⚠ archive-sweep 失败: ${sweep.err || sweep.out}`);

// ---------- 阶段 B：索引漂移 ----------
section('B. 索引漂移（--execute 时重生成）');
for (const [name, gen] of [
  ['workflow-index', '.agents/scripts/gen-workflow-index.mjs'],
  ['engine-map', '.agents/scripts/gen-engine-map.mjs'],
]) {
  const check = run(gen, ['--check']);
  if (check.ok) {
    add(`- ${name}: 一致`);
  } else {
    add(`- ${name}: 漂移\n  ${check.out.split('\n').filter(Boolean).slice(0, 10).join('\n  ')}`);
    if (EXECUTE) {
      const regen = run(gen, []);
      add(regen.ok ? '  → 已重生成' : `  → 重生成失败: ${regen.err || regen.out}`);
    } else {
      add('  → 待重生成（--execute）');
    }
  }
}
const wiki = run('.agents/scripts/verify-wiki-consistency.mjs', []);
add(wiki.ok ? '- wiki: 三方一致' : `- wiki: 不一致\n  ${wiki.out.split('\n').filter(Boolean).slice(0, 10).join('\n  ')}`);

// ---------- 阶段 C：全量对账（只报告） ----------
section('C. 全量对账（CHECK_LOOP_FULL=1，hard 6 段）');
const loop = run('.agents/scripts/check-loop.mjs', [], { env: { ...process.env, CHECK_LOOP_FULL: '1' } });
if (loop.ok) {
  add('- check-loop: 全绿');
} else {
  add(`- check-loop: 退出码 ${loop.status}（有阻断/告警）`);
  const blk = loop.out.split('\n').filter((l) => /BLOCK|block/i.test(l)).slice(0, 15);
  if (blk.length) add(`  BLOCK 摘要:\n  ${blk.join('\n  ')}`);
  add('  明细: node .agents/scripts/check-loop.mjs（或 tmp/check-loop-warn.log）');
}

// ---------- 阶段 D：错类候选（只报告，沿用 papercut-fix §0 阈值 ≥3 次） ----------
section('D. 错类候选（agg-judgments --retire-candidates）');
const cand = run('.agents/scripts/agg-judgments.mjs', ['--retire-candidates']);
add(cand.ok ? cand.out.trim() : `⚠ 候选统计失败: ${cand.err || cand.out}`);

// ---------- 阶段 E：常驻面预算（只报告） ----------
section('E. 常驻面预算（rule-budget --all）');
const budget = run('.agents/scripts/rule-budget.mjs', ['--all']);
add(budget.ok ? '- 预算: OK' : `- 预算超限:\n  ${budget.out.split('\n').filter(Boolean).slice(0, 10).join('\n  ')}`);

// ---------- 阶段 E2：冷数据候选（只报告，agg-kb-usage --stale-days 90） ----------
section('E2. 冷数据候选（agg-kb-usage --stale-days 90）');
const cold = run('.agents/scripts/agg-kb-usage.mjs', ['--stale-days', '90']);
add(cold.ok ? cold.out.trim() : `⚠ 冷数据统计失败: ${cold.err || cold.out}`);

// ---------- 阶段 G：主张依据（只报告，不写账） ----------
section('G. 主张依据（claims recheck，只报告）');
let claimRecheck = { held: 0, broken: 0, results: [] };
try {
  claimRecheck = recheckClaims(ROOT);
  add(`- held ${claimRecheck.held} / broken ${claimRecheck.broken}`);
  const broken = claimRecheck.results.filter((r) => r.status === 'broken');
  for (const row of broken) add(`- broken ${row.id} ${row.path}: ${row.reason}`);
  if (broken.length === 0) add('- 无断依据');
} catch (err) {
  add(`⚠ 主张核对失败: ${err.message}`);
}

// ---------- 阶段 H：经验回放（会话日志 → 摘要） ----------
section('H. 经验回放（session-log digest --days 7）');
const digestPath = path.join(TMP_DIR, `session-digest-${today()}.md`);
const sess = run('.agents/scripts/session-log.mjs', ['digest', '--days', '7', '--out', path.relative(ROOT, digestPath)]);
if (sess.ok) {
  add(`- 摘要: ${path.relative(ROOT, digestPath)}`);
  try {
    const excerpt = fs.readFileSync(digestPath, 'utf8').split(/\r?\n/).slice(0, 12).filter(Boolean);
    if (excerpt.length) add(indent(excerpt.join('\n'), '    '));
  } catch { /* 摘要读不到不影响其余阶段 */ }
  add('  （无日志时摘要会明确写“无输入”——dreaming 不能把“没有经验”当成“没有错误”）');
} else {
  add(`⚠ 会话摘要失败: ${sess.err || sess.out}`);
}

// ---------- 阶段 I：记忆表示（memory-wiki） ----------
section('I. 记忆表示（memory-wiki --check）');
const mw = run('.agents/scripts/memory-wiki.mjs', ['--check']);
if (mw.ok) {
  add('- memory-wiki: 一致');
} else {
  add(`- memory-wiki: 漂移\n  ${mw.out.split('\n').filter(Boolean).slice(0, 8).join('\n  ')}`);
  if (EXECUTE) {
    const regen = run('.agents/scripts/memory-wiki.mjs', []);
    add(regen.ok ? '  → 已重生成' : `  → 重生成失败: ${regen.err || regen.out}`);
  } else {
    add('  → 待生成（--execute）');
  }
}

// ---------- 阶段 J：注入层预算与上浮候选 ----------
section('J. 注入层预算与上浮候选（memory-tier）');
const tierAudit = run('.agents/scripts/memory-tier.mjs', ['audit']);
add(tierAudit.ok ? '- 注入层: 在预算内' : `- 注入层超限:\n  ${tierAudit.out.split('\n').filter(Boolean).slice(0, 6).join('\n  ')}`);
const tierSuggest = run('.agents/scripts/memory-tier.mjs', ['suggest', '--days', '90']);
add(tierSuggest.ok ? tierSuggest.out.trim() : `⚠ 上浮候选失败: ${tierSuggest.err || tierSuggest.out}`);

// ---------- 阶段 K：交付结果指标 ----------
section('K. 交付结果指标（outcome-metrics --days 30）');
const om = run('.agents/scripts/outcome-metrics.mjs', ['--days', '30']);
if (om.ok) {
  add(om.out.split('\n').slice(0, 18).join('\n'));
} else {
  add(`⚠ 指标聚合失败: ${om.err || om.out}`);
}

// ---------- 阶段 F：AI Judge 抽样简报 ----------
let judgeBriefPath = '';
if (!NO_JUDGE && JUDGE_COUNT > 0) {
  section('F. AI Judge 抽样审计');
  judgeBriefPath = path.join(TMP_DIR, `dream-judge-brief-${today()}.md`);
  const sample = collectJudgeSamples(JUDGE_COUNT);
  if (sample.docs.length === 0) {
    add('- 无活跃 workflow 文档，跳过抽样');
  } else {
    writeJudgeBrief(judgeBriefPath, sample, claimRecheck);
    add(`- 已抽取 ${sample.docs.length} 份活跃文档，证据简报: ${path.relative(ROOT, judgeBriefPath)}`);
    add('- 下一步: 主智能体读取简报，按末尾模板委托 independent-reviewer 核验');
  }
}

// ---------- 报告落盘 ----------
fs.mkdirSync(TMP_DIR, { recursive: true });
const header = `# 离线梦境审计报告 ${today()}\n> 生成: node .agents/scripts/dream-run.mjs${EXECUTE ? ' --execute' : ''}（默认 dry-run）\n`;
fs.writeFileSync(REPORT_PATH, header + lines.join('\n') + '\n', 'utf8');
console.log(`报告已写入 ${path.relative(ROOT, REPORT_PATH)}`);
if (judgeBriefPath && fs.existsSync(judgeBriefPath)) {
  console.log(`AI Judge 简报已写入 ${path.relative(ROOT, judgeBriefPath)}`);
}

// ---------- 阶段 F 辅助：采样与证据收集 ----------

function collectJudgeSamples(maxCount) {
  const docs = [];
  for (const type of DOC_TYPES) {
    const dir = path.join(ROOT, 'workflow', type);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const p = path.join(dir, f);
      const raw = fs.readFileSync(p, 'utf8');
      const fm = parseFrontmatter(raw);
      if (!fm) continue;
      const status = fm['状态'] || '';
      if (TERMINAL.has(status)) continue;
      docs.push({
        type,
        file: f,
        path: p,
        status,
        date: fm['日期'] || fm['发现'] || '',
        module: fm['模块'] || '',
        level: fm['级别'] || '',
        title: (raw.match(/^#\s+(.+)$/m) || [])[1] || f,
        body: raw,
      });
    }
  }
  // 老活优先（最可能沉淀过期/错误笔记）
  docs.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  return { docs: docs.slice(0, maxCount) };
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fm;
}

function extractSections(raw) {
  const KEYS = ['背景', '目标', '非目标', '根因', '为什么没拦住', '复盘三件套', '复盘', '验收标准', '影响面'];
  const out = [];
  const bodyLines = raw.split(/\r?\n/);
  for (let i = 0; i < bodyLines.length; i++) {
    const m = bodyLines[i].match(/^##{1,3}\s+(.+)$/);
    if (!m) continue;
    const h = m[1].trim();
    if (!KEYS.some((k) => h.includes(k))) continue;
    const block = [];
    for (let j = i + 1; j < bodyLines.length; j++) {
      if (/^##{1,3}\s+/.test(bodyLines[j])) break;
      block.push(bodyLines[j]);
    }
    const text = block.join('\n').trim();
    if (text) out.push(`### ${h}\n${text}`);
  }
  return out;
}

function gatherEvidence(doc) {
  const ev = [];
  // L1 transcripts：git 历史
  const log = git(['log', '--oneline', '-8', '--', doc.path]);
  if (log.ok && log.out) ev.push(`### git 历史（近 8 条）\n${log.out}`);

  // 确认台账（分片优先 + 主台账按文档基名检索）
  const base = path.basename(doc.path, '.md');
  let conf = '';
  const shard = path.join(ROOT, '.agents', 'confirmations.d', `${base}.jsonl`);
  if (fs.existsSync(shard)) conf += fs.readFileSync(shard, 'utf8');
  const main = path.join(ROOT, '.agents', 'confirmations.jsonl');
  if (fs.existsSync(main)) {
    conf += fs.readFileSync(main, 'utf8').split(/\r?\n/).filter((l) => l.includes(base)).join('\n');
  }
  const confRows = conf.split(/\r?\n/).filter(Boolean);
  if (confRows.length) ev.push(`### 确认台账\n${confRows.slice(0, 6).join('\n')}`);

  // 验证流水（同名检索，可能有）
  const verif = path.join(ROOT, '.agents', 'verifications.jsonl');
  if (fs.existsSync(verif)) {
    const rows = fs.readFileSync(verif, 'utf8').split(/\r?\n/).filter((l) => l.includes(base));
    if (rows.length) ev.push(`### 验证流水（同名命中 ${rows.length} 行，示 3）\n${rows.slice(0, 3).join('\n')}`);
  }
  return ev;
}

function writeJudgeBrief(briefPath, sample, claimRecheck = { results: [] }) {
  const parts = [];
  parts.push(`# AI Judge 抽样审计简报 ${today()}`);
  parts.push('');
  parts.push('> 由 dream-run.mjs 阶段 F 生成：抽样活跃 workflow 文档 + 原始证据（git 历史 / 确认台账 / 验证流水）。');
  parts.push('> 判断由主智能体委托 independent-reviewer 角色执行，本简报只做采样与证据收集。');
  parts.push('');
  sample.docs.forEach((doc, i) => {
    parts.push('---');
    parts.push('');
    parts.push(`## 样本 ${i + 1}: ${doc.title}`);
    parts.push('');
    parts.push(`- 路径: workflow/${doc.type}/${doc.file}`);
    parts.push(`- 状态: ${doc.status} ｜ 级别: ${doc.level || '-'} ｜ 日期: ${doc.date || '-'} ｜ 模块: ${doc.module || '-'}`);
    const secs = extractSections(doc.body);
    if (secs.length) parts.push('', secs.join('\n\n'));
    const ev = gatherEvidence(doc);
    if (ev.length) parts.push('', ev.join('\n\n'));
  });
  const brokenClaims = (claimRecheck.results || []).filter((r) => r.status === 'broken');
  if (brokenClaims.length) {
    parts.push('');
    parts.push('## 主张依据已断');
    parts.push('');
    parts.push('> 脚本只核对原文还在不在。断了不等于主张为假，还在也不等于主张为真。');
    parts.push('');
    for (const row of brokenClaims) {
      parts.push(`- ${row.id} \`${row.path}\`: ${row.reason}`);
      parts.push(`  主张: ${row.claim}`);
    }
  }
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('## Judge 委托模板');
  parts.push('');
  parts.push('以下内容供主智能体复制给 independent-reviewer：');
  parts.push('```text');
  parts.push(`任务：核验以下 ${sample.docs.length} 份活跃 workflow 文档的声明是否被证据支持。`);
  parts.push('范围：本简报中的全部样本。');
  parts.push('方法：');
  parts.push('1. 逐份读文档正文（workflow/<type>/<file> 原始文件）；');
  parts.push('2. 对照 git 历史、确认台账（.agents/confirmations.d/ 与 confirmations.jsonl）、验证流水（verifications.jsonl）；');
  parts.push('3. 重点核验「验收标准」勾验声明、incident 的根因与复盘陈述、plan 的验证计划引用；');
  parts.push('4. 输出：每份文档给出 BLOCK（证据不支持/矛盾）/ WARN（证据缺失或过期）/ OK，附 file:line 与证据指针。');
  parts.push('约束：只读不改；不确定写「数据不足」，禁止编造证据。');
  parts.push('```');
  fs.mkdirSync(path.dirname(briefPath), { recursive: true });
  fs.writeFileSync(briefPath, parts.join('\n') + '\n', 'utf8');
}