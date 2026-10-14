#!/usr/bin/env node
// check-ledger-invariant — confirmations 台账提交不变量（2026-10-02 ledger-ci-invariant；
// 2026-10-12 ledger-shard-invariant：校验面自单一主台账扩展到「主台账 + confirmations.d 分片」；
// 2026-10-13 深水批次：合并感知删片 / 终树补登追认 / 补登语义身份 / DAG 感知 + 历史基线，
// 判据自多 worktree 合并丢行事故后的实战实现逐字回灌（出处留包源仓 git 历史与 CHANGELOG））
// 目的：把「台账本地可写」的伪造面从事后对质级升为机器可检出级（能力评审审计维度扣分项）。
// 台账不可变原则：confirmations 历史行禁删改——修正只能走追加补偿行（README 硬规则 6）。
//
// 分片形态（2026-10-10 中期方案；2026-10-12 起为 confirm-doc 默认写入口径）：
//   .agents/confirmations.d/<doc 基名>.jsonl —— 按 doc 分片，跨机/跨 worktree 确认不同 doc 时
//   写不同文件，从根上消除「每合并必冲突 + 手工重建」；同一 doc 被两端并发确认时由
//   .gitattributes 的 merge=jsonl-union 驱动取并集（本地须配 merge.jsonl-union.driver：
//   git config merge.jsonl-union.driver "node .agents/scripts/git-merge-jsonl.mjs %O %A %B"）。
//   本脚本给分片补上主台账同级的 append-only 前缀不变量——否则分片是「无人校验的写入面」，
//   被改写/删除无人知。
//
// 特许修剪（2026-10-09 user-directed-prune）：仓库所有者明令删除某批 workflow 文档并清理其台账行时，
//   允许**一次性、逐行对账**的修剪——暂存/提交须同时携带 .agents/ledger-prune-manifest.json
//   （{ts, authority, reason, removes:[被删行 sha256...], docs:[家族名...]}，判据单源 ledger-prune.mjs），
//   门禁逐行核验「新内容 = 旧内容 − manifest 所列各行」且每个哈希恰对应一行。未带 manifest 的
//   删/改/重排仍全拦——append-only 红线对其他一切场景不变；修剪凭据随 manifest 入库，事后可对质。
//
// 分片删除的唯一合法形态 = compact-ledgers 归并（2026-10-12）：分片被删时，该分片**全部非空行必须
//   已存在于同一提交的主台账**（compact-ledgers 正是把这些行原样追加进主台账后才删片）——认不出
//   归并凭据的删片一律 hard fail，堵住「删片抹账」这条路。主台账自身永不因归并被删。其上三组深水
//   判据（2026-10-13，实战回灌）：
//   ① 合并感知删片（merge-aware-shard-delete）：分片内容从**各父提交取并集**后对账——合并解析收口
//      删片时，分片可能只在第二父侧（首父早已归并删片，实战实证：单看首父会把合法收口误判成
//      「增删同提交」）。「分片删除丢行」（行未并入主台账）仍 hard 拦。
//   ② 终树补登追认（merge-shard-restore-aware）：合并删片缺行、但缺行已原样回 append 到终树主台账
//      （补偿行：新 ts + note 引原 ts）→ 视为丢失已追认，放行——历史事实不可改写，终态无丢失即
//      审计实质。
//   ③ 补登语义身份比对：补偿行与被删行的等价判定用**语义三元组 {doc, stage, fingerprint}**——
//      补偿行本就允许改 ts 加 note，逐字节比对会漏掉全部合法补偿行。
//
// 合并并集语义（2026-10-13 merge-union-aware）：多父提交不按线性前缀判，改验「并集无丢失」——
//   合并结果的行集合须 ⊇ 各父行集之并（一行不丢）且 ⊆ 该并集（一行不造）。jsonl-union 策略
//   （多 worktree 并行确认的根基）与线性前缀模型天生矛盾，本判据对齐审计实质：确认行不被丢、
//   不被造。union 不过再试「合并携带 manifest 的特许修剪集合对账」（对父母并集对账，非第一父——
//   堵 p2 独有行借 p1 相对 manifest 无凭据消失）；支持「分支上修剪、合并时落地」的合法形态。
//   合并通过后以合并 blob 续扫。
//
// DAG 感知（2026-10-13 dag-aware-base）：历史全扫按 DAG 而非线性——路径史用 --full-history 取全
//   （TREESAME 合并也入列，防「ours 合并丢一侧行」被历史简化隐藏，审计门立场）；每个提交自对
//   己父取基准 blob（第一父；根提交视为新文件起步）——线性化「前一承」在分支汇合处会拿另一侧
//   提交当基准产生伪前缀破坏。多父提交无条件走并集对账（前缀通过不得短路——ours-resolution 合并
//   树与第一父逐字节同 blob，嵌套判法对静默丢行全盲）。
//
// 历史基线（2026-10-13 ledger-history-baseline 机制，装户自定）：LEDGER_HISTORY_BASELINE=<基线提交>
//   环境变量声明后，基线之前的提交不进前缀扫描——该时代（特许修剪/合并感知机制上线前）的删改
//   无对账凭据，原理上不可追溯验证（回填凭据须改写历史且属事后伪造授权）；基线由 owner 一次性
//   loud 声明，同「流程: legacy / 存量不回填」哲学。基线 blob 为可信起点，基线后提交照常全扫。
//   kit 缺省为空 = 无基线声明 → 全量扫描（最严语义；装户如确认存在机制上线前的存量断档，自行设
//   基线豁免，豁免计数 loud 出账。env 覆盖亦供测试）。
//
// 模式：
//   历史全扫（缺省，CI 机器门）：对主台账与每个分片各自遍历其提交历史，单父提交必须以第一父 blob
//     为**逐字节前缀**（允许纯追加；禁止删行/改行/重排）——或前缀破坏但该提交树上携带 manifest
//     恰好对账被删行（特许修剪认领，loud 记录后以新 blob 为基线继续）。多父提交无条件验并集。
//     分片另判「删除须已归并（①②③）」。blob 读取走 git 对象库（入库 LF 归一口径），不受工作树
//     autocrlf 影响。
//   --staged（pre-commit 前置）：主台账暂存 blob ⊇ HEAD blob（或携带 manifest 的特许修剪）；分片
//     三态——纯追加验前缀 / 暂存删除验「行已全部并入暂存主台账」（compact 归并形态放行、丢行
//     hard 拦）/ 新分片首入库无 HEAD 基线跳过（历史全扫续管）。
//
// 行级校验（终树，五项；取数面 = ledger-loader 视图：主台账在前、分片按文件名序在后——既有
//   ledger-line-exempt.json 的行号（校验序号即非空行序）不因引入分片而漂移）：
//   ① ts 为 ISO 字符串，且**同一 doc 内**非降序（跨 doc 物理序乱序不判、只计数出账——并集合并/
//      分片归并的正常形态；同 doc 内倒挂仍 hard 拦，跨 doc 插行/改行由检查 15 doc-chain 哈希链兜。
//      注：实战源实现用「单文件内非降序」——其主台账已单文件单 doc 化；kit 装户存量台账仍是
//      主台账多 doc 形态，全表判据会因正常并集协作报红逼出 --no-verify，故保留 kit 的 per-doc 口径）
//   ② fingerprint 为 64 位 hex
//   ③ source=chat-delegated 行必有非空 quote（原话对质面）
//   ④ doc 匹配 workflow/(intents|specs|plans|incidents)/[^/]+.md 且当前树存在（**归档感知**，
//      2026-10-13 archive-aware-doc：四目录原路径未命中再探 workflow/archive/*/——关单即归档移动
//      文件后行仍指向真实文档；真消失（四目录与归档批次均未命中）仍拦）
//   ⑤ stage ∈ 合法跳转终态集（approved/done/fixed/closed/superseded/cancelled + revert 注记行）
//   行级豁免（ledger-line-exempt.json）与跨 doc 乱序计数照 kit 既有口径出账。
//
// 静默条件：台账路径零提交历史（装户、新仓）/ --staged 且暂存未触任何台账或无 HEAD 版本。
//   有提交史的路径才进历史扫描**与终树行级校验**（否则新仓首版会被「doc 不存在」误杀）。
// 已知边界：git log --follow 未用——各台账路径自创建无重命名（单一路径取史）；克隆深度不足时仅扫可得
//   历史（CI 侧 fetch-depth:0 兜全史，深度不足会告警声明边界，fail-open 于深度、fail-closed 于内容）。
// 用法：node check-ledger-invariant.mjs [--root <仓库根>] [--staged]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { matchPrune, loadManifestFromRef, sha256line, PRUNE_REL } from './ledger-prune.mjs';
import { readLedgerEntries, SHARD_DIR_REL } from './ledger-loader.mjs';

