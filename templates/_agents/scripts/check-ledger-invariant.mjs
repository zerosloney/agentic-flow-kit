#!/usr/bin/env node
// check-ledger-invariant — confirmations.jsonl 提交不变量（2026-10-02 ledger-ci-invariant）
// 目的：把「台账本地可写」的伪造面从事后对质级升为机器可检出级（能力评审审计维度扣分项）。
// 台账不可变原则：confirmations.jsonl 历史行禁删改——修正只能走追加补偿行（README 硬规则 6）。
//
// **特许修剪通道（2026-10-12 ledger-prune-manifest）**：append-only 之上唯一的合法删行出口。场景是
//   仓库所有者明令删除某批 workflow 文档——台账对应行不删则行级④持续报红，退路只剩手改台账
//   （即把使用者逼向 `--no-verify`）。判据与凭据格式见 ledger-prune.mjs：暂存集须同带
//   `.agents/ledger-prune-manifest.json`（被删行 sha256 + 授权 + 理由），逐行对账「新 = 旧 − manifest
//   所列行」且每哈希恰命中一行、doc ∈ 声明家族，才认领为合法修剪；无 manifest 的删/改/重排**仍全拦**。
//   诚实边界：manifest 是可写文件，刻意伪造即可让任意删行合法化——与「台账本地可写」同级（见 README
//   确认门诚实边界）。本通道不宣称防伪，只把「顺手手改」抬到「提交一份可被 git 历史对质的凭据」。
//
// 模式：
//   历史全扫（缺省，CI 机器门）：遍历台账全部提交历史（时间正序），每次变更必须以旧 blob 为
//     **逐字节前缀**（允许纯追加；禁止删行/改行/重排）；再对最终树做行级校验（五项，见下）。
//     blob 读取走 git 对象库（入库 LF 归一口径），不受工作树 autocrlf 影响。
//   --staged（pre-commit 前置）：暂存 blob 必须以 HEAD blob 为逐字节前缀——提交时刻即拦重写。
//
// 行级校验（终树，五项）：
//   ① ts 为 ISO 字符串，且**同一 doc 内**非降序（跨 doc 物理序乱序不判——并集合并/分片归并的正常形态，
//      2026-10-12 修正；同 doc 内倒挂仍 hard 拦，跨 doc 插行/改行由检查 15 哈希链兜）
//   ② fingerprint 为 64 位 hex
//   ③ source=chat-delegated 行必有非空 quote（原话对质面）
//   ④ doc 匹配 workflow/(intents|specs|plans|incidents)/[^/]+.md 且当前树存在
//   ⑤ stage ∈ 合法跳转终态集（approved/done/fixed/closed/superseded/cancelled）
//   取数面 = ledger-loader 视图（主台账 + 分片 confirmations.d/*.jsonl）；视图序为主台账在前，
//      故既有 ledger-line-exempt.json 的行号不因引入分片而漂移。
//
// 行级豁免（2026-10-09 ledger-line-exempt，CI 红事故处置）：.agents/ledger-line-exempt.json 登记
// 已定性的污染行（{line, doc, reason}——line = 校验序号即非空行序）——行级五项对豁免行整体跳过、
// 行**保留在台账**（审计面完整），豁免计数照常出账保持可见。定位：事故行无法追加修复（行级扫最终树
// 全行）且不可就地改（历史前缀不变量）——superseded 重立单之外的唯一出口。**滥用边界**：豁免文件
// 自身入库、git 历史可对质；逐条须 papercuts/incident 定性引用，无定性登记 = 审计事件。
//
// 静默条件：台账不存在 / 零提交历史（装户、新仓）/ --staged 且暂存未触台账或无 HEAD 版本。
// 已知边界：git log --follow 未用——台账自创建无重命名（单一路径取史）；克隆深度不足时仅扫可得
//   历史（CI 侧 fetch-depth:0 兜全史，深度不足会告警声明边界，fail-open 于深度、fail-closed 于内容）。
// 用法：node check-ledger-invariant.mjs [--root <仓库根>] [--staged]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { matchPrune, loadManifestFromRef, PRUNE_REL } from './ledger-prune.mjs';
import { readLedgerRows, SHARD_DIR_REL } from './ledger-loader.mjs';

