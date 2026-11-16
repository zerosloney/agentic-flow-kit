#!/usr/bin/env node
// gen-effective-policy.mjs — 当前生效规则视图生成器（2026-10-09 AI-Native 架构审查 P2-5）
// 背景：豁免锚经 policy v1→v8 演进后，「存量豁免 vs 受管」的合成语义只活在 check-loop.mjs 源码里，
//   规则空间永久二分且不可读——本脚本把 policy.mjs 单源渲染为人可读的 workflow/effective-policy.md，
//   与 INDEX.md 同款「生成物 + --check 防漂移」纪律；verify.mjs 挂 --check 门（CI 强制随 policy 变更重生成）。
// 渲染内容：当前生效 policyVersion（engine.json，缺省回落 v1）、逐锚键的生效日 / 消费检查项 / 分级现状
//   （hard·已生效 / advisory·已生效 / 未到期——锚日 > 今日的升级锚标注「待升级」；
//   执法段已退役的锚标注「执法已退役」，不宣称不存在的执法——2026-10-28 引擎减重 hygiene 16 段全退）。
// 判定单源：锚定义 = policy.mjs POLICIES（本脚本不写日期，只读只渲染）；键→检查项映射取自
//   check-loop.mjs 头部检查清单（编号是文档引用锚，此处仅作说明文本）。
// 用法：flow-kit run gen-effective-policy.mjs [--root <dir>] [--check]
//   --check：与磁盘 workflow/effective-policy.md 比对，漂移 exit 1（CI/verify 用）。
//   比对前双侧行尾归一（CRLF→LF）。生成器仍只写 LF，--check 不改文件。
//   干净的 autocrlf 检出是 CRLF，字节相等会假红，且重生成只留下不可提交的行尾差。
// 现役门禁清单节（2026-11-16）：策略面之后追加「现役门禁清单（人读）」——给审批者与非工程角色看
//   每道门在查什么。单源渲染，不新增真相源：门清单 = 机制台账现役行（policy.json registry 声明，
//   parseMechanismRegistry 共用解析）；「查什么」= 门禁位置/机制名点名的门脚本头部注释；「谁看/失败
//   动作」= 门禁位置/统计口径列关键词的导航归并，完整口径以门禁位置列原文为准；[数据面] 行是遥测
//   不是门禁，不入清单。清单不手编——台账加/删行 + 重生成即增/删行，漂移由既有 --check 同门把关。
// 测试：锚表测试面已随引擎减重退役（2026-10-28，owner 决策）；门禁清单节测试见
//   tests/gen-effective-policy.test.mjs（临时目录 fixture + 增删门双向核对 + --check 漂移）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICIES, loadKitPolicy, renderPolicySection, parseMechanismRegistry } from './policy.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
};
const ROOT = path.resolve(argOf('--root') || process.env.FLOW_KIT_PROJECT_ROOT || path.join(SCRIPT_DIR, '..', '..'));
const OUT = path.join(ROOT, 'workflow', 'effective-policy.md');

