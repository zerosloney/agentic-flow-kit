#!/usr/bin/env node
// delegation-presence.mjs 的零件级直测（2026-10-25 source-port-batch）
// 断言：①parseDelegationRows 表头签名识别（委派+自做两表、节标题漂移仍解析、跨表不混）；
//       ②rowCovers 在场判据（日期 ≥、带/不带 .md、锚界日当天算覆盖）；③delegationRowsOf
//       分片感知读（主表 ∪ delegations.d/*.md 合并）与显式注入文件语义、缺失文件 → 空数组。
// 用法：node .agents/scripts/delegation-presence.test.mjs（npm test 随跑）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDelegationRows, rowCovers, delegationRowsOf } from './delegation-presence.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

// ---- ① parseDelegationRows：表头签名识别 ----
{
  const text = [
    '# 台账',
    '',
    '## 委派结果',
    '',
    '| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 | 合入结论 |',
    '|------|----------------|------------|------|------|----------|',
    '| 2026-10-25 | glm-4.7 | 改 foo.mjs | 一次通过 | - | 合入 |',
    '',
    '## 自做任务结果（节标题漂移形态——表头签名仍应识别）',
    '',
    '| 日期 | 任务一句话 | 结果 | 备注 | 合入结论 |',
    '|------|------------|------|------|----------|',
    '| 2026-10-26 | 自做 bar.md | 一次通过 | - | 合入 |',
    '',
    '## 其他节（数据不跨节）',
    '',
    '| 2026-10-27 | 无表头签名孤儿行 |',
  ].join('\n');
  const rows = parseDelegationRows(text);
  check('① 两表按表头签名解析（2 行；节标题漂移不误伤；孤儿行不收）', rows.length === 2
    && rows[0].line.includes('foo.mjs') && rows[1].line.includes('bar.md'), JSON.stringify(rows));
  check('① 行形态 {date, line}（首列 YYYY-MM-DD）', rows[0].date === '2026-10-25');
}

// ---- ② rowCovers：在场判据 ----
{
  const rows = [
    { date: '2026-10-24', line: '| 2026-10-24 | 旧单 old-name | 一次通过 |' },
    { date: '2026-10-25', line: '| 2026-10-25 | 自做 my-task.md 全程 | 一次通过 |' },
  ];
  check('② 日期 ≥ 且含文件名（带 .md）→ 覆盖（同日界 = 覆盖）', rowCovers(rows, 'my-task.md', '2026-10-25') === true);
  check('② 不带 .md 的行也覆盖同名家族（strip 口径）', rowCovers(rows, 'my-task.md', '2026-10-25')
    && rowCovers([{ date: '2026-10-25', line: '| 2026-10-25 | 自做 my-task 全程 | 一次通过 |' }], 'my-task.md', '2026-10-25') === true);
  check('② 早于文档日期的行不算（2026-10-24 < 2026-10-25）', rowCovers(rows, 'old-name', '2026-10-25') === false);
  check('② 文件名不在任何行 → 不覆盖', rowCovers(rows, 'no-such.md', '2026-10-20') === false);
}

// ---- ③ delegationRowsOf：分片感知读与注入语义 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-'));
  fs.mkdirSync(path.join(root, 'workflow', 'delegations.d'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'delegations.md'), [
    '# 台账', '', '## 自做任务结果', '',
    '| 日期 | 任务一句话 | 结果 | 备注 | 合入结论 |',
    '|------|------------|------|------|----------|',
    '| 2026-10-25 | 主表行 main-task.md | 一次通过 | - | 合入 |',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'workflow', 'delegations.d', '2026-10.md'), [
    '| 日期 | 任务一句话 | 结果 | 备注 | 合入结论 |',
    '|------|------------|------|------|----------|',
    '| 2026-10-26 | 分片行 shard-task.md | 一次通过 | - | 合入 |',
  ].join('\n'), 'utf8');
  const merged = delegationRowsOf(root);
  check('③ 主表 ∪ 分片合并读（2 行均可见）',
    merged.some((r) => r.line.includes('main-task.md')) && merged.some((r) => r.line.includes('shard-task.md')),
    JSON.stringify(merged));
  const inj = path.join(root, 'inject.md');
  fs.writeFileSync(inj, '| 日期 | 任务一句话 | 结果 | 备注 | 合入结论 |\n|---|---|---|---|---|\n| 2026-10-27 | 注入行 inj.md | 一次通过 | - | - |', 'utf8');
  check('③ 显式注入文件只读该文件（1 行）', delegationRowsOf(root, inj).length === 1);
  const nope = path.join(root, 'nope.md');
  check('③ 文件不存在 → 空数组不抛', delegationRowsOf(root, nope).length === 0);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
process.exit(0);
