#!/usr/bin/env node
// check-scripts-syntax.mjs 的夹具测试（CHECK_LOOP_ROOT 注入临时根 + 显式目录参数，不触真实 .agents）
// 断言：①全绿目录 exit 0 且报数；②混入语法坏件 exit 1 且点名坏文件；③目录缺失 exit 1（fail-closed）；
//       ④目录递归后无可检文件 exit 1（防「清空目录即去门」）；⑤非 .mjs/.cjs 扩展名不入扫描；
//       ⑥递归命中子目录脚本（顶层空不静默空转）；⑦SKIP_DIRS（node_modules/.git/tmp）不入守护面。
// 用法：node .agents/scripts/check-scripts-syntax.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(SCRIPT_DIR, 'check-scripts-syntax.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const mkroot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'syn-fix-'));
const run = (root, argv) => spawnSync(process.execPath, [CHECKER, ...argv], {
  encoding: 'utf8',
  env: { ...process.env, CHECK_LOOP_ROOT: root },
});

// ---- 场景 1：全绿目录 → exit 0 且报数 2（txt 不入扫描） ----
{
  const root = mkroot();
  fs.mkdirSync(path.join(root, 'sd'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sd', 'good.mjs'), 'const a = 1;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'sd', 'good.cjs'), 'module.exports = 1;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'sd', 'note.txt'), 'not scanned\n', 'utf8');
  const r = run(root, ['sd']);
  check('场景 1：全绿 → exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  check('场景 1：报数 2 且 txt 被排除', r.stdout.includes('✅ 2 个引擎脚本'), r.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 2：语法坏件 → exit 1 且点名 ----
{
  const root = mkroot();
  fs.mkdirSync(path.join(root, 'sd'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sd', 'good.mjs'), 'const a = 1;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'sd', 'broken.mjs'), 'if (true) entry.x process.env.Y;\n', 'utf8');
  const r = run(root, ['sd']);
  check('场景 2：混入坏件 → exit 1', r.status === 1, `exit=${r.status}`);
  check('场景 2：stderr 点名坏文件', r.stderr.includes('sd/broken.mjs') && r.stderr.includes('1 个不可解析'), r.stderr);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 3：目录缺失 → exit 1（fail-closed） ----
{
  const root = mkroot();
  const r = run(root, ['no-such-dir']);
  check('场景 3：目录缺失 → exit 1 且提示 fail-closed', r.status === 1 && r.stderr.includes('检查目标目录缺失'), `exit=${r.status}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 4：目录递归后无可检文件 → exit 1（每目录 fail-closed，防「清空/子目录化后顶层空」） ----
{
  const root = mkroot();
  fs.mkdirSync(path.join(root, 'sd'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sd', 'note.txt'), 'not scanned\n', 'utf8');
  const r = run(root, ['sd']);
  check('场景 4：递归后无可检 → exit 1 且点名目录', r.status === 1 && r.stderr.includes('递归后无可检脚本') && r.stderr.includes('sd'), `exit=${r.status}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 5：脚本全在子目录 → 递归命中（顶层空不静默空转）；坏件点名带子目录路径 ----
{
  const root = mkroot();
  fs.mkdirSync(path.join(root, 'sd', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sd', 'sub', 'good.mjs'), 'const a = 1;\n', 'utf8');
  const r = run(root, ['sd']);
  check('场景 5：顶层空、子目录有脚本 → exit 0 报数 1', r.status === 0 && r.stdout.includes('✅ 1 个引擎脚本'), `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  fs.writeFileSync(path.join(root, 'sd', 'sub', 'broken.cjs'), 'if (true) entry.x process.env.Y;\n', 'utf8');
  const r2 = run(root, ['sd']);
  check('场景 5：子目录坏件 → exit 1 且点名带子目录路径', r2.status === 1 && r2.stderr.includes('sd/sub/broken.cjs'), `exit=${r2.status}\n${r2.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 6：SKIP_DIRS（node_modules/.git/tmp）不入守护面 ----
{
  const root = mkroot();
  fs.mkdirSync(path.join(root, 'sd', 'node_modules', 'dep'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sd', 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sd', 'node_modules', 'dep', 'dep.mjs'), 'if (true) entry.x process.env.Y;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'sd', 'tmp', 'gen.mjs'), 'if (true) entry.x process.env.Y;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'sd', 'good.mjs'), 'const a = 1;\n', 'utf8');
  const r = run(root, ['sd']);
  check('场景 6：SKIP_DIRS 排除 → exit 0 报数 1（坏件在 node_modules/tmp 不入面）', r.status === 0 && r.stdout.includes('✅ 1 个引擎脚本'), `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
process.exit(0);
