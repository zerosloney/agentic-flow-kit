// verify-scope.mjs — verify.mjs diff 面增量关单的纯逻辑（verify-diet 2026-10-21 ②；复核修复 2026-10-21）
// 口径：--scope 取「基线..HEAD ∪ 工作区(含暂存) ∪ untracked」变更面，未被面触及的产品**重门**跳过；
// 密钥扫描 + wiki 三方一致性 + 关单主干引擎门恒跑（scripts-syntax/workflows-check/rule-budget/
// effective-policy 秒级、check-loop / lane-surface-ci 是关单本体——后端改动可能使 wiki 断言漂移，
// 故 wiki 门也不按面裁剪）。引擎测试面已退役（2026-10-28）：engine-tests 门不存在，.agents/ 不映射门。
// 面触及对应路径 = 相应门自然回列（skipped 收缩）。
// 基线选择：优先「最近一次全量（非 scope）绿行」的 headShort（调用方自本地台账 ∪ 仓库凭证
// workflow/verify-evidence.md 读出，须为 HEAD 祖先），否则回落 merge-base(origin/main, HEAD)。
// 前者让 scope 在长生命特性分支上可用（上次全量绿后只动文档 → 增量）；后者是冷启动基线。
// 基线不可得的两种**环境态**（scope loud-skip 2026-11-17 行为评测②）单独分类：抛出的 Error 带
// scopeSkip 标记（'no-commits' 仓库无任何提交 | 'no-origin' 无 origin 远端或取不到 origin/main
// merge-base），调用方（verify.mjs 显式 --scope）据此 loud-skip exit 0 不判红，降级建议指向
// check-scope.mjs（--base <sha> / --staged）与推送级 check-scope-range 兜底；其余解析失败
// （diff 面为空、git 故障等）不带标记，维持原 fail-loud 口径不变。默认档两态照旧退回全量。
// 仓库凭证兜底（verify-evidence-fallback 2026-10-22）：新 worktree 无本地台账时不再必然重付全量税。
// 两态都**过包含**（基线越旧面越大 → 产品门多跑，安全侧）。
// fail-loud：基线解析失败 / diff 面为空 → 抛错拒增量（跑全量），不猜。
// 产品门单边化 CI（2026-11-08 档 1-B；2026-11-11 增代码四门）：本地增量档（verify.mjs 缺省 / --scope /
// --face）不再执行产品 cohort 5 门（= PRODUCT_FACES 门映射并集）＋代码四门（全仓扫描、不映射任何面，
// 故显式追加，见 CI_UNILATERAL_GATE_IDS），执法点单边移交 CI——本文件的
// 面分类口径（classifyFace / computeDiffScope）不变，单边化裁剪在 verify.mjs 门清单装配处执行。
// 面源三路（复核 P1 修复）：committed diff 须 --no-renames（rename 只报目的地会隐藏产品源路径）、
// 工作区 diff、untracked（ls-files --others——未 add 的新后端文件也必须算面，否则 scope 凭证对
// 「含未编译后端代码的树」做假担保）。凭证：scope 绿行 entry.scope = { mode, base, baseSource,
// skipped, fileCount }——gen-verify-evidence 渲染进摘要行；hasFreshVerifyLine 认其为合法关单凭证
// （面计算已担保「基线以来未触对应产品路径」，与 24h 窗同信任级；关单前新提交须重跑——先提交、后跑门）。

// 产品重门 ←→ 变更面匹配（2026-11-24 faces 单源收尾：面不再写死，派生自项目配置）。
// 面清单单源 = `.agents/config/project-faces.json`（faces.mjs：ui/code/tests/data 前缀）；
// 每面的 gates = `.agents/config/product-gates*.json` 里 folder 与该面路径同树的条目 id。
// face 标签沿用 --face 既有取值（code→backend、ui→frontend；tests/data 同名），docs 是 verify
// CLI 的「无产品面」伪值（只在 --face 合法值表里，不是配置面）；存量调用方
// （--face backend|frontend|docs、审计凭证）零变化。未配置 faces = 空面清单（不裁单边门，保守全跑）；
// 配置解析失败 throw（调用方 fail-closed exit 2，不得静默）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFaces } from './faces.mjs';
let loadProjectRules = () => null;
let extractVerifyCommandGates = () => [];
try {
  const mod = await import('./rules-loader.mjs');
  if (typeof mod?.loadProjectRules === 'function') loadProjectRules = mod.loadProjectRules;
  if (typeof mod?.extractVerifyCommandGates === 'function') extractVerifyCommandGates = mod.extractVerifyCommandGates;
} catch {
  // 当脚本在最小隔离测试夹具中独立运行且未复制 rules-loader.mjs 时平滑降级
}

