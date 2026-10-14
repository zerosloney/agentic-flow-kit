#!/usr/bin/env node
// lane-surface-audit.test.mjs — 闭集审计 fixture 套件（2026-10-13 自 Shipyard.Material 参考实现回灌）
// 方法：临时 git 仓构造「L2 文档 + 同笔代码提交」历史，断言候选目录判定（阈值/ERE 覆盖排除/无候选静默）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(SCRIPT_DIR, 'lane-surface-audit.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

const mkrepo = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-audit-test-'));
  const g = (a) => spawnSync('git', ['-c', 'core.quotepath=off', ...a], { cwd: d, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  for (const s of ['intents', 'incidents']) fs.mkdirSync(path.join(d, 'workflow', s), { recursive: true });
  fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
  w(d, '.agents/lane-surfaces.txt', '## product\n^backend/shared/\n');
  const commit = (msg) => { g(['add', '-A']); g(['commit', '-q', '-m', msg]); };
  return { d, g, commit };
};
const w = (root, rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
const intent = (name, level, date) => `---\n状态: done\n级别: ${level}\n日期: ${date}\n模块: pipeline\n---\n# INTENT — ${name}\n`;
const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

// 场景 1：3 个不同 L2 任务反复触及未覆盖目录 → 候选；已覆盖目录（backend/shared）不进候选
{
  const { d, commit } = mkrepo();
  for (let i = 1; i <= 3; i++) {
    w(d, `workflow/intents/2026-10-0${i}-t${i}.md`, intent(`t${i}`, 'L2', `2026-10-0${i}`));
    w(d, `backend/material/Shipyard.Material.Application/Services/S${i}.cs`, `// ${i}\n`);
    w(d, 'backend/shared/Covered.cs', `// c${i}\n`); // 同任务也触已覆盖面
    commit(`task ${i}`);
  }
  const r = run(d, '--since', '2026-10-01');
  check('场景 1：未覆盖目录 3 任务 → 候选列出且提示人工评估；已覆盖目录不出现',
    r.code === 0 && r.out.includes('候选漏登面 1 个') && r.out.includes('backend/material/Shipyard.Material.Application') && r.out.includes('lane-surfaces.txt') && !r.out.includes('backend/shared/'), r.out);
}
// 场景 2：阈值未达（2 个任务）→ 无候选静默
{
  const { d, commit } = mkrepo();
  for (let i = 1; i <= 2; i++) {
    w(d, `workflow/intents/2026-10-0${i}-t${i}.md`, intent(`t${i}`, 'L2', `2026-10-0${i}`));
    w(d, `backend/material/Shipyard.Material.Application/Services/S${i}.cs`, `// ${i}\n`);
    commit(`task ${i}`);
  }
  const r = run(d, '--since', '2026-10-01');
  check('场景 2：2 任务未达阈值 3 → 无漂移信号', r.code === 0 && r.out.includes('无漂移信号'), r.out);
}
// 场景 3：L1 文档不计数（级别过滤）+ --min 覆盖（2 任务 + min 2 → 候选）
{
  const { d, commit } = mkrepo();
  for (let i = 1; i <= 2; i++) {
    w(d, `workflow/intents/2026-10-0${i}-l${i}.md`, intent(`l${i}`, 'L1', `2026-10-0${i}`));
    w(d, 'frontend/src/views/Some/V.vue', `// ${i}\n`);
    commit(`l ${i}`);
  }
  const r1 = run(d, '--since', '2026-10-01');
  check('场景 3a：纯 L1 不入审计面（无 L2/L3 文档）', r1.code === 0 && r1.out.includes('无 L2/L3 文档'), r1.out);
  const { d: d2, commit: c2 } = mkrepo();
  for (let i = 1; i <= 2; i++) {
    w(d2, `workflow/intents/2026-10-0${i}-t${i}.md`, intent(`t${i}`, 'L2', `2026-10-0${i}`));
    w(d2, 'frontend/src/views/Some/V.vue', `// ${i}\n`);
    c2(`t ${i}`);
  }
  const r2 = run(d2, '--since', '2026-10-01', '--min', '2');
  check('场景 3b：--min 2 时 2 任务 → 候选', r2.code === 0 && r2.out.includes('frontend/src/views'), r2.out);
}
// 场景 4：incident 等价（发现日期键）入审计面
{
  const { d, commit } = mkrepo();
  for (let i = 1; i <= 3; i++) {
    w(d, `workflow/incidents/2026-10-0${i}-inc${i}.md`, `---\n状态: closed\n级别: L3\n发现: 2026-10-0${i}\n模块: pipeline\n---\n# INCIDENT\n`);
    w(d, `db/procs/P${i}.sql`, `-- ${i}\n`);
    commit(`inc ${i}`);
  }
  const r = run(d, '--since', '2026-10-01');
  check('场景 4：incident（发现键）×3 → db/procs 候选', r.code === 0 && r.out.includes('db/procs'), r.out);
}

console.log(`\n${fail ? `❌ ${fail} failed` : '✅ all passed'}（${pass} passed）`);
process.exit(fail ? 1 : 0);
