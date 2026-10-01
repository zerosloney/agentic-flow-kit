#!/usr/bin/env node
// trust-mode.test.mjs — AI 自治信任等级 fixture 套件（2026-10-01 gate-script-test-coverage）
// 覆盖：三级语义（Strict/Standard/Trusted 名称↔数值双轨）、缺文件 fail-closed 回落 Strict、
// --enable/--disable/--status CLI 行为、非法 --level 拒绝、与 confirm-doc --auto 的端到端
// （Strict 缺文件拒绝不落账 / Trusted 放行 source=ai-auto-trust-L2）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TRUST = path.join(SCRIPT_DIR, 'trust-mode.mjs');
const CONFIRM = path.join(SCRIPT_DIR, 'confirm-doc.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

const mkfix = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-test-'));
  for (const s of ['intents', 'plans', 'specs', 'incidents']) {
    fs.mkdirSync(path.join(d, 'workflow', s), { recursive: true });
  }
  fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
  fs.mkdirSync(path.join(d, '.zcode'), { recursive: true });
  fs.writeFileSync(path.join(d, '.agents', 'workflow-enums.txt'),
    ['doc.status.all=draft approved done superseded cancelled', 'doc.status.confirmed=approved done superseded cancelled',
      'doc.status.active=draft approved', 'doc.status.terminal=done superseded cancelled', 'doc.status.abandoned=superseded cancelled',
      'incident.status.all=open fixed closed', 'incident.status.active=open', 'level.all=L0 L1 L2 L3'].join('\n') + '\n');
  fs.writeFileSync(path.join(d, '.agents', 'workflow-modules.txt'), '# modules\npipeline\nui\n');
  return d;
};
const runTrust = (root, args) => {
  const r = spawnSync(process.execPath, [TRUST, ...args], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const cfg = (root) => {
  const p = path.join(root, '.agents', 'trust-mode.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};
const ledgerLines = (root) => {
  const p = path.join(root, '.agents', 'confirmations.jsonl');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split(/\n/).filter(Boolean) : [];
};
const DRAFT = (level = 'L1') => `---\n状态: draft\n级别: ${level}\nrisk_level: ${level}\n日期: 2026-10-01\n模块: pipeline\n---\n# INTENT — demo\n`;

// T1：缺文件 → fail-closed Strict 默认
{
  const d = mkfix();
  const r = runTrust(d, ['--status']);
  check('T1 缺文件 --status 输出 Strict/level0/enabled false', r.code === 0 && r.out.includes('"name": "Strict"') && r.out.includes('"level": 0') && r.out.includes('"enabled": false'), r.out);
}
// T2：三级语义映射正确
{
  check('T2 名称↔数值双轨（NAME_BY_LEVEL 内容）',
    fs.readFileSync(TRUST, 'utf8').includes("NAME_BY_LEVEL = { 0: 'Strict', 1: 'Standard', 2: 'Trusted' }"), '');
}
// T3：--enable --level Trusted → 落盘 enabled true/level 2/name Trusted
{
  const d = mkfix();
  const r = runTrust(d, ['--enable', '--level', 'Trusted']);
  const c = cfg(d);
  check('T3 --level Trusted 落盘正确', r.code === 0 && c && c.enabled === true && c.level === 2 && c.name === 'Trusted', JSON.stringify(c));
}
// T4：--enable --level 0（Strict 数字）→ 关闭
{
  const d = mkfix();
  const r = runTrust(d, ['--enable', '--level', '0']);
  const c = cfg(d);
  check('T4 --level 0 → 关闭 Strict', r.code === 0 && c && c.enabled === false && c.level === 0 && c.name === 'Strict', JSON.stringify(c));
}
// T5：非法 --level → 拒绝 exit 1
{
  const d = mkfix();
  const r = runTrust(d, ['--enable', '--level', 'Bogus']);
  check('T5 非法 --level 拒绝 exit 1', r.code === 1 && r.out.includes('必须为'), r.out);
}
// T6：--disable → 关闭 Strict
{
  const d = mkfix();
  runTrust(d, ['--enable', '--level', 'Trusted']);
  const r = runTrust(d, ['--disable']);
  const c = cfg(d);
  check('T6 --disable 复位 Strict', r.code === 0 && c && c.enabled === false && c.level === 0 && c.name === 'Strict', JSON.stringify(c));
}
// T7 e2e：Strict（缺文件）下 confirm-doc --auto 拒绝不落账
{
  const d = mkfix();
  fs.writeFileSync(path.join(d, 'workflow', 'intents', '2026-10-01-demo.md'), DRAFT('L1'));
  const r = spawnSync(process.execPath, [CONFIRM, 'workflow/intents/2026-10-01-demo.md', '--root', d, '--auto'], { cwd: d, encoding: 'utf8' });
  check('T7 Strict 下 --auto 拒绝且零台账', r.status !== 0 && ledgerLines(d).length === 0, `${r.stdout}${r.stderr}\n${ledgerLines(d).join('|')}`);
}
// T8 e2e：Trusted 下 confirm-doc --auto 放行 L1，台账 source=ai-auto-trust-L2
{
  const d = mkfix();
  fs.writeFileSync(path.join(d, 'workflow', 'intents', '2026-10-01-demo.md'), DRAFT('L1'));
  runTrust(d, ['--enable', '--level', 'Trusted']);
  const r = spawnSync(process.execPath, [CONFIRM, 'workflow/intents/2026-10-01-demo.md', '--root', d, '--auto'], { cwd: d, encoding: 'utf8' });
  const lines = ledgerLines(d);
  check('T8 Trusted 下 --auto 放行并记 ai-auto-trust-L2',
    r.status === 0 && lines.length === 1 && lines[0].includes('ai-auto-trust-L2') && lines[0].includes('"stage":"approved"'),
    `${r.stdout}${r.stderr}\n${lines.join('|')}`);
}

console.log(`\n${fail ? `❌ ${fail} failed` : '✅ all passed'}（${pass} passed）`);
process.exit(fail ? 1 : 0);