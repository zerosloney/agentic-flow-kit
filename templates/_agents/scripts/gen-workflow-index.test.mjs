#!/usr/bin/env node
// gen-workflow-index.mjs 的 fixture 驱动测试
// 现场构造临时 workflow 根，以「换 cwd」方式运行被测脚本（脚本按相对路径 'workflow/' 读盘）。
// 断言：①活跃（draft/approved/open）逐行出表、终态折叠进档案计数（含 fixed incident）、验收勾验统计；
//       ②--check 一致 exit 0 / 漂移 exit 1（失败路径）；③缺 `模块:` 容忍显示 —。
// 用法：node .agents/scripts/gen-workflow-index.test.mjs（在仓库任意目录执行均可）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.join(SCRIPT_DIR, 'gen-workflow-index.mjs');
const USAGE = '用法：node .agents/scripts/gen-workflow-index.test.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const doc = (fm, title, body = '') => `---\n${fm}\n---\n# ${title}\n\n${body}\n`;

// mkfix：建临时 workflow 根（4 个子目录齐备——生成器按目录枚举，缺目录会 throw）
const mkfix = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-workflow-index-test-'));
  for (const d of ['intents', 'specs', 'plans', 'incidents']) fs.mkdirSync(path.join(root, 'workflow', d), { recursive: true });
  const w = path.join(root, 'workflow');
  fs.writeFileSync(path.join(w, 'intents', '2026-09-21-alpha.md'), doc(
    '状态: approved\n级别: L1\n日期: 2026-09-21\n模块: pipeline',
    'INTENT — 在跑的需求甲',
    '## 验收标准（可测试）\n- [x] 已验项（证据：实跑）\n- [ ] 未验项\n',
  ), 'utf8');
  fs.writeFileSync(path.join(w, 'plans', '2026-09-21-alpha.md'), doc(
    '状态: approved\n级别: L1\n模块: pipeline',
    'PLAN — 在跑的需求甲',
  ), 'utf8');
  fs.writeFileSync(path.join(w, 'plans', '2026-09-19-beta.md'), doc(
    '状态: done\n级别: L1\n模块: material',
    'PLAN — 已完结的需求乙',
  ), 'utf8');
  fs.writeFileSync(path.join(w, 'incidents', '2026-09-18-gamma.md'), doc(
    '状态: fixed\n级别: L2\n发现: 2026-09-18\n模块: material',
    'INCIDENT — 已修复未收口的事故丙',
  ), 'utf8');
  fs.writeFileSync(path.join(w, 'intents', '_TEMPLATE.md'), doc('状态: draft\n级别: L1', 'INTENT — 模板不该进表'), 'utf8');
  return root;
};

const run = (root, args = []) => spawnSync(process.execPath, [GEN, ...args], { cwd: root, encoding: 'utf8' });

// ---- 场景 1：主路径——活跃逐行 + 终态折叠 + 验收统计 ----
{
  const root = mkfix();
  const r = run(root);
  const idx = fs.readFileSync(path.join(root, 'workflow', 'INDEX.md'), 'utf8');
  check('场景 1：生成器 exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 1：活跃 2 行（approved intent + approved plan）', idx.includes('## 活跃（2）'), idx.split('\n').slice(0, 14).join('\n'));
  check('场景 1：活跃行含 7 字段（类型/级别/状态/日期/模块/标题/验收）',
    /\| INTENT \| L1 \| approved \| 2026-09-21 \| pipeline \| 在跑的需求甲 \| ☑1\/2 \|/.test(idx),
    idx.split('\n').filter((l) => l.startsWith('| INTENT')).join('\n'));
  check('场景 1：终态折叠为档案 2 篇（done plan + fixed incident）', idx.includes('## 档案计数（2，不进表）'), '');
  check('场景 1：档案按类型×模块计数', idx.includes('| PLAN | material | 1 |') && idx.includes('| INCIDENT | material | 1 |'), '');
  check('场景 1：终态构成行含 done 1 · fixed 1', /终态构成：.*done 1.*fixed 1/.test(idx), idx.split('\n').slice(-2).join('\n'));
  check('场景 1：_TEMPLATE.md 不进表', !idx.includes('模板不该进表'), '');
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 2：--check 一致 exit 0 / 漂移 exit 1 / 重生成后复原（失败路径）----
{
  const root = mkfix();
  run(root);
  const ok = run(root, ['--check']);
  check('场景 2：生成后 --check exit 0', ok.status === 0, `exit=${ok.status}\n${ok.stdout}${ok.stderr}`);
  const p = path.join(root, 'workflow', 'intents', '2026-09-21-alpha.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('状态: approved', '状态: done'), 'utf8');
  const drift = run(root, ['--check']);
  check('场景 2：文档状态变更后 --check exit 1（漂移）', drift.status === 1, `exit=${drift.status}\n${drift.stdout}${drift.stderr}`);
  check('场景 2：漂移提示含重生成命令', /gen-workflow-index\.mjs 重新生成/.test(drift.stderr), drift.stderr);
  run(root);
  const ok2 = run(root, ['--check']);
  check('场景 2：重生成后 --check 复原 exit 0', ok2.status === 0, `exit=${ok2.status}\n${ok2.stdout}${ok2.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 3：缺 `模块:` 容忍显示 —（不报错、不阻断）----
{
  const root = mkfix();
  const p = path.join(root, 'workflow', 'plans', '2026-09-21-alpha.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('模块: pipeline\n', ''), 'utf8');
  const r = run(root);
  const idx = fs.readFileSync(path.join(root, 'workflow', 'INDEX.md'), 'utf8');
  check('场景 3：缺模块字段仍 exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 3：模块列显示 —', /^\| PLAN \| L1 \| approved \| .* \| — \|/m.test(idx), idx.split('\n').filter((l) => l.startsWith('| PLAN | approved')).join('\n'));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 4：非法参数 exit 1 ----
{
  const root = mkfix();
  const r = run(root, ['--nope']);
  check('场景 4：未知参数 exit 1', r.status === 1 && /未知参数/.test(r.stderr), `exit=${r.status}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log(`\n${USAGE}`);
  process.exit(1);
}
process.exit(0);
