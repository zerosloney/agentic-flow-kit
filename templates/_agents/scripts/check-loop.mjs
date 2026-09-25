#!/usr/bin/env node
// check-loop: AI-Native 闭环骨架断档扫描（agentic-flow-kit 通用版；2026-09-26 check-loop-node 自 POSIX sh 全量迁移 node）
// 扫描 workflow/ 目录,输出 intent/spec/plan 配对、模板字段占位符、incidents 复盘三件套、新 intent 回路等断档。
// 迁移背景:sh 版为规避 MSYS fork 开销引入 awk 预扫临时文件 + fd 3/4 与 glob 序逐行对齐的隐式契约
//   （重排循环/加 continue 即静默错位）、四处临时文件无 trap 清理——node 为 kit 硬依赖,双语言实现面纯负担。
// 判定语义/消息文案/exit 语义与 sh 版逐条对齐（check-loop.test.mjs 37+ 场景为对齐安全网）；
//   输出 banner 保留「check-loop.sh」字样为稳定输出契约（doctor 按 WARN 行计数、pre-push 按 exit 码判定）。
// 旧入口 check-loop.sh 为 4 行兼容 shim（exec node 本文件）——.githooks/pre-push 与文档引用零改动继续有效。
//
// 严重性分级（沿用）:
//   - hard-block(阻断 push / CI):配对断裂 + 回路断档（影响三件套可追溯性与闭环电路）
//   - warning(打印提示,exit 0):其余卫生项（状态未确认 / 模板占位残留 / 引用漂移 / Adapter 一致性等）
// 违例输出到 stderr 并 exit 1；只剩警告时 exit 0。
//
// 检查项清单（编号/标题/severity 逐条沿 sh 版头部——gate-checklist 配对登记表按 id 消费，不得增删改号）:
//   1. 入口文档/spec/plan 同名配对(L1 必须有 plan;L2/L3 必须有 spec+plan)        [hard-block]
//   2. 模板字段占位符残留(YYYY-MM-DD / <主题> 等未替换)                             [warning]
//   3. incidents 复盘三件套完整性 + 状态严格枚举 + 新 intent 回路(回路断档=hard,其他=warning)
//   4. 引用有效性(文档/指令中引用的 .agents/ 路径必须存在)                          [warning]
//   5. intent/spec/plan 状态字段 + L3 独立复核                                       [warning]
//   6. 子智能体角色契约 + OpenCode/Trae/ZCode Adapter 一致性(含旧委派残留/钉死模型)  [warning]
//   7. 阶段索引同步(AGENTS.md 与 new-task.md 须双向索引全部阶段指令)                [warning]
//   8. intent 验收标准对账(2026-09-12 起新建:done 未勾验/缺节=hard,勾选缺证据=warning;存量聚合 warning,含「存量对账豁免」声明者出账)
//   9. 文件名英文 kebab-case(非 ASCII 文件名=warning,2026-09-11 规则)
//  10. 级别 vs 迁移文件一致性(L1/L2 入口文档加入提交触及迁移 SQL/Migrations=疑似判低,warning)
//  11. workflow/INDEX.md 漂移(活跃层索引与磁盘不一致=warning,2026-09-21 检索层;调生成器 --check,口径单一)
//  12. frontmatter「模块:」合法性(枚举非法 / 2026-09-22 起新建缺字段=warning;词表单源 .agents/workflow-modules.txt)
//  13. 常驻面体积预算(超限=warning;判定单源 rule-budget.sh——经 sh 调用,
//      无 sh 环境静默跳过:advisory 级且 pre-commit 侧在 git 钩子 sh 环境照常硬拦)
//  14. 新 done 的 spec/plan 须在 git 历史里出现过 `状态: approved`(确认环节留痕,2026-09-22;恒 advisory 永不升级 hard)
//
// 注：清单条目 5（状态字段+L3 复核）与 1（配对）在同一遍 intents/specs/plans 循环里实现（沿 sh 版代码结构）；
//    条目 6 的旧委派残留/钉死模型子项在「角色契约与 Adapter」代码段实现。
//
// 运行模式:CHECK_LOOP_ROOT 注入 fixture 根(全扫不过滤,非 git 时检查 10/14 跳过);
//   缺省 = git 仓库根(不在 git 仓库内 stderr 提示后 exit 0 跳过);仓库模式只扫已提交(HEAD)内容
//   (并行会话未跟踪半成品不拦别人的 push;ls-tree 失败退化为全扫,门禁不失效)。
// 文档协议:机器字段一律由文件头 YAML frontmatter(受限子集:每行 `键: 值`)承载,本脚本只扫 frontmatter 取字段;
//   叙述性字段(独立复核/复盘三件套/验收勾验)按正文行锚定。枚举单源 .agents/workflow-enums.txt
//   (缺文件/缺键 fail-loud exit 1;经 workflow-enums.mjs 读取,CRLF 天然容忍)。
// 已确认状态: approved/done=已批或闭环; superseded/cancelled=放弃留档(仍算确认,不挡 push); incident: fixed/closed
// 用法:node .agents/scripts/check-loop.mjs   （或经 check-loop.sh shim）
// 测试:node templates/_agents/scripts/check-loop.test.mjs（fixture 注入 CHECK_LOOP_ROOT）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnums } from './workflow-enums.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---- 根目录与枚举单源 ----
let ROOT;
if (process.env.CHECK_LOOP_ROOT) {
  ROOT = path.resolve(process.env.CHECK_LOOP_ROOT);
  if (!fs.existsSync(ROOT)) {
    console.error('check-loop: CHECK_LOOP_ROOT 不可访问:' + process.env.CHECK_LOOP_ROOT);
    process.exit(1);
  }
} else {
  const top = gitOut(['rev-parse', '--show-toplevel']);
  if (top === null) {
    console.error('check-loop: 不在 git 仓库内,跳过扫描');
    process.exit(0);
  }
  ROOT = top.trim();
}
// 枚举单源（<root>/.agents/workflow-enums.txt——fixture 契约：缺文件/缺键 fail-loud）
let ENUMS;
try {
  ENUMS = loadEnums(path.join(ROOT, '.agents', 'workflow-enums.txt'));
} catch (e) {
  const msg = String(e.message || '');
  if (msg.includes('不可读')) {
    console.error(`check-loop: 缺 ${path.join('.agents', 'workflow-enums.txt')}(枚举单源)——跑 flow-kit sync 恢复后重试`);
  } else {
    console.error('check-loop: 枚举单源 ' + msg);
  }
  process.exit(1);
}
const inSet = (v, arr) => arr.includes(v);
const stOkDoc = (st) => inSet(st, ENUMS['doc.status.confirmed']);

