// check-loop-unit.test.mjs — check-loop 零件直测（2026-10-08 checkloop-importable）
// papercuts 2026-10-04 isMain 行的兑现：check-loop.mjs 自 isMain 主守卫 + runCheckLoop 接缝后可 import——
// 本套件全部进程内直测（不 spawn），与 check-loop.test.mjs（端到端 spawn，行为回归网）互补。
// 覆盖：①runCheckLoop({root}) 三态（干净 exit 0 / 构造 blocker exit 1 且数组带内容 / rev+root 互斥）；
//       ②四纯零件：delegationResultRows 表头签名（节标题漂移仍解析）、versionGreater 边界、
//         fmStatus 形态、bindingSha256 prev 复原与「确认指纹」剔除对称。
// 用法：node templates/_agents/scripts/check-loop-unit.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const { runCheckLoop, delegationResultRows, versionGreater, fmStatus, bindingSha256 } =
  await import(pathToFileURL(path.join(SCRIPT_DIR, 'check-loop.mjs')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
};
const W = (root, rel, content) => { fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };

// ---- ① runCheckLoop 进程内直测 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-unit-'));
  W(root, '.agents/workflow-enums.txt', fs.readFileSync(path.join(SCRIPT_DIR, '..', 'workflow-enums.txt'), 'utf8'));
  let r = runCheckLoop({ root });
  check('run：干净 fixture → exit 0（blockers/warnings 均数组）',
    r.exitCode === 0 && Array.isArray(r.blockers) && Array.isArray(r.warnings) && r.blockers.length === 0,
    `exit=${r.exitCode} b=${r.blockers.length}`);
  // 构造 blocker：L2 done intent 缺 spec 配对（配对断裂 hard）
  W(root, 'workflow/intents/2026-10-08-x.md', '---\n状态: done\n级别: L2\n日期: 2026-10-08\n模块: pipeline\n---\n# x\n');
  r = runCheckLoop({ root });
  check('run：构造 L2 缺配对 → exit 1 且 blockers 数组带内容',
    r.exitCode === 1 && r.blockers.length > 0 && r.blockers[0].includes('配对断裂'),
    `exit=${r.exitCode} b=${JSON.stringify(r.blockers).slice(0, 80)}`);
  // rev+root 互斥（root 参数通道）
  const r2 = runCheckLoop({ root, rev: 'abc1234' });
  check('run：rev+root 互斥 → exit 1（报错走 stderr，返回空数组判决）', r2.exitCode === 1, `exit=${r2.exitCode}`);
  // root 不可访问 → exit 1（不抛异常）
  const r3 = runCheckLoop({ root: path.join(root, '不存在目录') });
  check('run：root 不可访问 → exit 1（同款报错语义）', r3.exitCode === 1, `exit=${r3.exitCode}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- ② delegationResultRows：表头签名识别（零件级直测）----
{
  const f = path.join(os.tmpdir(), `cl-unit-${Date.now()}-delegations.md`);
  // 节标题漂移（「委派结果表」≠精确节名）而表头不动 → 仍解析（papercuts-cleanup-batch 修 2 语义）
  fs.writeFileSync(f, '## 委派结果表\n\n| 日期 | 被委派方 | 任务一句话 | 结果 | 备注 |\n|---|---|---|---|---|\n| 2026-10-01 | x | y | 一次通过 | z |\n\n## 自做台账\n\n| 日期 | 任务一句话 | 结果 | 备注 |\n|---|---|---|---|\n| 2026-10-02 | p | 返工×2 | q |\n');
  const rows = delegationResultRows(f);
  check('零件 delegationResultRows：节标题漂移仍按表头签名解析（委派 1 + 自做 1）',
    rows.length === 2 && rows[0].date === '2026-10-01' && rows[1].date === '2026-10-02' && rows[1].line.includes('返工×2'),
    JSON.stringify(rows));
  check('零件 delegationResultRows：文件不存在 → 空数组不抛', delegationResultRows(path.join(os.tmpdir(), 'cl-unit-nope.md')).length === 0);
  fs.rmSync(f, { force: true });
}

// ---- ③ versionGreater 边界 ----
{
  check('零件 versionGreater：1.2.3>1.2.2 / 1.10.0>1.9.9 / 相等 false / 非法 false',
    versionGreater('1.2.3', '1.2.2') === true
    && versionGreater('1.10.0', '1.9.9') === true
    && versionGreater('1.2.3', '1.2.3') === false
    && versionGreater('abc', '1.0.0') === false);
}

// ---- ④ fmStatus 形态 ----
{
  check('零件 fmStatus：标准/双空格/CRLF/无 frontmatter',
    fmStatus('---\n状态: done\n级别: L1\n---\n# x') === 'done'
    && fmStatus('---\r\n状态:  approved\r\n---\r\n# x') === 'approved'
    && fmStatus('# 无 frontmatter') === '');
}

// ---- ⑤ bindingSha256：prev 复原与「确认指纹」剔除对称 ----
{
  // 前向：approved 落态全文算指纹（confirm-doc computeFingerprint 口径：CRLF 归一→剔指纹行→sha256）
  const fpOf = (text) => createHash('sha256')
    .update(text.replace(/\r\n/g, '\n').split('\n').filter((l) => !/^确认指纹:/.test(l)).join('\n'), 'utf8').digest('hex');
  const approved = '---\n状态: approved\n级别: L2\n日期: 2026-10-08\n模块: pipeline\n确认指纹: ab12cd34ef56ab12\n---\n# T\n\n## 验收标准（可测试）\n\n- [x] 用例（证据:a1b2c3d）\n';
  const done = approved.replace('状态: approved', '状态: done');
  // 逆推：done 行集（lines 已 CRLF 归一）+ prev='approved' → 应还原出与 approved 落态一致的指纹
  const reversed = bindingSha256(done.replace(/\r\n/g, '\n').split('\n'), 'approved');
  check('零件 bindingSha256：done 行集经 prev 复原重算 == approved 落态指纹（内容绑定对称性）',
    reversed === fpOf(approved), `${reversed.slice(0, 12)} vs ${fpOf(approved).slice(0, 12)}`);
  // prev 不同 → 指纹不同（判定不恒真）
  check('零件 bindingSha256：prev 不同 → 复原指纹不同（判定不恒真）',
    bindingSha256(done.replace(/\r\n/g, '\n').split('\n'), 'draft') !== reversed);
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
