#!/usr/bin/env node
// run-tests.mjs 的夹具驱动测试（2026-10-08 agents-hygiene 批2）
// 场景：①全绿目录 → exit 0 且聚合计数正确；②含红套件（FAIL>0 + exit 1）→ 记红且 exit 1；
//       ③崩溃套件（throw，无合计行）→ 记红且 exit 1；④--only 过滤；⑤空目录 → exit 1。
// 用法：node .agents/scripts/run-tests.test.mjs（在仓库任意目录执行均可）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(SCRIPT_DIR, 'run-tests.mjs');
const USAGE = '用法：node .agents/scripts/run-tests.test.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const mkfix = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-fx-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name), body);
  return d;
};
const run = (args) => spawnSync(process.execPath, [MAIN, ...args], { encoding: 'utf8' });

// ---- 场景 1：全绿目录 → exit 0 且聚合计数（非 .test.mjs 文件不入围）----
{
  const d = mkfix({ 'a.test.mjs': 'console.log("合计: PASS 3 / FAIL 0");', 'b.test.mjs': 'console.log("合计: PASS 2 / FAIL 0");', 'readme.md': 'x' });
  const r = run(['--dir', d]);
  check('场景 1：全绿目录 → exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 1：聚合计数 PASS 5 / FAIL 0 且红 0', /断言合计 PASS 5 \/ FAIL 0/.test(r.stdout) && /红 0/.test(r.stdout), r.stdout);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- 场景 2：红套件（计数 FAIL>0 且 exit 1）→ 记红且 exit 1 ----
{
  const d = mkfix({ 'a.test.mjs': 'console.log("合计: PASS 3 / FAIL 0");', 'bad.test.mjs': 'console.log("合计: PASS 1 / FAIL 2"); process.exit(1);' });
  const r = run(['--dir', d]);
  check('场景 2：含红套件 → exit 1', r.status === 1, `exit=${r.status}`);
  check('场景 2：红套件被点名', /RED bad\.test\.mjs/.test(r.stdout) && /红 1/.test(r.stdout) && /FAIL 2/.test(r.stdout), r.stdout);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- 场景 3：崩溃套件（无合计行）→ 记红且 exit 1 ----
{
  const d = mkfix({ 'boom.test.mjs': 'throw new Error("boom");' });
  const r = run(['--dir', d]);
  check('场景 3：崩溃套件 → exit 1 且标红', r.status === 1 && /RED boom\.test\.mjs（exit 1）/.test(r.stdout), r.stdout);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- 场景 4：--only 过滤 ----
{
  const d = mkfix({ 'aa.test.mjs': 'console.log("合计: PASS 1 / FAIL 0");', 'bb.test.mjs': 'console.log("合计: PASS 2 / FAIL 0");' });
  const r = run(['--dir', d, '--only', 'bb']);
  check('场景 4：--only 只跑匹配套件', r.status === 0 && r.stdout.includes('bb.test.mjs') && !r.stdout.includes('aa.test.mjs') && /套件 1/.test(r.stdout), r.stdout);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- 场景 5：空目录 → exit 1 报无套件 ----
{
  const d = mkfix({ 'readme.md': 'x' });
  const r = run(['--dir', d]);
  check('场景 5：空目录 → exit 1 报无套件', r.status === 1 && /无 \*\.test\.mjs/.test(r.stderr || ''), `${r.status}\n${r.stderr}`);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- 场景 6：--concurrency 校验——非正整数 fail-loud ----
{
  const d = mkfix({ 'a.test.mjs': 'console.log("合计: PASS 1 / FAIL 0");' });
  for (const bad of ['0', '-2', 'abc', '2.5']) {
    const r = run(['--dir', d, '--concurrency', bad]);
    check(`场景 6：--concurrency ${bad} → exit 1 fail-loud`, r.status === 1 && /正整数/.test(r.stderr), `exit=${r.status}\n${r.stderr}`);
  }
  const ok = run(['--dir', d, '--concurrency', '1']);
  check('场景 6：--concurrency 1（串行兼容）→ exit 0 聚合正确', ok.status === 0 && /断言合计 PASS 1 \/ FAIL 0/.test(ok.stdout), `exit=${ok.status}\n${ok.stdout}`);
  const okN = run(['--dir', d, '--concurrency', '8']);
  check('场景 6：--concurrency 8（超套件数）→ exit 0', okN.status === 0 && /断言合计 PASS 1 \/ FAIL 0/.test(okN.stdout), `exit=${okN.status}\n${okN.stdout}`);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- 场景 7：并行回放完整（每套件有 ▶ 分隔头且计数聚合不分串）----
{
  const d = mkfix({
    'a.test.mjs': 'console.log("a-out 合计: PASS 1 / FAIL 0");',
    'b.test.mjs': 'console.log("b-out 合计: PASS 2 / FAIL 0");',
    'c.test.mjs': 'console.log("c-out 合计: PASS 3 / FAIL 0");',
  });
  const r = run(['--dir', d]);
  check('场景 7：并行全绿 → 聚合 PASS 6 且三套件回放齐全',
    r.status === 0 && /断言合计 PASS 6 \/ FAIL 0/.test(r.stdout) && /▶ a\.test\.mjs/.test(r.stdout) && /▶ b\.test\.mjs/.test(r.stdout) && /▶ c\.test\.mjs/.test(r.stdout), `exit=${r.status}\n${r.stdout}`);
  check('场景 7：并行下套件输出不串（a-out 紧邻其回放块）', /▶ a\.test\.mjs\na-out/.test(r.stdout), r.stdout);
  fs.rmSync(d, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log(`\n${USAGE}`);
  process.exit(1);
}
process.exit(0);
