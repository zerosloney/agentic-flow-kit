// stage-gates.mjs — 逐阶段前置判定的单源（fill-spec / fill-plan / confirm-doc 共享；2026-09-30 stage-gate-machine）
// 口径（与 check-loop 检查 19 内联实现互引——改一处须跟另一处）：
//   入口「已确认」= 文件存在且 frontmatter 状态 ∈ {approved, done}，且【机器事实源】满足其一：
//     ① confirmations.jsonl 台账存在该 doc 的 stage ∈ {approved, done} 行（经 confirm-doc 才产生，防手改状态冒充）；
//     ② 存量口径：文档日期早于 policy.confirmDocsEffective，或行首含「流程: legacy」。
//   incident 入口 = 文件存在 + 「时间线」小节内、行首列表条目含「用户确认」（原 maintain.md §3 约定；
//     2026-09-30 复核 P2-1 收窄为小节内行首条目；第三轮复核 P1-1 起接受日期前缀形态，与模板样例一致）；
//     状态 ∈ {open, fixed, closed}（spec/plan 须先于 fixed 起草，故 open 即为有效态）。
//   入口「级别」须 ∈ L0-L3；缺失即拒（fail-closed）——**但库存量形态短路**（`流程: legacy` 或 日期早于
//     确认门生效日）：跳过级别校验与 spec 档（2026-09-30 增量复核 N1——存量最可能缺级别，硬拒会锁死
//     spec 起草与确认）。
//   注意：**库存量信号本身即等于「入口已确认」**（judgeDoc：`台账行 || 存量口径`，与检查 15 / 检查 1 /
//     配对门的既有口径一致——早于确认门生效日的自报日期即存量豁免，不要求另有台账行）；此处「短路」
//     只额外豁免**级别前置与 spec 档**，不是对台账要求的二次豁免（P2-1：原注释把二者写反，已订正）。
//   plan 门追加：入口级别（取入口 frontmatter 级别，不取工具 --level）为 L2/L3 时，同名 spec 须已确认（同口径）。
// 信任边界声明（沿 2026-09-28 audit-gate-hardening 口径）：本地可写台账 / 手改状态仍可伪造——本模块只把
//   「顺手绕过」抬到「主动伪造」，不宣称通道关闭；事后对质靠 git 历史与台账。
// 设计先例：fill-* 已 import 同目录 workflow-enums.mjs；check-loop 检查 19 内联同口径（门禁脚本自包含、防兄弟依赖）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadKitPolicy } from './policy.mjs';

export const ENTRY_STATUSES = ['approved', 'done'];
export const INCIDENT_STATUSES = ['open', 'fixed', 'closed'];

// readFm：frontmatter 区（首 --- 至闭合 ---）取单字段值；无 frontmatter / 无该键 → ''
export function readFm(abs, key) {
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { return ''; }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (!/^---\s*$/.test(lines[0] || '')) return '';
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) break;
    const m = lines[i].match(new RegExp(`^${key}:\\s*(.*)$`));
    if (m) return m[1].trim();
  }
  return '';
}

function readBody(abs) {
  try { return fs.readFileSync(abs, 'utf8'); } catch { return ''; }
}

// readLedger：confirmations.jsonl 追加式台账（坏行容忍跳过；与 check-loop 检查 15 同容错口径）
export function readLedger(root) {
  const p = path.join(root, '.agents', 'confirmations.jsonl');
  let text = '';
  try { text = fs.readFileSync(p, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 坏行跳过 */ }
  }
  return out;
}

