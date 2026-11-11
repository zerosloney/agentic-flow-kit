// check-loop-sections/s23-convergence-audit.mjs — 23. 判据级收敛对账（2026-10-11；锚 convergenceSince / convergenceHardSince）
// 背景（convergence-audit，参照 GitHub spec-kit converge 机理「完成声明不是证据」）：
// spec 的验证承诺此前只落在叙述节（检查 21 对节内引用做存在性扫描），没有逐判据 × 逐证据的机器对账。
// 本段把「验收判据」表（workflow/specs/_TEMPLATE.md 承重节）变成机器输入：L2/L3 done spec（锚后）逐行解析
//   判据 → 证据。状态列自报「覆盖」而证据无效 → 仍判未覆盖。
// 两档（convergence-hard）：
//   advisory（有 convergenceSince、无 hard 键，或日期 < convergenceHardSince）：证据 = 存在的路径，或命令白名单声明。WARN。
//   hard（日期 ≥ convergenceHardSince）：路径仍只认存在，不读正文、不判与判据是否相关（判断题留给新会话复核）；
//     命令必须是 verify.mjs 全量门实际跑的那几个，且 workflow/verify-evidence.md 有不早于本 spec 日期的全绿行。
//     答不了（空、路径不存在、命令不在全量门、没有对应全绿行）= 未覆盖，HARD-BLOCK。人工走查且证据为空仍合法。
// 无「验收判据」节或表无数据行 → 两档都是 WARN「收敛无判据」。
// 存量豁免：日期 < convergenceSince → 跳过。缺键（v1–v9）→ 整段跳过。缺 hard 键（v1–v10）→ 不升 hard。
import {
  fs, os, path, spawnSync, createHash, createRequire, fileURLToPath,
  loadEnums, auditEnabled, loadKitPolicy, hasFreshVerifyLine, laneOfDoc, MARK_RE,
  SCRIPT_DIR, GIT, REV_ARG, REV, ROOT, MAIN_ROOT, ENUMS, inSet, stOkDoc,
  spawnGit, gitOut, linesOf, fmGet, WF, DOC_DIRS, blockers, warnings, kitPolicy, isTracked, docFiles,
  addedDateOf, warnEvidenceExempt, VERIFY_GREEN_RE, verifyEvidenceTruth,
  versionGreater, fmStatus, bindingSha256, readdirOrNull, isDirectoryOrNull,
} from '../check-loop-kit.mjs';

// 与 s21 命令面同源的声明白名单（advisory 档：文本命中即认）。hard 档不再凭命中放行。
// 边界修复（2026-11-03）：词首加 (?<![\w.@\-\\/]) 负向断言——证据路径 `.agents/skills/verify-ui/features/*.md`
// 中 `verify-ui` 为路径片段，无断言时被误判为命令引用 → hard 档走全量门白名单（verify-ui 不在）恒判
// 证据无效（po-contract-required-tax-default 推送实证：4 条指向真实存在 UI 报告的人工判据全灭）。
const CMD_RE = /(?<![\w.@\-\\/])(?:npm\s+(run\s+)?test|dotnet\s+test|run-tests|regression-smoke|verify\.mjs|check-scope|verify-ui|ui-verifier|vue-tsc|dotnet\s+build|npm\s+run\s+build)/;
// 引用切分：长选项在前，避免 npm run build 被更短的模式截断。verify-ui 先于不会与 verify.mjs 重叠的独立词。
const CITE_RE = /(?<![\w.@\-\\/])(?:npm\s+run\s+build|npm\s+(?:run\s+)?test|dotnet\s+build|dotnet\s+test|verify\.mjs|verify-ui|ui-verifier|regression-smoke|run-tests|check-scope|vue-tsc)/g;
// verify.mjs 全绿行（suite=all-gates）实际覆盖的命令。不在此集的白名单命令没有对应绿记录。
// vue-tsc（2026-10-21 verify-diet ④）：本地关单前端门 = npm run type-check（vue-tsc -b），
// vite bundle 分离到 deploy/CI（TF_BUILD 下 frontend-build 门仍 npm run build）——两形态都是门实跑命令。
// 方向注意（复核 P2）：npm run build 的绿记录只在 **CI 行**（runId 有值）；本地全绿行实跑 vue-tsc。
// 按行环境严格对账挂 papercuts 2026-10-21（摘要行 runId 列已可辨 CI/本地）。
// npm 面命令已随引擎测试面退役（2026-10-28，根 package.json scripts 已删）——白名单保留系**存量 spec
// 兼容**：2026-10-18 前的 done spec 证据引 `npm run test:unit` 等（CITE_RE 前缀提取为 npm run test），
// 移除会使存量档在 FULL 对账下判「收敛未覆盖」（2026-10-28 实证 po-concurrent-overorder-lost-update）。
// 新 spec 勿再引用 npm 面命令；存量迁移（改证/解锁序）待 owner 裁决后另行清理。
const GATE_CMD = new Set(['npm run build', 'npm test', 'npm run test', 'dotnet build', 'dotnet test', 'verify.mjs', 'vue-tsc']);
// 扩展名交替**最长优先**（2026-10-20 修复：原 `mjs|js|ts|tsx|...|json` 中 js/ts 是 mjs/json/tsx 的
// 前缀且交替无尾锚，`.json`/`.tsx` 路径被截断成 `.js`/`.ts` → existsSync 恒 false → 证据永不可验，
// po-close-replace-mark-completed 关单实证）
const PATH_EXT = 'tsx|mjs|json|html|sql|vue|cs|md|ts|js';
// 路径体 = 原 ASCII 路径字符 + 字母（中文目录），单字符类，避免 (A|B)+ 在长说明上回溯。
// 标点（如路径后的「（说明）」）不在类内，仍截断。
const PATH_RE = new RegExp(`(?:^|[\\s\`'"（(])([\\w.@\\-\\\\/\\p{L}]+\\.(?:${PATH_EXT}))`, 'gu');
const SEC_RE = /^##\s+.*验收判据/;
// 与 gen-verify-evidence.mjs 数据行同形态：短 SHA | ISO 时间 | …。只取日期，不复述门数。
const EVIDENCE_ROW_RE = /^\|\s*`[0-9a-f]{7,40}`\s*\|\s*([^|]+?)\s*\|/;

