#!/usr/bin/env node
// check-ledger-invariant — confirmations.jsonl 提交不变量（2026-10-02 ledger-ci-invariant）
// 目的：把「台账本地可写」的伪造面从事后对质级升为机器可检出级（能力评审审计维度扣分项）。
// 台账不可变原则：confirmations.jsonl 历史行禁删改——修正只能走追加补偿行（README 硬规则 6）。
//
// 模式：
//   历史全扫（缺省，CI 机器门）：遍历台账全部提交历史（时间正序），每次变更必须以旧 blob 为
//     **逐字节前缀**（允许纯追加；禁止删行/改行/重排）；再对最终树做行级校验（五项，见下）。
//     blob 读取走 git 对象库（入库 LF 归一口径），不受工作树 autocrlf 影响。
//   --staged（pre-commit 前置）：暂存 blob 必须以 HEAD blob 为逐字节前缀——提交时刻即拦重写。
//
// 行级校验（终树，五项）：
//   ① ts 为 ISO 字符串且全表非降序（追加时序单调）
//   ② fingerprint 为 64 位 hex
//   ③ source=chat-delegated 行必有非空 quote（原话对质面）
//   ④ doc 匹配 workflow/(intents|specs|plans|incidents)/[^/]+.md 且当前树存在
//   ⑤ stage ∈ 合法跳转终态集（approved/done/fixed/closed/superseded/cancelled）
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
  const stagedHit = gitText(['-c', 'core.quotepath=off', 'diff', '--cached', '--name-only']).split(/\r?\n/).includes(REL);
  if (!stagedHit) process.exit(0);
  const headExists = (() => { try { gitText(['rev-parse', '--verify', '--quiet', `HEAD:${REL}`]); return true; } catch { return false; } })();
  if (!headExists) process.exit(0); // 首次入库：无 HEAD 基线，历史全扫后续覆盖
  let head, cur;
  try {
    head = blobOf(`HEAD:${REL}`);
    cur = blobOf(`:${REL}`); // 暂存区
  } catch {
    process.exit(0); // 对象读取异常（如极端并发）交由 CI 全扫兜底
  }
  if (!cur.subarray(0, head.length).equals(head)) {
    let off = 0;
    while (off < Math.min(head.length, cur.length) && head[off] === cur[off]) off++;
    problems.push(`- [台账重写] 暂存内容不是 HEAD 的前缀扩展（首异偏移 ${off}，HEAD ${head.length}B → 暂存 ${cur.length}B）`);
    console.error('台账不可变（--staged）— BLOCK:\n' + problems.join('\n'));
    console.error('  修法：台账历史行禁删改——误写走追加补偿行（node .agents/scripts/confirm-doc.mjs ...）；确需撤销历史提交请 git revert 后重新追加');
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
    let off = 0;
    while (off < Math.min(prev.length, cur.length) && prev[off] === cur[off]) off++;
    const removed = prev.length > cur.length;
    problems.push(`- [前缀破坏] ${sha.slice(0, 10)}（前承 ${prevSha.slice(0, 10)}）：历史内容被${removed ? `删减 ${prev.length - cur.length}B` : `改写（首异偏移 ${off}，旧 ${prev.length}B → 新 ${cur.length}B）`}`);
  }
  prev = cur;
  prevSha = sha;
}

// ---- 行级校验（终树）----
let rows = [];
try {
  rows = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } });
} catch { /* 上面 existsSync 已兜 */ }
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
let prevTs = '';
rows.forEach((e, idx) => {
  const at = `第 ${idx + 1} 行`;
  if (exemptLines.has(idx + 1)) { exemptCount++; return; } // 事故行豁免（登记文件入库可对质）
  if (!e || typeof e !== 'object') { problems.push(`- [行级] ${at}：非 JSON 对象行`); return; }
  if (typeof e.ts !== 'string' || Number.isNaN(Date.parse(e.ts))) problems.push(`- [行级] ${at}：ts 非 ISO 字符串`);
  else {
    if (prevTs && e.ts < prevTs) problems.push(`- [行级] ${at}：ts ${e.ts} 早于前行 ${prevTs}（追加时序非单调）`);
    prevTs = e.ts;
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
if (problems.length) {
  console.error(`台账不可变（历史全扫）— HARD-BLOCK:\n\n${problems.join('\n')}\n`);
  console.error('  修法：台账历史行禁删改（append-only 前缀不变量）——误写只能追加补偿行；确需撤销历史提交请 git revert 后重新追加。篡改属审计事件，保留现场联系仓库所有者。');
  process.exit(1);
}
process.exit(0);