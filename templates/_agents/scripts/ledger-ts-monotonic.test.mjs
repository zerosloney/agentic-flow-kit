#!/usr/bin/env node
// ledger-ts-monotonic.test.mjs — 台账行级校验 ts 口径修正 + 分片覆盖 fixture 套件（2026-10-12）
// 命题：并集合并 / 分片归并会制造**跨 doc** 的物理序 ts 乱序，这是正常协作而非篡改；判据必须从
//   「全表非降序」改为「同 doc 内非降序」，同时不能因此丢掉真问题的检出（同 doc 内倒挂照 hard 拦）。
// 覆盖面：跨 doc 乱序放行 + 计数出账 / 同 doc 内倒挂仍拦 / 分片行纳入行级校验 / 豁免行号不漂移。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// 夹具闭包（2026-10-12 fixture-closure-rootfix）：整闭包自动跟随，不再手写依赖枚举（漏拷 = 假绿）
const { copyScriptClosure } = await import(pathToFileURL(path.join(SCRIPT_DIR, 'fixture-scripts.mjs')).href);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// 建真 git fixture（行级校验只在有提交历史时才会跑到；--staged 也需要 HEAD 基线）
function mkRepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tsmono-'));
  const git = (...args) => spawnSync('git', args, { cwd: d, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 't@t.io'); git('config', 'user.name', 't');
  git('config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(d, '.agents', 'scripts'), { recursive: true });
  copyScriptClosure(path.join(d, '.agents', 'scripts'), ['check-ledger-invariant.mjs']);
  return { d, git };
}
const docFile = (d, rel) => {
  const p = path.join(d, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '---\n状态: approved\n---\n# doc\n', 'utf8');
};
const row = (ts, doc, extra = {}) => JSON.stringify({
  ts, doc, stage: 'approved', fingerprint: 'a'.repeat(64), source: 'tty', ...extra,
});
const writeLedger = (d, lines) => {
  fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.jsonl'), lines.filter(Boolean).join('\n') + '\n', 'utf8');
};
const runGate = (d) => spawnSync(process.execPath, ['.agents/scripts/check-ledger-invariant.mjs'], { cwd: d, encoding: 'utf8' });

// ============ 场景 1：跨 doc 物理序 ts 乱序（并集合并形态）→ 放行 + 计数出账 ============
// a 的末行 ts 晚于 b 的首行 ts——正是「A 分支先提交、B 分支的行被并集追加到尾部」产生的形态。
{
  const { d, git } = mkRepo();
  docFile(d, 'workflow/intents/2026-10-01-a.md');
  docFile(d, 'workflow/intents/2026-10-01-b.md');
  writeLedger(d, [
    row('2026-10-10T00:00:00Z', 'workflow/intents/2026-10-01-a.md'), // 较晚
    row('2026-10-01T00:00:00Z', 'workflow/intents/2026-10-01-b.md'), // 较早，跨 doc 乱序
  ]);
  git('add', '-A'); git('commit', '-qm', 'x');
  const r = runGate(d);
  check('S1 跨 doc ts 乱序 → exit 0 放行（正常协作形态）', r.status === 0, `exit=${r.status} ${r.stderr}`);
  check('S1 乱序计数出账且标明不阻断',
    /跨 doc 物理序 ts 乱序 1 处/.test(r.stdout) && /不阻断/.test(r.stdout), r.stdout);
}

// ============ 场景 2：同 doc 内 ts 倒挂 → 仍 hard 拦（真问题未被放松）============
{
  const { d, git } = mkRepo();
  docFile(d, 'workflow/intents/2026-10-01-a.md');
  writeLedger(d, [
    row('2026-10-10T00:00:00Z', 'workflow/intents/2026-10-01-a.md'),
    row('2026-10-01T00:00:00Z', 'workflow/intents/2026-10-01-a.md'), // 同 doc 倒挂
  ]);
  git('add', '-A'); git('commit', '-qm', 'x');
  const r = runGate(d);
  check('S2 同 doc 内 ts 倒挂 → exit 1 hard 拦', r.status === 1, `exit=${r.status}`);
  check('S2 报文点名「追加时序倒挂」并带 doc',
    /追加时序倒挂/.test(r.stderr) && /2026-10-01-a/.test(r.stderr), r.stderr);
}

// ============ 场景 3：分片行纳入行级校验（分片里的坏行不能逃逸）============
{
  const { d, git } = mkRepo();
  docFile(d, 'workflow/intents/2026-10-01-a.md');
  writeLedger(d, [row('2026-10-01T00:00:00Z', 'workflow/intents/2026-10-01-a.md')]);
  // 分片里放一行 fingerprint 非 64 位 hex 的坏行——只扫主台账会漏掉它
  fs.mkdirSync(path.join(d, '.agents', 'confirmations.d'), { recursive: true });
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.d', 'x.jsonl'),
    JSON.stringify({ ts: '2026-10-02T00:00:00Z', doc: 'workflow/intents/2026-10-01-a.md', stage: 'approved', fingerprint: 'bad', source: 'tty' }) + '\n', 'utf8');
  git('add', '-A'); git('commit', '-qm', 'x');
  const r = runGate(d);
  check('S3 分片内坏行被行级校验抓到 → exit 1', r.status === 1, `exit=${r.status} ${r.stdout}`);
  check('S3 报文指出 fingerprint 非 64 位 hex', /fingerprint 非 64 位 hex/.test(r.stderr), r.stderr);
}