const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
};
const staged = argv.includes('--staged');
const ROOT = argOf('--root') || (staged ? process.cwd() : execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
const REL = '.agents/confirmations.jsonl';
const SHARD_DIR = SHARD_DIR_REL; // '.agents/confirmations.d'（读口径单源 ledger-loader）
const FILE = path.join(ROOT, REL);
const VALID_STAGES = new Set(['approved', 'done', 'fixed', 'closed', 'superseded', 'cancelled',
  'revert-draft', 'revert-open']); // 回退注记行（check-loop :822 认可；fingerprint 恒 n/a）
// 历史基线（机制 2026-10-13 ledger-history-baseline，详见头注）：kit 缺省空 = 全量扫描
const HISTORY_BASELINE = process.env.LEDGER_HISTORY_BASELINE || '';

const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, ...opts });
const gitText = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const blobOf = (ref) => git(['show', ref]); // ref 必须为完整对象引用（<sha>:<path> / HEAD:<path> / :<path>）
// tryBlob：安全读 blob，失败返回 null 且**不向 stderr 外泄 git fatal 噪声**（删片场景读当前提交必失败，
// 那是预期路径不是错误——历史扫描的高频探针路径必须静默）。
const tryBlob = (ref) => {
  const r = spawnSync('git', ['show', ref], { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};
const linesOf = (buf) => buf.toString('utf8').split('\n').filter((l, i, a) => !(l === '' && i === a.length - 1) && l !== '');
const isShard = (rel) => rel.startsWith(`${SHARD_DIR}/`) && rel.endsWith('.jsonl');

// ④ 归档感知存在性（2026-10-13 archive-aware-doc）：四目录原路径未命中再探 workflow/archive/*/——
// 归档是 sanctioned 的文档生命周期事件，行的审计价值（指向真实文档）不受移动影响；真消失（既不在
// 四目录也无归档批次）仍拦。
const docExists = (doc) => {
  if (fs.existsSync(path.join(ROOT, doc))) return true;
  const m = /^workflow\/(intents|specs|plans|incidents)\/([^/]+)\.md$/.exec(doc);
  if (!m) return false;
  try {
    const arcRoot = path.join(ROOT, 'workflow', 'archive');
    for (const batch of fs.readdirSync(arcRoot)) {
      if (fs.existsSync(path.join(arcRoot, batch, m[1], `${m[2]}.md`))) return true;
    }
  } catch { /* archive 目录不存在 */ }
  return false;
};

const problems = [];
const fail = (msg) => { console.error(msg); process.exit(1); };

// 终树主台账行集（CRLF 归一；补登追认的比对基准——与行级校验「终树」同语义）
// 补登追认按**语义身份**比对：{doc, stage, fingerprint} 三元组——补登合法形态是补偿行
// （原 ts 早于尾行时须记现时刻 + note，内容字段沿原行），逐字节比对会漏掉全部合法补偿。
const finalLedgerRows = () => {
  try {
    return fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').split('\n')
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } });
  } catch { return null; }
};
const restoredInFinal = (missingLines, finRows) => {
  if (!finRows) return false;
  return missingLines.every((l) => {
    let e;
    try { e = JSON.parse(l); } catch { return false; }
    return finRows.some((r) => r && r.doc === e.doc && r.stage === e.stage && r.fingerprint === e.fingerprint);
  });
};

