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
// 台账：默认分片 .agents/confirmations.d/<doc基名>.jsonl（2026-10-13 ledger-shard-default，
//   协议对齐 Shipyard 参考实现；--no-shard / CONFIRM_SHARDED=0 回退主台账 .agents/confirmations.jsonl）
//   ——两者入 git、追加式。每行 {ts, doc, stage, fingerprint(64位), prev, source:"tty"|"chat-delegated",
//   quote?(仅委托行), batch, seq, of}。
//   batch/seq/of（2026-09-28 batch-ledger-audit 新增，纯增字段、向后兼容、历史行不回填）：
//   记「本次进程调用落了几份态」这一**写入时确定已知的事实**——batch 为本次调用生成的短随机串
//   （无时间语义、无全局唯一要求，仅需单台账内不碰撞），seq 为该次调用内件序（从 1），of 为本次
//   调用总份数。check-loop 检查 15 的并录审计据此直读事实判定，不再从 quote 相等 + ts 接近反推
//   （旧判据可被「换 quote」平凡规避、且合规逐件复用同句必然误报——见同名 incident）。
// 指纹：内容 CRLF 归一 → 剔除「确认指纹:」行（防自引用）→ sha256；frontmatter 存前 16 位，台账存全量。
// 用法：node .agents/scripts/confirm-doc.mjs <workflow/intents|x.md> [<doc2>...] [--root <仓库根>]
//       node .agents/scripts/confirm-doc.mjs <doc...> --delegated "<用户对话原话>"（委托代录）
//       node .agents/scripts/confirm-doc.mjs <doc...> --delegated "<原话>" --batch（协作道批量：L1 多份一次代录）
//       node .agents/scripts/confirm-doc.mjs <doc...> --to superseded|cancelled（放弃态：取代/取消，留指纹与台账）
//       node .agents/scripts/confirm-doc.mjs <doc...> --no-shard（回退主台账 .agents/confirmations.jsonl：
//         分片已是默认写入口径，环境变量 CONFIRM_SHARDED=0 同效；里程碑可选跑 compact-ledgers.mjs 归并分片）
//   多文档一次传入：TTY 模式天然逐份过目键入；--delegated 默认一次仅一份（2026-09-27
//   confirm-gate-one-per-call：多份并录曾系统性塌掉 build.md「逐件确认」三道门），L1 协作道可
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
import { execFileSync, spawnSync } from 'node:child_process';
import { readLedgerEntries, readLedgerRows } from './ledger-loader.mjs';
import { confirmGateFor, clarifyGateFor, doneGateFor, laneOfEntry, laneOfDoc } from './stage-gates.mjs';
import { loadKitPolicy, hasFreshVerifyLine, ledgerChainHash, ledgerDocChainActive, ledgerDocChainPrev, scopeDigest } from './policy.mjs';

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
// 哈希链（2026-10-09 engine-quality-round2 D）：每行追加 prevHash 与 hash（ledgerChainHash 单源计算，
//   check-loop 15 同函数验链）——「就地改/删中间行」必留断链痕迹；历史行零回填（无 hash 行后链重启），
//   整文件重写不可机器防（边界声明见 policy.ledgerChainHash）。
// 链域（2026-10-12 ledger-doc-chain）：policy.ledgerDocChainSince 存在且合法 → prevHash 取**同行 doc 的
//   最后一个带 hash 行**（ledgerDocChainPrev），不再取物理末行。理由见 POLICIES v8 注释：物理链隐含
//   「单写者顺序追加」前提，而并发 append / git 并集合并 / 分片归并三种**正常协作**都会打断它。
//   缺键（v1-v7）→ 走旧物理链口径，存量零变化。
// shard（2026-10-12 ledger-shard-write；2026-10-13 ledger-shard-default 升为默认）：多 worktree 并行时
//   两个进程同时 append 同一台账文件会互相覆盖（各自读到同一末行 → 同 prevHash → 后写者覆盖前写者）。
//   分片把本行写入 `.agents/confirmations.d/<doc基名>.jsonl`，各 worktree 各写各的、互不冲突。
//   **默认写分片**（CLI 层；--no-shard / CONFIRM_SHARDED=0 显式回退主台账）——doc 链未激活
//   （policyVersion < 8）时 CLI 层自动回退主台账（见 isMain 内 ledger-shard-default 注释），
//   存量装户升级后行为零变化。函数层契约不变：shard 显式传入，默认 false。
export function appendLedger(root, entry, { shard = false } = {}) {
  const p = shard && entry.doc
    ? path.join(root, '.agents', 'confirmations.d', `${path.basename(entry.doc, '.md')}.jsonl`)
    : path.join(root, '.agents', 'confirmations.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let prevHash = '';
  try {
    if (ledgerDocChainActive(loadKitPolicy(root))) {
      // doc 链取前驱走**台账视图**（主台账 + 分片）而非单个文件：--shard 写入时，该 doc 的历史行
      // 很可能在主台账里，只读分片文件会从 '' 重启 → 链断裂。视图取法天然跨来源衔接。
      const rows = readLedgerEntries(root).map((e) => e.row);
      prevHash = ledgerDocChainPrev(rows, entry.doc);
    } else if (fs.existsSync(p)) {
      // 旧物理链口径：取**本次写入目标文件**的末行 hash（v1-v7 存量行为，逐字不变）
      const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length) {
        const last = JSON.parse(lines[lines.length - 1]);
        prevHash = last && typeof last.hash === 'string' ? last.hash : '';
      }
    }
  } catch { /* 不可解析 → prevHash ''（链从本行重启；断裂由 check-loop 15 出账） */ }
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

// readTrustConfig(root)（2026-10-19 TTL 补漏）：读 .agents/trust-mode.json，并算出**当前是否真生效**。
// 此前两个读点各自 try/catch 裸 parse，enabledAt 只记不消费——授权事实永久有效。现在统一走本函数：
//   expired = expiresAt 存在、可解析、且已过 → **enabled 直接压成 false**（单点生效，未来新增消费方
//   不可能忘记判过期）；expired 标记保留，供错误分支区分「从没开过」与「开过但已到期」。
// 缺/坏文件 → {enabled:false, level:0, expired:false}（fail-closed，与旧口径一致）。
export function readTrustConfig(root) {
  let c = null;
  try {
    c = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'trust-mode.json'), 'utf8'));
  } catch { c = null; }
  if (!c || typeof c !== 'object') return { enabled: false, level: 0, expired: false, expiresAt: null };
  let expired = false;
  if (c.enabled && typeof c.expiresAt === 'string' && c.expiresAt) {
    const t = Date.parse(c.expiresAt);
    // expiresAt 不可解析 → 视为过期（fail-closed：看不懂的时间不当作永久授权）
    expired = !Number.isFinite(t) || Date.now() >= t;
  }
  // 到期 = 未开启：调用方只看 enabled 就得到正确结论，过期判据不依赖每个调用点自觉
  return { ...c, expired, enabled: c.enabled === true && !expired };
}

