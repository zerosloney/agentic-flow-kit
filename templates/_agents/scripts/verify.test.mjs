#!/usr/bin/env node
// verify.mjs 的 fixture 测试（--test-cmd 注入假命令 + CHECK_LOOP_ROOT 注入夹具根，不触真实 npm test 与 workflow）
// 断言：①绿路径（假过 + 空夹具闭环）exit 0；②步骤 1 假败 exit 1 且不出全绿；
// ③步骤 2 配对断裂夹具 exit 1（verify 自身标记断言——孙进程 stdio inherit 输出不进本测试管道）；
// ④⑤⑥凭证落账三态（绿落 / check-loop 红不落 / 无汇总行省略计数键）；
// ⑦装户仓（cwd 无 package.json）未给 --test-cmd → 跳过步骤 1、不落凭证、仍跑步骤 2、exit 0。
// 用法：node templates/_agents/scripts/verify.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VERIFY = path.join(SCRIPT_DIR, 'verify.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

// 空闭环夹具（四目录齐全、无文档 → check-loop 无断档；枚举单源随 fixture 内联——check-loop 启动段 fail-loud 要求）
const mkfix = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-fix-'));
  for (const s of ['intents', 'specs', 'plans', 'incidents']) fs.mkdirSync(path.join(d, 'workflow', s), { recursive: true });
  fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(d, '.agents', 'workflow-enums.txt'), [
    'doc.status.all=draft approved done superseded cancelled',
    'doc.status.confirmed=approved done superseded cancelled',
    'doc.status.active=draft approved',
    'doc.status.terminal=done superseded cancelled',
    'doc.status.abandoned=superseded cancelled',
    'incident.status.all=open fixed closed',
    'incident.status.active=open',
    'level.all=L0 L1 L2 L3',
    '',
  ].join('\n'), 'utf8');
  return d;
};
// 配对断裂夹具（L1 intent 无同名 plan → hard-block）
const mkBroken = () => {
  const d = mkfix();
  fs.writeFileSync(path.join(d, 'workflow', 'intents', '2026-09-12-lonely.md'), [
    '---', '状态: done', '级别: L1', '日期: 2026-09-12', '---', '# INTENT — lonely', '',
    '## 验收标准（可测试）', '- [x] 用例通过（证据:dotnet test 全绿）', '',
  ].join('\n'), 'utf8');
  return d;
};
// 假命令（绝对路径直调，不依赖 PATH，跨平台无引号问题）；out 可选输出汇总行
const mkCmd = (code, out = '') => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cmd-')), `exit${code}.mjs`);
  fs.writeFileSync(f, `process.stdout.write(${JSON.stringify(out)});process.exit(${code});`, 'utf8');
  return f;
};
const run = (argv, opts = {}) => spawnSync(process.execPath, [VERIFY, ...argv], { encoding: 'utf8', ...opts });

// ---- 场景 1：绿路径——假过 + 空夹具闭环 → exit 0 ----
{
  const root = mkfix();
  const r = run(['--test-cmd', `node ${mkCmd(0)}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  check('场景 1：exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  check('场景 1：两步全过且输出全绿', r.stdout.includes('✅ 1/2') && r.stdout.includes('✅ 2/2') && r.stdout.includes('全绿'), r.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 2：红路径步骤 1——假败 → exit 1、fail-fast 不出全绿 ----
{
  const root = mkfix();
  const r = run(['--test-cmd', `node ${mkCmd(3)}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  check('场景 2：exit 1', r.status === 1, `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  check('场景 2：步骤 1 失败标记在 stderr，且不输出全绿', r.stderr.includes('❌ 1/2') && !r.stdout.includes('全绿'), `${r.stdout}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 3：红路径步骤 2——配对断裂夹具 → exit 1 ----
{
  const root = mkBroken();
  const r = run(['--test-cmd', `node ${mkCmd(0)}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  check('场景 3：exit 1', r.status === 1, `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  check('场景 3：步骤 2 失败标记在 stderr，且不输出全绿', r.stderr.includes('❌ 2/2') && !r.stdout.includes('全绿'), `${r.stdout}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 4：绿路径凭证落账（2026-10-07 verify-evidence）——全绿后 fixture 台账出合法绿行 ----
{
  const root = mkfix();
  const r = run(['--test-cmd', `node ${mkCmd(0, '合计: PASS 3 / FAIL 0\n')}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  const vp = path.join(root, '.agents', 'verifications.jsonl');
  const line = fs.existsSync(vp) ? JSON.parse(fs.readFileSync(vp, 'utf8').trim()) : null;
  check('场景 4：全绿 → verifications.jsonl 落绿行（exitCode 0 + 计数捕获）',
    r.status === 0 && line !== null && line.exitCode === 0 && line.passed === 3 && line.failed === 0
      && typeof line.ts === 'string' && r.stdout.includes('凭证已落账'),
    `exit=${r.status} line=${JSON.stringify(line)}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 5：红路径不落账（check-loop 红 → fail-fast 在落账前退出）----
{
  const root = mkBroken();
  const r = run(['--test-cmd', `node ${mkCmd(0)}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  check('场景 5：npm test 绿但 check-loop 红 → 无凭证行（凭证语义 = verify 全绿）',
    r.status === 1 && !fs.existsSync(path.join(root, '.agents', 'verifications.jsonl')),
    `exit=${r.status}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 6：输出无汇总行 → 计数键省略（exitCode 才是硬事实）----
{
  const root = mkfix();
  const r = run(['--test-cmd', `node ${mkCmd(0, 'ok\n')}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  const vp = path.join(root, '.agents', 'verifications.jsonl');
  const line = fs.existsSync(vp) ? JSON.parse(fs.readFileSync(vp, 'utf8').trim()) : null;
  check('场景 6：无汇总输出 → 绿行落盘但计数键省略',
    r.status === 0 && line !== null && line.exitCode === 0 && !('passed' in line) && !('failed' in line),
    `line=${JSON.stringify(line)}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 7：装户仓（cwd 无 package.json）且未给 --test-cmd → 跳过步骤 1、不落凭证、仍跑步骤 2 → exit 0 ----
{
 const root = mkfix();
 const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-bare-'));
 const r = run([], { cwd: bare, env: { ...process.env, CHECK_LOOP_ROOT: root } });
 check('场景 7：exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
 check('场景 7：步骤 1 显式跳过（⏭ 1/2）、步骤 2 通过且全绿', r.stdout.includes('⏭ 1/2') && r.stdout.includes('✅ 2/2') && r.stdout.includes('全绿'), r.stdout);
 check('场景 7：跳过时不落测试绿凭证（防假绿）',
 !fs.existsSync(path.join(root, '.agents', 'verifications.jsonl')) && r.stdout.includes('不落测试绿凭证'),
 r.stdout);
 fs.rmSync(root, { recursive: true, force: true });
 fs.rmSync(bare, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log('\n用法：node templates/_agents/scripts/verify.test.mjs');
  process.exit(1);
}
process.exit(0);
