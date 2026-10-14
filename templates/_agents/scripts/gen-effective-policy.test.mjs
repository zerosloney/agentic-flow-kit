#!/usr/bin/env node
// gen-effective-policy.test.mjs — 生效规则视图生成器 fixture 套件（2026-10-13 自 Shipyard.Material
//   参考实现回灌时随件移植；夹具口径改 kit：注入 .agents/kit.json 的 policyVersion 取值 / 缺失 / 非法三态）
// 方法：临时根注入 kit.json，断言生成内容与 --check 语义。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(SCRIPT_DIR, 'gen-effective-policy.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};
const mkfix = (policyVersion) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'eff-policy-test-'));
  fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
  if (policyVersion !== undefined) fs.writeFileSync(path.join(d, '.agents', 'kit.json'), JSON.stringify({ kit: 'agentic-flow-kit', policyVersion }));
  return d;
};
const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

// 场景 1：v8 生成——当前版本行 + 全锚键行 + 表结构（真实 v8 锚均为历史日期，待升级分支由场景 4 注入钉住）
{
  const d = mkfix(8);
  const r = run(d);
  const doc = fs.readFileSync(path.join(d, 'workflow', 'effective-policy.md'), 'utf8');
  check('场景 1：v8 生成成功且含版本声明与锚键行',
    r.code === 0 && doc.includes('**policyVersion 8**') && doc.includes('`ledgerDocChainSince`') && doc.includes('`bindingTs`') && doc.includes('kit.json 声明 8'), r.out + doc);
}
// 场景 2：--check 一致 → 0；篡改磁盘 → 1；再生成 → 恢复 0
{
  const d = mkfix(8);
  run(d);
  check('场景 2a：生成后 --check 一致', run(d, '--check').code === 0);
  fs.appendFileSync(path.join(d, 'workflow', 'effective-policy.md'), 'drift\n');
  const r2 = run(d, '--check');
  check('场景 2b：磁盘漂移 → --check exit 1 且含修法', r2.code === 1 && r2.out.includes('重生成'), r2.out);
  run(d);
  check('场景 2c：重生成后 --check 恢复 0', run(d, '--check').code === 0);
}
// 场景 2d/2e：行尾不算漂移，内容差仍算（autocrlf 假红）
{
  const d = mkfix(8);
  run(d);
  const p = path.join(d, 'workflow', 'effective-policy.md');
  const lf = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(p, lf.replace(/\n/g, '\r\n'));
  check('场景 2d：CRLF 检出、内容相同 → --check 0', run(d, '--check').code === 0);
  fs.writeFileSync(p, lf.replace(/\n/g, '\r\n').replace('policyVersion', 'policyVerslon'));
  const r = run(d, '--check');
  check('场景 2e：CRLF 且内容漂移 → --check exit 1', r.code === 1 && r.out.includes('重生成'), r.out);
}
// 场景 2f：锚日翻转稳定性（源仓 2026-10-12 CI 生产事故钉：视图生成于 D1，次日系统当日 --check
//   按当日重渲染判「已生效」→ 与仓内「待升级」必差 → 每个未来日期锚都在锚日引爆）。
//   修法语义：--check 对磁盘自带「视图日期」重渲染——不依赖未来锚存在，视图日期行本身在旧实现下就会漂移。
{
  const d = mkfix(8);
  const d1 = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const gen = spawnSync(process.execPath, [SCRIPT, '--root', d], { encoding: 'utf8', env: { ...process.env, EFFECTIVE_POLICY_TODAY: d1 } });
  const doc = fs.readFileSync(path.join(d, 'workflow', 'effective-policy.md'), 'utf8');
  const chk = run(d, '--check'); // 不带 env——按系统当日跑，模拟「次日对账」
  check('场景 2f：视图日期 D1 生成的视图，次日 --check 仍一致（按磁盘视图日期重渲染，锚日不引爆）',
    gen.status === 0 && doc.includes(`视图日期 ${d1}`) && chk.code === 0,
    `gen=${gen.status} docViewDate=${(doc.match(/视图日期 (\S+)/) || [])[1]} check=${chk.code}\n${chk.out}`);
}

// 场景 3：非法版本号 → 回落 v1（渲染回落声明）；缺 kit.json → 同 v1
{
  const d = mkfix(99);
  const r = run(d);
  const doc = fs.readFileSync(path.join(d, 'workflow', 'effective-policy.md'), 'utf8');
  check('场景 3a：非法 policyVersion=99 → 回落 v1 且声明回落',
    r.code === 0 && doc.includes('**policyVersion 1**') && doc.includes('kit.json 声明 99') && doc.includes('已回落'), doc);
  const d2 = mkfix(undefined);
  const r2 = run(d2);
  const doc2 = fs.readFileSync(path.join(d2, 'workflow', 'effective-policy.md'), 'utf8');
  check('场景 3b：缺 kit.json → v1 基线', r2.code === 0 && doc2.includes('**policyVersion 1**'), doc2);
}
// 场景 4：待升级判定——不依赖墙钟：EFFECTIVE_POLICY_TODAY 注入 2026-09-24，
//   v8 的 check14Since=2026-09-26 > 视图基准日 → 「待升级」；moduleSince=2026-09-22 ≤ → 「已生效」
{
  const d = mkfix(8);
  const r = spawnSync(process.execPath, [SCRIPT, '--root', d], { encoding: 'utf8', env: { ...process.env, EFFECTIVE_POLICY_TODAY: '2026-09-24' } });
  const doc = fs.readFileSync(path.join(d, 'workflow', 'effective-policy.md'), 'utf8');
  check('场景 4：升级锚按视图基准日判定（moduleSince 已生效 / check14Since 待升级）',
    r.status === 0 && doc.includes('`check14Since` | 2026-09-26 | 检查 14 | 新 done 的 spec/plan 须有 approved git 历史（kit 口径恒 advisory 永不升级 hard） | advisory | 待升级（2026-09-26 起）')
      && doc.includes('`moduleSince` | 2026-09-22 | 检查 12'), doc);
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
