#!/usr/bin/env node
// confirm-doc — 用户确认门（2026-09-26 confirm-gate-machine；2026-09-27 confirm-gate-delegated 加委托代录形态；同日 gate-coverage 收 incidents；同日 closing-coverage 加放弃态 --to）
// 唯一确认入口：workflow/{intents,specs,plans} 文档（draft→approved 起草确认 / approved→done 关单确认）
//   与 workflow/incidents 文档（open→fixed 修复落地确认 / fixed→closed 关单确认——不支持 open→closed 单跳，
//   强制两跳留痕；2026-09-28 起 check-loop 15 对账）。放弃态走显式 `--to`（2026-09-27 closing-coverage）：
//   --to cancelled 自 draft/approved/open/fixed（未确认过的东西谈不上被取代）；--to superseded 自
//   approved/done/fixed/closed（已确认/闭环的结论被新档取代）。check-loop 检查 15 按「确认指纹 + 台账配对」
//   对账（四终态另做内容绑定），无记录即 hard-block。
// 两形态：
//   ① TTY 模式（默认）：用户终端亲手运行、逐份过目全文、逐份键入「可以」——非交互环境直接拒绝
//     （AI 会话的 spawnSync 无 TTY，本形态在 AI 手里跑不起来）。
//   ② 委托代录模式（--delegated "<用户对话原话>"，2026-09-27）：用户已在对话中明确放行后，AI 代为
//     落态记账——免 TTY、免逐份问答，但台账行如实记 source:"chat-delegated" + quote:<原话>，
//     永不伪装 TTY 行。调用纪律（AI 须先取得用户对话内明确确认）由 AGENTS.md 确认门条款承载，
//     quote 原话入账供事后对质。
// 台账：.agents/confirmations.jsonl（入 git、追加式）——每行 {ts, doc, stage, fingerprint(64位), prev,
//   source:"tty"|"chat-delegated", quote?(仅委托行), batch, seq, of}。
//   batch/seq/of（2026-09-28 batch-ledger-audit 新增，纯增字段、向后兼容、历史行不回填）：
//   记「本次进程调用落了几份态」这一**写入时确定已知的事实**——batch 为本次调用生成的短随机串
//   （无时间语义、无全局唯一要求，仅需单台账内不碰撞），seq 为该次调用内件序（从 1），of 为本次
//   调用总份数。check-loop 检查 15 的并录审计据此直读事实判定，不再从 quote 相等 + ts 接近反推
//   （旧判据可被「换 quote」平凡规避、且合规逐件复用同句必然误报——见同名 incident）。
// 指纹：内容 CRLF 归一 → 剔除「确认指纹:」行（防自引用）→ sha256；frontmatter 存前 16 位，台账存全量。
// 用法：node .agents/scripts/confirm-doc.mjs <workflow/intents|x.md> [<doc2>...] [--root <仓库根>]
//       node .agents/scripts/confirm-doc.mjs <doc...> --delegated "<用户对话原话>"（委托代录）
//       node .agents/scripts/confirm-doc.mjs <doc...> --delegated "<原话>" --batch（协作道批量：L0/L1 多份一次代录）
//       node .agents/scripts/confirm-doc.mjs <doc...> --to superseded|cancelled（放弃态：取代/取消，留指纹与台账）
//   多文档一次传入：TTY 模式天然逐份过目键入；--delegated 默认一次仅一份（2026-09-27
//   confirm-gate-one-per-call：多份并录曾系统性塌掉 build.md「逐件确认」三道门），L0/L1 协作道可
//   `--batch` 多份一次代录（2026-09-30 hybrid-governance-risk-lanes）：逐份读「级别」，L2/L3 逐份拒绝
//   （防御道不批量）；台账行带 `brief:true` 简洁审计标记（quote 原话仍入账供对质），check-loop 检查 15
//   并录审计对全行带标记的批次豁免「确认并录」告警。--auto 一次仍仅一份（自治放行不批量）。
// 逐阶段前置门（2026-09-30 stage-gate-machine）：specs/plans 的 draft→approved 须同主题入口已确认
//   （plan 另须入口级别 L2/L3 时同名 spec 已确认；判定口径见 stage-gates.mjs）——未过拒绝落账：
//   不写盘、不 append 台账、该份计为「拒绝」，任一被拒进程 exit 2。
// 测试：node templates/_agents/scripts/confirm-doc.test.mjs（纯函数逐项 + 非 TTY spawn 拒绝断言 + 委托场景）
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { confirmGateFor, doneGateFor, laneOfEntry, laneOfDoc } from './stage-gates.mjs';
import { loadKitPolicy, hasFreshVerifyLine, ledgerChainHash, scopeDigest } from './policy.mjs';