// ---- 分片删除合法性：该分片全部非空行须存在于同一提交的主台账（compact-ledgers 归并凭据）----
// 返回 null = 合法归并（或缺行已终树补登追认）；否则返回原因串。
// 读法要点（① 合并感知）：分片在**该提交已被删除**，其内容从各父取并集——合并收口删片时分片可能
//   只在第二父（首父已归并删片），单读首父会误判「增删同提交」；主台账取该提交当时的版本
//   （归并行把分片原样追加进主台账后同提交删片，故主台账须含全部行）。
const shardDeleteReason = (sha, rel) => {
  const mainBuf = tryBlob(`${sha}:${REL}`);
  if (mainBuf === null) return `该提交无主台账 ${REL}——无法认定归并`;
  const shardLines = new Set();
  let foundInParent = false;
  for (const p of parentShas(sha)) {
    const b = tryBlob(`${p}:${rel}`);
    if (b === null) continue;
    foundInParent = true;
    for (const l of linesOf(b)) if (l.trim()) shardLines.add(l);
  }
  if (!foundInParent) return `父提交 ${sha.slice(0, 10)}^ 中无此分片（增删同提交？）——无法认定归并`;
  const mainLines = new Set(linesOf(mainBuf).filter((l) => l.trim()));
  const missing = [...shardLines].filter((l) => !mainLines.has(l));
  if (missing.length) {
    // ② 终树补登追认：缺行已按语义身份（③）回append进终树主台账 → 丢失已追认
    if (restoredInFinal(missing, finalLedgerRows())) {
      console.error(`[info] ${sha.slice(0, 10)}：${rel} 合并删片缺 ${missing.length} 行已在终树主台账补登（例：${missing[0].slice(0, 60)}…）——丢失追认，续扫`);
      return null;
    }
    return `删除时分片有 ${missing.length} 行不在同提交主台账内（例：${missing[0].slice(0, 60)}…）——只有 compact-ledgers 归并后才允许删片`;
  }
  return null;
};

