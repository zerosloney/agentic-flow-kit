// delegation-presence.mjs — 委派台账行解析与在场判定单源（2026-10-25 优化4）
// 消费方：confirm-doc done 前置门（写入时拦截）。原第二消费方 check-loop 检查 18（事后对账）
// 已于 2026-10-28 随 hygiene 段退役删除（kit.delegationResultRows 同批删，不留死码）。
// 解析语义与 kit 原内联实现逐字一致：`## 委派结果`/`## 自做任务结果` 节内、管道行、首列 YYYY-MM-DD。
// 测试面已随引擎减重退役（2026-10-28，owner 决策），本模块现无测试兜底
import { readDelegationsText } from './ledger-shards.mjs';

export function parseDelegationRows(text) {
  const rows = [];
  const lines = String(text || '').split(/\r?\n/);
  const targetSec = (line) => /^##\s+(委派结果|自做任务结果)\s*$/.test(line);
  let inSec = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      inSec = targetSec(line);
      continue;
    }
    if (!inSec || !/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (!cells.length || cells.every((c) => /^[-: ]*$/.test(c))) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) continue;
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
// file 为显式注入路径时只读该文件。
export function delegationRowsOf(root, file = null) {
  return parseDelegationRows(readDelegationsText(root, file));
}