// git 调用（参数数组形式不走 shell——Windows cmd 不认单引号；git.exe 显式解析沿 doctor 先例）
function gitOut(args, { ok = () => true } = {}) {
  const r = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', args,
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error || r.status !== 0 || !ok(r)) return null;
  return r.stdout || '';
}

// ---- frontmatter 受限子集读取（fm_get 语义：首行 --- 进入、下一 --- 闭合、键在行首、首个命中、值两侧去空白）----
const fileLinesCache = new Map();
function linesOf(file) {
  if (!fileLinesCache.has(file)) {
    try { fileLinesCache.set(file, fs.readFileSync(file, 'utf8').split(/\r?\n/)); }
    catch { fileLinesCache.set(file, null); }
  }
  return fileLinesCache.get(file);
}
function fmGet(file, key) {
  const lines = linesOf(file);
  if (!lines) return '';
  const isDelim = (l) => /^---\s*$/.test(l);
  if (!isDelim(lines[0] || '')) return '';
  for (let i = 1; i < lines.length; i++) {
    if (isDelim(lines[i])) return '';
    if (lines[i].startsWith(key + ':')) return lines[i].slice(key.length + 1).trim();
  }
  return '';
}

const WF = 'workflow';
const DOC_DIRS = ['intents', 'specs', 'plans', 'incidents'];
const blockers = [];
const warnings = [];