// 键 → 消费检查项与分级说明（单源 check-loop 检查清单编号；说明文本与本脚本共同演进）。
// 分级 RETIRED_LEVEL = 执法段已退役（编号留疤引用不重排）：行仍列出（policy 锚单源存档），
// 但消费检查项显式标注退役日期、现状不再渲染「已生效」——生成物不得宣称不存在的执法。
const RETIRED_LEVEL = '已退役';
const CONSUMERS = {
  moduleSince: ['检查 12（已于 2026-10-28 退役）', 'frontmatter「模块:」枚举合法性（§12 并入 §9 后随 hygiene 段退役）', RETIRED_LEVEL],
  check14Since: ['检查 14（已于 2026-10-28 退役）', '新 done 的 spec/plan 须有 approved git 历史——advisory 生效锚', RETIRED_LEVEL],
  check14HardSince: ['检查 14（已于 2026-10-28 退役）', '同上——锚日起升 hard-block', RETIRED_LEVEL],
  confirmDocsEffective: ['检查 15', 'docs 确认台账两条件准入（台账行 ∪ 自报日期≥锚）', 'hard'],
  confirmIncidentsEffective: ['检查 15', 'incidents 档确认阈值（fixed/closed 配对）', 'hard'],
  bindingTs: ['检查 15', '四终态内容绑定（台账行 ts≥锚 才比对 sha256）', 'hard'],
  delegationSince: ['检查 18（已于 2026-10-28 退役）', '委派台账对账——锚前存量豁免', RETIRED_LEVEL],
  stageGateSince: ['检查 19（已于 2026-10-28 退役）', '逐阶段审计（起草先于入口确认 / 台账顺序）', RETIRED_LEVEL],
  check17UnclosedAfter: ['检查 17（已于 2026-10-21 退役）', '发版提交树未收口三件套——版本 tag 锚（非日期）', RETIRED_LEVEL],
  verifySince: ['检查 8', '测试绿声明对账（无 SHA 声明「测试绿」须 24h 内凭证）+ confirm-doc →done 前置', 'advisory'],
  verifyHardSince: ['confirm-doc', '→done 测试绿凭证——锚日起升 hard（拒无凭证关单）', 'hard'],
  incidentRegrSince: ['检查 3x', '防复发验证证据门（fixed/closed 须落自动化用例/回归清单引用）', 'hard'],
  specVerifSince: ['检查 21（已于 2026-10-28 退役）', 'spec 验证落地核查（L2/L3 done 的验证计划须引用测试文件/命令）', RETIRED_LEVEL],
  attributionSince: ['检查 24（已于 2026-10-28 退役）', 'incident 归因字段（来源/影响环境 枚举存在性与合法性）——锚前存量豁免', RETIRED_LEVEL],
  convergenceSince: ['检查 23', '判据级收敛对账（L2/L3 done spec 验收判据表逐条对证据——完成声明不是证据）——锚前存量豁免', 'advisory'],
  convergenceHardSince: ['检查 23', '同上——证据无效升 hard（命令须有不早于 spec 日期的 verify-evidence 全绿行；路径只认存在）', 'hard'],
  reviewerSince: ['检查 1', '独立复核上下文标识（复核行须含「复核上下文：<会话/子代理 id>」——独立性声明可证伪化）——锚前存量豁免', 'advisory'],
  clarifySince: ['confirm-doc（stage-gates clarifyGate）', 'spec 确认门歧义清单门——锚起新建 spec 须过 6 维 × 状态闭集 × 待澄清归零（缺维 = 未扫描）', 'hard'],
  coverageSince: ['confirm-doc（stage-gates coverageGate）', 'spec 确认门验收覆盖门——intent 验收编号 A1..An 每条至少被 spec 判据表「对应验收」列引用一次（单向）', 'hard'],
  premiseSince: ['confirm-doc（stage-gates premiseGate）', 'spec 确认门前提质询门——锚起新建 spec 须有非空且非占位的「前提质询」表（拦「自信的错误解读」进事实源；无解读风险写「无关键前提」行 + 理由）', 'hard'],
  regrEnforcerSince: ['检查 29', '回归清单执法者配对——锚起数据行「执法者」列须非空（真执法资产或显式 [prompt-only]）——锚前存量不追溯', 'hard'],
};

// ---- 现役门禁清单（人读，2026-11-16）----
// 「谁看 / 失败动作」= 门禁位置 / 统计口径列关键词的导航性归并（固定序、去重；非新真相源——
// 每行同时携带「门禁位置」列原文，读者可回溯单源）。无命中落默认文案，不猜档位。
const AUDIENCE_RULES = [
  [/confirm-doc|stage-gates/, 'spec/plan 审批者（confirm-doc 确认门）'],
  [/PreToolUse|写前门|pre-write|pre-shell|宿主/, 'AI 会话宿主（写/命令前置门）'],
  [/pre-commit|commit-msg|pre-push|pre-merge/, '提交者（本地 git 钩子）'],
  [/\bCI\b|azure-pipelines/, 'CI 流水线（合并前兜底）'],
  [/closeout|check-loop|§\d/, '引擎自查（主代理/独立复核）'],
  [/verify|关单/, '关单验证（工程）'],
  [/metrics|月度|agg-/, '月度对账（维护者）'],
];
const ACTION_PATTERNS = [
  [/hard(?:[-\s/]?(?:block|拦)|「)/, '硬拦（违例即阻断）'],
  [/\bdeny\b/, 'deny（命中即拦）'],
  [/\bWARN\b/, 'WARN 告警（不阻断）'],
  [/advisory/, 'advisory（只报告不阻断）'],
];