// ---- 历史前缀扫描（单台账路径；主台账与分片共用）----
// allowShardDelete：分片允许「已归并后删片（或缺行已终树补登）」这一种合法消失形态；主台账永不因归并被删。
// 返回该路径的提交史（空 = 从未入库：装户/新仓/尚在暂存区）——零史路径整体跳过，与原实现
// 「零提交历史即静默」的契约一致（行级校验也只覆盖有史的路径，否则新仓首版会被 doc 不存在误杀）。
function historyShas(rel) {
  try {
    // --full-history：不做历史简化——TREESAME 合并也入列，防「ours 合并丢一侧行」被简化隐藏（审计门立场）
    return gitText(['log', '--full-history', '--format=%H', '--reverse', '--', rel]).split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

// 基线后提交集（含基线可达性探测；无基线声明或基线不在本仓 → null = 基线不生效，全史扫描）
let _postBaseline;
const postBaselineSet = () => {
  if (_postBaseline !== undefined) return _postBaseline;
  if (!HISTORY_BASELINE) return (_postBaseline = null); // kit 缺省：无基线声明 → 全量扫描
  try {
    gitText(['rev-parse', '--verify', '--quiet', `${HISTORY_BASELINE}^{commit}`]);
    _postBaseline = new Set(gitText(['rev-list', `${HISTORY_BASELINE}..HEAD`]).split(/\s+/).filter(Boolean));
  } catch {
    _postBaseline = null;
  }
  return _postBaseline;
};

// 多父提交的父列表（%P 全父）
const parentShas = (sha) => {
  try {
    return gitText(['log', '-1', '--format=%P', sha]).split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
};

// 合并并集对账：cur 行集须恰为各父行集之并（无丢失、无凭空新增）。返回 null = 认可；否则返回原因。
// 父提交无此路径（单侧新增）跳过该父；行比对按整行字符串（与 linesOf/前缀判据同粒度）。
const mergeUnionProblem = (sha, rel, curBuf) => {
  const curLines = new Set(linesOf(curBuf));
  const parentLines = new Set();
  for (const p of parentShas(sha)) {
    const b = tryBlob(`${p}:${rel}`);
    if (b === null) continue;
    for (const l of linesOf(b)) parentLines.add(l);
  }
  const lost = [...parentLines].filter((l) => !curLines.has(l));
  if (lost.length) return `合并丢失 ${lost.length} 行（例：${lost[0].slice(0, 60)}…）——union 合并不得丢行`;
  const made = [...curLines].filter((l) => !parentLines.has(l));
  if (made.length) return `合并凭空多出 ${made.length} 行（例：${made[0].slice(0, 60)}…）——合并结果须为各父行集之并`;
  return null;
};

// 合并携带 manifest 的特许修剪对账（merge-prune-set）：集合口径——每个 removes 哈希须恰命中
// 父母并集中一行；cur 行集须恰为「父母并集 − 被删行集」。支持「分支上修剪、合并时落地」的合法
// 形态（修剪凭据随合并入库）；对父母并集对账（非第一父）堵住 p2 独有行借 p1 相对 manifest 无凭据
// 消失。返回 null = 认可；否则原因串。
const mergePruneProblem = (parents, rel, curBuf, manifest) => {
  if (!manifest || !Array.isArray(manifest.removes) || !manifest.removes.length) return 'manifest 缺失或 removes 为空';
  const union = new Set();
  for (const p of parents) {
    const b = tryBlob(`${p}:${rel}`);
    if (b === null) continue;
    for (const l of linesOf(b)) union.add(l);
  }
  const want = new Set(manifest.removes);
  const removed = [...union].filter((l) => want.has(sha256line(l)));
  if (removed.length !== manifest.removes.length) return `manifest 哈希在父母并集中命中 ${removed.length} 行 ≠ 声明 ${manifest.removes.length} 行`;
  const removedSet = new Set(removed);
  const expected = [...union].filter((l) => !removedSet.has(l));
  const expectedSet = new Set(expected);
  const curLines = new Set(linesOf(curBuf));
  const extra = [...curLines].filter((l) => !expectedSet.has(l));
  if (extra.length) return `合并多出对账外 ${extra.length} 行（例：${extra[0].slice(0, 60)}…）`;
  const stillLost = expected.filter((l) => !curLines.has(l));
  if (stillLost.length) return `合并仍丢失 manifest 外 ${stillLost.length} 行（例：${stillLost[0].slice(0, 60)}…）`;
  const docs = new Set(manifest.docs || []);
  if (docs.size) {
    for (const l of removed) {
      try {
        const doc = JSON.parse(l).doc || '';
        if (!docs.has(path.basename(doc).replace(/\.md$/, ''))) return `被删行 doc ${doc} 不在 manifest.docs 清单内`;
      } catch { return '被删行非 JSON'; }
    }
  }
  return null;
};

function scanHistory(rel, { allowShardDelete }) {
  const allShas = historyShas(rel);
  if (!allShas.length) return allShas;
  let shas = allShas;
  // 历史基线：只走基线后提交（详见头注）——DAG 感知比对下各提交自对己父，无需线性化起点
  const post = postBaselineSet();
  if (post) {
    const kept = shas.filter((sha) => post.has(sha));
    if (kept.length !== shas.length) {
      console.error(`[info] ${rel}：${shas.length - kept.length} 个前基线提交按 HISTORY_BASELINE 声明豁免（owner 授权，见脚本头注）`);
    }
    shas = kept;
  }
  for (const sha of shas) {
    let cur;
    try { cur = blobOf(`${sha}:${rel}`); } catch {
      // 删除提交不是静默边界（复核 P2 收口）：主台账在 append-only 世界里永不应删除——任一历史提交删除
      // 主台账即 hard fail（否则「删除→次提交重加」会把重加 blob 当新基线绕过前缀判据）。
      if (!allowShardDelete) {
        problems.push(`- [台账删除] ${sha.slice(0, 10)}：该提交删除了 ${rel}（append-only 世界禁删文件）`);
        continue;
      }
      const reason = shardDeleteReason(sha, rel);
      if (reason) {
        problems.push(`- [分片删除丢行] ${sha.slice(0, 10)}：删除 ${rel} —— ${reason}`);
        continue;
      }
      console.error(`[info] ${sha.slice(0, 10)}：${rel} 归并后删除（compact 归并形态——全部行已在同提交主台账对账，或缺行已终树补登追认）`);
      continue;
    }
    // DAG 感知基准：本提交第一父的 blob（dag-aware-base）——线性化「前一承」在分支汇合处会拿
    // 另一侧提交当基准产生伪前缀破坏；根提交（无父）视为新文件起步。
    const parents = parentShas(sha);
    const base = parents.length ? tryBlob(`${parents[0]}:${rel}`) : null;
    if (base === null) continue; // 首现（父无此路径）：无基线可比，行级校验兜底
    if (parents.length >= 2) {
      // 多父提交无条件走并集对账（前缀通过不得短路——ours-resolution 合并树与第一父逐字节同 blob，
      // 嵌套判法对静默丢行全盲）
      const unionFail = mergeUnionProblem(sha, rel, cur);
      if (!unionFail) {
        console.error(`[info] ${sha.slice(0, 10)}：合并并集无丢失——union 合并语义认可，续扫`);
        continue;
      }
      // union 不过 → manifest 集合对账（分支修剪合并落地；对父母并集对账，非第一父）
      const setFail = mergePruneProblem(parents, rel, cur, loadManifestFromRef(`${sha}:${PRUNE_REL}`, ROOT));
      if (!setFail) {
        console.error(`[info] ${sha.slice(0, 10)}：合并携带特许修剪——父母并集集合对账通过`);
        continue;
      }
      problems.push(`- [前缀破坏] ${sha.slice(0, 10)}（合并）：${rel} 并集对账失败：${unionFail}；修剪集合对账：${setFail}`);
      continue;
    }
    if (!cur.subarray(0, base.length).equals(base)) {
      // 前缀破坏 → 该提交树上携带 manifest 且逐行对账 = 特许修剪（loud 记录）
      const m = matchPrune(base.toString('utf8'), cur.toString('utf8'), loadManifestFromRef(`${sha}:${PRUNE_REL}`, ROOT));
      if (m && !m.err) {
        console.error(`[info] ${sha.slice(0, 10)}：特许修剪 ${m.removed} 行（${m.docs.length} 家族）——manifest 对账通过，凭据 ${PRUNE_REL} 入库可对质`);
      } else {
        let off = 0;
        while (off < Math.min(base.length, cur.length) && base[off] === cur[off]) off++;
        const removed = base.length > cur.length;
        problems.push(`- [前缀破坏] ${sha.slice(0, 10)}（父 ${parents[0].slice(0, 10)}）：${rel} 历史内容被${removed ? `删减 ${base.length - cur.length}B` : `改写（首异偏移 ${off}，旧 ${base.length}B → 新 ${cur.length}B）`}${m && m.err ? `；特许修剪对账失败：${m.err}` : ''}`);
      }
    }
  }
  return allShas; // 交回该路径的全量提交史，供调用方判定「有史才进行级校验」
}

// ---- 台账路径全集：主台账 + 历史上出现过的全部分片 ----
function ledgerPaths() {
  const rels = [REL];
  try {
    const out = gitText(['log', '--name-only', '--pretty=format:', '--', SHARD_DIR]);
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (p && isShard(p) && !rels.includes(p)) rels.push(p);
    }
  } catch { /* 非 git 或无历史：仅主台账 */ }
  // 工作区里新出现（尚未入库）的分片也要进行 --staged 前缀判定
  try {
    const dir = path.join(ROOT, SHARD_DIR);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      for (const f of fs.readdirSync(dir)) {
        const p = `${SHARD_DIR}/${f}`;
        if (isShard(p) && !rels.includes(p)) rels.push(p);
      }
    }
  } catch { /* 忽略 */ }
  return rels;
}

// ---- --staged：暂存台账面 ⊇ HEAD 前缀，或携带 manifest 的特许修剪；分片删除须已并入暂存主台账 ----
if (staged) {
  const stagedHit = gitText(['-c', 'core.quotepath=off', 'diff', '--cached', '--name-only']).split(/\r?\n/).filter(Boolean);
  const touched = ledgerPaths().filter((rel) => stagedHit.includes(rel));
  if (!touched.length) process.exit(0);
  // 暂存主台账行集（分片删除的 compact 归并判据比对基准——与历史扫「同提交主台账」同语义，取暂存态）
  let stagedMainLines = new Set();
  try { stagedMainLines = new Set(linesOf(blobOf(`:${REL}`))); } catch { /* 暂存主台账缺失/未触 → 空集 */ }
  for (const rel of touched) {
    if (rel === REL) {
      const headExists = (() => { try { gitText(['rev-parse', '--verify', '--quiet', `HEAD:${rel}`]); return true; } catch { return false; } })();
      if (!headExists) continue; // 首次入库：无 HEAD 基线，历史全扫与终树行级校验覆盖
      let head, cur;
      try {
        head = blobOf(`HEAD:${rel}`);
        cur = blobOf(`:${rel}`); // 暂存区
      } catch {
        continue; // 对象读取异常（如极端并发）交由 CI 全扫兜底
      }
      if (!cur.subarray(0, head.length).equals(head)) {
        // 前缀破坏 → 特许修剪对账（manifest 必须同在暂存集）
        const m = matchPrune(head.toString('utf8'), cur.toString('utf8'), loadManifestFromRef(`:${PRUNE_REL}`, ROOT));
        if (m && !m.err) {
          console.log(`台账不变量（--staged）— ${rel} 特许修剪通过：移除 ${m.removed} 行（${m.docs.length} 家族）——凭据 ${PRUNE_REL} 随笔入库，被删行可在 git 历史对质`);
          continue;
        }
        let off = 0;
        while (off < Math.min(head.length, cur.length) && head[off] === cur[off]) off++;
        problems.push(`- [台账重写] ${rel} 暂存内容不是 HEAD 的前缀扩展（首异偏移 ${off}，HEAD ${head.length}B → 暂存 ${cur.length}B）${m && m.err ? `；特许修剪对账失败：${m.err}` : ''}`);
      }
      continue;
    }
    // 分片三态（2026-10-13 ledger-shard-default：分片为默认写入口径）：纯追加验前缀 / 暂存删除验
    // compact 归并（丢行 hard 拦）/ 新分片首入库无 HEAD 基线跳过（历史全扫续管）。
    let sHead;
    try { sHead = blobOf(`HEAD:${rel}`); } catch { continue; } // 新分片首入库
    let sCur = null;
    try { sCur = blobOf(`:${rel}`); } catch { sCur = null; }
    if (sCur === null) {
      // 暂存里分片被删 → compact 归并判据（行全并入暂存主台账才放行）
      const shardLines = linesOf(sHead);
      const missing = shardLines.filter((l) => !stagedMainLines.has(l));
      if (missing.length === 0) {
        console.log(`台账不变量（--staged）— 分片 ${rel} 删除：${shardLines.length} 行已全部并入暂存主台账（compact 归并形态，放行）`);
      } else {
        problems.push(`- [分片删除丢行] ${rel} 被删除，但其中 ${missing.length} 行未出现在暂存主台账（compact 归并须先并入再删）`);
      }
      continue;
    }
    if (!sCur.subarray(0, sHead.length).equals(sHead)) {
      let off = 0;
      while (off < Math.min(sHead.length, sCur.length) && sHead[off] === sCur[off]) off++;
      problems.push(`- [分片重写] ${rel} 暂存内容不是 HEAD 的前缀扩展（首异偏移 ${off}，HEAD ${sHead.length}B → 暂存 ${sCur.length}B）——分片同受 append-only 前缀不变量约束`);
    }
  }
  if (problems.length) {
    console.error('台账不可变（--staged）— BLOCK:\n' + problems.join('\n'));
    console.error(`  修法：台账历史行禁删改——误写走追加补偿行（node .agents/scripts/confirm-doc.mjs ...）；确需撤销历史提交请 git revert 后重新追加。\n        所有者明令删除某批文档须同笔暂存 ${PRUNE_REL}（逐行 sha256 + 授权 + 理由），门禁逐行对账后才放行。`);
    if (problems.some((p) => p.startsWith('- [分片重写] '))) {
      console.error('  分片重写另因：分片按 doc 命名、单端追加；跨端并发确认同一 doc 须有 merge=jsonl-union 驱动（git config merge.jsonl-union.driver "node .agents/scripts/git-merge-jsonl.mjs %O %A %B" + .gitattributes 标 merge=jsonl-union）——驱动生效则合并自动取并集、不破坏前缀');
    }
    process.exit(1);
  }
  process.exit(0);
}

// ---- 历史全扫（缺省）----
// 有提交史的路径才进历史扫描**与终树行级校验**——零史路径（装户/新仓/尚在暂存区）整体跳过，
// 与原实现「零提交历史即静默」的契约一致（否则新仓首版会被 doc 不存在误杀）。
const withHistory = new Set();
for (const rel of ledgerPaths()) {
  const shas = scanHistory(rel, { allowShardDelete: isShard(rel) });
  if (shas && shas.length) withHistory.add(rel);
}

// ---- 行级校验（终树：主台账 + 各现存分片；仅覆盖有提交史的路径）----
// 取数走 ledger-loader 带来源视图（主台账在前、分片按文件名序在后）——既有
// .agents/ledger-line-exempt.json 的行号（校验序号即非空行序）不因引入分片而漂移；
// 报文带来源标签（坏行点名所在台账文件）。JSON 坏行以 null 占位计号并显式报「非 JSON 对象行」。
const entries = readLedgerEntries(ROOT).filter((en) => withHistory.has(en.rel));
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
// ① ts 单调口径（2026-10-12 ledger-doc-chain 配套修正）：**按 doc 分组内单调**，跨 doc 物理序乱序
// 不判、只计数出账。为什么与实战源实现的「单文件内非降序」不同：并集合并与分片归都会把「别的 doc
// 的新行」追加到本文件尾部，而那些行的 ts 可能早于本文件末行的 ts → 全表判据必然因正常协作报红，
// 逼出 --no-verify；kit 装户存量台账仍是主台账单文件多 doc 形态，per-doc 才是可满足的判据。
// 仍保留的强判据：**同一 doc 内的 ts 倒挂照报**；跨 doc 的插行/改行由检查 15 doc-chain 哈希链兜。
const prevTsByDoc = new Map();
let crossDocOutOfOrder = 0;
let prevTsAny = '';
entries.forEach((en, idx) => {
  const at = `${en.rel === REL ? '主台账' : en.rel} 第 ${idx + 1} 行`;
  const e = en.row;
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
  } else if (!docExists(e.doc)) {
    problems.push(`- [行级] ${at}：doc ${e.doc} 在当前树不存在（四目录与归档批次均未命中）`);
  }
  if (!VALID_STAGES.has(e.stage)) problems.push(`- [行级] ${at}：stage「${e.stage || '缺失'}」不在合法跳转终态集`);
});

if (exemptCount) console.log(`ℹ️  台账豁免行 ${exemptCount} 条（定性见 .agents/ledger-line-exempt.json）`);
if (crossDocOutOfOrder) {
  console.log(`ℹ️  台账跨 doc 物理序 ts 乱序 ${crossDocOutOfOrder} 处（并集合并 / 分片归并的正常形态——不阻断；同 doc 内时序倒挂仍 hard 拦，插行/改行由检查 15 哈希链兜）`);
}
if (problems.length) {
  fail(`台账不可变（历史全扫）— HARD-BLOCK:\n\n${problems.join('\n')}\n\n  修法：台账历史行禁删改（append-only 前缀不变量）——误写只能追加补偿行；确需撤销历史提交请 git revert 后重新追加。篡改属审计事件，保留现场联系仓库所有者。`);
}
process.exit(0);