// hasFreshVerify(root, doc)：读 <root>/.agents/verifications.jsonl 判 24h 窗口绿行（判定单源
// policy.hasFreshVerifyLine）。只读，台账缺失/不可读一律 false（=无凭证，advisory 层 fail-open）。
// doc 绑定（2026-10-08 verify-doc-binding）：非空时只认 e.doc === doc 的绿行——不带 doc 的绿行
// （CI 场景）与**别的单**的绿行都不给本单背证。调用方负责「仅 v6+ 才传 doc」，本函数不做版本判断。
function hasFreshVerify(root, doc = null) {
  try {
    const p = path.join(root, '.agents', 'verifications.jsonl');
    if (!fs.existsSync(p)) return false;
    return hasFreshVerifyLine(fs.readFileSync(p, 'utf8').split(/\r?\n/), Date.now(), doc);
  } catch {
    return false;
  }
}

// docRelOf：把用户传入的 doc 路径归一成「相对仓库根的 posix 相对路径」——与 verify.mjs --doc 的落账口径
// 必须逐字一致（一个转得动、另一个转不动 = 凭证永远匹配不上）。win32 反斜杠 / posix / 绝对路径三者同值。
function docRelOf(root, doc) {
  try {
    return path.relative(root, path.resolve(root, doc)).split(path.sep).join('/');
  } catch {
    return doc;
  }
}

