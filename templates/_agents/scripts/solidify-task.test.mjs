#!/usr/bin/env node
// solidify-task.test.mjs — 快车道固化脚本 fixture 套件（2026-10-01 v09-review-defects）
// 验证确认门契约：无确认来源只迁移不落账；--delegated quote 原样转发；--auto Strict 下拒绝且失败退出；
// 互斥/缺草稿/非文档等边界。gen-workflow-index 无 --root 参数，spawn 时以 fixture 根为 cwd。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(SCRIPT_DIR, 'solidify-task.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

const ENUMS_FIXTURE = [
  'doc.status.all=draft approved done superseded cancelled',
  'doc.status.confirmed=approved done superseded cancelled',
  'doc.status.active=draft approved',
  'doc.status.terminal=done superseded cancelled',
  'doc.status.abandoned=superseded cancelled',
  'incident.status.all=open fixed closed',
  'incident.status.active=open',
  'level.all=L0 L1 L2 L3',
].join('\n') + '\n';

const mkfix = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'solidify-test-'));
  for (const s of ['intents', 'plans', 'specs', 'incidents']) {
    fs.mkdirSync(path.join(d, 'workflow', s), { recursive: true });
  }
  fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
  fs.mkdirSync(path.join(d, '.zcode', 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(d, '.agents', 'workflow-enums.txt'), ENUMS_FIXTURE);
  fs.writeFileSync(path.join(d, '.agents', 'workflow-modules.txt'), '# modules\npipeline\nui\n');
  return d;
};
const DRAFT = (name, eol = '\n') =>
  `---${eol}状态: draft${eol}级别: L1${eol}日期: 2026-10-01${eol}模块: pipeline${eol}---${eol}# INTENT — ${name}${eol}`;
const run = (root, args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const ledgerLines = (root) => {
  const p = path.join(root, '.agents', 'confirmations.jsonl');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split(/\n/).filter(Boolean) : [];
};

// T1：默认只迁移不落账
{
  const d = mkfix();
  fs.writeFileSync(path.join(d, '.zcode', 'drafts', 'demo-task.md'), DRAFT('demo'));
  const r = run(d, ['--topic', 'demo', '--root', d]);
  check('T1 默认迁移成功 exit 0', r.code === 0, r.out);
  check('T1 草稿已迁移到 intents 且日期前缀正确',
    fs.existsSync(path.join(d, 'workflow', 'intents', '2026-10-01-demo-task.md')), '');
  check('T1 零台账新增（无确认来源绝不落账）', ledgerLines(d).length === 0, JSON.stringify(ledgerLines(d)));
  check('T1 输出含确认指引', r.out.includes('确认指引') && r.out.includes('--delegated'), r.out);
}
// T2：--delegated 原话原样转发
{
  const d = mkfix();
  fs.writeFileSync(path.join(d, '.zcode', 'drafts', 'demo-task.md'), DRAFT('demo'));
  const r = run(d, ['--topic', 'demo', '--root', d, '--delegated', '固化了可以']);
  check('T2 --delegated 流程 exit 0', r.code === 0, r.out);
  const lines = ledgerLines(d);
  check('T2 台账落 1 行', lines.length === 1, JSON.stringify(lines));
  check('T2 quote 原样（脚本不编造话术）',
    lines[0].includes('"quote":"固化了可以"') && lines[0].includes('chat-delegated'), lines[0]);
  check('T2 目标文档状态已 approved',
    fs.readFileSync(path.join(d, 'workflow', 'intents', '2026-10-01-demo-task.md'), 'utf8').includes('状态: approved'), '');
}
// T3：--auto 在 Strict（缺 trust-mode.json）下被拒 → 失败计数并 exit 1
{
  const d = mkfix();
  fs.writeFileSync(path.join(d, '.zcode', 'drafts', 'demo-task.md'), DRAFT('demo'));
  const r = run(d, ['--topic', 'demo', '--root', d, '--auto']);
  check('T3 --auto 在缺省 Strict 下 exit 1（不吞失败）', r.code === 1, r.out);
  check('T3 输出含失败汇总', r.out.includes('确认汇总') && r.out.includes('失败'), r.out);
  check('T3 台账零行（拒绝不落账）', ledgerLines(d).length === 0, JSON.stringify(ledgerLines(d)));
}
// T4：缺草稿 → exit 1
{
  const d = mkfix();
  fs.writeFileSync(path.join(d, '.zcode', 'drafts', 'other.md'), DRAFT('other'));
  const r = run(d, ['--topic', 'nope', '--root', d]);
  check('T4 缺主题草稿 exit 1 且带指引', r.code === 1 && r.out.includes('未找到主题'), r.out);
}
// T5：草稿非可识别文档 → exit 1
{
  const d = mkfix();
  fs.writeFileSync(path.join(d, '.zcode', 'drafts', 'demo-note.md'), '# 随手笔记\nnot a workflow doc\n');
  const r = run(d, ['--topic', 'demo', '--root', d]);
  check('T5 无可识别文档 exit 1', r.code === 1 && r.out.includes('未找到可识别'), r.out);
}
// T6：--delegated 与 --auto 互斥 → exit 1
{
  const d = mkfix();
  fs.writeFileSync(path.join(d, '.zcode', 'drafts', 'demo-task.md'), DRAFT('demo'));
  const r = run(d, ['--topic', 'demo', '--root', d, '--delegated', 'x', '--auto']);
  check('T6 互斥 exit 1', r.code === 1 && r.out.includes('互斥'), r.out);
}
// T7：失败路径退出码传播（确认失败后 exit 1，不吞）
{
  const d = mkfix();
  fs.writeFileSync(path.join(d, '.zcode', 'drafts', 'demo-task.md'), DRAFT('demo'));
  // 让确认失败：用 --auto 触发 Strict 拒绝（缺 trust-mode.json 即 Strict）。
  const r = run(d, ['--topic', 'demo', '--root', d, '--auto']);
  check('T7 失败后 exit 1 且索引仍生成', r.code === 1 && fs.existsSync(path.join(d, 'workflow', 'INDEX.md')), r.out);
}
// T8：索引更新失败传播退出码（独立于确认失败路径——删除 workflow/plans 目录使 gen-workflow-index 失败）
{
  const d = mkfix();
  fs.writeFileSync(path.join(d, '.zcode', 'drafts', 'demo-task.md'), DRAFT('demo'));
  fs.rmSync(path.join(d, 'workflow', 'plans'), { recursive: true });
  const r = run(d, ['--topic', 'demo', '--root', d]);
  check('T8 索引更新失败 exit 1 且输出指明', r.code === 1 && r.out.includes('索引更新失败'), r.out);
}

console.log(`\n${fail ? `❌ ${fail} failed` : '✅ all passed'}（${pass} passed）`);
process.exit(fail ? 1 : 0);