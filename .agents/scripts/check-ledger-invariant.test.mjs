#!/usr/bin/env node
// check-ledger-invariant.test.mjs — 台账提交不变量 fixture 套件（2026-10-02 ledger-ci-invariant）
// 真 git 仓注入：合法追加放行 / 六类篡改与行级违例检出 / --staged 双态 / 首次入库与空台账静默。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(SCRIPT_DIR, 'check-ledger-invariant.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

const HEX = 'a'.repeat(64);
const row = (o = {}) => JSON.stringify({
  ts: '2026-10-02T00:00:00.000Z', doc: 'workflow/intents/demo.md', stage: 'approved',
  fingerprint: HEX, prev: 'draft', source: 'chat-delegated', quote: '确认', ...o,
});

const G = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
const commitAll = (root, msg) => { G(root, ['add', '-A']); G(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg]); };
const run = (root, args = []) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

// mkrepo：临时真仓（workflow/intents/demo.md 在树 + 台账首行已提交）
const mkrepo = (firstRow = row()) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-inv-test-'));
  fs.mkdirSync(path.join(d, 'workflow', 'intents'), { recursive: true });
  fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(d, 'workflow', 'intents', 'demo.md'), '---\n状态: approved\n级别: L1\n日期: 2026-10-02\n模块: pipeline\n---\n# I\n');
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.jsonl'), firstRow + '\n');
  G(d, ['init', '-q']);
  G(d, ['config', 'user.email', 't@t']);
  G(d, ['config', 'user.name', 't']);
  commitAll(d, 'base ledger');
  return d;
};
const ledPath = (d) => path.join(d, '.agents', 'confirmations.jsonl');
const append = (d, line) => fs.appendFileSync(ledPath(d), line + '\n');

// S1：合法追加 ×2 → 历史全扫过
{
  const d = mkrepo();
  append(d, row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' }));
  commitAll(d, 'append 2nd');
  const r = run(d);
  check('S1 合法追加两次 → 历史全扫 exit 0', r.code === 0, r.out);
}
// S2：删历史行 → 前缀破坏拦
{
  const d = mkrepo();
  append(d, row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' }));
  commitAll(d, 'append');
  fs.writeFileSync(ledPath(d), row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' }) + '\n'); // 删首行
  commitAll(d, 'drop first row');
  const r = run(d);
  check('S2 删历史行 → 前缀破坏 exit 1', r.code === 1 && r.out.includes('前缀破坏') && r.out.includes('删减'), r.out);
}
// S3：改历史行内容 → 拦
{
  const d = mkrepo();
  append(d, row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' }));
  commitAll(d, 'append');
  const lines = fs.readFileSync(ledPath(d), 'utf8').split('\n').filter(Boolean);
  lines[0] = lines[0].replace('确认', '改成别的'); // 改首行 quote
  fs.writeFileSync(ledPath(d), lines.join('\n') + '\n');
  commitAll(d, 'rewrite first line');
  const r = run(d);
  check('S3 改历史行 → 前缀破坏 exit 1（首异偏移）', r.code === 1 && r.out.includes('改写') && r.out.includes('首异偏移'), r.out);
}
// S4：非前缀改写（截断+异内容）→ 拦
{
  const d = mkrepo();
  append(d, row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' }));
  commitAll(d, 'append');
  fs.writeFileSync(ledPath(d), row({ ts: '2027-01-01T00:00:00.000Z', quote: '另起炉灶' }) + '\n');
  commitAll(d, 'replace all');
  const r = run(d);
  check('S4 非前缀整体改写 → exit 1', r.code === 1 && r.out.includes('前缀破坏'), r.out);
}
// S5：ts 乱序追加 → 行级拦
{
  const d = mkrepo();
  append(d, row({ ts: '2026-10-01T00:00:00.000Z', stage: 'done' })); // 早于首行
  commitAll(d, 'append out-of-order');
  const r = run(d);
  check('S5 ts 非单调 → 行级 exit 1', r.code === 1 && r.out.includes('非单调'), r.out);
}
// S6：伪指纹（非 64-hex）→ 行级拦
{
  const d = mkrepo();
  append(d, row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done', fingerprint: 'zzz' }));
  commitAll(d, 'append bad fp');
  const r = run(d);
  check('S6 fingerprint 非 64-hex → 行级 exit 1', r.code === 1 && r.out.includes('64 位 hex'), r.out);
}
// S7：chat-delegated 空 quote → 行级拦
{
  const d = mkrepo();
  append(d, row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done', quote: '' }));
  commitAll(d, 'append empty quote');
  const r = run(d);
  check('S7 chat-delegated 空 quote → 行级 exit 1', r.code === 1 && r.out.includes('quote'), r.out);
}
// S8：doc 路径在树中不存在 → 行级拦
{
  const d = mkrepo();
  append(d, row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done', doc: 'workflow/intents/ghost.md' }));
  commitAll(d, 'append ghost doc');
  const r = run(d);
  check('S8 doc 当前树不存在 → 行级 exit 1', r.code === 1 && r.out.includes('不存在'), r.out);
}
// S9：--staged 合法追加 → 过
{
  const d = mkrepo();
  append(d, row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' }));
  G(d, ['add', '-A']);
  const r = run(d, ['--staged']);
  check('S9 --staged 合法追加 → exit 0', r.code === 0, r.out);
}
// S10：--staged 删历史行 → 拦
{
  const d = mkrepo();
  append(d, row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' }));
  commitAll(d, 'append');
  fs.writeFileSync(ledPath(d), row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' }) + '\n');
  G(d, ['add', '-A']);
  const r = run(d, ['--staged']);
  check('S10 --staged 删历史行 → exit 1', r.code === 1 && r.out.includes('台账重写'), r.out);
}
// S11：首次入库（无 HEAD 基线）与空台账 → 静默过
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-inv-fresh-'));
  fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
  G(d, ['init', '-q']);
  G(d, ['config', 'user.email', 't@t']);
  G(d, ['config', 'user.name', 't']);
  fs.writeFileSync(ledPath(d), row() + '\n');
  G(d, ['add', '-A']);
  const rs = run(d, ['--staged']);
  const rh = run(d);
  check('S11 首次入库（staged 无 HEAD 基线 / 历史零提交）均静默过', rs.code === 0 && rh.code === 0, `staged=${rs.out} hist=${rh.out}`);
  fs.rmSync(d, { recursive: true, force: true });
}
// S12：回退注记行（revert-draft / fingerprint n/a）合法放行
{
  const d = mkrepo(row({ ts: '2026-10-02T00:00:00.000Z', stage: 'revert-draft', fingerprint: 'n/a', prev: 'approved' }));
  const r = run(d);
  check('S12 回退注记行（n/a 指纹）→ 历史全扫过', r.code === 0, r.out);
}

console.log(`\n${fail ? `❌ ${fail} failed` : '✅ all passed'}（${pass} passed）`);
process.exit(fail ? 1 : 0);