// ---- 已提交(HEAD)过滤：仓库模式只扫 tracked（fixture 模式恒真；ls-tree 失败退化全扫）----
let trackedSet = null; // null = 不过滤
if (!process.env.CHECK_LOOP_ROOT) {
  const out = gitOut(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'workflow']);
  if (out !== null) trackedSet = new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
}
const isTracked = (abs) => trackedSet === null || trackedSet.has(path.relative(ROOT, abs).split(path.sep).join('/'));
const docFiles = (sub) => {
  const dir = path.join(ROOT, WF, sub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && /^\d/.test(f))
    .map((f) => path.join(dir, f))
    .filter((f) => isTracked(f))
    .sort();
};

// --- 1. intent/spec/plan 同名配对 + 状态确认 + L3 确认三件 [hard-block] ---
for (const intent of docFiles('intents')) {
  const base = path.basename(intent);
  const st = fmGet(intent, '状态');
  const lvl = fmGet(intent, '级别');
  if (!stOkDoc(st)) {
    const msg = `${base}（frontmatter 状态键当前值:『${st || '缺失'}』）`;
    if (lvl === 'L3') blockers.push(`- [状态未确认] L3 intent 必须为 approved/done/superseded/cancelled:${msg}`);
    else warnings.push(`- [WARN 状态未确认] intent 必须为 approved/done/superseded/cancelled:${msg}`);
  }
  if (lvl === 'L2' || lvl === 'L3') {
    if (!fs.existsSync(path.join(ROOT, WF, 'specs', base))) {
      blockers.push(`- [配对断裂] intent 缺 spec:${base}（应在 ${WF}/specs/ 下同名）`);
    }
  }
  if (!fs.existsSync(path.join(ROOT, WF, 'plans', base))) {
    blockers.push(`- [配对断裂] intent 缺 plan:${base}（应在 ${WF}/plans/ 下同名）`);
  }
}

for (const spec of docFiles('specs')) {
  const base = path.basename(spec);
  const st = fmGet(spec, '状态');
  const lvl = fmGet(spec, '级别');
  const hasEntry = fs.existsSync(path.join(ROOT, WF, 'intents', base)) || fs.existsSync(path.join(ROOT, WF, 'incidents', base));
  if (!hasEntry) blockers.push(`- [配对断裂] spec 缺 intent/incident:${base}（应在 ${WF}/intents/ 或 ${WF}/incidents/ 下同名）`);
  if (!stOkDoc(st)) {
    const msg = `${base}（frontmatter 状态键当前值:『${st || '缺失'}』）`;
    if (lvl === 'L3') blockers.push(`- [状态未确认] L3 spec 必须为 approved/done/superseded/cancelled:${msg}`);
    else warnings.push(`- [WARN 状态未确认] spec 必须为 approved/done/superseded/cancelled:${msg}`);
  }
  // L3 确认三件：确认结果/确认时间读 frontmatter；独立复核按正文行锚定（放弃件豁免 = 枚举单源 abandoned 集）
  if (lvl === 'L3' && !inSet(st, ENUMS['doc.status.abandoned'])) {
    if (fmGet(spec, '确认结果') !== 'approved') blockers.push(`- [L3 确认缺失] ${base} 确认结果必须为 approved`);
    if (!fmGet(spec, '确认时间')) blockers.push(`- [L3 确认缺失] ${base} 必须记录确认时间`);
    if (!(linesOf(spec) || []).some((l) => /^- 独立复核：[ \t]*[^<\s]/.test(l))) {
      blockers.push(`- [L3 复核缺失] ${base} 必须记录新会话独立复核结论`);
    }
  }
}

for (const plan of docFiles('plans')) {
  const base = path.basename(plan);
  const st = fmGet(plan, '状态');
  const lvl = fmGet(plan, '级别');
  const hasEntry = fs.existsSync(path.join(ROOT, WF, 'intents', base)) || fs.existsSync(path.join(ROOT, WF, 'incidents', base));
  if (!hasEntry) blockers.push(`- [配对断裂] plan 缺 intent/incident:${base}（应在 ${WF}/intents/ 或 ${WF}/incidents/ 下同名）`);
  if (!stOkDoc(st)) {
    const msg = `${base}（frontmatter 状态键当前值:『${st || '缺失'}』）`;
    if (lvl === 'L3') blockers.push(`- [状态未确认] L3 plan 必须为 approved/done/superseded/cancelled:${msg}`);
    else warnings.push(`- [WARN 状态未确认] plan 必须为 approved/done/superseded/cancelled:${msg}`);
  }
}

