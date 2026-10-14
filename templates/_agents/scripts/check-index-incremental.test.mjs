#!/usr/bin/env node
// check-index-incremental.mjs：未触及 workflow 文档则跳过；触及且 INDEX 与磁盘不一致则 exit 1；重生成后 exit 0。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(SCRIPT_DIR, '..', 'hooks', 'check-index-incremental.mjs');
const GEN = path.join(SCRIPT_DIR, 'gen-workflow-index.mjs');
const { stagedTouchesIndex } = await import(pathToFileURL(HOOK).href);

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

check('路径：四目录 md 与 INDEX.md 触发', stagedTouchesIndex([
  'workflow/plans/2026-10-12-a.md',
  'README.md',
]));
check('路径：归档 md 触发', stagedTouchesIndex(['workflow/archive/2026-10/plans/2026-10-01-a.md']));
check('路径：INDEX.md 触发', stagedTouchesIndex(['workflow/INDEX.md']));
check('路径：delegations 与引擎脚本不触发', !stagedTouchesIndex([
  'workflow/delegations.md',
  '.agents/scripts/gen-workflow-index.mjs',
  'backend/x.cs',
]));

const git = (cwd, args) => spawnSync('git', ['-c', 'core.hooksPath=', ...args], { cwd, encoding: 'utf8' });
const runHook = (cwd) => spawnSync(process.execPath, [HOOK], { cwd, encoding: 'utf8' });

function initRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'index-incremental-'));
  git(root, ['init']);
  git(root, ['config', 'user.email', 'index-test@example.com']);
  git(root, ['config', 'user.name', 'index-test']);
  for (const d of ['intents', 'specs', 'plans', 'incidents']) fs.mkdirSync(path.join(root, 'workflow', d), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'plans', '2026-10-01-a.md'), '---\n状态: done\n级别: L1\n日期: 2026-10-01\n---\n# PLAN — 甲\n', 'utf8');
  fs.writeFileSync(path.join(root, 'README.md'), 'x\n', 'utf8');
  return root;
}

{
  const root = initRepo();
  git(root, ['add', 'README.md']);
  const r = runHook(root);
  check('未暂存 workflow 文档 → exit 0', r.status === 0, `${r.status}\n${r.stdout}${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const root = initRepo();
  const gen = spawnSync(process.execPath, [GEN], { cwd: root, encoding: 'utf8' });
  check('夹具生成 INDEX exit 0', gen.status === 0, gen.stderr);
  git(root, ['add', 'workflow']);
  const ok = runHook(root);
  check('INDEX 与磁盘一致 → exit 0', ok.status === 0, `${ok.stdout}${ok.stderr}`);
  fs.writeFileSync(path.join(root, 'workflow', 'plans', '2026-10-01-a.md'), '---\n状态: approved\n级别: L1\n日期: 2026-10-01\n---\n# PLAN — 甲\n', 'utf8');
  git(root, ['add', 'workflow/plans/2026-10-01-a.md']);
  const blocked = runHook(root);
  check('状态变了但 INDEX 未重生成 → exit 1', blocked.status === 1, `${blocked.stdout}${blocked.stderr}`);
  const regen = spawnSync(process.execPath, [GEN], { cwd: root, encoding: 'utf8' });
  git(root, ['add', 'workflow/INDEX.md']);
  const again = runHook(root);
  check('重生成并暂存 INDEX 后 → exit 0', regen.status === 0 && again.status === 0, `${regen.stderr}${again.stdout}${again.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
