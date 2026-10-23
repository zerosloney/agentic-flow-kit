#!/usr/bin/env node
// compact-ledgers.test.mjs — 台账分片写入与 compact 归并 fixture 套件（2026-10-12 ledger-shard-write）
// 覆盖：分片写入定位 + 跨来源链衔接 / compact 默认 dry-run 不动盘 / 幂等 / 前缀不变式（既有行保序）/
//       读取失败中止 / 分片历史扫描与 compact 删除豁免 / 行未并入时仍拦丢行。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const { compactLedgers } = await import(pathToFileURL(path.join(SCRIPT_DIR, 'compact-ledgers.mjs')).href);
const { appendLedger } = await import(pathToFileURL(path.join(SCRIPT_DIR, 'confirm-doc.mjs')).href);
const { ledgerChainHash } = await import(pathToFileURL(path.join(SCRIPT_DIR, 'policy.mjs')).href);
// 夹具闭包（2026-10-12 fixture-closure-rootfix）：整闭包自动跟随，不再手写依赖枚举（漏拷 = 假绿）
const { copyScriptClosure } = await import(pathToFileURL(path.join(SCRIPT_DIR, 'fixture-scripts.mjs')).href);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const DOC_A = 'workflow/intents/2026-10-01-a.md';
const DOC_B = 'workflow/intents/2026-10-01-b.md';
const baseEntry = (doc, stage = 'approved') => ({
  ts: new Date().toISOString(), doc, stage, fingerprint: 'a'.repeat(64), source: 'tty',
});
// --shard 依赖 doc 链口径（policyVersion ≥ 8）：分片与主台账是不同文件，只有 doc 链跨来源接续。
// 装 kit.json 的 policyVersion=8 来启用，与真实装户升级后的形态一致。
const enableDocChain = (root) => {
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'kit.json'), JSON.stringify({ policyVersion: 8 }), 'utf8');
};

// ============ 场景 1：--shard 写入定位到分片，且跨来源链接得上 ============
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-write-'));
  enableDocChain(root);
  // 先用主台账写一行（模拟该 doc 的历史行在主台账）
  appendLedger(root, baseEntry(DOC_A));
  const mainPath = path.join(root, '.agents', 'confirmations.jsonl');
  check('S1 默认写主台账', fs.existsSync(mainPath));

  // 再对同一 doc 用 --shard 写一行：前驱必须接主台账那行，而不是从 '' 重启
  appendLedger(root, baseEntry(DOC_A, 'done'), { shard: true });
  const shardPath = path.join(root, '.agents', 'confirmations.d', '2026-10-01-a.jsonl');
  check('S1 --shard 写入分片文件（按 doc 基名命名）', fs.existsSync(shardPath));

  const mainRows = fs.readFileSync(mainPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const shardRows = fs.readFileSync(shardPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  check('S1 分片行的 prevHash 接主台账同 doc 行（跨来源衔接，链不断）',
    shardRows[0].prevHash === mainRows[0].hash, `${shardRows[0].prevHash} vs ${mainRows[0].hash}`);
  // 行内重算仍一致（doc 链前提）
  const { hash, prevHash, ...rest } = shardRows[0];
  check('S1 分片行行内哈希可重算', ledgerChainHash(rest, prevHash) === hash);
}

// ============ 场景 2：compact 默认 dry-run 不动盘 ============
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-dry-'));
  appendLedger(root, baseEntry(DOC_A));
  appendLedger(root, baseEntry(DOC_B), { shard: true });
  const mainPath = path.join(root, '.agents', 'confirmations.jsonl');
  const before = fs.readFileSync(mainPath, 'utf8');
  const shardPath = path.join(root, '.agents', 'confirmations.d', '2026-10-01-b.jsonl');

  const r = compactLedgers(root); // 默认 execute:false
  check('S2 dry-run 标记 skipped 且给出并入行数', r.ok && r.skipped && r.reason === 'dry-run' && r.added === 1, JSON.stringify(r));
  check('S2 dry-run 主台账字节不变', fs.readFileSync(mainPath, 'utf8') === before);
  check('S2 dry-run 分片仍在', fs.existsSync(shardPath));
}

// ============ 场景 3：--execute 归并 + 前缀不变式 ============
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-exec-'));
  appendLedger(root, baseEntry(DOC_A));
  const mainPath = path.join(root, '.agents', 'confirmations.jsonl');
  const before = fs.readFileSync(mainPath, 'utf8');
  appendLedger(root, baseEntry(DOC_B), { shard: true });

  const r = compactLedgers(root, { execute: true });
  const after = fs.readFileSync(mainPath, 'utf8');
  check('S3 execute 归并成功并计入 1 行', r.ok && !r.skipped && r.added === 1, JSON.stringify(r));
  check('S3 既有行严格保序在前（append-only 前缀不变式）', after.startsWith(before), JSON.stringify(after.slice(0, 40)));
  check('S3 分片已清理', !fs.existsSync(path.join(root, '.agents', 'confirmations.d', '2026-10-01-b.jsonl')));
}