// --- 2. 模板字段占位符残留 [warning]（排除运行时文件名格式与协议样板，口径沿 sh 版）---
{
  const phRe = /YYYY-MM-DD|<主题>|<日期 主题>|L0 \/ L1 \/ L2 \/ L3|draft \/ approved \/ done|open \/ fixed \/ closed/;
  const boilerRe = /\.\.\/specs\/[A-Za-z0-9-]*\.md|写明如何满足|防复发验证|_YYYY-MM-DD\.|format\('YYYY-MM-DD'\)|value-format="YYYY-MM-DD"/;
  const groups = new Map(); // file -> [ "行号:内容" ]（首现序）
  for (const sub of DOC_DIRS) {
    for (const f of docFiles(sub)) {
      const hits = [];
      (linesOf(f) || []).forEach((line, i) => {
        if (phRe.test(line) && !boilerRe.test(line)) hits.push(`${i + 1}:${line}`);
      });
      if (hits.length) groups.set(f, hits);
    }
  }
  for (const [f, hits] of groups) {
    warnings.push(`- [WARN 模板未填] ${path.relative(ROOT, f).split(path.sep).join('/')} 含模板占位符:\n${hits.join('\n')}`);
  }
}

// --- 3. incidents 复盘三件套 + 状态严格枚举 + 新 intent 回路（回路断档 = hard）---
for (const inc of docFiles('incidents')) {
  const name = path.basename(inc);
  const lines = linesOf(inc) || [];
  const incLvl = fmGet(inc, '级别');
  const incSt = fmGet(inc, '状态');

  if (!inSet(incSt, ENUMS['incident.status.all'])) {
    warnings.push(`- [WARN 状态非法] incident 状态必须为 open/fixed/closed:${name}（frontmatter 状态键当前值:『${incSt || '缺失'}』）`);
  }

  if (fmGet(inc, '流程') !== 'legacy') {
    if (!inSet(incLvl, ENUMS['level.all'])) {
      warnings.push(`- [WARN 级别缺失] ${name} 必须填写 L0/L1/L2/L3（配对检查已跳过——补级别后重跑本脚本校验配对）`);
    } else {
      if (['L1', 'L2', 'L3'].includes(incLvl) && !fs.existsSync(path.join(ROOT, WF, 'plans', name))) {
        blockers.push(`- [配对断裂] incident 缺 plan:${name}（应在 ${WF}/plans/ 下同名）`);
      }
      if (['L2', 'L3'].includes(incLvl) && !fs.existsSync(path.join(ROOT, WF, 'specs', name))) {
        blockers.push(`- [配对断裂] incident 缺 spec:${name}（应在 ${WF}/specs/ 下同名）`);
      }
    }
  }

  // 三件套：正文行锚定 /^1\. /^2\. /^3\. （sh awk 同款）
  for (const n of [1, 2, 3]) {
    if (!lines.some((l) => l.startsWith(`${n}. `))) {
      warnings.push(`- [WARN 三件套不全] ${name} 缺复盘三件套之 ${n}`);
    }
  }
  const hasParent = lines.some((l) => l.includes('是否需要新 intent'));
  if (!hasParent) {
    warnings.push(`- [WARN 三件套不全] ${name} 缺「是否需要新 intent」子项`);
    continue;
  }
  const yesLine = lines.find((l) => l.includes('是 → '));
  if (yesLine) {
    const m = yesLine.match(/intents\/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-[^ )]*\.md/);
    const ref = m ? m[0] : null;
    if (!ref) blockers.push(`- [回路断档] ${name} 选「是」但未指明 intent 文件路径`);
    else if (!fs.existsSync(path.join(ROOT, WF, ref))) blockers.push(`- [回路断档] ${name} 引用的 intent 不存在:${ref}`);
  }
}

