#!/usr/bin/env node
// ledger-loader.mjs — 确认台账读取视图单源（2026-10-12 ledger-loader-p1）
// 为什么有这个文件：确认台账 `.agents/confirmations.jsonl` 此前有 6 处生产代码各自
// `readFileSync` + `JSON.parse` 复刻一遍（stage-gates / check-loop ×4 / check-metric-claims /
// gen-workflow-dashboard / gen-workflow-metrics），口径与容错各写各的。后续引入分片台账
// （多人 / 多 worktree 并发，见 README 台账并发口径）时，逐处加分支必然漏改——漏一处即
// 「门禁看不见分片行」＝半盲，且不可见比全红更危险。本文件把**读**收成单源。
//
// 本步（Step 1）范围：纯重构，**行为逐字不变**——分片目录不存在时，视图与逐处直读等价。
// 故意**不做去重**：去重会改 gen-workflow-metrics 的漏斗计数口径（当前计全部行），
// 属口径变更，须随分片功能同批生效，不得混入本步。
//
// 两种视图（消费方需求不同，勿合并）：
//   readLedgerLines —— 原始文本行，给「按行计数 / 文本特征匹配」用（检查 16 确认负担）。
//   readLedgerRows  —— 解析后对象数组，坏行跳过，顺序 = 物理读序（主台账先、分片按文件名序）。
//
// **不归本文件管的两处（刻意保留直读，改动须先改这里）**：
//   ① check-loop.mjs 检查 15 哈希链校验——需**物理行号对齐**与**物理顺序**，
//      任何合并/去重视图都会毁掉它（物理行号 ↔ 数组下标换算依赖逐行原序）。
//   ② check-ledger-invariant.mjs——校验的是**物理文件本身**的 append-only 前缀不变量，
//      它审的是盘面字节，不是台账语义。
import fs from 'node:fs';
import path from 'node:path';

export const LEDGER_REL = '.agents/confirmations.jsonl';
export const SHARD_DIR_REL = '.agents/confirmations.d';

// ledgerSources：台账来源清单，顺序即读序——主台账（存量基线）先，分片按文件名序后。
// 分片视为较新（后读覆盖），与「append-only 台账末次生效」同向。
// 缺失即跳过（装户无台账 / 未启用分片 = 零影响，向上兼容）。
export function ledgerSources(root = process.cwd()) {
  const out = [];
  const mainAbs = path.join(root, ...LEDGER_REL.split('/'));
  if (fs.existsSync(mainAbs)) out.push({ rel: LEDGER_REL, abs: mainAbs });

  const shardAbs = path.join(root, ...SHARD_DIR_REL.split('/'));
  if (fs.existsSync(shardAbs) && fs.statSync(shardAbs).isDirectory()) {
    let files = [];
    try {
      files = fs.readdirSync(shardAbs).filter((f) => f.endsWith('.jsonl')).sort();
    } catch (err) {
      // 目录读不出来仍要把已收集的来源交出去——本文件是 hard 门（检查 15）的数据源，
      // IO 抖动不得伪装成「确认未对账」（fail-closed 会误伤真台账）
      console.error(`[ledger-loader] 分片目录读取失败: ${SHARD_DIR_REL} (${err.message})——台账视图可能缺该来源`);
      return out;
    }
    for (const f of files) {
      out.push({ rel: `${SHARD_DIR_REL}/${f}`, abs: path.join(shardAbs, f) });
    }
  }
  return out;
}

// readLedgerLines：全部来源的非空原始行（保留行内原文，顺序 = 物理读序）。
export function readLedgerLines(root = process.cwd()) {
  const lines = [];
  for (const src of ledgerSources(root)) {
    let text = '';
    try {
      text = fs.readFileSync(src.abs, 'utf8');
    } catch (err) {
      // 出账后继续：已读到的来源照常返回，缺的那个来源显式告警（不静默丢）
      console.error(`[ledger-loader] 读取失败: ${src.rel} (${err.message})——台账视图可能缺该来源`);
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) lines.push(line);
    }
  }
  return lines;
}

// readLedgerRows：全部来源解析后的行（坏行跳过，与检查 15 / 19 同容错口径）。
export function readLedgerRows(root = process.cwd()) {
  const out = [];
  for (const line of readLedgerLines(root)) {
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object') out.push(e);
    } catch { /* 坏行跳过 */ }
  }
  return out;
}

// readLedgerEntries：**带来源与行号**的视图，读序 = 主台账在前、分片按文件名序在后。
//   返回 [{ rel, no, row }]，坏行 row=null（保留占位，否则物理行号会漂移）。
//   消费方：check-loop 检查 15（链断裂要报「哪个文件的第几行」，跨来源后「物理行号」单一定位已不够，
//   必须带 rel 才能定位）。此前检查 15 只读主台账故无需本视图——引入分片后改走这里。
export function readLedgerEntries(root = process.cwd()) {
  const out = [];
  for (const src of ledgerSources(root)) {
    let text = '';
    try {
      text = fs.readFileSync(src.abs, 'utf8');
    } catch (err) {
      console.error(`[ledger-loader] 读取失败: ${src.rel} (${err.message})——台账视图可能缺该来源`);
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      let row = null;
      try { row = JSON.parse(lines[i]); } catch { /* 坏行占位 */ }
      out.push({ rel: src.rel, no: i + 1, row: (row && typeof row === 'object') ? row : null });
    }
  }
  return out;
}