const ROOT = process.env.FLOW_KIT_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FACE_ORDER = [
  ['code', 'backend'],
  ['ui', 'frontend'],
  ['tests', 'tests'],
  ['data', 'data'],
];

// 前缀命中（大小写不敏感——case-only 改名 / Linux CI 检出下不逃逸）。
const hitPrefix = (prefix, p) => {
  const a = String(prefix || '').replace(/\\/g, '/').toLowerCase();
  const b = String(p || '').replace(/\\/g, '/').toLowerCase();
  if (!a) return false;
  return b === a || b.startsWith(a.endsWith('/') ? a : `${a}/`);
};

// 同树：folder 是该面前缀的祖先 / 后代 / 相等；folder '.'（仓库根）与所有面同树（根级门如
// dotnet backend-build folder='.' 仍归属产品面，保持单边化口径）。
const sameTree = (folder, facePath) => {
  const f = String(folder || '.').replace(/\\/g, '/').replace(/\/+$/, '').replace(/^\.$/, '');
  const p = String(facePath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!f || !p) return true;
  return f === p || p.startsWith(`${f}/`) || f.startsWith(`${p}/`);
};

// product-gates*.json 的 {id, folder} 清单；解析/形状失败 throw（fail-closed）。
export function readProductGateEntries(root) {
  const dir = path.join(root, '.agents', 'config');
  let files;
  try {
    files = fs.readdirSync(dir)
      .filter((f) => f === 'product-gates.json' || /^product-gates\..+\.json$/.test(f)).sort();
  } catch { files = []; }
  const out = [];
  for (const file of files) {
    const rel = path.posix.join('.agents', 'config', file);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch (e) {
      throw new Error(`配置错误：${rel}——项目产品门配置失守（JSON 解析失败：${e.message}）`);
    }
    const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray(raw.gates) ? raw.gates : null);
    if (!list) throw new Error(`配置错误：${rel}——项目产品门配置失守（顶层须为数组或 { "gates": [...] }）`);
    for (const g of list) {
      if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !g.id.trim()) {
        throw new Error(`配置错误：${rel}——项目产品门配置失守（门元素须带字符串 id）`);
      }
      out.push({ id: g.id, folder: typeof g.folder === 'string' && g.folder.trim() ? g.folder : '.' });
    }
  }
  // 规则驱动：若声明式规则定义了 verify command 门，并入产品门清单
  const pr = loadProjectRules(root);
  if (pr) {
    const ruleGates = extractVerifyCommandGates(pr, root);
    for (const rg of ruleGates) {
      if (!out.some((g) => g.id === rg.id)) {
        out.push({ id: rg.id, folder: rg.folder || '.' });
      }
    }
  }
  return out;
}

/**
 * 面清单：project-faces.json 非空的 ui/code/tests/data（未配置 / 四面全空 → 空数组）。
 * 未配置 = 无面可裁（保守全跑），不是「无产品路径」；配置解析失败 → throw。
 * preloaded = 调用方已 loadFaces 的同一份结果（verify 顶部载入一次，避免重复读盘）。
 */
export function loadProductFaces(root = ROOT, preloaded = null) {
  const faces = preloaded || loadFaces(root);
  if (!faces.configured) return [];
  const gates = readProductGateEntries(root);
  const out = [];
  for (const [key, label] of FACE_ORDER) {
    const prefixes = faces[key];
    if (!prefixes.length) continue;
    const ids = [...new Set(gates
      .filter((g) => prefixes.some((p) => sameTree(g.folder, p)))
      .map((g) => g.id))];
    out.push({ face: label, key, gates: ids, match: (f) => prefixes.some((p) => hitPrefix(p, f)) });
  }
  return out;
}

// 代码四门（2026-11-11 owner 拍板接入，审计 P2「--no-verify 远端兜底缺口」：全仓扫描门，
// 不映射任何面，故在此显式追加）。
const CODE_UNILATERAL_GATE_IDS = [
  'code-architecture', 'code-audit-fields', 'code-delete-guard', 'code-notify-guard',
];