// --- 4. 引用有效性 [warning]（.agents/ 路径须存在；skills 特例允许用户级 ~/.agents/skills）---
{
  const refRe = /\.agents\/(commands|hooks|scripts|skills|roles)\/[A-Za-z0-9_][A-Za-z0-9_./-]*/g;
  const files = [];
  if (fs.existsSync(path.join(ROOT, 'AGENTS.md'))) files.push('AGENTS.md');
  for (const e of readdirOrNull(ROOT) || []) {
    const p = path.join(ROOT, e, 'AGENTS.md');
    if (isDirectoryOrNull(path.join(ROOT, e)) && fs.existsSync(p)) files.push(path.join(e, 'AGENTS.md'));
  }
  for (const f of readdirOrNull(path.join(ROOT, WF)) || []) {
    if (f.endsWith('.md')) files.push(`${WF}/${f}`); // workflow 根级 *.md（README 等）
  }
  for (const sub of DOC_DIRS) {
    const dir = path.join(ROOT, WF, sub);
    for (const f of readdirOrNull(dir) || []) {
      if (f.endsWith('.md') && (f === '_TEMPLATE.md' || /^\d/.test(f))) files.push(`${WF}/${sub}/${f}`);
    }
  }
  const cmdDir = path.join(ROOT, '.agents', 'commands');
  for (const f of readdirOrNull(cmdDir) || []) {
    if (f.endsWith('.md')) files.push(`.agents/commands/${f}`);
  }
  for (const rel of files) {
    const text = linesOf(path.join(ROOT, rel));
    if (!text) continue;
    const seen = new Set();
    for (const line of text) {
      for (const m of line.matchAll(refRe)) {
        const ref = m[0];
        if (seen.has(ref)) continue;
        seen.add(ref);
        if (fs.existsSync(path.join(ROOT, ref))) continue;
        if (ref.startsWith('.agents/skills/') && fs.existsSync(path.join(process.env.HOME || process.env.USERPROFILE || '', ref))) continue;
        warnings.push(`- [WARN 引用断档] ${rel.split(path.sep).join('/')} 引用不存在的文件:${ref}`);
      }
    }
  }
}