const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
};
const staged = argv.includes('--staged');
const ROOT = argOf('--root') || (staged ? process.cwd() : execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
const REL = '.agents/confirmations.jsonl';
const FILE = path.join(ROOT, REL);
const VALID_STAGES = new Set(['approved', 'done', 'fixed', 'closed', 'superseded', 'cancelled',
  'revert-draft', 'revert-open']); // 回退注记行（check-loop :822 认可；fingerprint 恒 n/a）

const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, ...opts });
const gitText = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const blobOf = (ref) => git(['show', ref]); // ref 必须为完整对象引用（<sha>:<path> / HEAD:<path> / :<path>）

const problems = [];

// ---- --staged：暂存 blob ⊇ HEAD blob ----
if (staged) {
  const stagedFiles = gitText(['-c', 'core.quotepath=off', 'diff', '--cached', '--name-only']).split(/\r?\n/).filter(Boolean);
  const stagedHit = stagedFiles.includes(REL);
  // 分片触发面（2026-10-13 ledger-shard-default）：分片已是默认写入口径，pre-commit 触发条件已扩到
  // confirmations.d/*.jsonl——本模式同须覆盖，否则「顺手重写分片」只能等 CI 历史全扫兜底。
  const stagedShards = stagedFiles.filter((f) => f.startsWith(`${SHARD_DIR_REL}/`) && f.endsWith('.jsonl'));
  if (!stagedHit && stagedShards.length === 0) process.exit(0);
  const headExists = (() => { try { gitText(['rev-parse', '--verify', '--quiet', `HEAD:${REL}`]); return true; } catch { return false; } })();
  if (stagedHit && headExists) {
    let head, cur;
    try {
      head = blobOf(`HEAD:${REL}`);
      cur = blobOf(`:${REL}`); // 暂存区
    } catch {
      process.exit(0); // 对象读取异常（如极端并发）交由 CI 全扫兜底
    }
    if (!cur.subarray(0, head.length).equals(head)) {
      // 特许修剪（2026-10-12 ledger-prune-manifest）：仓库所有者明令删某批 workflow 文档时，台账对应行
      // 须随之删除，否则行级④「doc 在当前树存在」持续报红、退路只剩手改台账（踩 --no-verify 红线）。
      // 出口 = **逐行对账 + 凭据入库**：暂存集须同时携带 .agents/ledger-prune-manifest.json，判据见
      // ledger-prune.mjs matchPrune（四条缺一不可）。无 manifest 的删/改/重排仍全拦——append-only 红线
      // 对其他一切场景不变。被删行哈希随 manifest 入库，事后可对质。
      const m = matchPrune(head.toString('utf8'), cur.toString('utf8'),
        loadManifestFromRef(`:${PRUNE_REL}`, ROOT));
      if (m && !m.err) {
        console.log(`台账不变量（--staged）— 特许修剪通过：移除 ${m.removed} 行（${m.docs.length} 家族）——凭据 ${PRUNE_REL} 随笔入库，被删行可在 git 历史对质`);
      } else {
        let off = 0;
        while (off < Math.min(head.length, cur.length) && head[off] === cur[off]) off++;
        problems.push(`- [台账重写] 暂存内容不是 HEAD 的前缀扩展（首异偏移 ${off}，HEAD ${head.length}B → 暂存 ${cur.length}B）${m && m.err ? `；特许修剪对账失败：${m.err}` : ''}`);
      }
    }
  }
  // ---- 分片 --staged 前置（2026-10-13 ledger-shard-default）----
  // 判据与主台账同款（暂存 blob ⊇ HEAD blob 逐字节前缀）；分片删除是合法形态（compact 归并）——
  // 判据同历史扫：被删分片的每一行都已出现在**暂存主台账**里才放行，否则丢行 hard 拦。
  let stagedMainText = '';
  try { stagedMainText = blobOf(`:${REL}`).toString('utf8'); } catch { /* 暂存主台账缺失/未触 → 空集 */ }
  const stagedMainLines = new Set(stagedMainText.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim()));
  for (const shardRel of stagedShards) {
    let sHead;
    try { sHead = blobOf(`HEAD:${shardRel}`); } catch { continue; } // 新分片首入库：无 HEAD 基线，历史扫续管
    let sCur = null;
    try { sCur = blobOf(`:${shardRel}`); } catch { sCur = null; }
    if (sCur === null) {
      // 暂存里分片被删 → compact 归并判据（行全并入暂存主台账才放行）
      const shardLines = sHead.toString('utf8').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
      const missing = shardLines.filter((l) => !stagedMainLines.has(l));
      if (missing.length === 0) {
        console.log(`台账不变量（--staged）— 分片 ${shardRel} 删除：${shardLines.length} 行已全部并入暂存主台账（compact 归并形态，放行）`);
      } else {
        problems.push(`- [分片删除丢行] ${shardRel} 被删除，但其中 ${missing.length} 行未出现在暂存主台账（compact 归并须先并入再删）`);
      }
      continue;
    }
    if (!sCur.subarray(0, sHead.length).equals(sHead)) {
      let off = 0;
      while (off < Math.min(sHead.length, sCur.length) && sHead[off] === sCur[off]) off++;
      problems.push(`- [分片重写] ${shardRel} 暂存内容不是 HEAD 的前缀扩展（首异偏移 ${off}，HEAD ${sHead.length}B → 暂存 ${sCur.length}B）——分片同受 append-only 前缀不变量约束`);
    }
  }
  if (problems.length) {
    console.error('台账不可变（--staged）— BLOCK:\n' + problems.join('\n'));
    console.error(`  修法：台账历史行禁删改——误写走追加补偿行（node .agents/scripts/confirm-doc.mjs ...）；确需撤销历史提交请 git revert 后重新追加。\n        所有者明令删除某批文档须同笔暂存 ${PRUNE_REL}（逐行 sha256 + 授权 + 理由），门禁逐行对账后才放行。`);
    process.exit(1);
  }
  process.exit(0);
}

