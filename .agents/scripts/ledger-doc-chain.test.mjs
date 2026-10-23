#!/usr/bin/env node
// ledger-doc-chain.test.mjs — 台账哈希链「链域改造」fixture 套件（2026-10-12 ledger-doc-chain）
// 核心命题：把链域从「文件物理序」改成「按 doc 的逻辑序」，在**不削弱篡改检出**的前提下让三种
// 正常协作（并发 append / git 并集合并 / 分片归并）不再撞 hard 门。
// 覆盖面：锚缺键=旧行为 / 锚前行维持物理链 / 锚后行按 doc 链 / 跨域衔接 / 三类篡改仍被抓 /
//         写入侧与校验侧口径一致（双方单源函数同源）。
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const { ledgerChainHash, ledgerDocChainActive, ledgerDocChainPrev } =
  await import(pathToFileURL(path.join(SCRIPT_DIR, 'policy.mjs')).href);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const ANCHOR = '2026-10-12T07:20:00Z';
const OLD = '2026-10-01T00:00:00Z';   // 锚前（旧物理链口径）
const NEW = '2026-10-13T00:00:00Z';   // 锚后（新 doc 链口径）

// mkRow：造一条链行（prevHash 由调用方给）
const mkRow = (ts, doc, stage, prevHash) => {
  const fields = { ts, doc, stage, fingerprint: 'f'.repeat(64), source: 'tty' };
  return { ...fields, prevHash, hash: ledgerChainHash(fields, prevHash) };
};

// ---- 校验侧判据的可执行镜像（必须与 check-loop.mjs 检查 15 同判据；此处用于单测，生产判据在 check-loop）----
function verifyChain(rows, policy) {
  const on = ledgerDocChainActive(policy);
  const since = on ? policy.ledgerDocChainSince : '';
  let prevHash = '', brokenAt = 0, brokenCount = 0;
  const byDoc = new Map();
  rows.forEach((row, idx) => {
    if (!row || typeof row.hash !== 'string') { prevHash = ''; return; }
    const { hash, prevHash: p, ...rest } = row;
    const inDoc = on && typeof row.ts === 'string' && row.ts >= since;
    const expected = inDoc ? (byDoc.get(row.doc) ?? '') : prevHash;
    const ok = (p ?? '') === expected && ledgerChainHash(rest, p ?? '') === hash;
    if (!ok) { if (!brokenAt) brokenAt = idx + 1; brokenCount++; }
    prevHash = hash;
    if (typeof row.doc === 'string') byDoc.set(row.doc, hash);
  });
  return { brokenAt, brokenCount };
}

// ================= 单元：锚开关 =================
{
  check('U1 缺键（v1-v7）→ 新口径不生效', ledgerDocChainActive({}) === false);
  check('U2 非法锚值 → 不生效（fail-safe 回旧口径）', ledgerDocChainActive({ ledgerDocChainSince: '2026-10-12' }) === false);
  check('U3 合法 ISO 时刻锚 → 生效', ledgerDocChainActive({ ledgerDocChainSince: ANCHOR }) === true);
  check('U4 v8 锚值合法', ledgerDocChainActive({ ledgerDocChainSince: ANCHOR }) === true);
}

// ================= 单元：前驱取法 =================
{
  const rA1 = mkRow(OLD, 'a.md', 'approved', '');
  const rA2 = mkRow(OLD, 'b.md', 'approved', rA1.hash);
  const rA3 = mkRow(OLD, 'a.md', 'done', rA2.hash);
  const rows = [rA1, rA2, rA3];
  check('U5 doc 链前驱取同行末行（非物理末行）', ledgerDocChainPrev(rows, 'a.md') === rA3.hash);
  check('U6 另一 doc 的前驱独立', ledgerDocChainPrev(rows, 'b.md') === rA2.hash);
  check('U7 该 doc 无链行 → 链段重启返回空', ledgerDocChainPrev(rows, 'zz.md') === '');
  check('U8 空表 → 返回空', ledgerDocChainPrev([], 'a.md') === '' && ledgerDocChainPrev(null, 'a.md') === '');
}

// ================= 关键：缺锚 = 旧行为（存量零变化）=====================
{
  const rA1 = mkRow(OLD, 'a.md', 'approved', '');
  const rA2 = mkRow(OLD, 'b.md', 'approved', rA1.hash);
  const rA3 = mkRow(OLD, 'a.md', 'done', rA2.hash);
  // 物理链下这三行是自洽的（旧口径判定）
  check('K1 缺锚：物理链自洽行不报断（= 存量零新增告警）',
    verifyChain([rA1, rA2, rA3], {}).brokenCount === 0);
}

// ================= 关键：锚前行维持物理链 =================
{
  const pol = { ledgerDocChainSince: ANCHOR };
  const rA1 = mkRow(OLD, 'a.md', 'approved', '');
  const rA2 = mkRow(OLD, 'b.md', 'approved', rA1.hash); // 物理接续（doc 链口径下这行会断）
  const rA3 = mkRow(OLD, 'a.md', 'done', rA2.hash);
  check('K2 锚前：物理链接续的三行不误报（存量不受改造影响）',
    verifyChain([rA1, rA2, rA3], pol).brokenCount === 0, JSON.stringify(verifyChain([rA1, rA2, rA3], pol)));
}