// ============ 场景 4：分片内 doc 不存在 → 同样被抓 ============
{
  const { d, git } = mkRepo();
  docFile(d, 'workflow/intents/2026-10-01-a.md');
  writeLedger(d, [row('2026-10-01T00:00:00Z', 'workflow/intents/2026-10-01-a.md')]);
  fs.mkdirSync(path.join(d, '.agents', 'confirmations.d'), { recursive: true });
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.d', 'y.jsonl'),
    row('2026-10-02T00:00:00Z', 'workflow/intents/2026-10-01-ghost.md') + '\n', 'utf8');
  git('add', '-A'); git('commit', '-qm', 'x');
  const r = runGate(d);
  check('S4 分片内 doc 在当前树不存在 → exit 1', r.status === 1, `exit=${r.status}`);
  check('S4 报文点名 ghost.md', /ghost\.md/.test(r.stderr), r.stderr);
}

// ============ 场景 5：豁免行号不因引入分片而漂移 ============
// 视图序 = 主台账在前、分片在后 → 主台账第 2 行的豁免登记在引入分片后仍指向同一行。
{
  const { d, git } = mkRepo();
  docFile(d, 'workflow/intents/2026-10-01-a.md');
  docFile(d, 'workflow/intents/2026-10-01-b.md');
  // 第 2 行是「doc 不存在」的坏行（须靠豁免放行）
  writeLedger(d, [
    row('2026-10-01T00:00:00Z', 'workflow/intents/2026-10-01-a.md'),
    row('2026-10-02T00:00:00Z', 'workflow/intents/2026-10-01-ghost.md'),
  ]);
  fs.writeFileSync(path.join(d, '.agents', 'ledger-line-exempt.json'),
    JSON.stringify([{ line: 2, doc: 'workflow/intents/2026-10-01-ghost.md', reason: '文档已归档' }]), 'utf8');
  git('add', '-A'); git('commit', '-qm', 'x');
  const before = runGate(d);
  check('S5 前：无分片时豁免生效 → exit 0', before.status === 0, `exit=${before.status} ${before.stderr}`);

  // 追加一个分片（视图序追加在主台账之后），豁免行号应仍指向 ghost 那行
  fs.mkdirSync(path.join(d, '.agents', 'confirmations.d'), { recursive: true });
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.d', 'z.jsonl'),
    row('2026-10-03T00:00:00Z', 'workflow/intents/2026-10-01-b.md') + '\n', 'utf8');
  git('add', '-A'); git('commit', '-qm', 'y');
  const after = runGate(d);
  check('S5 后：引入分片，豁免行号未漂移 → 仍 exit 0', after.status === 0, `exit=${after.status} ${after.stderr}`);
}

console.log(`\n[ledger-ts-monotonic.test] PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);