// ---- 历史全扫（缺省）----
if (!fs.existsSync(FILE)) process.exit(0); // 装户/新仓无台账面
let shas;
try {
  shas = gitText(['log', '--format=%H', '--reverse', '--', REL]).split(/\s+/).filter(Boolean);
} catch {
  process.exit(0); // 非仓库或文件未入库（测试夹具）
}
if (!shas.length) process.exit(0);

// 分片路径清单（2026-10-12 ledger-shard-write）：**扫 git 全历史里出现过的分片**，不只看工作树现有的
// ——compact 会把分片删掉，只看工作树就永远扫不到「已删分片的历史」。用 pathspec 枚举全史分片路径。
let shardRelPaths = [];
try {
  shardRelPaths = gitText(['log', '--all', '--format=', '--name-only', '--', `${SHARD_DIR_REL}/`])
    .split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith(`${SHARD_DIR_REL}/`) && l.endsWith('.jsonl'));
  shardRelPaths = [...new Set(shardRelPaths)].sort();
} catch { /* 非仓库/无分片历史 → 空清单，分片段整段跳过 */ }

let prev = null;
let prevSha = null;
for (const sha of shas) {
  let cur;
  // 删除提交不是静默边界（复核 P2 收口）：台账在 append-only 世界里永不应删除——任一历史提交删除
  // 台账即 hard fail（否则「删除→次提交重加」会把重加 blob 当新基线绕过前缀判据）。
  try { cur = blobOf(`${sha}:${REL}`); } catch {
    problems.push(`- [台账删除] ${sha.slice(0, 10)}：该提交删除了 confirmations.jsonl（append-only 世界禁删文件）`);
    prev = null; // 后续重加无基线可比，仅受行级校验约束
    continue;
  }
  if (prev !== null && !cur.subarray(0, prev.length).equals(prev)) {
    // 特许修剪：前缀破坏时，若该提交树上携带 manifest 且逐行对账通过 = 认领为合法修剪，
    // loud 记录后**以新 blob 为基线续扫**（对质凭据 = 该提交的 manifest + 被删行内容在 git 历史里）。
    const m = matchPrune(prev.toString('utf8'), cur.toString('utf8'), loadManifestFromRef(`${sha}:${PRUNE_REL}`, ROOT));
    if (m && !m.err) {
      console.error(`[info] ${sha.slice(0, 10)}：特许修剪 ${m.removed} 行（${m.docs.length} 家族）——manifest 对账通过，凭据 ${PRUNE_REL} 入库可对质`);
    } else {
      let off = 0;
      while (off < Math.min(prev.length, cur.length) && prev[off] === cur[off]) off++;
      const removed = prev.length > cur.length;
      problems.push(`- [前缀破坏] ${sha.slice(0, 10)}（前承 ${prevSha.slice(0, 10)}）：历史内容被${removed ? `删减 ${prev.length - cur.length}B` : `改写（首异偏移 ${off}，旧 ${prev.length}B → 新 ${cur.length}B）`}${m && m.err ? `；特许修剪对账失败：${m.err}` : ''}`);
    }
  }
  prev = cur;
  prevSha = sha;
}