// ================= 关键：锚后 doc 链 + 跨域衔接 =================
{
  const pol = { ledgerDocChainSince: ANCHOR };
  // 锚前：物理链两行（a 起点、b 接物理）
  const rA1 = mkRow(OLD, 'a.md', 'approved', '');
  const rB1 = mkRow(OLD, 'b.md', 'approved', rA1.hash);
  // 锚后：doc 链接续（a 的新行接 rA1，b 的新行接 rB1——**不是**物理末行 rA1）
  const rA2 = mkRow(NEW, 'a.md', 'done', rA1.hash);
  const rB2 = mkRow(NEW, 'b.md', 'done', rB1.hash);
  check('K3 锚后：doc 链接续自洽（跨域衔接成功）',
    verifyChain([rA1, rB1, rA2, rB2], pol).brokenCount === 0, JSON.stringify(verifyChain([rA1, rB1, rA2, rB2], pol)));
  check('K4 锚后 b 的前驱是 b 自己上一行（不是物理末行）',
    rB2.prevHash === rB1.hash && rB2.prevHash !== rA2.hash);
}

// ================= 关键：三种正常协作不再误报 =================
// 注意夹具语义：doc 链下某 doc 的**首个链行 prevHash 恒为 ''**（该 doc 链段重启），第二行才接前一行。
// 用物理前驱填夹具会造出「本就不该自洽」的样本——那是夹具错，不是判据错（K5/K6/K7 首版即栽在这里）。
{
  const pol = { ledgerDocChainSince: ANCHOR };
  const rA1 = mkRow(NEW, 'a.md', 'approved', '');
  const rA2 = mkRow(NEW, 'a.md', 'done', rA1.hash);
  const rB1 = mkRow(NEW, 'b.md', 'approved', '');
  const rB2 = mkRow(NEW, 'b.md', 'done', rB1.hash);
  // 协作①：两分支各自追加后并集合并 —— 行序可能被打乱（b 行被挪到 a 行之间）
  check('K5 协作①并集合并（跨 doc 行序与物理链不同）→ doc 链仍自洽',
    verifyChain([rA1, rB1, rA2, rB2], pol).brokenCount === 0, JSON.stringify(verifyChain([rA1, rB1, rA2, rB2], pol)));
  // 协作②：分片归并把别的 doc 的行插进本 doc 链的中段
  const rC1 = mkRow(NEW, 'c.md', 'approved', '');
  check('K6 协作②分片归并插行 → doc 链仍自洽',
    verifyChain([rA1, rC1, rA2, rB1, rB2], pol).brokenCount === 0, JSON.stringify(verifyChain([rA1, rC1, rA2, rB1, rB2], pol)));
  // 基线：供下方篡改用例复用
  const base = [rA1, rB1, rA2, rB2];
  check('K7 基线：四行自洽', verifyChain(base, pol).brokenCount === 0, JSON.stringify(verifyChain(base, pol)));

  // 篡改①：就地改中间行内容（不动其 hash）→ 重算必失配
  const tampered1 = base.map((r) => (r === rB1 ? { ...r, stage: 'cancelled' } : r));
  check('K8 篡改①就地改行 → 抓到', verifyChain(tampered1, pol).brokenCount > 0);

  // 篡改②：删该 doc 的**中间行**（a 的首行）→ 其后继行 prevHash 失配。
  //   诚实边界：**删某 doc 的末行在两种链域下都抓不到**（无后继可比），这是链式防伪的固有上限，
  //   物理链同样如此；兜底仍是 check-ledger-invariant 的 append-only 历史全扫。
  const deleted = base.filter((r) => r !== rA1);
  check('K9 篡改②删中间行 → 抓到', verifyChain(deleted, pol).brokenCount > 0);

  // 篡改③：插一行（自洽重算但前驱为空）→ 后继行前驱失配
  const fFields = { ts: NEW, doc: 'a.md', stage: 'reverted', fingerprint: 'x'.repeat(64), source: 'tty' };
  const forged = { ...fFields, prevHash: '', hash: ledgerChainHash(fFields, '') };
  const inserted = [rA1, forged, rA2, rB1, rB2];
  check('K10 篡改③插行（自洽重算但前驱为空）→ 抓到', verifyChain(inserted, pol).brokenCount > 0);
}

// ================= 关键：写入侧与校验侧口径一致 =================
{
  // 写入侧取前驱（ledgerDocChainPrev）与校验侧期望（byDoc 末值）必须是同一个值——否则新行一落账即断
  const rA1 = mkRow(OLD, 'a.md', 'approved', '');
  const rB1 = mkRow(OLD, 'b.md', 'approved', rA1.hash);
  const rows = [rA1, rB1];
  const writeSidePrev = ledgerDocChainPrev(rows, 'a.md');
  // 校验侧：走一遍同样两行后，byDoc.get('a.md') 应等于写入侧取到的值
  const byDoc = new Map();
  for (const row of rows) byDoc.set(row.doc, row.hash);
  check('K11 写入侧取前驱 == 校验侧期望（两侧单源一致）',
    writeSidePrev === rA1.hash && byDoc.get('a.md') === writeSidePrev);
}

// ================= 边界：无 ts 的链行 fail-safe 回旧口径 =================
{
  const pol = { ledgerDocChainSince: ANCHOR };
  const noTs = { doc: 'a.md', stage: 'approved', fingerprint: 'z'.repeat(64), prevHash: '', hash: '' };
  const fields = { doc: 'a.md', stage: 'approved', fingerprint: 'z'.repeat(64) };
  noTs.hash = ledgerChainHash(fields, '');
  check('K12 无 ts 的链行按物理链判定（不因缺 ts 误入新域）',
    verifyChain([noTs], pol).brokenCount === 0);
}

console.log(`\n[ledger-doc-chain.test] PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);