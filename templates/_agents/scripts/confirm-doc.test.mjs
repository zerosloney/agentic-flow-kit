#!/usr/bin/env node
// confirm-doc.test.mjs — 用户确认门测试（2026-09-26 confirm-gate-machine）
// 判据：① 指纹算法（CRLF 归一 / 剔指纹行防自引用 / 内容敏感）② 跳转唯一合法性 ③ 落态只动两行
//       ④ 台账追加 schema ⑤ 核心——非 TTY spawn（模拟 AI 调用路径）必须被拒
// 用法：node templates/_agents/scripts/confirm-doc.test.mjs（npm test 随跑）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeFingerprint, nextStage, applyTransition, appendLedger } from './confirm-doc.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(SCRIPT_DIR, 'confirm-doc.mjs');

// ---- S1 指纹：CRLF 归一（同内容不同行尾同指纹）----
{
  const lf = '---\n状态: draft\n---\n正文';
  const crlf = lf.replace(/\n/g, '\r\n');
  check('S1 CRLF 归一——同内容不同行尾指纹相同', computeFingerprint(lf) === computeFingerprint(crlf));
}

// ---- S2 指纹：剔「确认指纹:」行（防自引用——加指纹行不改指纹）----
{
  const a = '---\n状态: draft\n---\n正文';
  const b = '---\n状态: draft\n确认指纹: abc123\n---\n正文';
  check('S2 指纹行不参与指纹计算（防自引用）', computeFingerprint(a) === computeFingerprint(b));
}

// ---- S3 指纹：内容敏感（一字之差指纹不同；64 位 hex）----
{
  const fp1 = computeFingerprint('---\n状态: draft\n---\n正文A');
  const fp2 = computeFingerprint('---\n状态: draft\n---\n正文B');
  check('S3 内容敏感且为 64 位 hex', fp1 !== fp2 && /^[0-9a-f]{64}$/.test(fp1));
}

// ---- S4 nextStage：唯二合法跳转 ----
{
  check('S4 跳转表：draft→approved、approved→done、done/空/自造值→null',
    nextStage('draft') === 'approved' && nextStage('approved') === 'done'
      && nextStage('done') === null && nextStage('') === null && nextStage('进行中') === null);
}

// ---- S5 applyTransition：只动状态行 + 增指纹行，正文逐字节原样 ----
{
  const src = '---\n状态: draft\n级别: L2\n---\n\n# PLAN — x\n\n正文含 状态: 假行 不受影响';
  const out = applyTransition(src, 'approved', 'a3f9000000000000');
  check('S5 落态：状态行改值、指纹行追加、级别行与正文原样',
    out.startsWith('---\n状态: approved\n级别: L2\n确认指纹: a3f9000000000000\n---\n\n# PLAN — x\n\n正文含 状态: 假行 不受影响'),
    JSON.stringify(out));
}

// ---- S6 applyTransition：已有指纹行则覆盖（done 跳换新指纹）----
{
  const src = '---\n状态: approved\n确认指纹: old\n---\nX';
  const out = applyTransition(src, 'done', 'new1234567890abcd');
  check('S6 已有指纹行覆盖为新值', out.includes('状态: done') && out.includes('确认指纹: new1234567890abcd') && !out.includes('old'));
}

// ---- S7 applyTransition：无 frontmatter → null 不写 ----
{
  check('S7 无 frontmatter 返回 null', applyTransition('# 无 fm\n状态: draft', 'approved', 'x') === null);
}

// ---- S8 appendLedger：追加行 schema（ts/doc/stage/fingerprint/prev）----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-led-'));
  appendLedger(root, { ts: 'T', doc: 'workflow/plans/a.md', stage: 'approved', fingerprint: 'f'.repeat(64), prev: 'draft' });
  const lines = fs.readFileSync(path.join(root, '.agents', 'confirmations.jsonl'), 'utf8').trim().split('\n');
  const j = JSON.parse(lines[0]);
  check('S8 台账追加且 schema 齐', lines.length === 1 && j.doc === 'workflow/plans/a.md' && j.stage === 'approved' && j.fingerprint.length === 64 && j.prev === 'draft');
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S9【核心】非 TTY spawn（AI 调用路径）必须被拒 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-tty-'));
  const docP = path.join(root, 'workflow', 'plans');
  fs.mkdirSync(docP, { recursive: true });
  fs.writeFileSync(path.join(docP, '2026-09-27-x.md'), '---\n状态: draft\n---\n# P');
  // spawnSync 无 TTY（管道 stdin）——模拟 AI 会话内调用；即使参数完全合法也必须拒绝
  const r = spawnSync(process.execPath, [CLI, 'workflow/plans/2026-09-27-x.md'], { cwd: root, encoding: 'utf8', input: '可以\n' });
  const after = fs.readFileSync(path.join(docP, '2026-09-27-x.md'), 'utf8');
  check('S9 非 TTY 调用被拒：exit 1 + 提示 + 文档未被改动（AI 无法代确认）',
    r.status === 1 && /不可代确认/.test(r.stderr) && after === '---\n状态: draft\n---\n# P',
    JSON.stringify({ status: r.status, stderr: r.stderr, after }));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S10 非 TTY 拒绝先于参数校验（无参数同拒）----
{
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  check('S10 TTY 门最先（无参数也是拒绝而非用法提示）', r.status === 1 && /不可代确认/.test(r.stderr));
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
