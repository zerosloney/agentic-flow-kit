#!/usr/bin/env node
// rule-budget.test.mjs — 常驻面预算黑盒套件（2026-10-15 减重手段② 随附：#count 条目数指令）
// 夹具：os.tmpdir 下临时目录（非 git 环境——脚本 git rev-parse 失败留在 fixture 目录，
// 字节口径回退工作区文件；与真实仓「索引/HEAD」口径的差异不影响指令语义判定）。
// 覆盖：字节超限/未超、#count 超限/压线、旧格式行不受 #count 影响、缺预算表 exit 0、
//       --staged 无 git（staged 空）时 #count 门跳过。
// 运行：node templates/_agents/scripts/rule-budget.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rule-budget.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

function makeFixture({ budgets, dirs = {}, files = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-budget-'));
  if (budgets !== null) {
    fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents', 'rule-budgets.txt'), budgets, 'utf8');
  }
  for (const [dir, names] of Object.entries(dirs)) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    for (const n of names) fs.writeFileSync(path.join(root, dir, n), 'x\n', 'utf8');
  }
  for (const [f, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), content, 'utf8');
  }
  return root;
}

const run = (cwd, mode = '--all') => {
  const r = spawnSync(process.execPath, [SCRIPT, mode], { cwd, encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout || '') };
};

let root;

// ---- T1 字节超限（旧格式语义不回归）----
root = makeFixture({
  budgets: 'AGENTS.md 10\n',
  files: { 'AGENTS.md': 'x'.repeat(50) },
});
{
  const r = run(root);
  check('T1 字节超限 exit 1 + 违例行', r.code === 1 && r.out.includes('常驻面超限：AGENTS.md') && r.out.includes('> 上限 10B'), JSON.stringify(r));
}

// ---- T2 字节未超 → 0 ----
root = makeFixture({
  budgets: 'AGENTS.md 100\n',
  files: { 'AGENTS.md': 'x'.repeat(50) },
});
check('T2 字节未超 exit 0', run(root).code === 0);

// ---- T3 #count 超限 ----
root = makeFixture({
  budgets: '.agents/rules/ 2#count\n',
  dirs: { '.agents/rules': ['r01-a.md', 'r02-b.md', 'r03-c.md'] },
});
{
  const r = run(root);
  check('T3 #count 超限 exit 1 + 条目数违例行 + 一进一出提示', r.code === 1 && r.out.includes('条目数') && r.out.includes('3 项 > 上限 2 项') && r.out.includes('一进一出'), JSON.stringify(r));
}

// ---- T4 #count 压线（= 上限）→ 0 ----
root = makeFixture({
  budgets: '.agents/rules/ 3#count\n',
  dirs: { '.agents/rules': ['r01-a.md', 'r02-b.md', 'r03-c.md'] },
});
check('T4 #count 压线 exit 0', run(root).code === 0);

// ---- T5 混合表：#count 行存在但未触其它字节条目 → 0（互不干扰）----
root = makeFixture({
  budgets: 'AGENTS.md 100\n.agents/rules/ 3#count\n',
  files: { 'AGENTS.md': 'x'.repeat(50) },
  dirs: { '.agents/rules': ['r01-a.md', 'r02-b.md', 'r03-c.md'] },
});
check('T5 混合表双通过 exit 0', run(root).code === 0);

// ---- T6 缺预算表 → exit 0（fixture 沙箱不拦，既有语义）----
root = makeFixture({ budgets: null });
check('T6 缺预算表 exit 0', run(root).code === 0);

// ---- T7 --staged 无 git（staged 空）：#count 门跳过不拦 ----
root = makeFixture({
  budgets: '.agents/rules/ 2#count\n',
  dirs: { '.agents/rules': ['r01-a.md', 'r02-b.md', 'r03-c.md'] },
});
{
  const r = run(root, '--staged');
  check('T7 --staged 无 git 环境跳过 #count 门 exit 0', r.code === 0, JSON.stringify(r));
}

// ---- T8 glob 形态 #count（* 后缀）也按条数执法 ----
root = makeFixture({
  budgets: '.agents/commands/*.md 2#count\n',
  dirs: { '.agents/commands': ['a.md', 'b.md', 'c.md', 'd.txt'] },
});
{
  const r = run(root);
  check('T8 glob #count 只数 *.md（3 项 > 2）exit 1', r.code === 1 && r.out.includes('3 项'), JSON.stringify(r));
}

for (const d of fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('rule-budget-'))) {
  try { fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true }); } catch { /* Windows 文件锁容忍 */ }
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
