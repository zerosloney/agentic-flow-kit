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
//       node .agents/scripts/confirm-doc.mjs <doc...> --to superseded|cancelled（放弃态：取代/取消，留指纹与台账）
//   多文档一次传入：仅 TTY 模式（用户亲手逐份过目键入——天然逐件）；--delegated 一次仅一份
//   （2026-09-27 confirm-gate-one-per-call：多份并录曾系统性塌掉 build.md「逐件确认」三道门）。
// 测试：node templates/_agents/scripts/confirm-doc.test.mjs（纯函数逐项 + 非 TTY spawn 拒绝断言 + 委托场景）
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
export function appendLedger(root, entry) {
  const p = path.join(root, '.agents', 'confirmations.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(entry) + '\n');
  return p;
}

const DOC_RE = /^workflow\/(intents|specs|plans|incidents)\/[^/]+\.md$/;

const isMain = process.argv[1] && process.argv[1].endsWith('confirm-doc.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  let root = process.cwd();
  let delegatedQuote = null; // null = TTY 模式；字符串 = 委托代录的用户对话原话
  let toTarget = null; // null = 默认前向跳转；superseded|cancelled = 放弃态显式目标
  const docs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else if (argv[i] === '--delegated') delegatedQuote = argv[++i] ?? '';
    else if (argv[i] === '--to') toTarget = argv[++i] ?? '';
    else docs.push(argv[i].replace(/\\/g, '/'));
  }
  if (toTarget !== null && !ABANDON_TARGETS.includes(toTarget)) {
    console.error(`用法：--to 仅接受 superseded|cancelled（现「${toTarget}」）——cancelled 自 draft/approved/open/fixed；superseded 自 approved/done/fixed/closed（未确认态只能 cancelled；终态间仅允许 done/closed→superseded）`);
    process.exit(1);
  }
  const delegated = delegatedQuote !== null;
  if (delegated && !String(delegatedQuote).trim()) {
    console.error('用法：--delegated 须带用户对话原话（node .agents/scripts/confirm-doc.mjs <doc...> --delegated "<用户原话>"）——原话入台账供事后对质，不可缺省');
    process.exit(1);
  }
  // TTY 门（仅 TTY 模式；先于文档参数校验）：AI 会话内非委托调用一律拒绝
  // CONFIRM_DOC_TEST_TTY：**仅测试用**逃生门——本测试环境无 TTY，而 TTY 多文档分支
  // （batch 相同 / seq 递增 / of=N）是并录审计的判别基础，必须可测（复核 P2-2）。
  // 该变量只影响 isTTY 判定，不改动任何落态/记账语义；生产路径不设置该变量。
  const ttyForced = process.env.CONFIRM_DOC_TEST_TTY === '1';
  if (!delegated && !ttyForced && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    console.error('确认门须由用户在终端亲手运行（node .agents/scripts/confirm-doc.mjs <workflow/文档>...）——AI 会话内不可代确认；用户对话内明确确认后可用 --delegated "<用户原话>" 委托代录（台账如实记来源）');
    process.exit(1);
  }
  if (!docs.length) {
    console.error('用法：node .agents/scripts/confirm-doc.mjs <workflow/intents|specs|plans/x.md> [...]  [--root <仓库根>] [--delegated "<用户原话>"]');
    process.exit(1);
  }
  if (delegated) {
    console.error('⚠️  委托代录模式：确认语义 = 用户已在对话中明确放行；台账行将如实记 source=chat-delegated 与原话，不伪装 TTY 确认');
    console.error(`   用户原话：「${delegatedQuote}」`);
    // 单文档强制（2026-09-27 confirm-gate-one-per-call）：delegated 没有TTY「逐份过目」的天然机制——
    // 多文档并录曾系统性塌掉三道阶段门（build.md「逐件确认不得并作一次」）。逐件调用：一次一份、
    // 每次带当次用户原话。TTY 形态不受限（用户亲手逐份过目键入，天然逐件）。
    if (docs.length > 1) {
      console.error(`❌ --delegated 一次仅接受一份文档（现 ${docs.length} 份：${docs.join(' ')}）——逐件确认口径（build.md）：每份一次调用、每次带当次用户原话`);
      process.exit(1);
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
    if (!target) {
      console.error(`跳过 ${doc}：当前状态「${st || '缺失'}」无合法跳转（前向：docs draft→approved / approved→done；incidents open→fixed / fixed→closed；放弃 --to：cancelled 自 draft/approved/open/fixed，superseded 自 approved/done/fixed/closed）`);
      continue;
    }
    const fp = computeFingerprint(text);
    if (delegated) {
      fs.writeFileSync(abs, applyTransition(text, target, fp.slice(0, 16)));
      appendLedger(root, {
        ts: new Date().toISOString(), doc, stage: target, fingerprint: fp, prev: st,
        source: 'chat-delegated', quote: String(delegatedQuote),
        // 调用事实（batch-ledger-audit）：seq=本次调用内件序（从 1），of=本次调用总份数
        batch, seq, of: docs.length,
      });
      console.log(`✓ ${doc} ${st} → ${target}（指纹 ${fp.slice(0, 16)}，代录已记账：source=chat-delegated）`);
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
  console.log(`\n完成：确认 ${confirmed} 份 / 跳过 ${docs.length - confirmed} 份${delegated ? '（委托代录）' : ''}`);
  process.exit(0);
}
export default { computeFingerprint, nextStage, applyTransition, appendLedger };