// gitDirtyFiles(root)：机器实测的「工作树处于改动态的文件集合」（已跟踪改动 + 未跟踪新件，gitignore 项天然排除）。
//   解析 `git status --porcelain`（-z 不用，逐行解析足够；重命名行取 `->` 后段）。
//   非 git 仓库 / git 不可用 / 命令失败 → []（**静默降级为「无额外改动面」而非假装有**——scope 退化成
//   只含被确认文档本身，仍然自洽可验；不因探测失败而拒绝关单）。
function gitDirtyFiles(root) {
  try {
    const r = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8', timeout: 10_000 });
    if (r.status !== 0 || !r.stdout) return [];
    return r.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const p = line.slice(3).trim();
      const arrow = p.lastIndexOf(' -> ');
      const rel = arrow >= 0 ? p.slice(arrow + 4) : p;
      return rel.replace(/^"(.*)"$/, '$1');
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// machineScope(root, doc)：落账用的改动面事实（2026-10-09 审查 A1 干净版）。
//   **AI 无输入面**——files 全部由机器派生（被确认文档 + git 实测工作树改动集），不是调用方能填的参数。
//   这正是相对旧设计的核心改进：旧的 quote 是 AI 自填的自由文本（可复用、可伪造、机器不可校验）；
//   scope 是机器事实，AI 填不了假，对质时问的是「这 N 个文件」而非「一句说过的话」。
//   归一/摘要计算单源在 policy.scopeDigest（check-loop 检查 15 侧校验复用同一实现）。
export function machineScope(root, doc) {
  return scopeDigest([docRelOf(root, doc), ...gitDirtyFiles(root)]);
}
// computeFingerprint(text)：CRLF 归一 → 剔指纹行 → sha256 hex（64 位）
export function computeFingerprint(text) {
  const norm = String(text).replace(/\r\n/g, '\n').split('\n')
    .filter((l) => !/^确认指纹:/.test(l))
    .join('\n');
  return createHash('sha256').update(norm, 'utf8').digest('hex');
}

// nextStage(status)：唯一合法前向跳转（docs 两跳 + incidents 两跳）；其余（done/closed/superseded/cancelled/缺失）返回 null
export function nextStage(status) {
  if (status === 'draft') return 'approved';
  if (status === 'approved') return 'done';
  if (status === 'open') return 'fixed'; // incidents：修复落地确认（三件套全落地）
  if (status === 'fixed') return 'closed'; // incidents：关单确认（防复发验证已落地）
  return null;
}

// 放弃态跳转表（2026-09-27 closing-coverage）：cancelled 自未确认/进行态，superseded 自已确认态——
// draft/open 未被确认过，谈不上「被取代」，只能 cancelled；终态间仅允许 done/closed→superseded（结论被新档取代），其余互跳拒绝
const CANCELLABLE = new Set(['draft', 'approved', 'open', 'fixed']);
const SUPERSEDABLE = new Set(['approved', 'done', 'fixed', 'closed']);
export const ABANDON_TARGETS = ['superseded', 'cancelled'];

// resolveTransition(status, to)：带 --to 目标的跳转裁决（pure）。to 为空 = 默认前向（nextStage）；
// to ∈ {superseded, cancelled} 按上表判合法性；其余值或非法组合返回 null
export function resolveTransition(status, to) {
  if (!to) return nextStage(status);
  if (to === 'cancelled') return CANCELLABLE.has(status) ? 'cancelled' : null;
  if (to === 'superseded') return SUPERSEDABLE.has(status) ? 'superseded' : null;
  return null;
}

// applyTransition(text, targetStage, fingerprint16)：frontmatter 内只改「状态:」行值 + 增/换「确认指纹:」行，
// 其余字节原样保留；无 frontmatter（首行非 ---）或未闭合 → 返回 null（调用方跳过不写）
export function applyTransition(text, targetStage, fingerprint16) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  if (!/^---\s*$/.test(lines[0] || '')) return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) { end = i; break; }
  }
  if (end === -1) return null;
  let hasStatus = false;
  let hasFp = false;
  for (let i = 1; i < end; i++) {
    if (!hasStatus && /^状态:/.test(lines[i])) { lines[i] = `状态: ${targetStage}`; hasStatus = true; }
    else if (!hasFp && /^确认指纹:/.test(lines[i])) { lines[i] = `确认指纹: ${fingerprint16}`; hasFp = true; }
  }
  const fm = lines.slice(1, end);
  if (!hasStatus) fm.unshift(`状态: ${targetStage}`); // 防御：无状态键本应被 nextStage 拦，不至此
  if (!hasFp) fm.push(`确认指纹: ${fingerprint16}`);
  return [lines[0], ...fm, ...lines.slice(end)].join('\n');
}

// appendLedger(root, entry)：追加一行 JSON（目录不存在自动建；只 append 不重写）
// 哈希链（2026-10-09 engine-quality-round2 D）：每行追加 prevHash（末行 hash，末行无 hash/空文件 → ''）
//   与 hash（ledgerChainHash 单源计算，check-loop 15 同函数验链）——「就地改/删中间行」必留断链痕迹；
//   历史行零回填（无 hash 行后链重启），整文件重写不可机器防（边界声明见 policy.ledgerChainHash）。
export function appendLedger(root, entry) {
  const p = path.join(root, '.agents', 'confirmations.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let prevHash = '';
  try {
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length) {
        const last = JSON.parse(lines[lines.length - 1]);
        prevHash = last && typeof last.hash === 'string' ? last.hash : '';
      }
    }
  } catch { /* 末行不可解析 → prevHash ''（链从本行重启；断裂由 check-loop 15 出账） */ }
  const { hash: _h, prevHash: _p, ...rest } = entry;
  const row = { ...rest, prevHash, hash: ledgerChainHash(rest, prevHash) };
  fs.appendFileSync(p, JSON.stringify(row) + '\n');
  return p;
}

const DOC_RE = /^workflow\/(intents|specs|plans|incidents)\/[^/]+\.md$/;

// fmLevel(nl)：frontmatter「级别:」值（无 frontmatter / 无该键 → ''）——AI 自治门与协作道批量门共用
export function fmLevel(nl) {
  if (!/^---\s*$/.test(nl[0] || '')) return '';
  for (let i = 1; i < nl.length && !/^---\s*$/.test(nl[i]); i++) {
    const m = nl[i].match(/^级别:\s*(.*)$/);
    if (m) return m[1].trim();
  }
  return '';
}

