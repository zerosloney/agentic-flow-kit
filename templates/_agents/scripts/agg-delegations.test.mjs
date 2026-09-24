#!/usr/bin/env node
// agg-delegations.cjs 的 fixture 驱动测试（2026-09-24 随「台账结构漂移静默吞数据」修复引入）
// 被测脚本以 __dirname 定位台账，故复制脚本进临时根（<tmp>/.agents/scripts/）后以 cwd=<tmp> 运行。
// 断言：①节标题缺失但表头合规 → 数据照常入账（本次事故形态回归）；②日期数据行在但表头不可识别 → exit 1 fail-loud；
//       ③空台账（表头合规、无数据行）→ exit 0 且提示为空。
// 用法：node .agents/scripts/agg-delegations.test.mjs（在仓库任意目录执行均可）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(SCRIPT_DIR, 'agg-delegations.cjs');
const USAGE = '用法：node .agents/scripts/agg-delegations.test.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const mkfix = (ledgerText) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agg-delegations-test-'));
  fs.mkdirSync(path.join(root, '.agents', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workflow', 'incidents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'delegations.md'), ledgerText, 'utf8');
  fs.copyFileSync(SRC, path.join(root, '.agents', 'scripts', 'agg-delegations.cjs'));
  return root;
};
const runAgg = (root) => spawnSync(process.execPath, [path.join(root, '.agents', 'scripts', 'agg-delegations.cjs')], { cwd: root, encoding: 'utf8' });

// ---- 场景 1：无 `## ` 节标题、表头合规（2026-09-24 事故形态）→ 数据照常入账 ----
{
  const root = mkfix([
    '# 量化证据台账（fixture）',
    '',
    '| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 |',
    '|------|----------------|------------|------|------|',
    '| 2026-09-23 | general-purpose(子代理) | 示例委派任务 | 一次通过 | fixture |',
    '',
  ].join('\n'));
  const r = runAgg(root);
  check('场景 1：节标题缺失 + 表头合规 → exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 1：数据行入账（有效任务 1，非「台账为空」）', /有效任务 1（/.test(r.stdout) && !r.stdout.includes('台账为空'), r.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 2：日期数据行在但表头不可识别 → fail-loud（不再静默「台账为空」）----
{
  const root = mkfix([
    '# 量化证据台账（fixture）',
    '',
    '| when | who | what | result | note |',
    '|------|-----|------|--------|------|',
    '| 2026-09-23 | executor | 表头被改的行 | 一次通过 | fixture |',
    '',
  ].join('\n'));
  const r = runAgg(root);
  check('场景 2：表头不可识别 → exit 1', r.status === 1, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 2：报错点名结构漂移', (r.stderr || '').includes('结构漂移'), r.stderr);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 3：空台账（表头合规、无数据行）→ exit 0 且提示为空 ----
{
  const root = mkfix([
    '# 量化证据台账（fixture）',
    '',
    '## 委派结果',
    '',
    '| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 |',
    '|------|----------------|------------|------|------|',
    '',
    '## 自做任务结果',
    '',
    '| 日期 | 任务一句话 | 结果 | 备注 |',
    '|------|------------|------|------|',
    '',
  ].join('\n'));
  const r = runAgg(root);
  check('场景 3：空台账 → exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 3：提示台账为空', r.stdout.includes('台账为空'), r.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log(`\n${USAGE}`);
  process.exit(1);
}
process.exit(0);