if (isMain) {
  const argv = process.argv.slice(2);
  let root = process.cwd();
  let delegatedQuote = null; // null = TTY 模式；字符串 = 委托代录的用户对话原话
  let toTarget = null; // null = 默认前向跳转；superseded|cancelled = 放弃态显式目标
  let autoMode = false; // AI 自治模式（信任等级授权，2026-09-30 ai-autonomy-trust）
  let batchMode = false; // 协作道批量代录（--batch，2026-09-30 hybrid-governance-risk-lanes：仅 --delegated + L1）
  let shardWrite = process.env.CONFIRM_SHARDED !== '0'; // 分片默认写入口径（2026-10-13 ledger-shard-default）：CONFIRM_SHARDED=0 显式回退主台账
  const docs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else if (argv[i] === '--delegated') delegatedQuote = argv[++i] ?? '';
    else if (argv[i] === '--to') toTarget = argv[++i] ?? '';
    else if (argv[i] === '--auto') autoMode = true;
    else if (argv[i] === '--batch') batchMode = true;
    else if (argv[i] === '--shard') shardWrite = true;
    else if (argv[i] === '--no-shard') shardWrite = false;
    else docs.push(argv[i].replace(/\\/g, '/'));
  }
  if (toTarget !== null && !ABANDON_TARGETS.includes(toTarget)) {
    console.error(`用法：--to 仅接受 superseded|cancelled（现「${toTarget}」）——cancelled 自 draft/approved/open/fixed；superseded 自 approved/done/fixed/closed（未确认态只能 cancelled；终态间仅允许 done/closed→superseded）`);
    process.exit(1);
  }
  // 分片默认写入口径（2026-10-13 ledger-shard-default，对齐 Shipyard 参考实现）：
  //   确认行默认写 `.agents/confirmations.d/<doc基名>.jsonl`——多 worktree / 多人并行天然各写各的，
  //   互不覆盖；跨分支合并走 .gitattributes 的 union driver（confirmations.d/*.jsonl merge=jsonl-union），
  //   里程碑可选跑 compact-ledgers.mjs 收敛碎片。--no-shard / CONFIRM_SHARDED=0 显式回退主台账。
  // doc 链仍是分片的前提（2026-10-12 ledger-shard-write 口径保留）：分片与主台账分属不同文件，
  //   只有 doc 链能跨来源接续；旧物理链口径下分片行的 prevHash 会与主台账末行失配 → 提交即断链。故：
  //   显式 --shard + doc 链未激活 → 参数期直接拒（友好报错，原口径不变）；
  //   默认分片 + doc 链未激活 → 自动回退主台账并出 ℹ️——存量装户（policyVersion < 8）升级模板后
  //     行为零变化，分片默认仅对 doc 链已激活的装户生效；升级法：.agents/kit.json 设 policyVersion: 8。
  if (argv.includes('--shard') && argv.includes('--no-shard')) {
    console.error('用法：--shard 与 --no-shard 互斥——分片已是默认写入口径，显式回退主台账只需 --no-shard');
    process.exit(1);
  }
  if (shardWrite && !ledgerDocChainActive(loadKitPolicy(root))) {
    if (argv.includes('--shard')) {
      console.error('❌ --shard 需要台账 doc 链口径（policy.ledgerDocChainSince），当前 policyVersion 无此键。\n   原因：分片与主台账是不同文件，只有 doc 链能跨来源接续；旧物理链口径下分片行会与主台账断链。\n   修法：在 .agents/kit.json 设 policyVersion: 8（或更高的支持版本）后重试，或改用 --no-shard 显式写主台账。');
      process.exit(1);
    }
    shardWrite = false; // 存量装户回退：分片默认仅对 doc 链已激活（policyVersion ≥ 8）的装户生效
    console.error('ℹ️ 分片默认写入口径需 doc 链口径（policy.ledgerDocChainSince），当前 policyVersion 未激活——本次写主台账 .agents/confirmations.jsonl。升级法：.agents/kit.json 设 policyVersion: 8。');
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
  // 免旗标自动转入本分支（见「Trusted 自动泳道」）——L1 门 / incidents 排除 / 逐阶段与 done 门照常执行。
  let trustConfig = null;
  if (autoMode) {
    trustConfig = readTrustConfig(root);
    if (!trustConfig.enabled || ![1, 2].includes(trustConfig.level)) {
      if (trustConfig.expired) {
        console.error(`❌ AI 自治授权已于 ${trustConfig.expiresAt} 到期，现按 Strict 拒绝——到期不静默续期（TTL 2026-10-19 补漏：enabledAt 此前只记不消费，授权事实永久有效）。重新开启：node .agents/scripts/trust-mode.mjs --enable --level <1|2>`);
      } else {
        console.error('❌ AI 自治未开启或等级非法（.agents/trust-mode.json enabled=false 或 level∉[1,2]）——跑 node .agents/scripts/trust-mode.mjs --enable --level <1|2> 开启');
      }
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
    console.error(`⚠️  AI 自治模式（Trust L${trustConfig.level}）：仅限 L1 文档；Level 1 只放行 draft→approved，Level 2 放行至 done`);
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
    // --auto 旗标）自动转入 AI 自治放行——单份、非放弃态才可隐式（与 --auto 同口径，L1 门与
    // incidents 排除由主循环自治门照常执行）；不满足则维持原拒绝（fail-closed，Standard/Strict 不隐式）。
    let implicitTrust = readTrustConfig(root);
    if (implicitTrust.enabled && implicitTrust.level === 2 && docs.length === 1 && !toTarget) {
      autoMode = true;
      trustConfig = implicitTrust; // 主循环自治门（L1 与 incidents 排除）直读本配置——顶部 if (autoMode) 块先于 TTY 门执行，须在此补装
      console.error('⚠️  Trusted 自动泳道（隐式）：单份 L1 文档按 AI 自治放行（Level 2 全闭环，台账 source=ai-auto-trust-L2）；L2/L3 与 incidents 仍须人工确认');
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
    // 协作道批量（2026-09-30 hybrid-governance-risk-lanes）：L1 可 `--batch` 多份一次代录——
    // 逐份读「级别」，L2/L3 逐份拒绝（见主循环协作道门）；台账行带 brief:true，检查 15 据此豁免并录告警。
    if (docs.length > 1) {
      if (!batchMode) {
        console.error(`❌ --delegated 一次仅接受一份文档（现 ${docs.length} 份：${docs.join(' ')}）——逐件确认口径（build.md）：每份一次调用、每次带当次用户原话；L1 协作道批量可加 --batch`);
        process.exit(1);
      }
      console.error(`   批量代录（--batch）：${docs.length} 份，仅受理 L1（协作道，异步审计兜底）；L2/L3 逐份拒绝`);
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
    // 待澄清项门（2026-10-12 needs-clarification；2026-10-18 立项跳对称化扩到 intents）：起草期挂
    // 「待澄清」标记**不阻断**（零阻塞），但 draft→approved 确认时若仍挂着未澄清项则拒绝——确认即
    // 「认可这份文档」，文档里还写着「这里我不知道」，确认就没有意义。intents 原不挂本门（旧判例
    // 「澄清天然发生在需求单处」，S19c 旧断言），2026-10-18 推翻：intent 是后链全部文档的种子，
    // 立项时被含混带过的不确定项到 spec/plan 跳已无人能补标——与 specs/plans 同口径挂门。判据与
    // 文档类型无关（clarifyGateFor 只扫正文标记行），存量 intent 无标记零回溯；incidents 生命周期
    // 无 approved 态，不在本门面。与上面的前置门分开出账：拒绝原因必须指向真正的原因（合并会让
    // 作者去查「前置」，而前置其实是好的；前置门只适用于 specs/plans——入口文档无「前置」概念）。
    // ⚠️ 文案锚点硬约束：本段禁止并入上方 gate 分支的输出契约（既有 confirm-doc.test.mjs 断言
    // 锚定「未过逐阶段前置门（stage-gates）」子串），故单列独立分支。
    if (target === 'approved' && (doc.startsWith('workflow/specs/') || doc.startsWith('workflow/plans/')
      || doc.startsWith('workflow/intents/'))) {
      const cl = clarifyGateFor(abs);
      if (!cl.ok) {
        console.error(`❌ ${doc} 含未澄清项（needs-clarification）：${cl.reason}`);
        console.error(`   ${cl.hint}（本份未落账、未写盘）`);
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
    // 关单活文档一致性前置门（泛化自源仓 44390bde）：done/closed 关单时，回归清单引用的
    // 代码路径/流程文档须仍存在（判定单源 check-regression-consistency.mjs——语言无关路径存在性，
    // 易失前缀只 advisory）。独立复核反复抓到「清单残留旧口径」类债却只在复核阶段可见——前移到
    // 关单，防残留进归档。fail-open：检查器异常不拦截（本门属防残留 advisory 族，异常非残留）。
    if (target === 'done' || target === 'closed') {
      try {
        const { scanRegressionRefs } = await import('./check-regression-consistency.mjs');
        const rr = scanRegressionRefs(root);
        const dangling = [...rr.danglingPaths, ...rr.danglingDocs];
        if (dangling.length) {
          console.error(`❌ ${doc} 未过关单活文档一致性门：回归清单引用了不存在的资产（${dangling.length} 处）——`);
          for (const d of dangling.slice(0, 10)) console.error(`   - ${d}`);
          if (dangling.length > 10) console.error(`   … 另 ${dangling.length - 10} 处`);
          console.error('   处理：按回归清单维护规则 4 删除/改写过时条目，或恢复被误删的资产（本份未落账、未写盘）');
          refused++;
          continue;
        }
      } catch (err) {
        console.error(`⚠️  ${doc} 活文档一致性检查执行失败（${err.message}）——不拦截（fail-open），但须人工确认清单无残留`);
      }
    }
    const fp = computeFingerprint(text);
    // 改动面事实（2026-10-09 审查 A1 干净版）：机器派生，三形态（TTY / 委托代录 / AI 自治）一律记入——
    // TTY 形态同样需要（事后对质问的是「放行时盘面上哪些文件在动」，与谁点的确认无关）。
    // 2026-10-19：本注释此前声称三形态都有，实际 TTY 分支漏记——见 :530-538 的补齐注释。
    const scope = machineScope(root, doc);
    // AI 自治放行分支（2026-09-30 ai-autonomy-trust）：
    // ① 仅 L1（读 frontmatter「级别」，缺级别按不可自治处理——fail-closed）；
    // ② Level 1：仅 draft→approved；Level 2：draft→approved 与 approved→done；
    // ③ incidents 永不自治（open→fixed/fixed→closed 必须人工）。
    if (autoMode) {
      const isLowLevel = lane === 'low';
      const stageAllowed = trustConfig.level === 2
        ? (target === 'approved' || target === 'done')
        : target === 'approved';
      if (!isLowLevel || !stageAllowed || doc.startsWith('workflow/incidents/')) {
        console.error(`❌ ${doc} 未过 AI 自治门（级别「${lvl || '缺失'}」/ 泳道「${lane}」/ 目标态「${target}」/ 类型）：Level ${trustConfig.level} 仅授权泳道 low（intent 级别 L1；suspect 须先对齐「级别/risk_level」）的 ${trustConfig.level === 2 ? 'approved/done' : 'approved'} 且不含 incidents`);
        refused++;
        continue;
      }
      fs.writeFileSync(abs, applyTransition(text, target, fp.slice(0, 16)));
      // shard 走第三参 options（不进 entry）：appendLedger(root, entry, { shard }) 的契约是 options 形参，
      // 写进 entry 会让旗标混入台账行数据且分片开关失效（2026-10-13 ledger-shard-default 修复的存量缺陷）。
      appendLedger(root, {
        ts: new Date().toISOString(), doc, stage: target, fingerprint: fp, prev: st,
        source: `ai-auto-trust-L${trustConfig.level}`, quote: `AI 自治放行 (Trust Level ${trustConfig.level})`,
        batch, seq, of: docs.length, scope,
      }, { shard: shardWrite });
      console.log(`✓ ${doc} ${st} → ${target}（指纹 ${fp.slice(0, 16)}，AI 自治已记账：source=ai-auto-trust-L${trustConfig.level}）`);
      confirmed++;
      seq++;
      continue;
    }
    if (delegated) {
      // 协作道门（2026-09-30 hybrid-governance-risk-lanes；2026-10-02 caliber-convergence 起单源泳道）：
      // --batch 批量仅受理泳道 low（intent 级别 L1；suspect 拒）——high/suspect 逐份拒绝落账；
      // 不带 --batch 的单份代录不限级别（既有口径不变）。
      const low = lane === 'low';
      if (batchMode && !low) {
        console.error(`❌ ${doc} 泳道「${lane}」（级别「${lvl || '缺失'}」）不在协作道——--batch 批量代录仅限级别 L1；suspect（级别/risk_level 缺失、非法或分歧）须先对齐两字段，L2/L3 防御道须逐份确认（本份未落账、未写盘）`);
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
        // 简洁审计标记（hybrid-governance-risk-lanes）：L1 协作道行带 brief（quote 仍入账供对质），
        // 检查 15 并录审计对全 brief 批次豁免「确认并录」告警
        ...(low ? { brief: true } : {}),
      }, { shard: shardWrite });
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
      // 改动面事实（2026-10-19 补齐 TTY 缺口）：三形态一律记 scope。此前只 delegated / ai-auto 带，
      // 而 :459-460 的注释声称三形态都有——缺口使 TTY 行在 check 15 scope 段恒报「缺机器改动面」，
      // 是最常见形态吃最多告警。对质问的是「放行时盘面上哪些文件在动」，与谁点的确认无关。
      scope,
    }, { shard: shardWrite });
    console.log(`✓ ${doc} → ${target}（指纹 ${fp.slice(0, 16)}，台账已记）`);
    confirmed++;
    seq++;
  }
  if (rl) rl.close();
  // --- 终态件滚动归档（2026-10-13 archive-on-close；B9 自 Shipyard.Material 回灌，行为边界逐字对齐）---
  // 关单即归档：本进程刚落终态的文档，其同名家族若已全终态且超窗、无活跃引用 → git mv 进
  // workflow/archive/<家族最晚终态月>/{类型}/。动机：archive-sweep 是手工工具、无人跑，活跃目录
  // 无限膨胀（源仓实测 885 篇、733 篇终态零引用——留痕在包源仓 git 历史与 CHANGELOG）；挂进确认门
  // 后活跃目录恒定。判定单源 = archive-sweep.analyze（禁第二套口径）；归档单位 = 同名家族
  // （check-loop 检查 1 的结构配对是家族双向在场审计，单篇归档会造配对断裂——源仓首批返工实证）。
  // 时序：**台账行已写、状态已落盘之后**才 mv——check-loop 检查 15 的内容绑定按台账 doc 路径读
  // 四目录直下文件，归档后该路径不在 buildDocList() 扫描面内，绑定检查自然跳过（归档件不再受
  // 内容绑定约束，与既有归档批次同口径）。失败一律 fail-open：归档是卫生动作，不得回滚已完成的
  // 确认（**归档失败不阻断关单**——与源仓语义逐字一致）。启用锚（照搬源仓，无 policy 锚）：
  // ① 仓库已建立归档约定（workflow/archive/ 存在）——真实装户仓有，临时 fixture 无，避免测试夹具
  //   被静默搬走（也避免在未采纳归档的仓库里凭空造目录）；② env 逃生门 CONFIRM_DOC_NO_ARCHIVE；
  //   ③ 特性分支默认不归档（2026-10-16）：分支上先关单再合并时，diff 只剩
  //   archive/ 路径，泳道/配对增量门只认 workflow 活跃直路径，合法合并被拦。main/master/develop 与
  //   游离 HEAD 维持关单即归档。CONFIRM_DOC_NO_ARCHIVE=1 仍强制关；CONFIRM_DOC_ARCHIVE=1 可在特性分支强制归档。
  const archiveRoot = path.join(root, 'workflow', 'archive');
  let featureHold = false;
  if (confirmed > 0 && !process.env.CONFIRM_DOC_NO_ARCHIVE && process.env.CONFIRM_DOC_ARCHIVE !== '1') {
    let branch = '';
    try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { branch = ''; }
    featureHold = !!branch && branch !== 'HEAD' && !['main', 'master', 'develop'].includes(branch);
    if (featureHold && fs.existsSync(archiveRoot)) {
      console.log(`📦 特性分支 ${branch} 不归档（合并前保持 workflow 活跃路径；main/develop 关单才归档）。CONFIRM_DOC_ARCHIVE=1 可强制`);
    }
  }
  if (confirmed > 0 && !process.env.CONFIRM_DOC_NO_ARCHIVE && !featureHold && fs.existsSync(archiveRoot)) {
    try {
      const { analyze, buildDocList, loadLastTouch, parseStatus, TERMINAL, ACTIVE } = await import('./archive-sweep.mjs');
      // 台账终态锚：kit 读侧单源 = readLedgerRows（主台账+分片透明合并；源仓走
      // loadAllConfirmations——「每 doc 终态行最大日期」的 max 判据对去重口径无语义差，
      // 见 archive-sweep.loadLedgerTs 同款注释）。CONFIRM_DOC_TEST_NOW 仅测试注入，生产不设。
      const ledgerTs = {};
      for (const e of readLedgerRows(root)) {
        if (TERMINAL.has(e.stage) && e.doc) {
          const d = (e.ts || '').slice(0, 10);
          if (d && (!ledgerTs[e.doc] || d > ledgerTs[e.doc])) ledgerTs[e.doc] = d;
        }
      }
      const allDocs = buildDocList(root);
      // 窗口口径：本次确认的文档**刚**落终态，其台账 ts = 今日 → 21 天窗口必然拦下（窗口的用途是
      // 「防归档仍在编辑的在途件」，而刚过确认门的终态件按定义已定稿，窗口对它冗余）。故对本进程
      // 确认过的家族用 windowDays=-1（判据 `floor((today-tTime)/864e5) <= windowDays` 恒 false = 窗口
      // 关闭；注意 0 不等于关闭——0 表示「同日也算未满窗」）；未涉及的家族不在此次归档范围（touched
      // 过滤），历史积压仍走 archive-sweep 手工批次 + 21 天窗口。
      const r = analyze({
        docs: allDocs,
        ledgerTs,
        lastTouch: loadLastTouch(root),
        activeTexts: allDocs.filter((d) => ACTIVE.has(parseStatus(d.text))).map((d) => d.text),
        windowDays: -1,
      });
      // 只归档「本次确认涉及的家族」——不越权清理历史积压（积压走 archive-sweep 手工批次）
      const touched = new Set(docs.map((d) => path.basename(d)));
      const mine = r.candidates.filter((x) => touched.has(x.file));
      if (mine.length) {
        for (const x of mine) {
          const destDir = path.join(root, 'workflow', 'archive', x.month, x.dir);
          fs.mkdirSync(destDir, { recursive: true });
          execFileSync('git', ['mv', x.rel, path.join('workflow', 'archive', x.month, x.dir, x.file)], { cwd: root });
        }
        const fams = new Set(mine.map((x) => x.file));
        console.log(`📦 归档 ${mine.length} 篇 / ${fams.size} 族 → workflow/archive/<终态月>/（家族原子；活跃目录不再累积终态件）`);
      }
    } catch (err) {
      console.error(`⚠️ 归档跳过（fail-open，不影响已完成的确认）：${err.message}`);
    }
  }
  console.log(`\n完成：确认 ${confirmed} 份 / 跳过 ${docs.length - confirmed - refused} 份 / 拒绝 ${refused} 份${delegated ? '（委托代录）' : ''}`);
  process.exit(refused ? 2 : 0);
}
export default { computeFingerprint, nextStage, applyTransition, appendLedger, fmLevel, readTrustConfig };
