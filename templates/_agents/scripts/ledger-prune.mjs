#!/usr/bin/env node
// ledger-prune.mjs — 台账特许修剪的判据单源（2026-10-12 ledger-prune-manifest）
// 为什么需要它：确认台账 append-only（README 硬规则 6），历史行禁删改。但现实中存在**合法**的删行场景——
//   仓库所有者明令删除某批 workflow 文档（归档、误建单清理、GDPR/合规下架）。此时台账里对应的确认行
//   也必须随之删除，否则行级校验④「doc 在当前树存在」会持续报红，退路只剩「手改台账」→ 直接踩
//   `--no-verify` 的红线。
//   在本模块之前，flow-kit 对此**无任何合法出口**——这不是一个「缺个功能」，而是一条会把人逼向绕过的死路。
//
// 本模块提供的唯一出口（**特许**，不是豁免）：逐行对账 + 凭据入库。
//   manifest = .agents/ledger-prune-manifest.json，格式：
//     { "ts": "<ISO>", "authority": "<授权来源：谁/哪次指令>", "reason": "<为什么删>",
//       "removes": ["<被删行的 sha256>", ...], "docs": ["<家族名>", ...] }
//   判据（matchPrune，四条缺一不可）：
//     ① manifest 存在且 removes 非空；
//     ② 每个哈希**恰命中一行**（哈希不存在或声明重复都判失败——防「一个哈希对多行」的糊弄）；
//     ③ 新内容 == 旧内容 − manifest 所列各行（**保序**）——存在 manifest 之外的任何增删改即失败；
//     ④ 每个被删行的 doc ∈ manifest.docs 清单（空清单 = 不约束）。
//   凭据（被删行哈希）随 manifest 入 git，事后可对质；manifest 自身是 owned 面，人工审查面。
//
// **删行后该 doc 的哈希链会断**：被删行 R1（hash=H1）之后的后继行 R2 带 prevHash=H1，而 R1 已不在表内
//   → 校验时 byDoc(doc) 为空、R2 的 H1 失配。本模块导出 prunedHashes() 供链校验识别这一**有凭据的链段重启**：
//   「本行的 prevHash 出现在 manifest.prunedHashes 中」即视为合法重启点，而非篡改。
//   诚实边界：manifest 是可写文件，**刻意伪造一份 manifest 即可让任意断链合法化**——这与「台账本地可写」
//   的既有信任边界同级（见 README 确认门诚实边界 / policy.ledgerChainHash）。本模块不宣称通道关闭，
//   它把「顺手手改台账」抬到「必须提交一份带授权与理由、可被 git 历史对质的凭据」——性质不同，可事后追责。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const PRUNE_REL = '.agents/ledger-prune-manifest.json';

export const sha256line = (l) => createHash('sha256').update(l, 'utf8').digest('hex');

const linesOf = (text) => (text || '').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);

// loadManifestFromRef：从某个 git 对象引用读 manifest（历史全扫用：该提交树上的 manifest）。
// 用 spawnSync + status 判定而非 execFileSync：后者失败时 stderr 直通父进程，历史扫描探针在旧提交
// 尚无 manifest 时会刷屏 fatal 噪声（实测教训）——探测失败必须静默归 null。
export function loadManifestFromRef(ref, cwd) {
  try {
    const r = spawnSync('git', ['show', ref], { cwd, encoding: 'utf8' });
    if (r.status !== 0) return null;
    const m = JSON.parse(r.stdout);
    return (m && typeof m === 'object') ? m : null;
  } catch {
    return null;
  }
}

// loadManifestFromDisk：读工作树上的 manifest（链校验用；缺文件 = 无修剪凭据，返回 null）。
export function loadManifestFromDisk(root) {
  const p = path.join(root, ...PRUNE_REL.split('/'));
  try {
    if (!fs.existsSync(p)) return null;
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (m && typeof m === 'object') ? m : null;
  } catch {
    return null; // 损坏 = 视同无凭据 → 链断裂照报（fail-closed 于校验面）
  }
}

// matchPrune：逐行对账。返回 {removed, docs, hashes} 或 {err}。
export function matchPrune(headText, curText, manifest) {
  if (!manifest || !Array.isArray(manifest.removes) || !manifest.removes.length) {
    return { err: 'manifest 缺失或 removes 为空' };
  }
  const head = linesOf(headText);
  const cur = linesOf(curText);
  const want = new Set(manifest.removes);
  const kept = head.filter((l) => !want.has(sha256line(l)));
  const removedLines = head.filter((l) => want.has(sha256line(l)));

  if (removedLines.length !== manifest.removes.length) {
    return { err: `manifest 哈希命中 ${removedLines.length} 行 ≠ 声明 ${manifest.removes.length} 行（哈希不存在或声明重复）` };
  }
  if (kept.join('\n') !== cur.join('\n')) {
    return { err: '新内容 ≠ 旧内容 − manifest 所列行（存在 manifest 之外的增删改）' };
  }
  const docs = new Set(manifest.docs || []);
  for (const l of removedLines) {
    let doc = '';
    try { doc = JSON.parse(l).doc || ''; } catch { return { err: '被删行非 JSON' }; }
    if (docs.size && !docs.has(path.basename(doc).replace(/\.md$/, ''))) {
      return { err: `被删行 doc ${doc} 不在 manifest.docs 清单内` };
    }
  }
  return { removed: removedLines.length, docs: [...docs], hashes: [...want] };
}

// prunedHashes：工作树 manifest 声明的被删行哈希集合（链校验的合法重启点判定用）。
export function prunedHashes(root) {
  const m = loadManifestFromDisk(root);
  if (!m || !Array.isArray(m.removes)) return new Set();
  return new Set(m.removes.filter((h) => typeof h === 'string'));
}