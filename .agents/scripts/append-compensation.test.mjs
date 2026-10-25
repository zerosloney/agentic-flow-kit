#!/usr/bin/env node
// append-compensation.mjs 的夹具测试（2026-10-25 source-port-batch-2）
// 断言：①终态文档改内容 → 补偿行落账（指纹=bindingSha256(lines, 末次行 prev)、prev 沿用、
//       source=chat-delegated、quote 原话）——检查 15 同口径复算即绿；②五类拒绝面（非终态 /
//       无台账行 / 末次行缺 prev / 内容未变 / 缺 --quote）零写入；③fmStatusOf 无 frontmatter → ''。
// 用法：node .agents/scripts/append-compensation.test.mjs（npm test 随跑）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bindingSha256 } from './check-loop.mjs';
import { pickLastRow, buildCompensation, fmStatusOf } from './append-compensation.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(SCRIPT_DIR, 'append-compensation.mjs');
const mkroot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acomp-'));
const readLedger = (root) => fs.readFileSync(path.join(root, '.agents', 'confirmations.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

const doneLines = (extra = '') => `---\n状态: done\n级别: L2\n日期: 2026-10-25${extra}\n---\n# P\n\n## 验收标准（可测试）\n- [x] 用例（证据：npm test）\n`.split('\n');

// ---- ① 终态改内容 → 补偿行落账（含检查 15 同口径复算即绿） ----
{
  const root = mkroot();
  fs.mkdirSync(path.join(root, 'workflow', 'plans'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  const doc = 'workflow/plans/2026-10-25-c1.md';
  const original = doneLines();
  fs.writeFileSync(path.join(root, doc), original.join('\n'), 'utf8');
  const prev = 'approved';
  const seedFp = bindingSha256(original, prev);
  fs.writeFileSync(path.join(root, '.agents', 'confirmations.jsonl'),
    JSON.stringify({ ts: '2026-10-25T02:00:00.000Z', doc, stage: 'done', fingerprint: seedFp, prev, source: 'tty' }) + '\n', 'utf8');
  // 模拟关单后回填：正文加一行裁定备注
  const edited = [...original.slice(0, -1), '回填：用户 2026-10-25 裁定补记一行。', ''];
  fs.writeFileSync(path.join(root, doc), edited.join('\n'), 'utf8');
  const r = spawnSync(process.execPath, [CLI, doc, '--quote', '同意按裁定回填'], { cwd: root, encoding: 'utf8' });
  const rows = readLedger(root);
  const last = rows[rows.length - 1];
  check('场景 1：补偿行落账（exit 0、行数 2、prev 沿用原行）',
    r.status === 0 && rows.length === 2 && last.prev === prev && last.doc === doc && last.stage === 'done',
    `exit=${r.status}\n${r.stdout}${r.stderr}\n${JSON.stringify(rows)}`);
  check('场景 1：指纹 = bindingSha256(改后内容, prev)——检查 15 同函数复算即绿',
    last.fingerprint === bindingSha256(edited, prev) && last.source === 'chat-delegated' && last.quote === '同意按裁定回填',
    JSON.stringify(last));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- ② 拒绝面（纯函数四类 + CLI 缺 --quote）----
{
  const rows = [{ doc: 'workflow/plans/x.md', stage: 'done', fingerprint: 'a'.repeat(64), prev: 'approved', ts: '2026-10-25T00:00:00.000Z' }];
  check('场景 2a：非终态（approved）拒绝', buildCompensation([], 'approved', rows[0], 'q', 'ts').ok === false);
  check('场景 2b：台账无该 stage 行拒绝', buildCompensation(doneLines(), 'done', null, 'q', 'ts').ok === false);
  check('场景 2c：末次行缺 prev 拒绝', buildCompensation(doneLines(), 'done', { doc: 'x', stage: 'done', fingerprint: 'f' }, 'q', 'ts').ok === false);
  {
    const lines = doneLines();
    const fp = bindingSha256(lines, 'approved');
    const r = buildCompensation(lines, 'done', { doc: 'x', stage: 'done', fingerprint: fp, prev: 'approved' }, 'q', 'ts');
    check('场景 2d：内容未变（指纹一致）拒绝', r.ok === false && /无可补偿/.test(r.reason));
  }
  {
    const root = mkroot();
    fs.mkdirSync(path.join(root, 'workflow', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(root, 'workflow', 'plans', '2026-10-25-c2.md'), doneLines().join('\n'), 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'workflow/plans/2026-10-25-c2.md'], { cwd: root, encoding: 'utf8' });
    const noLedger = !fs.existsSync(path.join(root, '.agents', 'confirmations.jsonl'));
    check('场景 2e：缺 --quote → exit 2 用法行 + 零写入', r.status === 2 && /用法/.test(r.stderr) && noLedger,
      `exit=${r.status}\n${r.stderr}`);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---- ③ pickLastRow 末次生效 / fmStatusOf 边界 ----
{
  const rows = [
    { doc: 'a.md', stage: 'done', fingerprint: 'f1', prev: 'approved' },
    { doc: 'a.md', stage: 'done', fingerprint: 'f2', prev: 'approved' },
    { doc: 'b.md', stage: 'done', fingerprint: 'f3', prev: 'approved' },
  ];
  check('场景 3a：pickLastRow 取该 doc+stage 末次行', pickLastRow(rows, 'a.md', 'done').fingerprint === 'f2');
  check('场景 3b：fmStatusOf 无 frontmatter → 空串', fmStatusOf(['# 无 frontmatter']) === '' && fmStatusOf(doneLines()) === 'done');
}

// ---- ④ 分片口径（2026-10-25 hotfix，incident 2026-10-25-append-compensation-shard）：v12 装户形态落分片 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acomp-sh-'));
  fs.mkdirSync(path.join(root, 'workflow', 'plans'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents', 'confirmations.d'), { recursive: true });
  const doc = 'workflow/plans/2026-10-25-s1.md';
  const original = doneLines();
  fs.writeFileSync(path.join(root, doc), original.join('\n'), 'utf8');
  const prev = 'approved';
  const seedFp = bindingSha256(original, prev);
  // v8+ doc 链激活形态：该 doc 历史行在分片
  fs.writeFileSync(path.join(root, '.agents', 'confirmations.d', '2026-10-25-s1.jsonl'),
    JSON.stringify({ ts: '2026-10-25T02:00:00.000Z', doc, stage: 'done', fingerprint: seedFp, prev, source: 'tty' }) + '\n', 'utf8');
  fs.writeFileSync(path.join(root, '.agents', 'kit.json'), JSON.stringify({ kit: 'agentic-flow-kit', policyVersion: 12 }), 'utf8');
  const edited = [...original.slice(0, -1), '回填一行', ''];
  fs.writeFileSync(path.join(root, doc), edited.join('\n'), 'utf8');
  const r = spawnSync(process.execPath, [CLI, doc, '--quote', 'q'], { cwd: root, encoding: 'utf8' });
  const shardRows = fs.readFileSync(path.join(root, '.agents', 'confirmations.d', '2026-10-25-s1.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const noMain = !fs.existsSync(path.join(root, '.agents', 'confirmations.jsonl'));
  check('场景 4：v12 形态补偿行落分片（与既有行同域、doc 链接续）且主台账不新建',
    r.status === 0 && shardRows.length === 2 && shardRows[1].stage === 'done' && noMain,
    `exit=${r.status}\n${r.stdout}${r.stderr}\n${JSON.stringify(shardRows)}`);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
process.exit(0);
