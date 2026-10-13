#!/usr/bin/env node
// ledger-loader.test.mjs — 台账读取视图单源 fixture 套件（2026-10-12 ledger-loader-p1）
// 覆盖：主台账单源 / 分片并入与读序 / 坏行跳过 / 缺失静默 / IO 失败 fail-soft 出账 /
//       lines 视图保行内原文 / 两侧视图与旧逐处直读的等价性（Step 1 行为不变的回归护栏）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// 兄弟脚本动态载入必须走 file:// URL——win32 绝对路径（'E:\...'）直接 import 会被 ESM loader
// 判 ERR_UNSUPPORTED_ESM_URL_SCHEME（protocol 'e:'），非 Windows 平台不受影响
const { ledgerSources, readLedgerLines, readLedgerRows, LEDGER_REL, SHARD_DIR_REL } =
  await import(pathToFileURL(path.join(SCRIPT_DIR, 'ledger-loader.mjs')).href);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const mkRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-loader-'));
const w = (root, rel, text) => {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
};
const row = (o) => JSON.stringify(o);

// ============ 场景 1：无台账（装户/新仓）→ 空视图，不抛 ============
{
  const r = mkRoot();
  check('S1 无台账时 sources 为空', ledgerSources(r).length === 0);
  check('S1 无台账时 lines 为空', readLedgerLines(r).length === 0);
  check('S1 无台账时 rows 为空', readLedgerRows(r).length === 0);
}

// ============ 场景 2：仅主台账 → 与旧逐处直读等价 ============
{
  const r = mkRoot();
  const rows = [
    row({ ts: '2026-10-01T00:00:00Z', doc: 'workflow/intents/a.md', stage: 'approved', fingerprint: 'a'.repeat(64) }),
    row({ ts: '2026-10-02T00:00:00Z', doc: 'workflow/intents/a.md', stage: 'done', fingerprint: 'a'.repeat(64) }),
    row({ ts: '2026-10-03T00:00:00Z', doc: 'workflow/specs/b.md', stage: 'approved', fingerprint: 'b'.repeat(64) }),
  ];
  w(r, LEDGER_REL, rows.join('\n') + '\n');
  const got = readLedgerRows(r);
  check('S2 rows 数与行数一致', got.length === 3, `实得 ${got.length}`);
  check('S2 读序 = 物理序（末次 done 在后）',
    got[1].stage === 'done' && got[2].doc === 'workflow/specs/b.md');
  // 等价性护栏：旧口径（过滤空行 + JSON.parse + 跳过 null/非对象）
  const legacy = rows.map((l) => JSON.parse(l));
  check('S2 与旧逐处直读逐行等价', JSON.stringify(got) === JSON.stringify(legacy));
  check('S2 lines 视图保留行内原文', readLedgerLines(r).length === 3 && /"stage":"approved"/.test(readLedgerLines(r)[0]));
}

// ============ 场景 3：坏行跳过（与检查 15/19 同容错口径） ============
{
  const r = mkRoot();
  w(r, LEDGER_REL, [
    row({ ts: '1', doc: 'workflow/intents/a.md', stage: 'approved' }),
    '{不是 JSON',
    '',
    '   ',
    row({ ts: '2', doc: 'workflow/intents/b.md', stage: 'approved' }),
  ].join('\n') + '\n');
  const got = readLedgerRows(r);
  check('S3 坏行跳过、空行不计入', got.length === 2, `实得 ${got.length}`);
  check('S3 坏行后仍继续读到后续行', got[1].doc === 'workflow/intents/b.md');
  check('S3 lines 视图含坏行原文（计数口径要全量行）', readLedgerLines(r).length === 3, `实得 ${readLedgerLines(r).length}`);
}