// ---- 分片历史扫描（2026-10-12 ledger-shard-write）----
// 分片 `.agents/confirmations.d/*.jsonl` 此前**不受本门约束**——`--shard` 写入一旦可用，分片就成了
// 前缀不变量的缺口（可改可删而不被历史扫到）。故逐分片路径做同样的前缀不变量扫描。
// **删除豁免（与主台账相反）**：compact-ledgers.mjs 归并后**删除分片是合法形态**，不能照抄主台账那条
// 「删文件即 hard fail」。豁免判据：该分片被删时的内容，其**每一行都已出现在同提交的主台账里**
// （并集归并的必然结果）→ 认领为 compact 归并；否则（行未并入 = 丢行）仍 hard fail。
for (const shard of shardRelPaths) {
  let sShas;
  try {
    sShas = gitText(['log', '--format=%H', '--reverse', '--', shard]).split(/\s+/).filter(Boolean);
  } catch { continue; }
  let sPrev = null;
  for (const sha of sShas) {
    let sCur = null;
    try { sCur = blobOf(`${sha}:${shard}`); } catch { sCur = null; }
    if (sCur === null) {
      // 分片在本次提交消失 → 只在「行已全部并入主台账」时认领 compact 归并
      if (sPrev !== null) {
        const shardLines = sPrev.toString('utf8').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
        let mainNow = '';
        try { mainNow = blobOf(`${sha}:${REL}`).toString('utf8'); } catch { /* 主台账亦不在 = 整体删除，另行报 */ }
        const mainLines = new Set(mainNow.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim()));
        const missing = shardLines.filter((l) => !mainLines.has(l));
        if (missing.length === 0) {
          console.error(`[info] ${sha.slice(0, 10)}：分片 ${shard} 删除（${shardLines.length} 行已全部并入主台账——compact 归并形态，放行）`);
        } else {
          problems.push(`- [分片删除丢行] ${sha.slice(0, 10)}：${shard} 被删除，但其中 ${missing.length} 行未出现在主台账（compact 归并须先并入再删）`);
        }
      }
      sPrev = null;
      continue;
    }
    if (sPrev !== null && !sCur.subarray(0, sPrev.length).equals(sPrev)) {
      let off = 0;
      while (off < Math.min(sPrev.length, sCur.length) && sPrev[off] === sCur[off]) off++;
      problems.push(`- [分片前缀破坏] ${sha.slice(0, 10)}：${shard} 历史内容被改写（首异偏移 ${off}，旧 ${sPrev.length}B → 新 ${sCur.length}B）——分片同受 append-only 前缀不变量约束`);
    }
    sPrev = sCur;
  }
}