// judgeDoc：状态枚举 + 机器事实源判定（供入口 / spec 复用）
// legacy：库存量信号（`流程: legacy` 标记 或 日期 < confirmDocsEffective）——所有调用方与门禁其余部分
// 同口径（配对门 / 检查 1 / 检查 15 / 检查 19）；2026-09-30 复核 N1：存量入口须先短路，不得被
// 「缺级别」fail-closed 硬拒（存量最可能缺级别，硬拒会锁死 spec 起草/确认，违反「存量零新增」契约）。
function judgeDoc(root, abs, rel, statuses) {
  const st = readFm(abs, '状态');
  if (!statuses.includes(st)) {
    return { ok: false, status: st, legacy: false, reason: `状态「${st || '缺失'}」不在 ${statuses.join(' / ')}` };
  }
  const policy = loadKitPolicy(root);
  const body = readBody(abs);
  const legacyByMarker = body.split(/\r?\n/).some((l) => /^流程: legacy/.test(l));
  const d = readFm(abs, '日期') || readFm(abs, '发现');
  const legacyByDate = /^\d{4}-\d{2}-\d{2}$/.test(d) && d < policy.confirmDocsEffective;
  const legacy = legacyByMarker || legacyByDate;
  const hasRow = readLedger(root).some((e) => e && e.doc === rel && (e.stage === 'approved' || e.stage === 'done'));
  if (hasRow || legacy) return { ok: true, status: st, legacy };
  return { ok: false, status: st, legacy: false, reason: `无确认台账行（门禁后的入口须经 confirm-doc，且台账无 ${rel} 的 approved / done 行）` };
}

// entryStorageLegacy：入口是否属「库存量」形态（`流程: legacy` 标记 或 日期早于确认门生效日）——
// 与 judgeDoc 的存量信号同口径，供门在**级别校验**处短路（2026-09-30 增量复核 N1）。注意：本短路
// **只豁免 level 前置**（存量多为门禁前建档、无级别字段），**不豁免台账要求**——`judgeDoc` 的
// hasRow||legacy 仍照常判定（门禁后无台账行即拒，不因日期早于生效日而放行）。
export function entryStorageLegacy(root, abs) {
  const body = readBody(abs);
  if (body.split(/\r?\n/).some((l) => /^流程: legacy/.test(l))) return true;
  const d = readFm(abs, '日期') || readFm(abs, '发现');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d < loadKitPolicy(root).confirmDocsEffective;
}