// ============ 场景 4：分片并入——主台账先、分片按文件名序后（分片＝较新） ============
{
  const r = mkRoot();
  w(r, LEDGER_REL, row({ ts: '2026-10-01T00:00:00Z', doc: 'workflow/intents/a.md', stage: 'approved' }) + '\n');
  w(r, `${SHARD_DIR_REL}/b.jsonl`, row({ ts: '2026-10-05T00:00:00Z', doc: 'workflow/intents/b.md', stage: 'approved' }) + '\n');
  w(r, `${SHARD_DIR_REL}/a.jsonl`, row({ ts: '2026-10-09T00:00:00Z', doc: 'workflow/intents/c.md', stage: 'approved' }) + '\n');
  const srcs = ledgerSources(r).map((s) => s.rel);
  check('S4 来源清单：主台账在最前', srcs[0] === LEDGER_REL, JSON.stringify(srcs));
  check('S4 来源清单含分片（文件名序 a → b）', srcs.length === 3 && srcs[1] === `${SHARD_DIR_REL}/a.jsonl`, JSON.stringify(srcs));
  const got = readLedgerRows(r);
  // 读序 = 主台账 → 分片按**文件名**序：a.jsonl（内含 c.md）先于 b.jsonl
  check('S4 读序：主台账行在前、分片行按文件名序在后',
    got[0].doc === 'workflow/intents/a.md' && got[1].doc === 'workflow/intents/c.md' && got[2].doc === 'workflow/intents/b.md',
    JSON.stringify(got.map((e) => e.doc)));
  check('S4 分片行可见（末次取值口径：分片较新）',
    [...got.reduce((m, e) => m.set(e.doc, e.ts), new Map()).values()].length === 3);
}

// ============ 场景 5：分片目录不存在 / 非目录 → 静默零影响 ============
{
  const r = mkRoot();
  w(r, LEDGER_REL, row({ ts: '1', doc: 'workflow/intents/a.md', stage: 'approved' }) + '\n');
  w(r, 'not-a-dir.txt', 'x');
  check('S5 无分片目录时只返回主台账', ledgerSources(r).length === 1);
  // 分片路径被同名普通文件占位 → 非目录，按不启用处理
  w(r, SHARD_DIR_REL, '我是文件不是目录');
  check('S5 分片路径非目录时静默跳过', ledgerSources(r).length === 1 && readLedgerRows(r).length === 1);
}

// ============ 场景 6：IO 失败 fail-soft —— 已读来源照常返回，缺的来源出账不抛 ============
{
  const r = mkRoot();
  w(r, LEDGER_REL, row({ ts: '1', doc: 'workflow/intents/a.md', stage: 'approved' }) + '\n');
  // 造一个 existsSync 为真但读取失败的来源：目录形态的 .jsonl（读目录抛 EISDIR）
  const shardDir = path.join(r, ...SHARD_DIR_REL.split('/'));
  fs.mkdirSync(shardDir, { recursive: true });
  fs.mkdirSync(path.join(shardDir, 'boom.jsonl'), { recursive: true }); // 目录而非文件 → readFileSync 抛
  const origErr = console.error;
  const errs = [];
  console.error = (...a) => { errs.push(a.join(' ')); };
  let got = null;
  try { got = readLedgerRows(r); } finally { console.error = origErr; }
  check('S6 读取失败不抛异常', got !== null);
  check('S6 主台账行仍正常返回', got.length === 1 && got[0].doc === 'workflow/intents/a.md');
  check('S6 失败来源显式出账（不静默丢行）',
    errs.some((e) => e.includes('boom.jsonl')), JSON.stringify(errs));
}

// ============ 场景 7：CRLF 台账 → 行视图不残留 \r（消费方免各自处理） ============
{
  const r = mkRoot();
  w(r, LEDGER_REL, row({ ts: '1', doc: 'workflow/intents/a.md', stage: 'approved' }) + '\r\n');
  const lines = readLedgerLines(r);
  check('S7 CRLF 行尾不残留 \\r', lines.length === 1 && !lines[0].endsWith('\r'));
  check('S7 CRLF 下 rows 仍可解析', readLedgerRows(r).length === 1);
}

console.log(`\n[ledger-loader.test] PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);