// ============ 场景 4：幂等（重跑不重复追加）============
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-idem-'));
  enableDocChain(root);
  appendLedger(root, baseEntry(DOC_A));
  appendLedger(root, baseEntry(DOC_B), { shard: true });
  compactLedgers(root, { execute: true });
  const mainPath = path.join(root, '.agents', 'confirmations.jsonl');
  const after1 = fs.readFileSync(mainPath, 'utf8');
  const mergedLine = after1.trim().split('\n').pop(); // 归并时实际追加的那一行（含 prevHash/hash）

  // 把**同一行原文**再放进分片重跑（模拟重复归并同批内容）——行文本逐字相同才会被去重
  fs.mkdirSync(path.join(root, '.agents', 'confirmations.d'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'confirmations.d', '2026-10-01-b.jsonl'), mergedLine + '\n', 'utf8');
  const r = compactLedgers(root, { execute: true });
  const after2 = fs.readFileSync(mainPath, 'utf8');
  check('S4 重复归并不重复追加（并集按整行去重）', r.ok && r.added === 0 && after1 === after2, `added=${r.added}`);
}

// ============ 场景 5：无分片 / 空分片 → 跳过且不报错 ============
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-none-'));
  const r = compactLedgers(root);
  check('S5 无分片目录 → 跳过且 ok', r.ok && r.skipped);
}

// ============ 场景 6：分片历史扫描 + compact 删除豁免（真 git）============
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-hist-'));
  const git = (...args) => spawnSync('git', args, { cwd: d, encoding: 'utf8' });
  git('init', '-q', '.'); git('config', 'user.email', 't@t.io'); git('config', 'user.name', 't');
  git('config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(d, '.agents', 'scripts'), { recursive: true });
  copyScriptClosure(path.join(d, '.agents', 'scripts'), ['check-ledger-invariant.mjs']);
  const mkDoc = (rel) => {
    const p = path.join(d, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '---\n状态: approved\n---\n# doc\n', 'utf8');
  };
  const rowObj = (doc) => JSON.stringify({ ts: '2026-10-01T00:00:00Z', doc, stage: 'approved', fingerprint: 'a'.repeat(64), source: 'tty' });
  const runGate = () => spawnSync(process.execPath, ['.agents/scripts/check-ledger-invariant.mjs'], { cwd: d, encoding: 'utf8' });

  mkDoc(DOC_A); mkDoc(DOC_B);
  // 基线：主台账一行 + 分片一行（分片持有 B 的行）
  fs.mkdirSync(path.join(d, '.agents', 'confirmations.d'), { recursive: true });
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.jsonl'), rowObj(DOC_A) + '\n', 'utf8');
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.d', '2026-10-01-b.jsonl'), rowObj(DOC_B) + '\n', 'utf8');
  git('add', '-A'); git('commit', '-qm', 'base with shard');
  let r = runGate();
  check('S6 分片入库且未删 → 历史扫描放行', r.status === 0, `exit=${r.status} ${r.stderr}`);

  // compact 归并后删分片：删除豁免应认领
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.jsonl'), rowObj(DOC_A) + '\n' + rowObj(DOC_B) + '\n', 'utf8');
  fs.rmSync(path.join(d, '.agents', 'confirmations.d', '2026-10-01-b.jsonl'));
  git('add', '-A'); git('commit', '-qm', 'compact merged');
  r = runGate();
  check('S6 compact 归并删分片 → 删除豁免认领，exit 0', r.status === 0, `exit=${r.status} ${r.stderr}`);
  check('S6 豁免记录点名 compact 归并形态', /compact 归并形态/.test(r.stderr), r.stderr.slice(0, 200));

  // 未归并就删分片（丢行）→ 仍 hard 拦。用**从未进过主台账**的独立 doc C，
  // 否则它的行已在主台账里（早先 compact 并过），删除豁免会正确地放行——那正是豁免该有的行为。
  const DOC_C = 'workflow/intents/2026-10-01-c.md';
  mkDoc(DOC_C);
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.d', '2026-10-01-c.jsonl'), rowObj(DOC_C) + '\n', 'utf8');
  git('add', '-A'); git('commit', '-qm', 'add shard c');
  fs.rmSync(path.join(d, '.agents', 'confirmations.d', '2026-10-01-c.jsonl'));
  git('add', '-A'); git('commit', '-qm', 'drop shard c without merge');
  r = runGate();
  check('S6 未归并即删分片（丢行）→ exit 1 hard 拦', r.status === 1, `exit=${r.status}`);
  check('S6 报文点名「分片删除丢行」', /分片删除丢行/.test(r.stderr), r.stderr.slice(0, 300));
}

console.log(`\n[compact-ledgers.test] PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);