// incidentMarked：「## 时间线」小节内、行首列表条目形态的「用户确认」（维持口径；正文叙述句不算——
// 2026-09-30 复核 P2-1 实证：全仓唯一历史命中为叙述句，非过目留痕）。
// 行首可选日期前缀（`- 2026-09-30 用户确认：…`）与可选加粗（`- **用户确认**：…`）均接受——
// 与 _TEMPLATE.md 时间线样例形态保持一致（2026-09-30 第三轮复核 P1-1：样例若不可解析即误导）。
export function incidentMarked(body) {
  let inTimeline = false;
  for (const l of String(body).replace(/\r\n/g, '\n').split('\n')) {
    if (/^##\s/.test(l)) { inTimeline = /^##\s*时间线/.test(l); continue; }
    if (inTimeline && MARK_RE.test(l)) return true;
  }
  return false;
}

// MARK_RE：行首列表条目 + 可选日期前缀（YYYY-MM-DD 或 <日期> 占位）+ 可选加粗围栏（词前 / 词后均可）
// + 「用户确认」+ **须紧跟冒号或行尾**（词边界）。
// 形态矩阵（2026-09-30 四/五轮复核收敛，8 正例 / 5 负例由 fill-spec.test S19/S20 钉死）：
//   命中：`- 用户确认：…` / `- **用户确认**：…` / `- 2026-09-30 用户确认：…` / `- <日期> **用户确认**：…` / 行尾无冒号
//   拒绝：`- 2026-09-30 用户确认了方案` / `- 用户确认书已归档` / `- 用户确认。` / `- 待用户确认：…`
//   注：词前的 `\**` 与词后的 `\**` 必须都允许——只开一侧即产生结构性假阴性（第五轮复核 P1 实证：
//   加粗围栏形态被拒，与 _TEMPLATE.md 自述契约冲突）。
export const MARK_RE = /^\s*[-*]\s*(?:\d{4}-\d{2}-\d{2}|<日期>)?\s*\**用户确认\**(?=\s*[：:]|\s*$)/;

// entryConfirmed：同主题入口判定（intent 优先；否则 incidents）——返回 {ok, kind, rel, level, status, reason?}
export function entryConfirmed(root, base) {
  const intentRel = `workflow/intents/${base}.md`;
  const intentAbs = path.join(root, intentRel);
  if (fs.existsSync(intentAbs)) {
    const r = judgeDoc(root, intentAbs, intentRel, ENTRY_STATUSES);
    return { ...r, kind: 'intent', rel: intentRel, level: readFm(intentAbs, '级别'), storageLegacy: entryStorageLegacy(root, intentAbs) };
  }
  const incRel = `workflow/incidents/${base}.md`;
  const incAbs = path.join(root, incRel);
  if (fs.existsSync(incAbs)) {
    const st = readFm(incAbs, '状态');
    const level = readFm(incAbs, '级别');
    if (INCIDENT_STATUSES.includes(st) && incidentMarked(readBody(incAbs))) {
      return { ok: true, kind: 'incident', rel: incRel, level, status: st, legacy: false };
    }
    const why = !INCIDENT_STATUSES.includes(st) ? `状态「${st || '缺失'}」非法` : '「时间线」小节缺「用户确认」条目（maintain.md §3）';
    return { ok: false, kind: 'incident', rel: incRel, level, status: st, legacy: false, reason: `同名 incident 未过目确认——${why}` };
  }
  return { ok: false, kind: null, rel: null, level: '', status: '', reason: `未找到同名入口（workflow/intents 与 workflow/incidents 均无 ${base}.md）` };
}

// specConfirmed：plan 门的 L2/L3 追加要求
export function specConfirmed(root, base) {
  const rel = `workflow/specs/${base}.md`;
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return { ok: false, reason: `缺同名 spec（${rel}）` };
  return judgeDoc(root, abs, rel, ENTRY_STATUSES);
}

// draftGateFor：起草门总判（kind = 'spec' | 'plan'，fill 工具用）
export function draftGateFor(kind, root, base) {
  const entry = entryConfirmed(root, base);
  if (!entry.ok) {
    return {
      ok: false,
      reason: `同主题入口未确认——${entry.reason}`,
      hint: '先走 plan.md 完成入口确认（修复类走 maintain.md，incident 草稿过目后在时间线留「用户确认」条目）',
    };
  }
  // 库存量形态短路（2026-09-30 增量复核 N1）：**只额外豁免「级别前置」与「spec 档」**——
  // 库存量入口（`流程: legacy` / 日期早于确认门生效日）多为门禁前建档、常缺「级别」字段，硬拒会锁死
  // spec 起草与确认。注意：库存量信号**本身即等于入口已确认**（judgeDoc 的 `台账行 || 存量口径`，
  // 与检查 1 / 15 / 配对门同口径）——台账豁免发生在 judgeDoc，不在本处；本处不做二次豁免
  // （第三轮复核 P2-1：原句「台账要求不豁免」把两件事写反，已订正）。
  if (!entry.storageLegacy && !/^L[0-3]$/.test(entry.level)) {
    return {
      ok: false,
      reason: `入口缺合法「级别」字段（现「${entry.level || '缺失'}」，无法判定前置深度）`,
      hint: '先给入口补「级别: L0-L3」字段，再继续',
    };
  }
  if (kind === 'plan' && !entry.storageLegacy && (entry.level === 'L2' || entry.level === 'L3')) {
    const sp = specConfirmed(root, base);
    if (!sp.ok) {
      return { ok: false, reason: `入口级别 ${entry.level}，前置 spec 未确认——${sp.reason}`, hint: '先走 design.md 完成 spec 确认' };
    }
  }
  return { ok: true, entry };
}

// confirmGateFor：确认门总判（confirm-doc 用；docRel = workflow/specs/... 或 workflow/plans/...）
export function confirmGateFor(root, docRel) {
  const base = path.basename(docRel).replace(/\.md$/, '');
  const kind = docRel.startsWith('workflow/specs/') ? 'spec' : 'plan';
  return draftGateFor(kind, root, base);
}

// ---- done 前置门族（2026-09-30 confirm-gate-approved-history）----
// 背景：stage-gate-machine 关单后检查 14 报「确认态缺失」×2——approved→done 期间从未提交、首次提交即
// done 态（先 done 后提交），git 历史无 approved 中间态；检查 14 是事后审计（发现即定局），本族把
// 校验收口到 confirm-doc 的「→done」跳转——「approved 态还在工作区」的最后一刻，即唯一可拦截窗口。
// 命中判据单源：approvedTraceHit 命令行与 check-loop 检查 14 逐字一致（-G '^状态:[[:space:]]*approved'），
// 本模块为唯一实现、两调用方共享（2026-09-30 复核 N3 教训：双份字面量靠注释同步必漂移）。
// 注（2026-09-30 复核 P2-2 登记）：gitRun 的 GIT 解析 / maxBuffer / 失败语义与 check-loop.mjs 的
// gitOut、gitReady 与检查 14 段级两条 rev-parse 为**同口径的两份实现**（未合并——检查 14 段结构不动
// 属本单非目标）——任一侧调整（如加 --no-pager）须同步另一侧，防段级门与文档级判据分叉。
const GIT = process.platform === 'win32' ? 'git.exe' : 'git';

function gitRun(root, args) {
  const r = spawnSync(GIT, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error || r.status !== 0) return null;
  return r.stdout || '';
}

// gitReady：git 环境可用（在仓库内且已有 HEAD）——与检查 14 段级两条 rev-parse 同口径
export function gitReady(root) {
  return gitRun(root, ['rev-parse', '--git-dir']) !== null
    && gitRun(root, ['rev-parse', '-q', '--verify', 'HEAD']) !== null;
}

// approvedTraceHit：命中判定单源——git 历史是否出现过行首「状态: approved」（经提交进入历史才算，
// 当前工作区未提交的 approved 不算——这正是「留痕」语义）。rel = 仓库根相对路径。
// 返回：'' = 从未出现；<sha> = 命中；null = git 调用失败（调用方按各自容错口径处理——检查 14 不报、
// done 门跳过，均沿 fail-open 边界；诚实边界声明见 spec）。
export function approvedTraceHit(root, rel) {
  const r = gitRun(root, ['log', '-1', '--format=%H', '-G', '^状态:[[:space:]]*approved', '--', rel]);
  return r === null ? null : r.trim();
}

// doneGateFor：confirm-doc「→done」前置门（三件套 intent/spec/plan 均适用；incidents 的 fixed/closed 不在本门）。
// 豁免与顺序：① 行首 `流程: legacy` ② 行含「存量确认态豁免（」声明（与检查 14 同标记，显式逃生口）
// ③ 非 git 环境 ④ git 调用失败 → 均跳过（不误拦）。未豁免且未命中 → 拒绝（调用方负责非零退出 +
// 零落账 + 零写盘 + 回退指引）。
export function doneGateFor(root, abs, rel) {
  const body = readBody(abs);
  if (body.split(/\r?\n/).some((l) => /^流程: legacy/.test(l))) return { ok: true, skipped: 'legacy' };
  if (body.split(/\r?\n/).some((l) => l.includes('存量确认态豁免（'))) return { ok: true, skipped: 'declared' };
  if (!gitReady(root)) return { ok: true, skipped: 'no-git' };
  const hit = approvedTraceHit(root, rel);
  if (hit === null) return { ok: true, skipped: 'git-error' };
  if (hit === '') {
    return {
      ok: false,
      reason: 'git 历史中从未出现行首「状态: approved」——确认态未留痕（先 done 后提交 / 两跳同批提交）',
      hint: '先把该文档的 approved 态提交（git add 该文件并 commit）后再重试关单',
    };
  }
  return { ok: true, hit };
}

// resolveWorkspace：从输出路径推导工作区根与主题名；output 路径不含 workflow 段 → null（仓外草稿，不校验）
export function resolveWorkspace(outputPath, rootOverride) {
  const abs = path.resolve(outputPath);
  const base = path.basename(abs).replace(/\.md$/, '');
  if (rootOverride) return { root: path.resolve(rootOverride), base };
  const parts = abs.split(path.sep);
  for (let i = parts.length - 2; i >= 0; i--) {
    if (parts[i].toLowerCase() === 'workflow') return { root: parts.slice(0, i).join(path.sep) || path.sep, base };
  }
  return null;
}

export default { entryConfirmed, specConfirmed, draftGateFor, confirmGateFor, doneGateFor, gitReady, approvedTraceHit, resolveWorkspace, readFm, readLedger };