// 产品门单边化 CI（2026-11-08 档 1-B，owner 拍板）：本地增量档不执行的产品门集合 = 各面门映射
// 并集（随项目 product-gates 配置演进；docs 面无门自然不入）＋代码四门。verify.mjs 门清单装配与
// 跳过说明行消费。--full/--mid/--product 三档与 CI（azure-pipelines）不受影响。
export function ciUnilateralGateIds(faces = loadProductFaces()) {
  return new Set([...faces.flatMap((pf) => pf.gates), ...CODE_UNILATERAL_GATE_IDS]);
}

// 台账触及面（2026-10-24 复核 P1）：ledger-invariant 不再无条件退 CI-only——本地默认档（diff）在
// commit/worktree/untracked 触及 confirmations 台账或其 manifest 时回列全史扫描（台账改动才付 ~90s），
// 未触及仍 loud-skip。全量档（无 scope）与 CI 照跑。判据只加字段，不改面/skipped 口径
// （避免与既有门表计数、--list 契约耦合）。
export const LEDGER_TOUCH_RE = /^\.agents\/confirmations(?:\.jsonl|\.d\/)|^\.agents\/config\/ledger-.*manifest\.json$/i;

// 引擎测试面退役（2026-10-28，owner 决策）：engine-tests 门与 ENGINE_TEST_FACE 一并删除——
// 引擎改动不再按面触发测试门（.agents/ 全部不再映射到任何门）。产品面不受影响。

// 仓库级绿凭证（verify-evidence-fallback 2026-10-22）：workflow/verify-evidence.md 是入库的追加保全
// 摘要（gen-verify-evidence.mjs 生成），每行 = 某基线提交过全量门禁全绿。本地台账
// （.agents/verifications.jsonl）per-worktree 且 gitignore——新 worktree 无绿行时默认档会退回全量
// （verify.mjs 24h 兜底）。本解析把「仓库级绿行」纳入基线候选：跨树/跨机不再重付全量税；基线仍须过
// merge-base --is-ancestor（非祖先 = 别的分支/rebase 残留，拒用）。
// 只认全量行：末列以 `scope=`（门被裁过）或 `fast=`（engine-tests 降 --fast 的裁剪绿，
// 2026-10-24 复核 P1-5）开头的是增量/降档凭证，不能当全量锚；其余（`—` 或 runId）皆全量。
export const EVIDENCE_REL = 'workflow/verify-evidence.md';
const EVIDENCE_ROW_RE = /^\|\s*`([0-9a-f]{7,40})`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/;

/** 解析摘要文件 → 全量绿行 [{ headShort, ts }]（坏行/表头/scope 行跳过，不抛）。 */
export function parseEvidenceGreens(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.trim().match(EVIDENCE_ROW_RE);
    if (!m) continue;
    // skip-env（2026-10-27 anchor-envskip）：带 CI-only 门跳过标记的绿行实跑门数 < 门表，
    // 与 scope/fast 同属「裁剪凭证」，不得作全量锚（否则跨机基线建立在漏跑门的树上）。
    if (/^(scope|fast|skip-env)=/.test(m[5].trim())) continue;
    const ts = m[2].trim();
    if (!Number.isFinite(Date.parse(ts))) continue;
    out.push({ headShort: m[1], ts });
  }
  return out;
}

/**
 * 纯分类：变更路径数组（POSIX 斜杠）→ { touched:Set<face>, skippedGateIds:string[], matched:string[] }。
 * 路径按「面序」归属——一条路径只归一个面（faces 数组序即面序）。faces 缺省 = 项目配置派生
 * （loadProductFaces；未配置 = 空面清单，skipped 为空——不裁单边门）。
 */
export function classifyFace(files, faces = loadProductFaces()) {
  const touched = new Set();
  const matched = [];
  for (const raw of files || []) {
    const f = String(raw).replace(/\\/g, '/');
    for (const pf of faces) {
      if (pf.match(f)) { touched.add(pf.face); matched.push(f); break; }
    }
  }
  // 门归属可能跨面（folder '.' 的根级门挂在所有面下）：只有「所属面全部未触及」才可跳过，
  // 避免 backend 改动时根级 backend-build 因 untouched frontend 被误裁（旧口径逐门等价）。
  const touchedGateIds = new Set(faces.filter((pf) => touched.has(pf.face)).flatMap((pf) => pf.gates));
  const allGateIds = [...new Set(faces.flatMap((pf) => pf.gates))];
  const skippedGateIds = allGateIds.filter((id) => !touchedGateIds.has(id));
  return { touched, skippedGateIds, matched };
}

