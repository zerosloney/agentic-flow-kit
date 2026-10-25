// delegation-presence.mjs — 委派台账行解析与在场判定单源（2026-10-25 source-port-batch，自源仓优化4 回灌）
// 消费方：check-loop 检查 18（事后对账 WARN）+ confirm-doc 终态前置门（写入时拦截）——两个执法点
// 共用同一套解析与判据，事后 WARN 与关单拦截不漂移。
// 解析语义 = check-loop 原 delegationResultRows 逐字（表头签名识别：委派表头含「被委派方」列、
// 自做表头首列「日期」且含「任务一句话」列——节标题只服务人类阅读，表头才是数据边界；与
// agg-delegations.cjs splitTables 同口径，一边改另一边须跟）。
// 测试：node .agents/scripts/delegation-presence.test.mjs（另由 check-loop-unit / confirm-doc.test 端到端覆盖）
import { readDelegationsText } from './ledger-shards.mjs';

export function parseDelegationRows(text) {
  const lines = String(text || '').split(/\r?\n/);
  let inTable = false;
  const rows = [];
  for (const line of lines) {
    if (/^##\s+/.test(line)) { inTable = false; continue; }
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (!cells.length || cells.every((c) => /^[-: ]*$/.test(c))) continue;
    if (cells.some((c) => c.startsWith('被委派方')) || (cells[0] === '日期' && cells.some((c) => c.startsWith('任务一句话')))) {
      inTable = true;
      continue;
    }
    if (!inTable || !/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) continue;
    rows.push({ date: cells[0], line });
  }
  return rows;
}

// rowCovers(rows, base, date)：在场判据——存在日期 ≥ 文档日期、且行内含文件名（带/不带 .md）的行。
// 与检查 18 原判据逐字一致（家族同名行同时覆盖 intent/spec/plan 三件）。
export function rowCovers(rows, base, date) {
  const stripped = base.replace(/\.md$/, '');
  return rows.some((r) => r.date >= date && (r.line.includes(base) || r.line.includes(stripped)));
}

// delegationRowsOf(root, file)：分片感知读（主台账 ∪ delegations.d/*.md）+ 解析。
// file 为显式注入路径时只读该文件（测试语义同 delegationResultRows）。
export function delegationRowsOf(root, file = null) {
  return parseDelegationRows(readDelegationsText(root, file));
}
