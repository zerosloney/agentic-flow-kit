#!/usr/bin/env node
// git-merge-jsonl.test.mjs — 台账并集合并驱动 fixture 套件（2026-10-12 ledger-merge-driver）
// 覆盖：并集去重 / %A 行序保持 / %B 新行追加 / 空侧 / CRLF 归一 / 幂等 / CLI 原子覆写与失败码，
//       以及**行内哈希重算不变**（union 不破坏台账哈希链的前提，见驱动头部注释）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(SCRIPT_DIR, 'git-merge-jsonl.mjs');
const { mergeJsonlLines } = await import(pathToFileURL(SCRIPT).href);
const { ledgerChainHash } = await import(pathToFileURL(path.join(SCRIPT_DIR, 'policy.mjs')).href);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const L = (...xs) => xs.filter(Boolean).join('\n') + '\n';
const r1 = L('{"ts":"1","doc":"a","stage":"approved"}', '{"ts":"2","doc":"a","stage":"done"}');
const r2 = L('{"ts":"3","doc":"b","stage":"approved"}');
const shared = L('{"ts":"9","doc":"c","stage":"approved"}');

// ============ 场景 1：%A 独有 → 全保留，%A 顺序不变 ============
{
  const out = mergeJsonlLines(r1, '');
  check('S1 %B 空时结果 == %A（字节级）', out === r1, JSON.stringify(out));
}

// ============ 场景 2：%B 有 %A 没有的新行 → 追加末尾 ============
{
  const out = mergeJsonlLines(r1, r2);
  check('S2 %B 新行追加到末尾', out === r1 + r2, JSON.stringify(out));
}

// ============ 场景 3：共有行只留一份（去重） ============
{
  const out = mergeJsonlLines(r1 + shared, shared + r2);
  const lines = out.trim().split('\n');
  const cnt = lines.filter((l) => l === shared.trim()).length;
  check('S3 共有行只保留一份', cnt === 1, `实得 ${cnt}`);
  check('S3 %A 既有行顺序保持在前', lines[0].includes('"ts":"1"') && lines[1].includes('"ts":"2"'), JSON.stringify(lines));
  check('S3 行数 = %A 行数 + %B 新增行数', lines.length === 4, `实得 ${lines.length}`);
}

// ============ 场景 4：双空 → 空串 ============
{
  check('S4 双空返回空串', mergeJsonlLines('', '') === '');
  check('S4 null 视为空', mergeJsonlLines(null, null) === '');
}

// ============ 场景 5：CRLF 归一为 LF（与 check-ledger-invariant 的 blob 口径对齐） ============
{
  const out = mergeJsonlLines('{"ts":"1"}\r\n', '{"ts":"2"}\r\n');
  check('S5 CRLF 归一为 LF', !out.includes('\r') && out === L('{"ts":"1"}', '{"ts":"2"}'), JSON.stringify(out));
  check('S5 空行被剔除', mergeJsonlLines('{"ts":"1"}\n\n\n', '') === L('{"ts":"1"}'));
}

// ============ 场景 6：幂等——同输入重复合并结果不变（compact 重跑安全的前提） ============
{
  const once = mergeJsonlLines(r1, r2);
  check('S6 重复合并幂等', mergeJsonlLines(once, r2) === once && mergeJsonlLines(r1, once) === once);
}

// ============ 场景 7【关键互证】：union 保留行文本 → 行内哈希重算不变 ============
// 背景：台账哈希链 ledgerChainHash(row) = sha256(prevHash + JSON.stringify(row))，依赖 JSON.stringify
//   的键序 = 写入序。union 按整行文本去重、不解析不改写 → 行文本逐字不变 → 键序不变 → 重算不变。
//   这条一旦被破坏（例如将来有人改成「解析后重排键再序列化」），台账链会整片失效且极难排查。
{
  const mkRow = (prevHash, fields) => {
    const row = { ...fields, prevHash };
    return { ...row, hash: ledgerChainHash(fields, prevHash) };
  };
  const chained = [
    JSON.stringify(mkRow('', { ts: '2026-10-01T00:00:00Z', doc: 'workflow/intents/a.md', stage: 'approved', fingerprint: 'a'.repeat(64), scope: { files: ['x.md'], sha256: 's' } })),
    JSON.stringify(mkRow('PREVHASH', { ts: '2026-10-02T00:00:00Z', doc: 'workflow/intents/a.md', stage: 'done', fingerprint: 'a'.repeat(64) })),
  ].join('\n') + '\n';
  const mine = chained;
  const theirs = L('{"ts":"2026-10-03T00:00:00Z","doc":"workflow/intents/b.md","stage":"approved","fingerprint":"b","extra":1}');
  const merged = mergeJsonlLines(mine, theirs);
  const rows = merged.trim().split('\n').map((l) => JSON.parse(l));
  const selfOk = rows.every((r) => {
    if (typeof r.hash !== 'string') return true; // 无链字段行（存量/注记）不参与
    const { hash, prevHash, ...rest } = r;
    return ledgerChainHash(rest, prevHash ?? '') === hash;
  });
  check('S7 合并后每行行内哈希仍可重算一致', selfOk, JSON.stringify(rows));
  check('S7 合并后行文本与合并前逐字相同（去重不改写字段）',
    merged.trim().split('\n')[0] === mine.trim().split('\n')[0]);
}

// ============ 场景 8：CLI 真跑 —— 覆写 %A、exit 0、无残留 .tmp ============
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-merge-'));
  const A = path.join(d, 'A'), B = path.join(d, 'B'), O = path.join(d, 'O');
  fs.writeFileSync(A, r1, 'utf8');
  fs.writeFileSync(B, r1 + r2, 'utf8');
  fs.writeFileSync(O, L(), 'utf8');
  const r = spawnSync(process.execPath, [SCRIPT, O, A, B], { encoding: 'utf8' });
  check('S8 CLI exit 0', r.status === 0, `exit=${r.status} ${r.stderr || ''}`);
  check('S8 CLI 结果写入 %A', fs.readFileSync(A, 'utf8') === r1 + r2, JSON.stringify(fs.readFileSync(A, 'utf8')));
  check('S8 无残留 .tmp', !fs.existsSync(`${A}.tmp`));
  // 缺参数 → 用法提示 + exit 1（driver 由 git 触发，参数缺失属接线错误，应响亮）
  const bad = spawnSync(process.execPath, [SCRIPT, O], { encoding: 'utf8' });
  check('S8 缺参数 exit 1 且出用法', bad.status === 1 && bad.stderr.includes('用法'), `exit=${bad.status}`);
  fs.rmSync(d, { recursive: true, force: true });
}

// ============ 场景 9：%A 不存在（对侧新增文件）→ 以 %B 内容落盘 ============
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-merge2-'));
  const A = path.join(d, 'A'), B = path.join(d, 'B'), O = path.join(d, 'O');
  fs.writeFileSync(B, r2, 'utf8');
  fs.writeFileSync(O, L(), 'utf8');
  const r = spawnSync(process.execPath, [SCRIPT, O, A, B], { encoding: 'utf8' });
  check('S9 %A 缺失时以 %B 落盘且 exit 0', r.status === 0 && fs.readFileSync(A, 'utf8') === r2,
    `exit=${r.status} ${r.stderr || ''}`);
  fs.rmSync(d, { recursive: true, force: true });
}

console.log(`\n[git-merge-jsonl.test] PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);