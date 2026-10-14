#!/usr/bin/env node
// gen-verify-evidence.mjs — 验证绿凭证摘要入库生成器（2026-10-13 自 Shipyard.Material 参考实现回灌，
//   源仓沿革留痕在包源仓 git 历史与 CHANGELOG——装户径不引实例路径）
// 背景：verifications.jsonl 是 gitignore 的本地台账（24h 窗口、跨机不可见）——历史提交「当时验证过什么」
//   的机器事实只活在本地。本脚本把全绿行按 headShort 去重（同 SHA 取最新 ts）渲染进仓内
//   workflow/verify-evidence.md，使绿凭证成为随库持久、跨机可对质的生成物（全量台账仍留本地）。
// 语义：一行 = 「**验证时刻的工作树**（其基线提交 = 短 SHA，工作树可含未提交改动）过 verify 全量门禁
//   全绿（门数 / 套件计数）」；非证据链签名——本地台账可伪造的诚实边界不变（check-loop 检查 15 头注释
//   口径），入库摘要只是把「曾有凭证」从易失升级为难失。
// 归因提醒：短 SHA 只是**基线提交**，不等于被测内容。关单应「先提交、后跑门」，否则绿行 SHA 指向
//   未含本次改动的上一提交——同一 SHA 可能既有绿行（脏工作区跑）又有红记录。
// 追加保全：已入仓的行不因本地台账缺失而被抹掉——台账 per-worktree 且 gitignore，整段重写会让
//   跨机/换 worktree 的历史凭证消失。合并口径 = 仓内既有行 ∪ 本地台账绿行，同 headShort 取更新 ts
//   （平局取本地台账，保持「重跑刷新凭证」语义）。代价（已接受）：仓内错行不会被重生成自动纠正——
//   须人工改正；若本地台账仍持同一 SHA，重生成会按台账重写该行（须连同台账处理）。
// 时机：verify.mjs 全绿尾部自动重生成（事件原子化——绿事实与仓内摘要同刻生成，消除双真相分叉）
//   + 关单时随三件套同笔提交；CI 侧重生成于 CI 工作区、不回流本仓，无副作用；--check 只供本地自检。
// 台账口径：kit 绿行形状 = {ts, exitCode:0, suite:'npm test', gates?, headShort?, passed?, failed?,
//   doc?, runId?}（verify.mjs 落账单源）——本脚本只认 exitCode===0 且 suite==='npm test' 且带 headShort
//   的行（无 SHA 的旧 schema 行不渲染）；passed/failed 语义 = 套件计数（非断言），doc = --doc 绑定单。
// 用法：node .agents/scripts/gen-verify-evidence.mjs [--root <dir>] [--check]
// 测试：node .agents/scripts/gen-verify-evidence.test.mjs（fixture 注入 --root）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
};
const ROOT = argOf('--root') || path.resolve(SCRIPT_DIR, '..', '..');
const LEDGER = path.join(ROOT, '.agents', 'verifications.jsonl');
const OUT = path.join(ROOT, 'workflow', 'verify-evidence.md');

// 六列数据行：短SHA / 时间 / 门数 / 套件计数 / 绑定单 / runId
const ROW_RE = /^\|\s*`([0-9a-f]{7,40})`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/;

/** 按本地台账条目渲染数据行 */
function renderRow(e) {
  const cnt = Number.isFinite(e.passed) ? `PASS ${e.passed} / FAIL ${e.failed ?? 0}` : '—';
  return `| \`${e.headShort}\` | ${e.ts} | ${e.gates ?? '—'} | ${cnt} | ${e.doc || '—'} | ${e.runId || '—'} |`;
}

/**
 * 解析本文件既有数据行（追加保全用）。
 * 只认形态完整的数据行；说明行 / 表头 / 注释一律忽略。读不到文件 = 无既有行。
 */
function parseCommittedRows() {
  const out = [];
  let disk = '';
  try { disk = fs.readFileSync(OUT, 'utf8'); } catch { return out; }
  for (const raw of disk.split(/\r?\n/)) {
    const m = raw.trim().match(ROW_RE);
    if (m) out.push({ headShort: m[1], ts: m[2].trim(), line: raw.trim() });
  }
  return out;
}

function render() {
  const rows = [];
  try {
    for (const line of fs.readFileSync(LEDGER, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.exitCode === 0 && e.suite === 'npm test' && e.headShort) rows.push(e);
      } catch { /* 坏行跳过——台账是 append-only 事实流，不因单行格式失败中断 */ }
    }
  } catch { /* 无台账 = 空表（新装户/新 clone 首跑前） */ }
  // 行统一形态 { headShort, ts, line }。先放**仓内既有行**（追加保全），再叠加本地台账绿行。
  const bySha = new Map();
  for (const r of parseCommittedRows()) bySha.set(r.headShort, r);
  // 同 headShort 取更新 ts（重跑刷新凭证，不堆行）；平局取本地台账
  for (const e of rows) {
    const prev = bySha.get(e.headShort);
    if (!prev || String(e.ts) >= String(prev.ts)) bySha.set(e.headShort, { headShort: e.headShort, ts: String(e.ts), line: renderRow(e) });
  }
  const ordered = [...bySha.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const lines = [];
  lines.push('# 验证绿凭证摘要（生成物，勿手改）');
  lines.push('');
  lines.push('> 生成器 `node .agents/scripts/gen-verify-evidence.mjs`（verify.mjs 全绿尾部自动重生成；源 .agents/verifications.jsonl 为本地台账）。');
  lines.push('> 一行 = 验证时刻**工作树**过 verify 全量门禁全绿（短 SHA 为该时刻的**基线提交**，工作树可能含未提交改动——关单宜「先提交、后跑门」）；`套件计数` 为测试门编排器的套件 PASS/FAIL（无汇总行时缺省）；`绑定单` 为 --doc 绑定的工作流文档（不带的行不给任何单背书）。非签名链——诚实边界同 check-loop 检查 15。');
  lines.push('> 行来源 = 本地台账绿行 ∪ 本文件既有行（**追加保全**：跨机 / 换 worktree 不失历史；代价：错行不会被重生成自动纠正，须人工改正后重跑）。');
  lines.push('');
  lines.push('| 提交(短SHA) | 时间(UTC) | 门数 | 套件计数 | 绑定单 | runId |');
  lines.push('|---|---|---|---|---|---|');
  for (const e of ordered) lines.push(e.line);
  lines.push('');
  lines.push(`<!-- GENERATED:END — 共 ${ordered.length} 行；gen-verify-evidence.mjs 生成（既有行追加保全，勿手改） -->`);
  return lines.join('\n') + '\n';
}

const text = render();
if (argv.includes('--check')) {
  let disk = '';
  try { disk = fs.readFileSync(OUT, 'utf8'); } catch { /* 缺文件走漂移分支 */ }
  if (disk === text) { console.log('[verify-evidence] ✅ 与磁盘一致'); process.exit(0); }
  console.error('[verify-evidence] 漂移：本地台账有新绿行未入摘要——关单时跑 node .agents/scripts/gen-verify-evidence.mjs 并随同提交');
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
// 数据行计数：直接数六列数据行，不做总行数算术（生成物自描述）
console.log(`✅ 已生成 ${path.relative(process.cwd(), OUT)}（绿凭证 ${text.split(/\r?\n/).filter((l) => ROW_RE.test(l.trim())).length} 行）`);