// 门脚本头部注释摘要：前导注释块（// 行或 /** */ 块）取前 4 段，压空白、截 160 字。
// 首段若以脚本 basename 开头（check-foo: xxx 形态）则剥掉——单元格已带前缀，不重复。
function scriptHeaderSummary(absPath, base, maxChars = 160) {
  let text = '';
  try { text = fs.readFileSync(absPath, 'utf8'); } catch { return ''; }
  const parts = [];
  for (const raw of text.split(/\r?\n/).slice(0, 40)) {
    const line = raw.trim();
    if (!parts.length && line.startsWith('#!')) continue;
    if (!line) { if (parts.length) break; continue; }
    if (line.startsWith('*/')) break;
    if (line.startsWith('//')) parts.push(line.replace(/^\/\/+\s*/, ''));
    else if (line.startsWith('/*') || line.startsWith('*')) parts.push(line.replace(/^\/?\*+\s*/, ''));
    else break;
    if (parts.length >= 4) break;
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
  const stripped = joined.replace(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.(?:m|c)js)?\\s*[:：—-]?\\s*`), '');
  return stripped.length > maxChars ? `${stripped.slice(0, maxChars)}…` : stripped;
}

// 表格单元格加固：换行折空格、竖线转义——台账/头注偶有特殊字符时不撑破 5 列管道表。
const cell = (text) => String(text).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

function renderGateChecklistSection(root) {
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'config', 'policy.json'), 'utf8')); } catch { return []; }
  if (!cfg || typeof cfg !== 'object' || typeof cfg.registry !== 'string') return [];
  let registryText = '';
  try { registryText = fs.readFileSync(path.join(root, cfg.registry), 'utf8'); } catch { return []; }
  const rows = parseMechanismRegistry(registryText);
  const activeAll = rows.filter((r) => r.status === '现役');
  const gates = activeAll.filter((r) => r.tag !== '数据面');
  if (!gates.length) return [];
  // 门脚本头部表：.agents/scripts 与 .agents/hooks 顶层 .mjs/.cjs（字典序固定；目录缺省的最小装户跳过）。
  const headers = [];
  for (const dir of ['.agents/scripts', '.agents/hooks']) {
    let files = [];
    try { files = fs.readdirSync(path.join(root, dir)).filter((f) => /\.(m|c)js$/.test(f)).sort(); } catch { /* 目录缺省跳过 */ }
    for (const f of files) {
      const base = f.replace(/\.(m|c)js$/, '');
      const summary = scriptHeaderSummary(path.join(root, dir, f), base);
      if (summary) headers.push({ base, summary });
    }
  }
  const lines = [];
  lines.push('## 现役门禁清单（人读）');
  lines.push('');
  lines.push('> 每道现役门一行：门名 / 查什么 / 谁看 / 失败动作 / 门禁位置。单源合成（机制台账现役行 + 门脚本头部注释 + policy.json 角色闭集），生成器整段重写，勿手编。');
  lines.push('> 「谁看 / 失败动作」是导航性归并，完整口径以「门禁位置」列原文为准；[数据面] 行是遥测不是门禁，不入清单。');
  const modelRoles = Array.isArray(cfg.roles?.modelRoles) ? cfg.roles.modelRoles : [];
  const prRoles = Array.isArray(cfg.roles?.prReviewRoles) ? cfg.roles.prReviewRoles : [];
  if (modelRoles.length || prRoles.length) {
    lines.push(`> 审批角色闭集（policy.json）：模型角色 ${modelRoles.join(' / ') || '—'}；PR 评审角色 ${prRoles.join(' → ') || '—'}。`);
  }
  lines.push('');
  lines.push(`共 ${gates.length} 道现役门（台账现役 ${activeAll.length} 行，其中数据面 ${activeAll.length - gates.length} 行不入清单）。`);
  lines.push('');
  lines.push('| 门名 | 查什么 | 谁看 | 失败动作 | 门禁位置 |');
  lines.push('|---|---|---|---|---|');
  for (const row of gates) {
    const hay = `${row.name}\n${row.gate}`;
    const whats = [];
    for (const h of headers) {
      const re = new RegExp(`(?<![\\w-])${h.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
      if (re.test(hay)) whats.push(`${h.base}：${h.summary}`);
    }
    const who = [...new Set(AUDIENCE_RULES.filter(([re2]) => re2.test(hay)).map(([, label]) => label))].join('；') || '见门禁位置列';
    const hay2 = `${row.gate}\n${row.criterion}`;
    const actions = [];
    for (const [re3, label] of ACTION_PATTERNS) {
      if (re3.test(hay2) && !actions.includes(label)) actions.push(label);
    }
    const what = whats.length ? whats.join('；') : (cell(row.criterion) || '—');
    lines.push(`| ${cell(row.name)} | ${what} | ${who} | ${actions.join('；') || '见门禁位置（无显式档位标记）'} | ${cell(row.gate)} |`);
  }
  return lines;
}