// --- 5. 子智能体角色契约 + 宿主 Adapter 一致性 + 旧委派残留 + 钉死模型 [warning] ---
{
  const cmdFiles = () => (readdirOrNull(path.join(ROOT, '.agents', 'commands')) || [])
    .filter((f) => f.endsWith('.md')).map((f) => `.agents/commands/${f}`);
  const textOf = (rel) => linesOf(path.join(ROOT, rel)) || [];
  for (const role of ['implementer', 'independent-reviewer', 'ui-verifier']) {
    const rolePath = `.agents/roles/${role}.md`;
    if (!fs.existsSync(path.join(ROOT, rolePath))) {
      warnings.push(`- [WARN 角色缺失] 公共角色契约不存在:${rolePath}`);
      continue;
    }
    if (fs.existsSync(path.join(ROOT, '.opencode', 'agents'))) {
      const p = `.opencode/agents/${role}.md`;
      if (!fs.existsSync(path.join(ROOT, p))) warnings.push(`- [WARN Adapter 缺失] OpenCode 缺 ${role}:${p}`);
      else {
        if (!/^mode:\s*subagent\s*$/m.test(textOf(p).join('\n'))) warnings.push(`- [WARN Adapter 无效] OpenCode ${role} 未声明 mode:subagent:${p}`);
        if (!textOf(p).some((l) => l.includes(rolePath))) warnings.push(`- [WARN Adapter 断线] OpenCode ${role} 未引用公共角色:${rolePath}`);
      }
    }
    if (fs.existsSync(path.join(ROOT, '.trae', 'agents'))) {
      const p = `.trae/agents/${role}.md`;
      if (!fs.existsSync(path.join(ROOT, p))) warnings.push(`- [WARN Adapter 缺失] Trae 缺 ${role}:${p}`);
      else {
        if (!new RegExp(`^name:\\s*${role}\\s*$`, 'm').test(textOf(p).join('\n'))) warnings.push(`- [WARN Adapter 无效] Trae ${role} 的 name 与文件名不一致:${p}`);
        if (!textOf(p).some((l) => l.includes(rolePath))) warnings.push(`- [WARN Adapter 断线] Trae ${role} 未引用公共角色:${rolePath}`);
      }
    }
    const zc = `.zcode/agents/${role}.md`;
    if (fs.existsSync(path.join(ROOT, zc))) { // 本地配置不入 git：缺失不告警，存在时校验一致性
      if (!new RegExp(`^name:\\s*["']?${role}["']?\\s*$`, 'm').test(textOf(zc).join('\n'))) warnings.push(`- [WARN Adapter 无效] ZCode ${role} 的 name 与文件名不一致:${zc}`);
      if (!textOf(zc).some((l) => l.includes(rolePath))) warnings.push(`- [WARN Adapter 断线] ZCode ${role} 未引用公共角色:${rolePath}`);
    }
    const cited = ['AGENTS.md', ...cmdFiles()].some((f) => textOf(f).some((l) => l.includes(rolePath)));
    if (!cited) warnings.push(`- [WARN 命令断线] 工作流未引用公共角色:${rolePath}`);
  }
  // 旧委派残留 / 钉死模型（grep -nH 行格式 file:line:content）
  const legacyRe = /(^subagent:|subagent_type=|general_purpose_task|browser_use)/;
  const legacyHits = [];
  for (const f of ['AGENTS.md', ...cmdFiles()]) {
    textOf(f).forEach((l, i) => { if (legacyRe.test(l)) legacyHits.push(`${f}:${i + 1}:${l}`); });
  }
  if (legacyHits.length) warnings.push(`- [WARN 旧委派残留] 主规则或阶段命令仍含宿主特定/旧委派声明:\n${legacyHits.join('\n')}`);
  const modelHits = [];
  for (const h of ['.opencode', '.trae', '.zcode']) {
    for (const f of readdirOrNull(path.join(ROOT, h, 'agents')) || []) {
      if (!f.endsWith('.md')) continue;
      const rel = `${h}/agents/${f}`;
      textOf(rel).forEach((l, i) => { if (/^model:/.test(l) && !/^model:\s*inherit/.test(l)) modelHits.push(`${rel}:${i + 1}:${l}`); });
    }
  }
  if (modelHits.length) warnings.push(`- [WARN 宿主耦合] 薄 Adapter 不应固定模型:\n${modelHits.join('\n')}`);
}

// --- 6. 阶段索引同步 [warning] ---
for (const cmd of ['plan', 'design', 'build', 'test', 'deploy', 'maintain', 'review']) {
  for (const doc of ['AGENTS.md', '.agents/commands/new-task.md']) {
    const text = linesOf(path.join(ROOT, doc));
    if (text && !text.some((l) => l.includes(`.agents/commands/${cmd}.md`))) {
      warnings.push(`- [WARN 阶段索引漂移] ${doc} 缺 ${cmd} 指令索引(两处阶段表须同步维护)`);
    }
  }
}