const isMain = process.argv[1] && process.argv[1].endsWith('confirm-doc.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  let root = process.cwd();
  let delegatedQuote = null; // null = TTY 模式；字符串 = 委托代录的用户对话原话
  let toTarget = null; // null = 默认前向跳转；superseded|cancelled = 放弃态显式目标
  let autoMode = false; // AI 自治模式（信任等级授权，2026-09-30 ai-autonomy-trust）
  let batchMode = false; // 协作道批量代录（--batch，2026-09-30 hybrid-governance-risk-lanes：仅 --delegated + L0/L1）
  const docs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else if (argv[i] === '--delegated') delegatedQuote = argv[++i] ?? '';
    else if (argv[i] === '--to') toTarget = argv[++i] ?? '';
    else if (argv[i] === '--auto') autoMode = true;
    else if (argv[i] === '--batch') batchMode = true;
    else docs.push(argv[i].replace(/\\/g, '/'));
  }
  if (toTarget !== null && !ABANDON_TARGETS.includes(toTarget)) {
    console.error(`用法：--to 仅接受 superseded|cancelled（现「${toTarget}」）——cancelled 自 draft/approved/open/fixed；superseded 自 approved/done/fixed/closed（未确认态只能 cancelled；终态间仅允许 done/closed→superseded）`);
    process.exit(1);
  }
  const delegated = delegatedQuote !== null;
  if (delegated && autoMode) {
    console.error('❌ --auto 与 --delegated 互斥：自治模式是用户预先授权的机器放行，委托代录是单次对话确认');
    process.exit(1);
  }
  if (batchMode && autoMode) {
    console.error('❌ --batch 与 --auto 互斥：批量代录是协作道的对话委托形态，自治放行不批量（一次一份）');
    process.exit(1);
  }
  if (batchMode && toTarget) {
    console.error('❌ --batch 不支持 --to 放弃态——放弃须逐份显式确认，不批量');
    process.exit(1);
  }
  // AI 自治门（2026-09-30 ai-autonomy-trust；2026-09-30 hybrid-governance-explore-hardening 加隐式形态）：
  // 读 .agents/trust-mode.json。除显式 --auto 外，Trusted（level=2）下的非 TTY 单份调用在 TTY 门处
  // 免旗标自动转入本分支（见「Trusted 自动泳道」）——L0/L1 门 / incidents 排除 / 逐阶段与 done 门照常执行。
  let trustConfig = null;
  if (autoMode) {
    try {
      trustConfig = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'trust-mode.json'), 'utf8'));
    } catch { trustConfig = { enabled: false, level: 0 }; }
    if (!trustConfig.enabled || ![1, 2].includes(trustConfig.level)) {
      console.error('❌ AI 自治未开启或等级非法（.agents/trust-mode.json enabled=false 或 level∉[1,2]）——跑 node .agents/scripts/trust-mode.mjs --enable --level <1|2> 开启');
      process.exit(1);
    }
    if (toTarget) {
      console.error('❌ AI 自治模式不支持 --to 放弃态（放弃态必须由用户显式确认）');
      process.exit(1);
    }
    if (docs.length > 1) {
      console.error('❌ AI 自治模式一次仅接受一份文档（与 --delegated 同口径，逐件放行）');
      process.exit(1);
    }
    console.error(`⚠️  AI 自治模式（Trust L${trustConfig.level}）：仅限 L0/L1 文档；Level 1 只放行 draft→approved，Level 2 放行至 done`);
  }
  if (delegated && !String(delegatedQuote).trim()) {
    console.error('用法：--delegated 须带用户对话原话（node .agents/scripts/confirm-doc.mjs <doc...> --delegated "<用户原话>"）——原话入台账供事后对质，不可缺省');
    process.exit(1);
  }
  // TTY 门（仅 TTY 模式；先于文档参数校验）：AI 会话内非委托调用一律拒绝
  // CONFIRM_DOC_TEST_TTY：**仅测试用**逃生门——本测试环境无 TTY，而 TTY 多文档分支
  // （batch 相同 / seq 递增 / of=N）是并录审计的判别基础，必须可测（复核 P2-2）。
  // 双条件（2026-09-28 check16-inline-debt）：须同时 NODE_ENV === 'test' 才放行——单看
  // 「TEST」字样的变量名不构成机器约束，AI 会话可能「顺手」在生产路径设置它绕过 TTY 门；
  // 加 NODE_ENV 双条件后，生产路径（不设 NODE_ENV=test）即便误设 CONFIRM_DOC_TEST_TTY 也不生效。
  // **信任边界声明（沿 check8-git-anchor 口径）**：本地信任边界内不可机器防——环境变量终究可被
  // 本机进程任意设置，刻意伪造 `NODE_ENV=test CONFIRM_DOC_TEST_TTY=1` 仍可绕过，与伪造 git 时间戳 /
  // 手改台账同属事后对质（git 历史与台账）兜底的范畴；此处只把「顺手设置单变量」的成本抬到
  // 「主动伪造双变量组合」，不宣称「通道已关闭」。
  // 两变量只影响 isTTY 判定，不改动任何落态/记账语义；生产路径不设置这两个变量。
  const ttyForced = process.env.CONFIRM_DOC_TEST_TTY === '1' && process.env.NODE_ENV === 'test';
  if (!delegated && !autoMode && !ttyForced && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    // Trusted 自动泳道（2026-09-30 hybrid-governance-explore-hardening）：trust-mode.json 为 Trusted
    // （enabled 且 level=2）时，非 TTY 调用（AI 会话）对文档**免手工触发**（无需 --delegated 原话 /
    // --auto 旗标）自动转入 AI 自治放行——单份、非放弃态才可隐式（与 --auto 同口径，L0/L1 门与
    // incidents 排除由主循环自治门照常执行）；不满足则维持原拒绝（fail-closed，Standard/Strict 不隐式）。
    let implicitTrust = null;
    try {
      implicitTrust = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'trust-mode.json'), 'utf8'));
    } catch { implicitTrust = { enabled: false, level: 0 }; }
    if (implicitTrust.enabled && implicitTrust.level === 2 && docs.length === 1 && !toTarget) {
      autoMode = true;
      trustConfig = implicitTrust; // 主循环自治门（L0/L1 与 incidents 排除）直读本配置——顶部 if (autoMode) 块先于 TTY 门执行，须在此补装
      console.error('⚠️  Trusted 自动泳道（隐式）：单份 L0/L1 文档按 AI 自治放行（Level 2 全闭环，台账 source=ai-auto-trust-L2）；L2/L3 与 incidents 仍须人工确认');
    } else {
      console.error('确认门须由用户在终端亲手运行（node .agents/scripts/confirm-doc.mjs <workflow/文档>...）——AI 会话内不可代确认；用户对话内明确确认后可用 --delegated "<用户原话>" 委托代录（台账如实记来源）');
      process.exit(1);
    }
  }
  if (!docs.length) {
    console.error('用法：node .agents/scripts/confirm-doc.mjs <workflow/intents|specs|plans/x.md> [...]  [--root <仓库根>] [--delegated "<用户原话>" [--batch]]');
    process.exit(1);
  }
  if (delegated) {
    console.error('⚠️  委托代录模式：确认语义 = 用户已在对话中明确放行；台账行将如实记 source=chat-delegated 与原话，不伪装 TTY 确认');
    console.error(`   用户原话：「${delegatedQuote}」`);
    // 单文档默认（2026-09-27 confirm-gate-one-per-call）：delegated 没有TTY「逐份过目」的天然机制——
    // 多文档并录曾系统性塌掉三道阶段门（build.md「逐件确认不得并作一次」）。逐件调用：一次一份、
    // 每次带当次用户原话。TTY 形态不受限（用户亲手逐份过目键入，天然逐件）。
    // 协作道批量（2026-09-30 hybrid-governance-risk-lanes）：L0/L1 可 `--batch` 多份一次代录——
    // 逐份读「级别」，L2/L3 逐份拒绝（见主循环协作道门）；台账行带 brief:true，检查 15 据此豁免并录告警。
    if (docs.length > 1) {
      if (!batchMode) {
        console.error(`❌ --delegated 一次仅接受一份文档（现 ${docs.length} 份：${docs.join(' ')}）——逐件确认口径（build.md）：每份一次调用、每次带当次用户原话；L0/L1 协作道批量可加 --batch`);
        process.exit(1);
      }
      console.error(`   批量代录（--batch）：${docs.length} 份，仅受理 L0/L1（协作道，异步审计兜底）；L2/L3 逐份拒绝`);
    }
  }
  // 调用事实（2026-09-28 batch-ledger-audit）：本次进程调用的批次标识与件序——
  // 供 check-loop 检查 15 的并录审计直读（替代「同 quote + ts 接近」的反推）。
  const batch = randomBytes(3).toString('hex');
  let seq = 1;
  // 应答来源（**仅测试用**注入，见 CONFIRM_DOC_TEST_ANSWERS）：TTY 多文档路径的 batch/seq/of 是并录
  // 审计的判别基础，必须可端到端验证；而 spawnSync 的管道 stdin 是「写完即关」，readline 会在第二个
  // question 注册前吞掉后续行、且 stdin 已 EOF → 第 2 份必然挂住（**不是无 TTY 的限制**，是管道 EOF；
  // 2026-09-28 复核 P2-2 更正：此前测试注释把根因误记为「管道输入不被逐次消费」）。
  // 故提供问答注入：按序取预置应答，绕开 stdin/EOF 时序，不改动任何落态与记账语义。
  const injected = process.env.CONFIRM_DOC_TEST_ANSWERS !== undefined
    ? String(process.env.CONFIRM_DOC_TEST_ANSWERS).split(',').map((s) => s.trim())
    : null;
  const rl = delegated || injected ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => {
    if (injected) {
      process.stdout.write(q);
      return res(injected.shift() ?? '');
    }
    return rl.question(q, res);
  });
  let confirmed = 0;
  let refused = 0; // 逐阶段前置门拒绝数（exit 2 信号；2026-09-30 stage-gate-machine）
  for (const doc of docs) {
    if (!DOC_RE.test(doc)) {
      console.error(`跳过 ${doc}：路径须匹配 workflow/{intents,specs,plans,incidents}/<文件>.md`);
      continue;
    }
    const abs = path.join(root, doc);
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); }
    catch { console.error(`跳过 ${doc}：文件不可读`); continue; }
    // 状态键只在 frontmatter 区（首 --- 至闭合 ---）取——防正文误命中
    const nl = text.replace(/\r\n/g, '\n').split('\n');
    let st = '';
    if (/^---\s*$/.test(nl[0] || '')) {
      for (let i = 1; i < nl.length && !/^---\s*$/.test(nl[i]); i++) {
        const m = nl[i].match(/^状态:\s*(.*)$/);
        if (m) { st = m[1].trim(); break; }
      }
    }
    const target = resolveTransition(st, toTarget);
    const lvl = fmLevel(nl); // 级别（AI 自治门 / 协作道批量门共用；缺 = ''）
    // 泳道单源（2026-10-02 caliber-convergence 方案 C 分歧双严）：intent 双字段（级别+risk_level，协议
    // 锚 policy.riskLevelSince）三态判定；其余件级别单字段。suspect（缺失/非法/分歧）按 high——--auto
    // 与 --batch 均不受理，须先两字段对齐（fill-intent 双写口径）。
    const fmOf = (key) => {
      const m = nl.find((l) => l.startsWith(`${key}:`));
      return m ? m.slice(key.length + 1).trim() : '';
    };
    const lane = doc.includes('/intents/')
      ? laneOfEntry(lvl, fmOf('risk_level'), loadKitPolicy(root).riskLevelSince, fmOf('日期'))
      : laneOfDoc(lvl);
    if (!target) {
      console.error(`跳过 ${doc}：当前状态「${st || '缺失'}」无合法跳转（前向：docs draft→approved / approved→done；incidents open→fixed / fixed→closed；放弃 --to：cancelled 自 draft/approved/open/fixed，superseded 自 approved/done/fixed/closed）`);
      continue;
    }
    // 逐阶段前置门（2026-09-30 stage-gate-machine）：specs/plans 的 draft→approved 须前置已确认
    // （plan 另须入口级别 L2/L3 时同名 spec 已确认）——未过拒绝落账（不写盘、不 append 台账）。
    if (target === 'approved' && (doc.startsWith('workflow/specs/') || doc.startsWith('workflow/plans/'))) {
      const gate = confirmGateFor(root, doc);
      if (!gate.ok) {
        console.error(`❌ ${doc} 未过逐阶段前置门（stage-gates）：${gate.reason}`);
        console.error(`   ${gate.hint}（本份未落账、未写盘）`);
        refused++;
        continue;
      }
    }
    // done 前置门（2026-09-30 confirm-gate-approved-history）：→done 须 git 历史已留 approved 态
    // （先 done 后提交 / 两跳同批提交 → 拒绝；防「确认态缺失」缺陷复发；判据单源见 stage-gates.doneGateFor）。
    if (target === 'done') {
      const gate = doneGateFor(root, abs, doc);
      if (!gate.ok) {
        console.error(`❌ ${doc} 未过 done 前置门（approved 历史）：${gate.reason}`);
        console.error(`   ${gate.hint}（本份未落账、未写盘）`);
        refused++;
        continue;
      }
    }
    // 测试绿凭证前置（2026-10-07 verify-evidence，advisory 不拦）：→done 且文档含「验收标准」节且
    // policy v5（verifySince）→ 24h 窗口内须有 verifications.jsonl 绿行。只读判定，任何读取异常降级
    // 静默（fail-open——advisory 层不因台账缺失/坏行阻断关单）；升 hard 走后续 policyVersion 演进。
    // 2026-10-08 verify-doc-binding：v6+（verifyDocSince）时按本 doc 精确匹配绿行——他单的绿行不再
    // 给本单背书；v1-v5 维持 v5 全局行为逐字不变。
    // ⚠️ 文案锚点硬约束（既有 confirm-doc.test.mjs 断言锚定子串，零改动前提）：
    // 「无测试绿凭证」六字须**连续**，doc 与命令只能追加在其后——不得写成「无本单（x）的测试绿凭证」。
    if (target === 'done' && typeof loadKitPolicy(root).verifySince === 'string'
      && /^##\s*[^#]*验收标准/m.test(text)) {
      const pol = loadKitPolicy(root);
      const rel = docRelOf(root, doc);
      const bound = typeof pol.verifyDocSince === 'string' ? rel : null;
      if (!hasFreshVerify(root, bound)) {
        console.error(`⚠️ ${doc} 置 done：24h 内无测试绿凭证（${bound ? `本单 ${rel} 须带 --doc 落账` : '凭证未按单绑定'}）——关单勾验的「测试绿」声明缺机器事实`);
        console.error(`   跑 node .agents/scripts/verify.mjs${bound ? ` --doc ${rel}` : ''} 后重新关单；本次不拦截（advisory，灰度第一档）`);
      }
    }
    const fp = computeFingerprint(text);
    // 改动面事实（2026-10-09 审查 A1 干净版）：机器派生，三形态（TTY / 委托代录 / AI 自治）一律记入——
    // TTY 形态同样需要（事后对质问的是「放行时盘面上哪些文件在动」，与谁点的确认无关）。
    const scope = machineScope(root, doc);
    // AI 自治放行分支（2026-09-30 ai-autonomy-trust）：
    // ① 仅 L0/L1（读 frontmatter「级别」，缺级别按不可自治处理——fail-closed）；
    // ② Level 1：仅 draft→approved；Level 2：draft→approved 与 approved→done；
    // ③ incidents 永不自治（open→fixed/fixed→closed 必须人工）。
    if (autoMode) {
      const isLowLevel = lane === 'low';
      const stageAllowed = trustConfig.level === 2
        ? (target === 'approved' || target === 'done')
        : target === 'approved';
      if (!isLowLevel || !stageAllowed || doc.startsWith('workflow/incidents/')) {
        console.error(`❌ ${doc} 未过 AI 自治门（级别「${lvl || '缺失'}」/ 泳道「${lane}」/ 目标态「${target}」/ 类型）：Level ${trustConfig.level} 仅授权泳道 low（intent 两字段一致 L0/L1；suspect 须先对齐「级别/risk_level」）的 ${trustConfig.level === 2 ? 'approved/done' : 'approved'} 且不含 incidents`);
        refused++;
        continue;
      }
      fs.writeFileSync(abs, applyTransition(text, target, fp.slice(0, 16)));
      appendLedger(root, {
        ts: new Date().toISOString(), doc, stage: target, fingerprint: fp, prev: st,
        source: `ai-auto-trust-L${trustConfig.level}`, quote: `AI 自治放行 (Trust Level ${trustConfig.level})`,
        batch, seq, of: docs.length, scope,
      });
      console.log(`✓ ${doc} ${st} → ${target}（指纹 ${fp.slice(0, 16)}，AI 自治已记账：source=ai-auto-trust-L${trustConfig.level}）`);
      confirmed++;
      seq++;
      continue;
    }
    if (delegated) {
      // 协作道门（2026-09-30 hybrid-governance-risk-lanes；2026-10-02 caliber-convergence 起单源泳道）：
      // --batch 批量仅受理泳道 low（intent 两字段一致 L0/L1；suspect 拒）——high/suspect 逐份拒绝落账；
      // 不带 --batch 的单份代录不限级别（既有口径不变）。
      const low = lane === 'low';
      if (batchMode && !low) {
        console.error(`❌ ${doc} 泳道「${lane}」（级别「${lvl || '缺失'}」）不在协作道——--batch 批量代录仅限两字段一致的 L0/L1；suspect（级别/risk_level 缺失、非法或分歧）须先对齐两字段，L2/L3 防御道须逐份确认（本份未落账、未写盘）`);
        refused++;
        continue;
      }
      fs.writeFileSync(abs, applyTransition(text, target, fp.slice(0, 16)));
      appendLedger(root, {
        ts: new Date().toISOString(), doc, stage: target, fingerprint: fp, prev: st,
        source: 'chat-delegated', quote: String(delegatedQuote),
        // 调用事实（batch-ledger-audit）：seq=本次调用内件序（从 1），of=本次调用总份数
        batch, seq, of: docs.length,
        // 改动面事实（A1 干净版）：quote 降级为「人类可读摘要」，分辨力改由 scope（机器派生）+ fingerprint
        // （文档内容）承担——「不复用同句」纪律据此退役（复用一句摘要不再削弱任何判据）。
        scope,
        // 简洁审计标记（hybrid-governance-risk-lanes）：L0/L1 协作道行带 brief（quote 仍入账供对质），
        // 检查 15 并录审计对全 brief 批次豁免「确认并录」告警
        ...(low ? { brief: true } : {}),
      });
      console.log(low
        ? `✓ ${doc} ${st} → ${target} [${lvl} 协作道/异步审计]（指纹 ${fp.slice(0, 16)}）`
        : `✓ ${doc} ${st} → ${target}（指纹 ${fp.slice(0, 16)}，代录已记账：source=chat-delegated）`);
      confirmed++;
      seq++;
      continue;
    }
    console.log('\n'.repeat(3) + '='.repeat(72));
    console.log(`文档：${doc}    状态：${st} → ${target}    指纹：${fp.slice(0, 16)}`);
    console.log('='.repeat(72));
    console.log(text);
    console.log('='.repeat(72));
    const ans = (await ask(`键入"可以"确认本份（${st} → ${target}），其他任意输入跳过：`)).trim();
    if (ans !== '可以') {
      console.log(`× 已跳过 ${doc}（未落状态）`);
      continue;
    }
    fs.writeFileSync(abs, applyTransition(text, target, fp.slice(0, 16)));
    appendLedger(root, {
      ts: new Date().toISOString(), doc, stage: target, fingerprint: fp, prev: st,
      source: 'tty',
      batch, seq, of: docs.length, // 调用事实（形态无关：TTY 多文档天然逐件过目，of>1 不构成违规）
    });
    console.log(`✓ ${doc} → ${target}（指纹 ${fp.slice(0, 16)}，台账已记）`);
    confirmed++;
    seq++;
  }
  if (rl) rl.close();
  console.log(`\n完成：确认 ${confirmed} 份 / 跳过 ${docs.length - confirmed - refused} 份 / 拒绝 ${refused} 份${delegated ? '（委托代录）' : ''}`);
  process.exit(refused ? 2 : 0);
}
export default { computeFingerprint, nextStage, applyTransition, appendLedger, fmLevel };