// 关单树路径存在（2026-10-29 done-tree-evidence，papercut 待登记——handoff 2026-10-29 P0）：
// 「关单后业务重构删证据」结构性失灵的堵口。原判据 `fs.existsSync(今天)` 单认当下——spec done 后
// 测试文件被合法重构删除（实证 fafbc30f 删 OutboundPickTests，4 条 L3 done spec 全体 HARD-BLOCK），
// 历史承诺被事后树态否决。补第二认：**该 spec 首次进入 done 态的提交树中路径存在**（历史树对账，
// 与 ledger-invariant DAG 感知同哲学：关单时的承诺按关单时的树兑现判）。双认 = 今天存在 ∪ done 树存在。
// done 树解析：spec 文件历史最早一个「正文含行首 `状态: done`」的提交（逐提交 cat-file 正文，
// done spec 数少 + memo 缓存；非 git / 查不到 → null 不放行第二认，行为与旧判据等价不误放）。
const doneTreeMemo = new Map(); // specAbsPath → sha|null
function doneTreeShaOf(spec) {
  if (doneTreeMemo.has(spec)) return doneTreeMemo.get(spec);
  let sha = null;
  try {
    const rel = path.relative(ROOT, spec).split(path.sep).join('/');
    const log = gitOut(['log', '--format=%H', '--follow', '--', rel]); // 旧→新
    if (log) {
      for (const line of log.split('\n').reverse()) {
        const c = line.trim();
        if (!c) continue;
        const body = gitOut(['show', `${c}:${rel}`]);
        if (body !== null && /^状态:\s*done\s*$/m.test(body.split(/\r?\n/).slice(0, 12).join('\n'))) { sha = c; break; }
      }
    }
  } catch { /* 非 git / 异常 → null */ }
  doneTreeMemo.set(spec, sha);
  return sha;
}
const doneTreePathMemo = new Map(); // `${sha}\n${path}` → bool
function doneTreeHasPath(spec, relPath) {
  const sha = doneTreeShaOf(spec);
  if (!sha) return false;
  const key = `${sha}\n${relPath}`;
  if (doneTreePathMemo.has(key)) return doneTreePathMemo.get(key);
  let ok = false;
  try { ok = spawnGit(['cat-file', '-e', `${sha}:${relPath}`]).status === 0; } catch { ok = false; }
  doneTreePathMemo.set(key, ok);
  return ok;
}

function greenEvidenceDates() {
  const dates = [];
  let text = '';
  try { text = fs.readFileSync(path.join(ROOT, WF, 'verify-evidence.md'), 'utf8'); } catch { return dates; }
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(EVIDENCE_ROW_RE);
    if (!m) continue;
    const day = m[1].trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) dates.push(day);
  }
  return dates;
}

// 命令格：每一处引用都须落在全量门里，且有不早于 spec 日期的全绿行。解析不出引用 → 不放行。
// 两侧日期同须 UTC 口径（台账渲染 UTC ts；spec「日期」fill-spec 默认 UTC，手写见 _TEMPLATE.md 验收判据注）：
// 本地时区手写日期会在 UTC+8 0–8 点窗与全绿行错位一天——fail-closed，不误放。
function commandCovered(ev, specDate, greenDates) {
  const cites = ev.match(CITE_RE) || [];
  if (!cites.length) return false;
  const fresh = greenDates.some((g) => g >= specDate);
  return cites.every((c) => GATE_CMD.has(c) && fresh);
}

