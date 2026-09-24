#!/usr/bin/env node
// gen-workflow-metrics.mjs 的 fixture 驱动测试
// 现场构造临时语料（换 cwd 运行被测脚本，脚本按相对路径读 workflow/ 与 .agents/rule-budgets.txt）。
// 断言：①主路径——类型聚合/活跃终态/模块已填/常驻面峰值/INDEX 活跃行；②同月重跑 upsert 不重复、跨月按月升序；
//       ③失败路径——非法 --month / 未知参数 exit 1。
// 用法：node .agents/scripts/gen-workflow-metrics.test.mjs（在仓库任意目录执行均可）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.join(SCRIPT_DIR, 'gen-workflow-metrics.mjs');
const USAGE = '用法：node .agents/scripts/gen-workflow-metrics.test.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const doc = (fm, title) => `---\n${fm}\n---\n# ${title}\n`;

const mkfix = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-workflow-metrics-test-'));
  for (const d of ['intents', 'specs', 'plans', 'incidents']) fs.mkdirSync(path.join(root, 'workflow', d), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents', 'commands'), { recursive: true });
  const w = path.join(root, 'workflow');
  fs.writeFileSync(path.join(w, 'intents', '2026-09-21-a.md'), doc('状态: approved\n级别: L1\n日期: 2026-09-21\n模块: pipeline', 'INTENT — 甲'), 'utf8');
  fs.writeFileSync(path.join(w, 'plans', '2026-09-21-a.md'), doc('状态: approved\n级别: L1\n模块: pipeline', 'PLAN — 甲'), 'utf8');
  fs.writeFileSync(path.join(w, 'plans', '2026-09-19-b.md'), doc('状态: done\n级别: L1\n模块: material', 'PLAN — 乙'), 'utf8');
  fs.writeFileSync(path.join(w, 'incidents', '2026-09-18-c.md'), doc('状态: closed\n级别: L2\n发现: 2026-09-18', 'INCIDENT — 丙'), 'utf8');
  fs.writeFileSync(path.join(w, 'intents', '_TEMPLATE.md'), doc('状态: draft\n级别: L1', 'INTENT — 模板'), 'utf8');
  fs.writeFileSync(path.join(w, 'INDEX.md'), '# index fixture\n\n## 活跃（2）\n\n| 类型 |\n|---|\n', 'utf8');
  // 预算表：AGENTS.md 120B / 上限 100 → 峰值 120%；commands 单篇与合计都远低于上限
  fs.writeFileSync(path.join(root, '.agents', 'rule-budgets.txt'), [
    '# fixture 预算表',
    'AGENTS.md 100',
    '.agents/commands/*.md 50',
    '.agents/commands/ 100',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'x'.repeat(120), 'utf8');
  fs.writeFileSync(path.join(root, '.agents', 'commands', 'plan.md'), 'y'.repeat(10), 'utf8');
  return root;
};

const run = (root, args) => spawnSync(process.execPath, [GEN, ...args], { cwd: root, encoding: 'utf8' });
const readMetrics = (root) => fs.readFileSync(path.join(root, 'workflow', 'metrics.md'), 'utf8');

// ---- 场景 1：主路径——一行算对 ----
{
  const root = mkfix();
  const r = run(root, ['--month', '2026-09']);
  const md = fs.existsSync(path.join(root, 'workflow', 'metrics.md')) ? readMetrics(root) : '';
  check('场景 1：生成 exit 0 且落盘 workflow/metrics.md', r.status === 0 && md.length > 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 1：行含 4（活跃 2 / 终态 2）+ 模块 3/4', /\| 2026-09 \| 4（活跃 2 \/ 终态 2） \| .* \| 3\/4 \|/.test(md), md);
  check('场景 1：常驻面峰值取最紧项（120.0% AGENTS.md）', /峰值 120\.0% AGENTS\.md/.test(md), md);
  check('场景 1：常驻面合计 = AGENTS.md + commands 逐文件（130B → 0.1 KB）', /0\.1 KB（峰值/.test(md), md);
  check('场景 1：INDEX 活跃行解析（2 行）', /（2 行） \|/.test(md), md);
  check('场景 1：_TEMPLATE.md 不计入（4 篇而非 5 篇）', !/\| 5（/.test(md), md);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 2：同月重跑 upsert 不重复；跨月按月升序 ----
{
  const root = mkfix();
  run(root, ['--month', '2026-09']);
  run(root, ['--month', '2026-09']);
  let md = readMetrics(root);
  const n09 = (md.match(/^\| 2026-09 \|/gm) || []).length;
  check('场景 2：同月重跑只保留一行', n09 === 1, `${n09} 行\n${md}`);
  run(root, ['--month', '2026-08']);
  md = readMetrics(root);
  const i08 = md.indexOf('| 2026-08 |');
  const i09 = md.indexOf('| 2026-09 |');
  check('场景 2：跨月两行且按月升序', i08 > -1 && i09 > -1 && i08 < i09, md);
  check('场景 2：HEADER 手工说明保留（生成区外内容不丢）', md.includes('# workflow 规模与规则面月度快照'), md);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 3：失败路径 + --dry-run 不写盘 ----
{
  const root = mkfix();
  const bad = run(root, ['--month', '2026-9']);
  check('场景 3：非法 --month exit 1', bad.status === 1 && /须为 YYYY-MM/.test(bad.stderr), `exit=${bad.status}\n${bad.stderr}`);
  const unk = run(root, ['--bogus']);
  check('场景 3：未知参数 exit 1', unk.status === 1 && /未知参数/.test(unk.stderr), `exit=${unk.status}\n${unk.stderr}`);
  const dry = run(root, ['--dry-run']);
  check('场景 3：--dry-run 不写盘且打印将写入行', dry.status === 0 && /将写入行/.test(dry.stdout) && !fs.existsSync(path.join(root, 'workflow', 'metrics.md')), dry.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 4：预算表 glob 词表收口——单 * 前缀+后缀匹配；多 * / 目录段 * 警告跳过（2026-09-24）----
{
  const root = mkfix();
  fs.writeFileSync(path.join(root, '.agents', 'commands', 'zeta.md'), 'z'.repeat(500), 'utf8'); // 非 pl 前缀：不得被 pl*.md 吃进
  fs.writeFileSync(path.join(root, '.agents', 'rule-budgets.txt'), [
    '# fixture 预算表（glob 词表收口）',
    'AGENTS.md 100',
    '.agents/commands/pl*.md 9999',
    '.agents/commands/**.md 9999',
    '.agents/*/cmd.md 9999',
    '',
  ].join('\n'), 'utf8');
  const r = run(root, ['--month', '2026-09']);
  const md = fs.existsSync(path.join(root, 'workflow', 'metrics.md')) ? readMetrics(root) : '';
  check('场景 4：exit 0（词表外条目跳过不阻断）', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 4：单 * 按前缀+后缀匹配（pl*.md 只吃 plan.md 10B，zeta.md 500B 不计入）', /\.agents\/commands\/pl\*\.md（单篇最大）\s+10\s+\/\s+9999/.test(r.stdout), r.stdout);
  check('场景 4：常驻面合计随之正确（120+10=130B → 0.1 KB）', /0\.1 KB（峰值/.test(md) && /常驻面合计：0\.1 KB/.test(r.stdout), `${md}\n${r.stdout}`);
  check('场景 4：多 * 与目录段 * 各警告跳过', (r.stderr || '').includes('**.md') && (r.stderr || '').includes('.agents/*/cmd.md'), r.stderr);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log(`\n${USAGE}`);
  process.exit(1);
}
process.exit(0);