// ---- 行级校验（终树）----
// 取数走 ledger-loader 视图（2026-10-12 ledger-loader-p1 / ledger-doc-chain）：主台账 + 分片
// `.agents/confirmations.d/*.jsonl`。**视图序 = 主台账行在前、分片行在后**——故既有
// `.agents/ledger-line-exempt.json` 的行号（基于主台账全量）不因引入分片而漂移。
const rows = readLedgerRows(ROOT);
const EXEMPT_P = path.join(ROOT, '.agents', 'ledger-line-exempt.json');
const exemptLines = new Set();
try {
  if (fs.existsSync(EXEMPT_P)) {
    for (const e of JSON.parse(fs.readFileSync(EXEMPT_P, 'utf8'))) {
      if (e && Number.isInteger(e.line)) exemptLines.add(e.line);
    }
  }
} catch { /* 豁免表损坏 → 视同无豁免（fail-closed 于校验面） */ }
let exemptCount = 0;
// ① ts 单调口径（2026-10-12 ledger-doc-chain 配套修正）：**按 doc 分组内单调**，跨 doc 物理序乱序不判。
// 为什么必须改：git 并集合并（见 git-merge-jsonl.mjs）与分片归并都会把「别的 doc 的新行」追加到本文件
//   尾部，而那些行的 ts 可能早于本文件末行的 ts → **必然**触发原「全表非降序」判据。这是正常协作的形态，
//   不是篡改；让门禁因正常协作报红，只会逼出 `--no-verify`。
// 仍保留的强判据：**同一 doc 内的 ts 倒挂照报**（该 doc 的确认时序倒挂是真问题），另加哈希链
//   （检查 15）覆盖跨 doc 的插行/改行。跨 doc 乱序仅计数出账、不阻断（可观测性保留）。
const prevTsByDoc = new Map();
let crossDocOutOfOrder = 0;
let prevTsAny = '';
rows.forEach((e, idx) => {
  const at = `第 ${idx + 1} 行`;
  if (exemptLines.has(idx + 1)) { exemptCount++; return; } // 事故行豁免（登记文件入库可对质）
  if (!e || typeof e !== 'object') { problems.push(`- [行级] ${at}：非 JSON 对象行`); return; }
  if (typeof e.ts !== 'string' || Number.isNaN(Date.parse(e.ts))) problems.push(`- [行级] ${at}：ts 非 ISO 字符串`);
  else {
    const docKey = typeof e.doc === 'string' ? e.doc : '（doc 缺失）';
    const prevSameDoc = prevTsByDoc.get(docKey);
    if (prevSameDoc && e.ts < prevSameDoc) {
      problems.push(`- [行级] ${at}：ts ${e.ts} 早于同 doc 前行 ${prevSameDoc}（${docKey} 追加时序倒挂）`);
    }
    prevTsByDoc.set(docKey, e.ts);
    if (prevTsAny && e.ts < prevTsAny) crossDocOutOfOrder++;
    prevTsAny = e.ts;
  }
  const isRevertNote = typeof e.stage === 'string' && e.stage.startsWith('revert-');
  if (isRevertNote) {
    if (e.fingerprint !== 'n/a') problems.push(`- [行级] ${at}：回退注记行 fingerprint 恒为「n/a」`);
  } else if (typeof e.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(e.fingerprint)) {
    problems.push(`- [行级] ${at}：fingerprint 非 64 位 hex`);
  }
  if (e.source === 'chat-delegated' && !(typeof e.quote === 'string' && e.quote.trim())) problems.push(`- [行级] ${at}：chat-delegated 行缺非空 quote（原话对质面）`);
  if (typeof e.doc !== 'string' || !/^workflow\/(intents|specs|plans|incidents)\/[^/]+\.md$/.test(e.doc)) {
    problems.push(`- [行级] ${at}：doc 路径不在 workflow 四目录协议内`);
  } else if (!fs.existsSync(path.join(ROOT, e.doc))) {
    problems.push(`- [行级] ${at}：doc ${e.doc} 在当前树不存在`);
  }
  if (!VALID_STAGES.has(e.stage)) problems.push(`- [行级] ${at}：stage「${e.stage || '缺失'}」不在合法跳转终态集`);
});

if (exemptCount) console.log(`ℹ️  台账豁免行 ${exemptCount} 条（定性见 .agents/ledger-line-exempt.json）`);
if (crossDocOutOfOrder) {
  console.log(`ℹ️  台账跨 doc 物理序 ts 乱序 ${crossDocOutOfOrder} 处（并集合并 / 分片归并的正常形态——不阻断；同 doc 内时序倒挂仍 hard 拦，插行/改行由检查 15 哈希链兜）`);
}
if (problems.length) {
  console.error(`台账不可变（历史全扫）— HARD-BLOCK:\n\n${problems.join('\n')}\n`);
  console.error('  修法：台账历史行禁删改（append-only 前缀不变量）——误写只能追加补偿行；确需撤销历史提交请 git revert 后重新追加。篡改属审计事件，保留现场联系仓库所有者。');
  process.exit(1);
}
process.exit(0);