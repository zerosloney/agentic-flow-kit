#!/usr/bin/env node
// compact-ledgers.mjs — 台账分片归并器（2026-10-12 ledger-shard-write 配套；2026-10-13 ledger-shard-default 起为默认分片的收敛动作）
// 用途：里程碑节点或发布前，把 `.agents/confirmations.d/*.jsonl` 的分片确认行并回主台账
//   `.agents/confirmations.jsonl` 并清理分片。分片已是**默认**写入口径（confirm-doc 不带 --no-shard 即写分片），
//   长期不归并会让台账面无限碎片化——本脚本就是可选的收敛动作（跨分支合并另由 union driver 承担，归并非必需）。
//
// 保持 append-only 前缀不变量：主台账既有行**严格保序不动**，分片新行只追加到末尾——这正是
//   check-ledger-invariant 的「旧 blob 是新 blob 的逐字节前缀」所要求的形态。绝不做重排/去重改写。
//
// 安全设计（三条，缺一条都可能损坏主台账）：
//   ① 默认 dry-run：只报告「将并入 N 行」，不动盘。必须显式 execute 才写。
//   ② 原子覆写：同目录临时文件 + rename。中途崩溃 = 主台账原样、分片未删，可安全重跑。
//   ③ 幂等：并集按整行文本去重（复用 git-merge-jsonl 的同款判据），重复执行结果不变。
//   任一分片读取失败 → 立即中止，主台账与全部分片保持原样。
//
// 用法：node .agents/scripts/compact-ledgers.mjs [--root <仓库根>] [--execute]
import fs from 'node:fs';
import path from 'node:path';
import { mergeJsonlLines } from './git-merge-jsonl.mjs';
import { LEDGER_REL, SHARD_DIR_REL } from './ledger-loader.mjs';

const linesOf = (t) => (t || '').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);

// compactLedgers(root, { execute })：纯函数形态，供测试直测。
//   返回 { ok, skipped?, reason?, added, before, after, shards, shardLines, error? }
export function compactLedgers(root = process.cwd(), { execute = false } = {}) {
  const mainLedger = path.join(root, ...LEDGER_REL.split('/'));
  const shardDir = path.join(root, ...SHARD_DIR_REL.split('/'));

  if (!fs.existsSync(shardDir) || !fs.statSync(shardDir).isDirectory()) {
    return { ok: true, skipped: true, reason: '无分片目录', added: 0, before: 0, after: 0, shards: 0, shardLines: 0 };
  }
  const shardFiles = fs.readdirSync(shardDir).filter((f) => f.endsWith('.jsonl')).sort();
  if (shardFiles.length === 0) {
    return { ok: true, skipped: true, reason: '分片目录无 .jsonl', added: 0, before: 0, after: 0, shards: 0, shardLines: 0 };
  }

  const mainBefore = fs.existsSync(mainLedger) ? fs.readFileSync(mainLedger, 'utf8') : '';
  const mainBeforeLines = linesOf(mainBefore);

  let shardCombined = '';
  let shardLineCount = 0;
  for (const f of shardFiles) {
    try {
      const t = fs.readFileSync(path.join(shardDir, f), 'utf8');
      shardLineCount += linesOf(t).length;
      shardCombined += '\n' + t;
    } catch (err) {
      // fail-soft 中止：主台账与全部分片保持原样（修好重跑即可——并集按行去重，重跑安全）
      return { ok: false, error: `读取分片失败: ${f} (${err.message})`, added: 0, before: mainBeforeLines.length, after: mainBeforeLines.length, shards: shardFiles.length, shardLines: shardLineCount };
    }
  }

  const merged = mergeJsonlLines(mainBefore, shardCombined);
  const added = linesOf(merged).filter((l) => !mainBeforeLines.includes(l)).length;
  const after = linesOf(merged).length;

  if (!execute) {
    return { ok: true, skipped: true, reason: 'dry-run', added, before: mainBeforeLines.length, after, shards: shardFiles.length, shardLines: shardLineCount };
  }

  const tmpMain = `${mainLedger}.tmp`;
  try {
    fs.writeFileSync(tmpMain, merged, 'utf8');
    fs.renameSync(tmpMain, mainLedger);
  } catch (err) {
    try { fs.unlinkSync(tmpMain); } catch { /* tmp 可能未创建或删除失败 */ }
    return { ok: false, error: `主台账写入失败: ${err.message}`, added: 0, before: mainBeforeLines.length, after: mainBeforeLines.length, shards: shardFiles.length, shardLines: shardLineCount };
  }

  for (const f of shardFiles) {
    try { fs.unlinkSync(path.join(shardDir, f)); } catch { /* 残留分片不影响正确性，下轮再清 */ }
  }
  try { if (fs.readdirSync(shardDir).length === 0) fs.rmdirSync(shardDir); } catch { /* 忽略 */ }

  return { ok: true, added, before: mainBeforeLines.length, after, shards: shardFiles.length, shardLines: shardLineCount };
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('compact-ledgers.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--root');
  const root = path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd());
  const execute = argv.includes('--execute');
  const r = compactLedgers(root, { execute });

  if (!r.ok) { console.error(`[compact-ledgers] ${r.error}`); console.error('[compact-ledgers] 已中止：主台账与分片保持原样，修好重跑即可。'); process.exit(1); }
  if (r.skipped) { console.log(`[compact-ledgers] ${r.reason}，无需归并。`); process.exit(0); }
  if (!execute) {
    console.log(`[compact-ledgers] dry-run：将并入 ${r.added} 行（分片共 ${r.shardLines} 行 / ${r.shards} 个文件，其中 ${r.shardLines - r.added} 行主台账已有），主台账 ${r.before} → ${r.after} 行`);
    console.log('[compact-ledgers] 加 --execute 执行（未加则不动盘）。');
    process.exit(0);
  }
  console.log(`[compact-ledgers] ✅ 归并完成：并入 ${r.added} 行，主台账 ${r.before} → ${r.after} 行；${r.shards} 个分片已清理。`);
  console.log('[compact-ledgers] 提醒：归并产生的台账变更请随下一笔提交入库——历史前缀不变量按提交判，不入库等于没生效。');
  process.exit(0);
}