// --- 8. intent 验收标准对账（done 须逐条勾验并补证据；2026-09-12 起新建 hard，存量聚合 warning）---
{
  const accCutoff = '2026-09-12';
  let legacyUnaccounted = 0;
  for (const intent of docFiles('intents')) {
    if (fmGet(intent, '状态') !== 'done') continue;
    const base = path.basename(intent);
    const lines = linesOf(intent) || [];
    // 节扫描：hs=有验收节；insec 至下一个二级标题；uc=未勾项；ne=勾选缺证据；ex=存量豁免声明
    let hs = false, uc = false, ne = false;
    let insec = false, ex = false;
    for (const line of lines) {
      if (/存量对账豁免（/.test(line)) ex = true;
      if (/^\s*##\s+[^#]*验收标准/.test(line)) { hs = true; insec = true; continue; }
      if (insec && /^\s*##\s/.test(line)) insec = false;
      if (insec && /^\s*- \[ \]/.test(line)) uc = true;
      if (insec && /^\s*- \[x\]/.test(line) && !/证据：/.test(line)) ne = true;
    }
    const filedate = /^\d{4}-\d{2}-\d{2}$/.test(base.slice(0, 10)) ? base.slice(0, 10) : '';
    const isNew = filedate !== '' && filedate >= accCutoff;
    if (!hs) {
      if (isNew) blockers.push(`- [验收未对账] done intent 缺「## 验收标准」节(勾验无从核对):${base}`);
      else if (!ex) legacyUnaccounted++;
      continue;
    }
    if (!uc && !ne) continue;
    if (isNew) {
      if (uc) blockers.push(`- [验收未对账] done intent 验收标准有未勾验项:${base}（逐条勾验并补证据：commit/用例/冒烟输出）`);
      if (ne) warnings.push(`- [WARN 验收缺证据] ${base} 验收标准勾选项缺「证据：」标注`);
    } else if (!ex) {
      legacyUnaccounted++;
    }
  }
  if (legacyUnaccounted > 0) {
    warnings.push(`- [WARN 验收对账存量] ${legacyUnaccounted} 个存量 done intent 验收标准未对账（2026-09-12 前创建，豁免 hard，不回填）`);
  }
}

// --- 9. 文件名英文 kebab-case [warning] ---
for (const sub of DOC_DIRS) {
  const dir = path.join(ROOT, WF, sub);
  for (const f of readdirOrNull(dir) || []) {
    if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
    const abs = path.join(dir, f);
    if (!isTracked(abs)) continue;
    if (!/^[\x20-\x7e]*$/.test(f)) {
      warnings.push(`- [WARN 文件名非英文] 文件名含非 ASCII 字符,应为英文 kebab-case:${WF}/${sub}/${f}`);
    }
  }
}

// --- 10. 级别 vs 迁移文件一致性 [warning]（启发式：入口文档加入提交触及迁移 SQL/Migrations → 疑似判低；非 git 跳过）---
if (gitOut(['rev-parse', '--git-dir']) !== null) {
  const log = gitOut(['log', '--diff-filter=A', '--format=@%H', '--name-only']);
  if (log !== null) {
    const addpath = new Map(); // 文件 → 首次加入 commit（新→旧序首遇）
    const cfiles = new Map();  // commit → 文件清单
    let cur = null;
    for (const line of log.split('\n')) {
      if (line.startsWith('@')) { cur = line.slice(1); cfiles.set(cur, []); continue; }
      if (line.trim() && cur && !addpath.has(line.trim())) {
        addpath.set(line.trim(), cur);
        cfiles.get(cur).push(line.trim());
      }
    }
    const docs = [...docFiles('intents'), ...docFiles('incidents')];
    for (const doc of docs) {
      const rel = path.relative(ROOT, doc).split(path.sep).join('/');
      const lvl = fmGet(doc, '级别');
      if (lvl !== 'L1' && lvl !== 'L2') continue;
      const c = addpath.get(rel);
      if (!c) continue;
      const hits = (cfiles.get(c) || []).filter((f) => /(^|\/)docs\/scripts\/.*\.sql$/.test(f) || /(^|\/)Migrations\//.test(f));
      if (hits.length) {
        warnings.push(`- [WARN 级别疑似判低] ${path.basename(doc)} 级别 ${lvl} 但其加入提交触及迁移文件(混合改动应就高不就低,请复核级别):\n${hits.join('\n')}`);
      }
    }
  }
}

// --- 11. workflow/INDEX.md 漂移 [warning]（调生成器 --check，口径单一不复刻渲染）---
{
  const gen = path.join(ROOT, '.agents', 'scripts', 'gen-workflow-index.mjs');
  if (fs.existsSync(gen)) {
    const r = spawnSync(process.execPath, [gen, '--check'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
      const first = `${r.stdout || ''}${r.stderr || ''}`.split('\n')[0];
      warnings.push(`- [WARN 索引漂移] workflow/INDEX.md 与磁盘不一致——跑 node .agents/scripts/gen-workflow-index.mjs 重新生成（${first}）`);
    }
  }
}

// --- 12. frontmatter「模块:」合法性 [warning]（词表单源；缺字段只对 2026-09-22 起新建提示）---
{
  const modsFile = path.join(ROOT, '.agents', 'workflow-modules.txt');
  if (fs.existsSync(modsFile)) {
    const mods = linesOf(modsFile).filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim());
    const vocab = new Set(mods);
    for (const sub of ['intents', 'specs', 'plans', 'incidents']) {
      for (const doc of docFiles(sub)) {
        const base = path.basename(doc);
        const mod = fmGet(doc, '模块');
        let d = fmGet(doc, '日期') || fmGet(doc, '发现');
        if (!d) d = /^\d{4}-\d{2}-\d{2}$/.test(base.slice(0, 10)) ? base.slice(0, 10) : '';
        if (mod) {
          if (!vocab.has(mod)) warnings.push(`- [WARN 模块元数据] ${base}「模块: ${mod}」不在词表(见 .agents/workflow-modules.txt)`);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '2026-09-22') {
          warnings.push(`- [WARN 模块元数据] ${base} 缺「模块:」字段(2026-09-22 起新建文档必填)`);
        }
      }
    }
  }
}

// --- 13. 常驻面体积预算 [warning]（判定单源 rule-budget.sh；无 sh 环境静默跳过——advisory，pre-commit 硬拦兜底）---
{
  const rb = path.join(ROOT, '.agents', 'scripts', 'rule-budget.sh');
  const budgets = path.join(ROOT, '.agents', 'rule-budgets.txt');
  if (fs.existsSync(rb) && fs.existsSync(budgets)) {
    const r = spawnSync('sh', [rb, '--all'], { cwd: ROOT, encoding: 'utf8' });
    if (!r.error && r.status !== 0) {
      const head = `${r.stdout || ''}${r.stderr || ''}`.split('\n').slice(0, 5).map((l) => '    ' + l).join('\n');
      warnings.push(`- [WARN 常驻面超限] 常驻面体积超预算(先删除或下沉被取代条目再增——一进一出):\n${head}`);
    }
  }
}

// --- 14. 新 done 的 spec/plan 须在 git 历史里出现过 `状态: approved` [warning]（恒 advisory；非 git 跳过）---
if (gitOut(['rev-parse', '--git-dir']) !== null && gitOut(['rev-parse', '-q', '--verify', 'HEAD']) !== null) {
  for (const sub of ['specs', 'plans']) {
    for (const doc of docFiles(sub)) {
      if (fmGet(doc, '状态') !== 'done') continue;
      const base = path.basename(doc);
      let d = fmGet(doc, '日期') || fmGet(doc, '发现');
      if (!d) d = /^\d{4}-\d{2}-\d{2}$/.test(base.slice(0, 10)) ? base.slice(0, 10) : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < '2026-09-23') continue; // 生效 2026-09-23 起（规则发布次日）
      const lines = linesOf(doc) || [];
      if (lines.some((l) => l.includes('存量确认态豁免（'))) continue;
      const rel = path.relative(ROOT, doc).split(path.sep).join('/');
      const hit = gitOut(['log', '-1', '--format=%H', '-G', '^状态:[[:space:]]*approved', '--', rel]);
      if (hit !== null && hit.trim() === '') {
        warnings.push(`- [WARN 确认态缺失] ${base} 状态已 done 但 git 历史中从未出现行首「状态: approved」——确认环节未留痕(draft 直跳 done)`);
      }
    }
  }
}

// --- 输出（banner 沿 sh 版字样与格式 = 稳定输出契约：banner 后空行、条目 '- ' 前缀）---
if (blockers.length) {
  process.stderr.write(`闭环骨架断档（check-loop.sh）— HARD-BLOCK:\n\n${blockers.join('\n')}\n\n`);
  if (warnings.length) process.stderr.write(`WARN（advisory,不阻断）:\n\n${warnings.join('\n')}\n`);
  process.exit(1);
}
if (warnings.length) {
  process.stderr.write(`check-loop.sh WARN（advisory,不阻断）:\n\n${warnings.join('\n')}\n`);
}
process.exit(0);

function readdirOrNull(dir) {
  try { return fs.readdirSync(dir); } catch { return null; }
}
function isDirectoryOrNull(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