export function run() {
// --- 23. 判据级收敛对账（2026-10-11；锚 convergenceSince / convergenceHardSince）---
{
 const anchor = kitPolicy.convergenceSince;
 const hardAnchor = kitPolicy.convergenceHardSince;
 if (anchor) {
 const greenDates = greenEvidenceDates();
 const isPlaceholder = (s) => !s || /^<.*>$/.test(s);
 for (const spec of docFiles('specs')) {
 const st = fmGet(spec, '状态');
 const lvl = fmGet(spec, '级别');
 if (st !== 'done' || !['L2', 'L3'].includes(lvl)) continue;
 // 生效日锚：frontmatter「日期」优先（fill-spec 必写），缺则 git 首加日 / 文件名前缀（同检查 12 退化序）
 let d = fmGet(spec, '日期') || addedDateOf(spec);
 if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = /^\d{4}-\d{2}-\d{2}/.test(path.basename(spec)) ? path.basename(spec).slice(0, 10) : '';
 if (!d || d < anchor) continue; // 锚前存量不回填
 const hard = !!(hardAnchor && d >= hardAnchor);
 const lines = linesOf(spec) || [];
 const secLines = [];
 let inSec = false;
 for (const l of lines) {
 if (SEC_RE.test(l)) { inSec = true; continue; }
 if (inSec && /^##\s+/.test(l)) { inSec = false; continue; }
 if (inSec) secLines.push(l);
 }
 // 解析表数据行（表头才是数据边界——沿用 agg-delegations splitTables 口径；分隔行/表头行/占位行跳过）
 const rows = secLines
 .filter((l) => /^\|.*\|\s*$/.test(l))
 .filter((l) => !/^\|[\s:|-]+\|\s*$/.test(l))
 .map((l) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, '')))
 .filter((cells) => cells.length >= 3)
 .filter((cells) => !(/^判据/.test(cells[0]) && /^证据/.test(cells[1]))) // 表头行（「判据」「证据」带括号后缀的形态）
 .filter((cells) => !isPlaceholder(cells[0])); // 模板占位行
 const base = path.basename(spec);
 if (!rows.length) {
 warnings.push(`- [WARN 收敛无判据] ${base} 无「验收判据」表或表为空——L2/L3 done spec 须逐条登记可验判据（检查 23，模板 workflow/specs/_TEMPLATE.md）`);
 continue;
 }
 const missed = [];
 for (const [crit, ev, stat] of rows.map((c) => [c[0], c[1], (c[2] || '').trim()])) {
 if (stat === '人工' && isPlaceholder(ev)) continue; // 人工走查判据：空证据合法
 let ok = false;
 if (!isPlaceholder(ev)) {
 if (hard && CMD_RE.test(ev)) ok = commandCovered(ev, d, greenDates);
 else if (CMD_RE.test(ev)) ok = true; // advisory：命令白名单认声明
 else {
 const cands = [];
 for (const m of ev.matchAll(PATH_RE)) cands.push(m[1].replace(/\\/g, '/'));
 // 双认（2026-10-29 done-tree-evidence）：今天存在 ∪ done 提交树存在——关单后删证据不再否决历史承诺
 // 三认（2026-11-10 local-evidence-fallback）：`workflow/evidence/` 被 .gitignore 排除、按设计只存本机；
 //   --rev/--range 把 ROOT 换成临时 worktree，证据文件天然不在那棵树上（2026-11-10 推送实证：
 //   仅引证据文件的判据在 ranged 模式恒判未覆盖）。与 readVerifyLedgerText 同口径回退主工作区；
 //   树上已有文件仍以树为准，非本机证据目录不回退（不让任意缺失路径蒙混过关）。
 const LOCAL_EVIDENCE_PREFIX = 'workflow/evidence/';
 const localEvidenceInMain = (p) => !!MAIN_ROOT
   && path.resolve(MAIN_ROOT) !== path.resolve(ROOT)
   && p.startsWith(LOCAL_EVIDENCE_PREFIX)
   && fs.existsSync(path.join(MAIN_ROOT, p));
 ok = cands.some((p) => fs.existsSync(path.join(ROOT, p)) || doneTreeHasPath(spec, p) || localEvidenceInMain(p));
 }
 }
 if (!ok) missed.push(`${crit}→${ev || '（空）'}`);
 }
 if (missed.length) {
 const detail = `${base} ${rows.length} 条判据中 ${missed.length} 条证据无效（${missed.join('; ')}）`;
 if (hard) blockers.push(`- [收敛未覆盖] ${detail}——状态列自报不作数；命令须是全量门（dotnet test / dotnet build / npm run build / verify.mjs；npm 面命令仅存量 spec 兼容）且 workflow/verify-evidence.md 有不早于本 spec 日期的全绿行；路径只认存在（检查 23，含 .vue 与中文目录）。若本 spec 已标 done：先标后补会与本门互为前提（verify 门序含 check-loop）——解锁序：改正文 → 状态改回 approved（勿改 draft，L3 必须 approved/done）→ confirm-doc 重录指纹 → 再标 done。中间态不要提交`);
 else warnings.push(`- [WARN 收敛未覆盖] ${detail}——状态列自报不作数，证据须存在或为验证命令（检查 23）`);
 }
 }
 }
}
}