/**
 * 组装 scope：git(args) 注入（返回 { status, stdout }，cwd=仓库根），便于夹具测试；
 * baseHint = 调用方选出的「最近全量绿行 headShort」（可为 null）；baseSourceHint = 该 hint 的来源
 * （'ledger' 本地台账 | 'evidence' 仓库凭证），原样写进凭证供审计对质。
 * 返回 { baseShort, baseSource:'ledger'|'evidence'|'origin/main', fileCount, touched, skippedGateIds, matched }；
 * 任何解析失败抛 Error（中文，直出 stderr）。faces 缺省 = 项目配置派生（见 classifyFace）。
 */
export function computeDiffScope(git, baseHint = null, baseSourceHint = 'ledger', faces = loadProductFaces()) {
  const out = (args) => {
    const r = git(args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败——无法确定增量基线（先 git fetch origin，或跑全量 verify）`);
    return String(r.stdout || '').trim();
  };
  // 环境态失败单独分类（带 scopeSkip 标记供调用方 loud-skip；其余失败走 out() 的 fail-loud）。
  const skip = (reason, message) => {
    const e = new Error(message);
    e.scopeSkip = reason;
    throw e;
  };
  const headRev = git(['rev-parse', 'HEAD']);
  if (headRev.status !== 0) {
    // 区分「仓库无任何提交」（rev-list --all 为空且成功）与其他 git 故障——前者是 loud-skip 环境态。
    const empty = git(['rev-list', '-n', '1', '--all']);
    if (empty.status === 0 && !String(empty.stdout || '').trim()) {
      skip('no-commits', '仓库尚无任何提交——diff 面增量基线不可得');
    }
    throw new Error('git rev-parse HEAD 失败——无法确定增量基线（先 git fetch origin，或跑全量 verify）');
  }
  const head = String(headRev.stdout || '').trim();
  let base = null;
  let baseSource = null;
  if (baseHint) {
    const anc = git(['merge-base', '--is-ancestor', baseHint, head]);
    if (anc.status === 0) { base = baseHint; baseSource = baseSourceHint; }
  }
  if (!base) {
    const mb = git(['merge-base', 'origin/main', 'HEAD']);
    if (mb.status !== 0) {
      skip('no-origin', '无 origin 远端（或取不到 origin/main merge-base）——diff 面增量基线不可得');
    }
    base = String(mb.stdout || '').trim();
    baseSource = 'origin/main';
  }
  const baseShort = out(['rev-parse', '--short', base]);
  const committed = out(['-c', 'core.quotepath=off', 'diff', '--name-only', '--no-renames', `${base}..${head}`])
    .split(/\r?\n/).filter(Boolean);
  const worktree = out(['-c', 'core.quotepath=off', 'diff', '--name-only', '--no-renames', 'HEAD'])
    .split(/\r?\n/).filter(Boolean);
  // untracked 亦须 quotepath=off（2026-10-24 复核 M2）：默认 core.quotepath=true 时非 ASCII 路径被
  // 加引号转义（"backend/\344\270\255..."），前缀与扩展名双双失配 → 新后端文件逃出变更面、scope 绿行假担保
  const untracked = out(['-c', 'core.quotepath=off', 'ls-files', '--others', '--exclude-standard'])
    .split(/\r?\n/).filter(Boolean);
  const files = [...new Set([...committed, ...worktree, ...untracked])];
  if (!files.length) {
    throw new Error('diff 面为空（基线以来无任何变更）——无增量依据，跑全量 verify');
  }
  const cls = classifyFace(files, faces);
  return {
    baseShort,
    baseSource,
    fileCount: files.length,
    touched: cls.touched,
    skippedGateIds: cls.skippedGateIds,
    matched: cls.matched,
    // 变更面文件清单（统一斜杠）：供 --scope 档做「只 lint 变更文件」这类按面缩范围的门
    files: files.map((f) => String(f).replace(/\\/g, '/')),
    // 台账触及（ledger-invariant 本地回列判据；见头注 LEDGER_TOUCH_RE）
    ledgerTouched: files.some((f) => LEDGER_TOUCH_RE.test(String(f).replace(/\\/g, '/'))),
  };
}
