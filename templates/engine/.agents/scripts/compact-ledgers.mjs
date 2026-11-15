#!/usr/bin/env node
// compact-ledgers.mjs — 台账分片打包归并器（2026-10-10 中期方案配套工具；2026-11-15 issue #39 部分归并重写）
// 用途：在里程碑节点或发布前，可选运行本脚本将 .agents/confirmations.d/*.jsonl 中的分片确认行
// 安全合并回归档主台账 .agents/confirmations.jsonl，并清理已归并分片。
//
// 部分归并（2026-11-15 issue #39）：主台账行级不变量要求「ts 文件内非降序」（check-ledger-invariant
//   行级校验①，ISO **字符串比较**口径），而分片常含回溯行（ts 早于主台账末行），按文件名序整包追加
//   必破坏单调（实证：619 片归并后 385 处「追加时序非单调」）。本版改为逐分片判定：片的全部非重复行
//   均能解析出合法 ISO ts 且（字符串比较）≥ 主台账末行 ts 才可归并；可归并行按 ts 字符串升序**稳定
//   排序**后追加——与检查器行级判据同一比较口径（禁 Date.parse 排序：小数秒位数不同的 ISO 串两者
//   不等价）；回溯/缺 ts 分片原样保留并打印明确清单，待主台账末行时间推进后重跑，或走
//   ledger-rebuild-manifest 通道。
// 重跑安全：按行文本去重（与 mergeJsonlLines 同 norm 口径），已在主台账中的重复行不追加、也不参与
//   判定（不会破坏单调）；重复重跑幂等。
// 原子写：主台账同目录临时文件 + rename，任一步失败时主台账原样、分片未删，可安全重跑。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 与 git-merge-jsonl.mjs mergeJsonlLines 同口径的行归一（LF 归一、去空行）；排序要求其保持收集序，
// 故内联实现而非复用（后者「保持 current 序 + other 原序追加」不满足 ts 升序语义）。
const normLines = (str) => (str || '').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);

// 行 → 合法 ISO ts 字符串（JSON.parse 失败 / ts 非字符串 / Date.parse 无效 → null）。
// Date.parse 仅做有效性判定（与 check-ledger-invariant 行级校验同式），排序一律字符串比较。
const tsOf = (line) => {
  try {
    const e = JSON.parse(line);
    if (e && typeof e.ts === 'string' && !Number.isNaN(Date.parse(e.ts))) return e.ts;
  } catch { /* 非 JSON 行按缺 ts 处理 */ }
  return null;
};

// 归并计划（纯函数，可测）：{ mainText, shardTexts: Map<文件名, 文本>（保持文件名序）} →
//   { mergedText, mergedShards: [{file, lines}], keptShards: [{file, reason}], appended }
// 判定规则：逐分片（文件名序）取其「非重复非空行」（不在主台账、且未被更早分片成功收集），
//   每行须有合法 ISO ts 且（字符串比较）tailTs === '' || ts >= tailTs → 该片可归并；否则整片保留，
//   reason 取首类违规行：`回溯行早于主台账末行 ${tailTs}（行 ${n}：ts ${ts}）` 或 `第 ${n} 行缺合法 ts 字段`。
//   已在主台账中的重复行不参与判定（不会追加，不破坏单调）；违规行不进全局去重集——后续分片含
//   同一行时仍独立判定，保证「被删分片的全部行都已进主台账」（否则历史全扫的删片对账会红）。
//   可归并行按 ts 字符串升序稳定排序（Node sort 稳定，等 ts 保持收集序 = 文件名序 × 片内序）后追加。
export function planCompaction({ mainText, shardTexts }) {
  const mainLines = normLines(mainText);
  const mainSet = new Set(mainLines);
  const tailTs = mainLines.length ? (tsOf(mainLines[mainLines.length - 1]) || '') : '';
  const mergedShards = [];
  const keptShards = [];
  const collect = [];
  const seen = new Set(mainSet); // 全局去重集：主台账行 + 已成功收集行（同 mergeJsonlLines 的按行去重）
  for (const [file, text] of shardTexts) {
    const lines = normLines(text);
    const fresh = [];
    let keepReason = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (seen.has(line)) continue; // 重复行：不追加、不参与判定
      const ts = tsOf(line);
      if (ts === null) { keepReason = `第 ${i + 1} 行缺合法 ts 字段`; break; }
      if (tailTs && ts < tailTs) { keepReason = `回溯行早于主台账末行 ${tailTs}（行 ${i + 1}：ts ${ts}）`; break; }
      seen.add(line); // 仅判定通过的行入集（违规行不入，见上）
      fresh.push({ line, ts });
    }
    if (keepReason) {
      keptShards.push({ file, reason: keepReason });
      continue;
    }
    mergedShards.push({ file, lines: fresh.map((e) => e.line) });
    collect.push(...fresh);
  }
  collect.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)); // ts 字符串升序，稳定
  const appended = collect.map((e) => e.line);
  const all = [...mainLines, ...appended];
  const mergedText = all.length > 0 ? all.join('\n') + '\n' : '';
  return { mergedText, mergedShards, keptShards, appended };
}