// today：视图基准日。EFFECTIVE_POLICY_TODAY 为测试注入缝（场景 2f 跨锚日稳定性用；生产不设）。
const today = () => process.env.EFFECTIVE_POLICY_TODAY || new Date().toISOString().slice(0, 10);

function render(viewDateStr) {
  const policy = loadKitPolicy(ROOT);
  const v = POLICIES[policy.policyVersion] || {};
  const todayStr = viewDateStr || today();
  const lines = [];
  lines.push('# 当前生效规则视图（生成物，勿手改）');
  lines.push('');
  lines.push('> 生成器 `flow-kit run gen-effective-policy.mjs`（policy.mjs 单源渲染；漂移由 verify.mjs `effective-policy` 门 --check 把关——改 policy 后须重生成并随同提交）。');
  lines.push(`> 当前生效：**policyVersion ${policy.policyVersion}**（engine.json 声明 ${policy.requestedVersion}${policy.requestedVersion === policy.policyVersion ? '' : '，不在 POLICIES 表内已回落 v1'}）；视图日期 ${todayStr}。`);
  lines.push('');
  lines.push('| 锚键 | 生效日/锚 | 消费检查项 | 语义 | 分级 | 现状 |');
  lines.push('|---|---|---|---|---|---|');
  for (const key of Object.keys(v)) {
    const raw = v[key];
    const c = CONSUMERS[key] || ['—', '（未登记消费方——policy 加新键时同步登 CONSUMERS）', '—'];
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(String(raw));
    // 升级锚语义：日期 > 今日 = 未到期（维持低档）；其余 = 已生效；
    // 执法段已退役的锚不按日期宣称执法（编号留疤，锚仅存档）。
    const status = c[2] === RETIRED_LEVEL
      ? '执法已退役（锚存档）'
      : (!isDate ? '生效（版本锚）' : (String(raw) <= todayStr ? '已生效' : `待升级（${raw} 起）`));
    lines.push(`| \`${key}\` | ${raw} | ${c[0]} | ${c[1]} | ${c[2]} | ${status} |`);
  }
  lines.push('');
  // R3-1：把 policy.json 的机器策略面并入同一份人类视图；无 policy.json 的存量目标静默跳过。
  if (fs.existsSync(path.join(ROOT, '.agents', 'config', 'policy.json'))) {
    lines.push(...renderPolicySection(ROOT));
    lines.push('');
    const checklist = renderGateChecklistSection(ROOT);
    if (checklist.length) {
      lines.push(...checklist);
      lines.push('');
    }
  }
  lines.push('<!-- GENERATED:BEGIN — gen-effective-policy.mjs 整段重写，手工说明写在本行之前 -->');
  return lines.join('\n') + '\n';
}

const text = render();
// 行尾归一（与 gen-workflow-index.mjs normEol 同句）：只影响 --check 判定，写盘仍是 LF。
const normEol = (s) => String(s).replace(/\r\n/g, '\n');
if (argv.includes('--check')) {
  let disk = '';
  try {
    disk = fs.readFileSync(OUT, 'utf8');
  } catch { /* 缺文件视作空——走漂移分支 */ }
  // 锚日时间炸弹拆除（2026-10-12 CI 实证：v12 两锚定 10-12，10-11 生成的视图含「待升级（10-12 起）」，
  // 锚日当天重渲染按当日判「已生效」→ 与仓内视图必差 → --check 必红——任何未来日期锚都会在锚日引爆）。
  // 修法：--check 对**磁盘文件自带的视图日期**重渲染（生成物与自身生成日自洽，跨锚日字节稳定）；
  // 显式重生成（默认模式）才前进视图日期并翻转状态列。视图日期行缺失的存量件回落当日口径。
  const mDate = disk.match(/视图日期 (\d{4}-\d{2}-\d{2})/);
  const checkText = mDate ? render(mDate[1]) : text;
  if (normEol(disk) === normEol(checkText)) {
    console.log('[effective-policy] ✅ 与磁盘一致（无漂移；按磁盘视图日期重渲染比对）');
    process.exit(0);
  }
  console.error('[effective-policy] ❌ 漂移：policy/engine 变更后未重生成 workflow/effective-policy.md');
  console.error('  修法：flow-kit run gen-effective-policy.mjs && git add workflow/effective-policy.md（随 policy 变更同笔提交）');
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
console.log(`✅ 已生成 ${path.relative(process.cwd(), OUT)}`);