function main() {
  const root = process.cwd();
  const mainLedger = path.join(root, '.agents', 'confirmations.jsonl');
  const shardDir = path.join(root, '.agents', 'confirmations.d');

  if (!fs.existsSync(shardDir) || !fs.statSync(shardDir).isDirectory()) {
    console.log('[compact-ledgers] 未发现分片目录 .agents/confirmations.d/，无需打包。');
    process.exit(0);
  }

  const shardFiles = fs.readdirSync(shardDir).filter((f) => f.endsWith('.jsonl')).sort();
  if (shardFiles.length === 0) {
    console.log('[compact-ledgers] 分片目录无 .jsonl 文件，无需打包。');
    process.exit(0);
  }

  console.log(`[compact-ledgers] 发现 ${shardFiles.length} 个分片文件，正在按 ts 归并判定...`);

  const currentMain = fs.existsSync(mainLedger) ? fs.readFileSync(mainLedger, 'utf8') : '';
  const shardTexts = new Map();
  for (const file of shardFiles) {
    try {
      shardTexts.set(file, fs.readFileSync(path.join(shardDir, file), 'utf8'));
    } catch (err) {
      console.error(`[compact-ledgers] 读取分片失败: ${file} (${err.message})`);
      console.error('[compact-ledgers] 已中止打包：主台账与全部分片保持原样；请解决后重跑（合并按行去重，重跑安全）。');
      process.exit(1);
    }
  }

  const plan = planCompaction({ mainText: currentMain, shardTexts });

  const reportKept = () => {
    if (!plan.keptShards.length) return;
    console.log(`[compact-ledgers] ⏸ 保留 ${plan.keptShards.length} 片（回溯行/缺 ts，未归并）：${plan.keptShards.map((s) => s.file).join('、')}`);
    for (const s of plan.keptShards) console.log(`  · ${s.file} — ${s.reason}`);
    console.log('[compact-ledgers] 回溯分片待主台账末行时间推进后重跑，或走 ledger-rebuild-manifest 通道。');
  };

  if (plan.mergedShards.length === 0) {
    reportKept();
    console.log('[compact-ledgers] 无可归并分片：主台账保持原样，未删除任何分片。');
    process.exit(0);
  }

  // 原子覆写主台账：直接 writeFileSync 会先截断原文件，进程中途崩溃将损坏主台账；
  // 改为同目录临时文件 + rename，任一步失败时主台账原样、分片未删，可安全重跑。
  const tmpMain = `${mainLedger}.tmp`;
  try {
    fs.writeFileSync(tmpMain, plan.mergedText, 'utf8');
    fs.renameSync(tmpMain, mainLedger);
  } catch (err) {
    try { fs.unlinkSync(tmpMain); } catch { /* tmp 可能尚未创建或删除失败 */ }
    console.error(`[compact-ledgers] 主台账写入失败: ${err.message}`);
    console.error('[compact-ledgers] 已中止打包：主台账原样、分片未删除；请解决后重跑（合并按行去重，重跑安全）。');
    process.exit(1);
  }

  // 删除只作用于可归并片；保留片原样留在 .agents/confirmations.d/
  for (const s of plan.mergedShards) {
    try {
      fs.unlinkSync(path.join(shardDir, s.file));
    } catch { /* 忽略删除异常 */ }
  }

  // 若目录为空，尝试删除空目录（有保留片时目录非空，不删）
  try {
    if (fs.readdirSync(shardDir).length === 0) {
      fs.rmdirSync(shardDir);
    }
  } catch { /* 忽略 */ }

  console.log(`[compact-ledgers] ✅ 归并 ${plan.mergedShards.length} 片 / ${plan.appended.length} 行（按 ts 升序追加），全量确认行已整合至 .agents/confirmations.jsonl，已归并分片清理完毕。`);
  reportKept();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
