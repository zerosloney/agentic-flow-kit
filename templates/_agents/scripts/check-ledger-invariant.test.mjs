#!/usr/bin/env node
// check-ledger-invariant.test.mjs — 台账提交不变量 fixture 套件（2026-10-02 ledger-ci-invariant）
// 真 git 仓注入：合法追加放行 / 六类篡改与行级违例检出 / --staged 双态 / 首次入库与空台账静默。
// 2026-10-13 深水批次并集：分片 H 系 / 特许修剪 P 系 / 归档感知 A 系 / 合并并集与合并审计 M 系
// （M6 合并收口删片·首父盲区 / M7 借收口抹账 / M8 补登追认·语义身份）/ 历史基线 B1——
// 场景自实战实现同名套件移植，判据适配处见各场景注释。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(SCRIPT_DIR, 'check-ledger-invariant.mjs');
const PRUNE_REL = '.agents/ledger-prune-manifest.json'; // 与脚本单源（ledger-prune.mjs）同路径

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
const run = (root, args = [], env = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
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

// ---- 分片台账夹具（追加合法 / 改写硬拦 / 归并后删片合法 / 未归并存片硬拦）----
// 夹具注意：分片行的 doc 必须在树上有对应文件，否则行级校验「doc 不存在」会盖过被测判据。
const shardDirOf = (d) => path.join(d, '.agents', 'confirmations.d');
const mkDoc = (d, name) => fs.writeFileSync(path.join(d, 'workflow', 'intents', `${name}.md`), `---\n状态: approved\n级别: L1\n日期: 2026-10-02\n模块: pipeline\n---\n# ${name}\n`);
const shardWrite = (d, name, rows) => {
  fs.mkdirSync(shardDirOf(d), { recursive: true });
  fs.writeFileSync(path.join(shardDirOf(d), `${name}.jsonl`), rows.join('\n') + '\n');
};
// 特许修剪夹具
const sha256Of = (s) => spawnSync(process.execPath, ['-e', `console.log(require('crypto').createHash('sha256').update(process.argv[1],'utf8').digest('hex'))`, s], { encoding: 'utf8' }).stdout.trim();
const manifestPath = (d) => path.join(d, ...PRUNE_REL.split('/'));
const writeManifest = (d, obj) => { fs.mkdirSync(path.dirname(manifestPath(d)), { recursive: true }); fs.writeFileSync(manifestPath(d), JSON.stringify(obj, null, 2) + '\n'); };

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
  // S5：ts 乱序追加 → 行级拦。措辞随 2026-10-12 口径修正由「非单调」改为「追加时序倒挂」
  // （判据从「全表非降序」收窄为「同 doc 内非降序」，跨 doc 乱序是并集合并的正常形态）。
  // 本例两行同 doc（demo.md），故仍在新口径下 hard 拦。
  check('S5 ts 非单调（同 doc 内倒挂）→ 行级 exit 1',
    r.code === 1 && r.out.includes('追加时序倒挂'), r.out);
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

// ---- 豁免登记（2026-10-09 ledger-line-exempt，CI 红事故处置）----
{
  // 坏行（fingerprint 非 hex + doc 不存在）→ 红；登记豁免 → 绿 + 计数可见
  const d = mkrepo(row({ fingerprint: 'probe-fp', doc: 'workflow/intents/ghost.md' }));
  let r = run(d);
  check('豁免前：行级坏行 hard（fingerprint/doc 双违规）', r.code === 1 && r.out.includes('行级'), r.out.slice(0, 200));
  fs.writeFileSync(path.join(d, '.agents', 'ledger-line-exempt.json'), JSON.stringify([{ line: 1, doc: 'workflow/intents/ghost.md', reason: '事故定性' }], null, 2));
  r = run(d);
  check('豁免后：exit 0 且计数可见', r.code === 0 && r.out.includes('台账豁免行 1 条'), r.out.slice(0, 200));
  // 行号错位豁免不生效（line=99 无对应坏行）
  fs.writeFileSync(path.join(d, '.agents', 'ledger-line-exempt.json'), JSON.stringify([{ line: 99, reason: '错位' }]));
  r = run(d);
  check('豁免行号不匹配：仍 hard（精确豁免）', r.code === 1, r.out.slice(0, 150));
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- S13-S17：--staged 分片触发面（2026-10-13 ledger-shard-default：分片为默认写入口径，触发面扩大）----
{
  const d = mkrepo();
  const shardDir = path.join(d, '.agents', 'confirmations.d');
  fs.mkdirSync(shardDir, { recursive: true });
  const shardP = path.join(shardDir, 'demo.jsonl');
  fs.writeFileSync(shardP, row({ ts: '2026-10-02T02:00:00.000Z', stage: 'done' }) + '\n');
  G(d, ['add', '-A']);
  let r = run(d, ['--staged']);
  check('S13 --staged 新分片首入库（无 HEAD 基线）→ exit 0', r.code === 0, r.out);
  commitAll(d, 'shard base');
  r = run(d);
  check('S13 分片入库后历史全扫 exit 0（分片历史干净）', r.code === 0, r.out);

  // S14：分片纯追加 → --staged 放行
  fs.appendFileSync(shardP, row({ ts: '2026-10-02T03:00:00.000Z', stage: 'done' }) + '\n');
  G(d, ['add', '-A']);
  r = run(d, ['--staged']);
  check('S14 --staged 分片纯追加 → exit 0', r.code === 0, r.out);
  commitAll(d, 'shard append');

  // S15：分片重写 → --staged 拦（分片同受 append-only 前缀不变量约束）
  const lines = fs.readFileSync(shardP, 'utf8').split('\n').filter(Boolean);
  lines[0] = lines[0].replace('确认', '篡改后');
  fs.writeFileSync(shardP, lines.join('\n') + '\n');
  G(d, ['add', '-A']);
  r = run(d, ['--staged']);
  check('S15 --staged 分片重写 → exit 1（报文点名分片重写）', r.code === 1 && r.out.includes('分片重写'), r.out);
  G(d, ['checkout', 'HEAD', '--', '.agents/confirmations.d/demo.jsonl']); // 还原到 HEAD 基线

  // S16：compact 归并删分片（分片行全部并入暂存主台账）→ --staged 放行
  fs.appendFileSync(ledPath(d), fs.readFileSync(shardP, 'utf8'));
  fs.rmSync(shardP);
  G(d, ['add', '-A']);
  r = run(d, ['--staged']);
  check('S16 --staged compact 归并删分片（行全并入暂存主台账）→ exit 0', r.code === 0, r.out);
  commitAll(d, 'compact merge');

  // S17：未并入即删分片（丢行）→ --staged 拦
  fs.writeFileSync(shardP, row({ ts: '2026-10-02T04:00:00.000Z', stage: 'done' }) + '\n');
  G(d, ['add', '-A']);
  commitAll(d, 'shard again');
  fs.rmSync(shardP);
  G(d, ['add', '-A']);
  r = run(d, ['--staged']);
  check('S17 --staged 未并入即删分片 → exit 1（报文点名分片删除丢行）', r.code === 1 && r.out.includes('分片删除丢行'), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- 分片台账不变量（2026-10-12 ledger-shard-write 实战套件移植）：----
// H1：分片合法追加 ×2 → 历史全扫过（跨端确认不同 doc 写不同分片，互不干扰）
// H2：分片删历史行 → 前缀破坏硬拦（--staged 与历史全扫双态）
// H3：分片归并后删除（compact-ledgers 形态：全部行已逐字进主台账）→ 合法且 loud 记录
// H4：分片删除但行未进主台账（抹账）→ 硬拦
// H5：主台账删除仍恒拦（分片的合法删除形态不外溢到主台账）
// H6：分片行级违例（ts 乱序）在分片自身被检出，不因主台账无恙而漏
//     （判据适配：kit 行级 ts 口径为「同 doc 内非降序」，报文措辞「追加时序倒挂」——见脚本头注①）
{
  const d = mkrepo();
  mkDoc(d, 'a');
  shardWrite(d, 'doc-a', [row({ ts: '2026-10-02T01:00:00.000Z', doc: 'workflow/intents/a.md' })]);
  commitAll(d, 'shard doc-a v1');
  fs.appendFileSync(path.join(shardDirOf(d), 'doc-a.jsonl'), row({ ts: '2026-10-02T02:00:00.000Z', stage: 'done', doc: 'workflow/intents/a.md' }) + '\n');
  commitAll(d, 'shard doc-a v2');
  const r = run(d);
  check('H1 分片合法追加两次 → 历史全扫 exit 0', r.code === 0, r.out);
  fs.rmSync(d, { recursive: true, force: true });
}
{
  const d = mkrepo();
  mkDoc(d, 'b');
  shardWrite(d, 'doc-b', [
    row({ ts: '2026-10-02T01:00:00.000Z', doc: 'workflow/intents/b.md' }),
    row({ ts: '2026-10-02T02:00:00.000Z', stage: 'done', doc: 'workflow/intents/b.md' }),
  ]);
  commitAll(d, 'shard doc-b v1');
  shardWrite(d, 'doc-b', [row({ ts: '2026-10-02T01:00:00.000Z', doc: 'workflow/intents/b.md' })]); // 删第二行
  G(d, ['add', '-A']);
  const rs = run(d, ['--staged']);
  check('H2a 分片删历史行 → --staged 前缀破坏 exit 1', rs.code === 1 && /分片重写|台账重写/.test(rs.out) && /doc-b\.jsonl/.test(rs.out), rs.out);
  commitAll(d, 'shard doc-b tampered');
  const rh = run(d);
  check('H2b 分片删历史行 → 历史全扫 exit 1 且点名分片', rh.code === 1 && /confirmations\.d\/doc-b\.jsonl/.test(rh.out), rh.out);
  fs.rmSync(d, { recursive: true, force: true });
}
{
  const d = mkrepo();
  mkDoc(d, 'c');
  const s1 = row({ ts: '2026-10-02T01:00:00.000Z', doc: 'workflow/intents/c.md' });
  const s2 = row({ ts: '2026-10-02T02:00:00.000Z', stage: 'done', doc: 'workflow/intents/c.md' });
  shardWrite(d, 'doc-c', [s1, s2]);
  commitAll(d, 'shard doc-c');
  // 归并：分片两行原样追加进主台账，再删分片（compact-ledgers.mjs 的真实动作序列）
  append(d, s1); append(d, s2);
  fs.rmSync(path.join(shardDirOf(d), 'doc-c.jsonl'));
  commitAll(d, 'compact doc-c into main');
  const r = run(d);
  check('H3 分片归并后删除 → exit 0 且 loud 记录「归并后删除」', r.code === 0 && /归并后删除/.test(r.out), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}
{
  const d = mkrepo();
  mkDoc(d, 'e');
  const s1 = row({ ts: '2026-10-02T01:00:00.000Z', doc: 'workflow/intents/e.md' });
  shardWrite(d, 'doc-e', [s1]);
  commitAll(d, 'shard doc-e');
  fs.rmSync(path.join(shardDirOf(d), 'doc-e.jsonl')); // 直接删，不归并
  commitAll(d, 'delete shard without merge');
  const r = run(d);
  check('H4 分片删除而行未归并主台账 → hard 拦「分片删除」', r.code === 1 && /分片删除/.test(r.out) && /不在同提交主台账内/.test(r.out), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}
{
  const d = mkrepo();
  fs.rmSync(ledPath(d));
  commitAll(d, 'delete main ledger');
  const r = run(d);
  check('H5 主台账删除 → 恒 hard 拦「台账删除」', r.code === 1 && /台账删除/.test(r.out), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}
{
  const d = mkrepo();
  mkDoc(d, 'f');
  shardWrite(d, 'doc-f', [
    row({ ts: '2026-10-02T05:00:00.000Z', doc: 'workflow/intents/f.md' }),
    row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done', doc: 'workflow/intents/f.md' }), // 早于前行
  ]);
  commitAll(d, 'shard doc-f out-of-order');
  const r = run(d);
  check('H6 分片内 ts 倒挂 → 行级拦且点名分片', r.code === 1 && /追加时序倒挂/.test(r.out) && /doc-f\.jsonl/.test(r.out), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- 特许修剪（2026-10-09 user-directed-prune）：manifest 逐行对账 ----
// P1：--staged 特许修剪——删中段行 + manifest 恰对账 → 放行
{
  const r2 = row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done', doc: 'workflow/intents/gone.md' });
  const r3 = row({ ts: '2026-10-02T02:00:00.000Z', stage: 'done' });
  const d = mkrepo();
  append(d, r2); append(d, r3); commitAll(d, '3 rows');
  fs.writeFileSync(ledPath(d), [row(), r3].join('\n') + '\n'); // 删 r2
  writeManifest(d, { ts: '2026-10-09T00:00:00.000Z', authority: 'test', reason: 'test prune', removes: [sha256Of(r2)], docs: ['gone'] });
  G(d, ['add', '-A']);
  const r = run(d, ['--staged']);
  check('P1 --staged 特许修剪 manifest 对账 → exit 0 且 loud 记录', r.code === 0 && /特许修剪通过/.test(r.out) && /1 行/.test(r.out), r.out);
  commitAll(d, 'sanctioned prune');
  const rh = run(d);
  check('P1b 历史全扫认领同一修剪 → exit 0', rh.code === 0, rh.out);
  fs.rmSync(d, { recursive: true, force: true });
}
// P2：--staged 删行但 manifest 哈希不对（对账失败）→ 拦
{
  const r2 = row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done', doc: 'workflow/intents/gone.md' });
  const d = mkrepo();
  append(d, r2); commitAll(d, '2 rows');
  fs.writeFileSync(ledPath(d), row() + '\n');
  writeManifest(d, { ts: '2026-10-09T00:00:00.000Z', authority: 'test', reason: 'x', removes: ['f'.repeat(64)], docs: ['gone'] });
  G(d, ['add', '-A']);
  const r = run(d, ['--staged']);
  check('P2 manifest 哈希不命中 → exit 1 且报对账失败', r.code === 1 && r.out.includes('特许修剪对账失败'), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}
// P3：--staged 删行且无 manifest → 仍拦（append-only 红线对未授权场景不变）
{
  const r2 = row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done', doc: 'workflow/intents/gone.md' });
  const d = mkrepo();
  append(d, r2); commitAll(d, '2 rows');
  fs.writeFileSync(ledPath(d), row() + '\n');
  G(d, ['add', '-A']);
  const r = run(d, ['--staged']);
  check('P3 无 manifest 删行 → exit 1（S10 语义回归）', r.code === 1 && r.out.includes('台账重写'), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}
// P4：manifest 在场但删了 manifest 之外的行（夹带私删）→ 拦
{
  const r2 = row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done', doc: 'workflow/intents/gone.md' });
  const r3 = row({ ts: '2026-10-02T02:00:00.000Z', stage: 'done', doc: 'workflow/intents/sneak.md' });
  const d = mkrepo();
  append(d, r2); append(d, r3); commitAll(d, '3 rows');
  fs.writeFileSync(ledPath(d), [row(), r3].join('\n') + '\n'); // 删 r2；r3 保留
  writeManifest(d, { ts: '2026-10-09T00:00:00.000Z', authority: 't', reason: 'x', removes: [sha256Of(r2), sha256Of(r3)], docs: ['gone', 'sneak'] }); // 多报一行
  G(d, ['add', '-A']);
  const r = run(d, ['--staged']);
  check('P4 manifest 多报（哈希命中 1 ≠ 声明 2）→ exit 1', r.code === 1 && r.out.includes('特许修剪对账失败'), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- ④ 归档感知（2026-10-13 archive-aware-doc）：关单即归档移动文件后行仍指向真实文档 ----
// A1：行指向归档批次中的文档 → 放行；A2：行指向真消失文档（四目录与归档批次均无）→ 拦且报新口径
{
  const d = mkrepo();
  fs.mkdirSync(path.join(d, 'workflow', 'archive', '2026-10', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(d, 'workflow', 'archive', '2026-10', 'plans', 'archived.md'), '---\n状态: done\n---\n# A\n');
  append(d, row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done', doc: 'workflow/plans/archived.md' }));
  commitAll(d, 'append archived-doc row');
  const r = run(d);
  check('A1 doc 已归档（archive/2026-10/plans）→ 行级放行 exit 0', r.code === 0, r.out);
  fs.rmSync(d, { recursive: true, force: true });
}
{
  const d = mkrepo();
  append(d, row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done', doc: 'workflow/plans/vanished.md' }));
  commitAll(d, 'append vanished-doc row');
  const r = run(d);
  check('A2 doc 真消失（无归档批次命中）→ 拦且报「归档批次均未命中」', r.code === 1 && r.out.includes('归档批次均未命中'), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- 合并并集语义（2026-10-13 merge-union-aware）：多父提交按「并集无丢失」判 ----
// M1：两侧各追加一行，合并结果 = 三行之并 → union 认可、全扫过
// M2：合并结果丢掉一侧的行 → 拦且报「合并丢失」
const mkMergeRepo = () => {
  const d = mkrepo();
  const BR = G(d, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  const r2 = row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' });
  const r3 = row({ ts: '2026-10-02T02:00:00.000Z', stage: 'fixed' });
  G(d, ['checkout', '-qb', 'br']);
  append(d, r2); commitAll(d, 'br append r2');
  G(d, ['checkout', '-q', BR]);
  append(d, r3); commitAll(d, 'main append r3');
  G(d, ['merge', '--no-commit', 'br']); // 冲突（双改同文件）——预期非零，手工写并集
  return { d, r2, r3 };
};
{
  const { d, r2, r3 } = mkMergeRepo();
  fs.writeFileSync(ledPath(d), [row(), r2, r3].join('\n') + '\n'); // union 结果
  commitAll(d, 'merge union');
  const r = run(d);
  check('M1 合并=父母行集之并 → union 认可 exit 0', r.code === 0 && /union 合并语义认可/.test(r.out), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}
{
  const { d, r2 } = mkMergeRepo();
  fs.writeFileSync(ledPath(d), [row(), r2].join('\n') + '\n'); // 丢了 main 侧 r3
  commitAll(d, 'merge losing main-side line');
  const r = run(d);
  check('M2 合并丢行 → exit 1 且报「合并丢失」', r.code === 1 && r.out.includes('合并丢失'), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- 合并审计加固（复核②实修回归）：ours 丢行 / 合并携带修剪 / 凭空造行 ----
// M3：-X ours 合并静默丢 br 侧行（合并树与第一父同 blob，前缀通过）→ union 无条件对账必须拦
{
  const d = mkrepo();
  const BR = G(d, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  const r2 = row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' });
  G(d, ['checkout', '-qb', 'br']);
  append(d, r2); commitAll(d, 'br append r2');
  G(d, ['checkout', '-q', BR]);
  const rM3 = row({ ts: '2026-10-02T02:00:00.000Z', stage: 'fixed' });
  append(d, rM3); commitAll(d, 'main append r3');
  G(d, ['merge', '-X', 'ours', '-q', 'br', '-m', 'ours merge drops br line']); // 树=第一父，r2 静默消失
  const r = run(d);
  check('M3 ours 合并静默丢行 → exit 1 且报「合并丢失」', r.code === 1 && r.out.includes('合并丢失'), r.out.slice(-300));
  fs.rmSync(d, { recursive: true, force: true });
}
// M4：合并丢弃父母并集中的行 + manifest——(a) 诚实全量申报（对父母并集）→ 放行；(b) 只报第一父相对差集（p2 独有行无凭据消失）→ 拦
{
  const d = mkrepo();
  const BR = G(d, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  const r2 = row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' });
  const r3 = row({ ts: '2026-10-02T02:00:00.000Z', stage: 'fixed' });
  G(d, ['checkout', '-qb', 'br']);
  append(d, r2); commitAll(d, 'br r2');
  G(d, ['checkout', '-q', BR]);
  append(d, r3); commitAll(d, 'main r3');
  G(d, ['merge', '--no-commit', 'br']);
  fs.writeFileSync(ledPath(d), row() + '\n'); // r2、r3 全丢
  writeManifest(d, { ts: '2026-10-13T00:00:00.000Z', authority: 't', reason: 'honest full prune', removes: [sha256Of(r2), sha256Of(r3)], docs: ['demo', 'demo'] });
  commitAll(d, 'merge with honest full manifest');
  const r = run(d);
  check('M4a 合并丢双侧行+诚实全量 manifest → 集合对账放行 exit 0', r.code === 0 && /合并携带特许修剪/.test(r.out), r.out.slice(-300));
  fs.rmSync(d, { recursive: true, force: true });
}
{
  const d = mkrepo();
  const BR = G(d, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  const r2 = row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' });
  const r3 = row({ ts: '2026-10-02T02:00:00.000Z', stage: 'fixed' });
  G(d, ['checkout', '-qb', 'br']);
  append(d, r2); commitAll(d, 'br r2');
  G(d, ['checkout', '-q', BR]);
  append(d, r3); commitAll(d, 'main r3');
  G(d, ['merge', '--no-commit', 'br']);
  fs.writeFileSync(ledPath(d), row() + '\n'); // r2、r3 全丢
  writeManifest(d, { ts: '2026-10-13T00:00:00.000Z', authority: 't', reason: 'p1-relative partial', removes: [sha256Of(r3)], docs: ['demo'] }); // 只报 main 侧，br 的 r2 无凭据消失
  commitAll(d, 'merge with partial manifest');
  const r = run(d);
  check('M4b 合并丢行+部分 manifest（p2 行无凭据）→ exit 1', r.code === 1 && /修剪集合对账/.test(r.out), r.out.slice(-300));
  fs.rmSync(d, { recursive: true, force: true });
}
// M5：合并凭空多出父母都没有的行 → 拦
{
  const d = mkrepo();
  const BR = G(d, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  const r2 = row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' });
  const r3 = row({ ts: '2026-10-02T02:00:00.000Z', stage: 'fixed' });
  G(d, ['checkout', '-qb', 'br']);
  append(d, r2); commitAll(d, 'br r2');
  G(d, ['checkout', '-q', BR]);
  append(d, r3); commitAll(d, 'main r3'); // 双侧分叉，保证是真合并而非 fast-forward
  G(d, ['merge', '--no-commit', 'br']);
  append(d, row({ ts: '2026-10-02T09:00:00.000Z', quote: '凭空造行' }));
  commitAll(d, 'merge with fabricated line');
  const r = run(d);
  check('M5 合并凭空多出行 → exit 1 且报「凭空多出」', r.code === 1 && r.out.includes('凭空多出'), r.out.slice(-300));
  fs.rmSync(d, { recursive: true, force: true });
}
// M6：合并收口删片（首父侧早已归并删片、分片仅第二父仍持有）→ 各父并集对账认可
// （合并感知删片①：单读首父只看一侧会把合法收口误判成「增删同提交」——首父盲区形态）
// 形态：A 首父侧建分片 → B 首父侧归并删片 → br（第二父，模拟他端未同步修剪）仍持分片并
//   独立追加主台账 → 真合并，分片按首父态在结果中缺席、主台账取父母并集。
{
  const d = mkrepo();
  mkDoc(d, 'm');
  const s1 = row({ ts: '2026-10-02T01:00:00.000Z', doc: 'workflow/intents/m.md' });
  const r2 = row({ ts: '2026-10-02T02:00:00.000Z', stage: 'done' });
  const r9 = row({ ts: '2026-10-02T03:00:00.000Z', stage: 'fixed' });
  shardWrite(d, 'doc-m', [s1]);
  commitAll(d, 'A main create shard doc-m');
  const BR = G(d, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  G(d, ['checkout', '-qb', 'br']); // br 自 A 分叉：仍持有分片（他端未做归并）
  append(d, r2);
  commitAll(d, 'C br append r2 (shard still present)');
  G(d, ['checkout', '-q', BR]);
  append(d, s1); // B 首父侧归并：行进主台账后删片（compact-ledgers 动作序列）
  fs.rmSync(path.join(shardDirOf(d), 'doc-m.jsonl'));
  commitAll(d, 'B main compact doc-m (append row then drop shard)');
  append(d, r9);
  commitAll(d, 'D main unrelated append');
  G(d, ['merge', '--no-commit', 'br']); // 主台账双侧追加 → 冲突，手工写并集；分片呈删除态（delete/modify 自动取删除）
  fs.writeFileSync(ledPath(d), [row(), s1, r2, r9].join('\n') + '\n');
  commitAll(d, 'merge: ledger union + shard stays dropped');
  const r = run(d);
  check('M6 合并收口删片（分片仅第二父有）→ 各父并集对账认可 exit 0', r.code === 0 && /归并后删除/.test(r.out), r.out.slice(-400));
  fs.rmSync(d, { recursive: true, force: true });
}
// M7：合并收口删片而行未归并主台账（借合并收口抹账）→ 硬拦
{
  const d = mkrepo();
  mkDoc(d, 'n');
  const s1 = row({ ts: '2026-10-02T01:00:00.000Z', doc: 'workflow/intents/n.md' });
  const r2 = row({ ts: '2026-10-02T02:00:00.000Z', stage: 'done' });
  const r9 = row({ ts: '2026-10-02T03:00:00.000Z', stage: 'fixed' });
  shardWrite(d, 'doc-n', [s1]);
  commitAll(d, 'A main create shard doc-n');
  const BR = G(d, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  G(d, ['checkout', '-qb', 'br']);
  append(d, r2);
  commitAll(d, 'C br append r2 (shard still present, rows never in main ledger)');
  G(d, ['checkout', '-q', BR]);
  append(d, r9); // 首父侧【不归并】直接独立推进
  commitAll(d, 'D main unrelated append (no compaction)');
  G(d, ['merge', '--no-commit', 'br']);
  fs.writeFileSync(ledPath(d), [row(), r2, r9].join('\n') + '\n'); // 并集无 s1——分片行从未进主台账
  fs.rmSync(path.join(shardDirOf(d), 'doc-n.jsonl')); // 合并解析把分片一并丢弃 → 借收口抹账
  commitAll(d, 'merge: drop shard without compaction');
  const r = run(d);
  check('M7 合并收口删片未归并 → exit 1 且报「分片删除」', r.code === 1 && /分片删除/.test(r.out) && /不在同提交主台账内/.test(r.out), r.out.slice(-400));
  fs.rmSync(d, { recursive: true, force: true });
}
// M8：合并删片缺行但终树已补登（merge-shard-restore-aware）→ 丢失追认 exit 0 且 loud
// 形态：br 侧分片多出 s2 未归并主台账，合并解析删片（s2 丢失）→ 后续提交把 s2 以补偿形态
//   （ts 改现时刻 + note 引原 ts，doc/stage/fingerprint 沿原行）回append进主台账 → 语义身份比对追认。
{
  const d = mkrepo();
  mkDoc(d, 'p');
  mkDoc(d, 'p2');
  const s1 = row({ ts: '2026-10-02T01:00:00.000Z', doc: 'workflow/intents/p.md' });
  const s2 = row({ ts: '2026-10-02T04:00:00.000Z', doc: 'workflow/intents/p2.md' });
  const r2 = row({ ts: '2026-10-02T02:00:00.000Z', stage: 'done' });
  const r9 = row({ ts: '2026-10-02T03:00:00.000Z', stage: 'fixed' });
  shardWrite(d, 'doc-p', [s1]);
  commitAll(d, 'A main create shard doc-p');
  const BR = G(d, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  G(d, ['checkout', '-qb', 'br']);
  append(d, r2);
  fs.appendFileSync(path.join(shardDirOf(d), 'doc-p.jsonl'), s2 + '\n'); // br 侧分片多出 s2（未归并）
  commitAll(d, 'C br append r2 + shard gains s2 (not compacted)');
  G(d, ['checkout', '-q', BR]);
  append(d, s1); // 首父侧归并 s1 后删片
  fs.rmSync(path.join(shardDirOf(d), 'doc-p.jsonl'));
  commitAll(d, 'B main compact s1 + drop shard');
  append(d, r9);
  commitAll(d, 'D main unrelated append');
  G(d, ['merge', '--no-commit', 'br']);
  fs.writeFileSync(ledPath(d), [row(), s1, r2, r9].join('\n') + '\n'); // 并集（无 s2——s2 在合并中丢失）
  fs.rmSync(path.join(shardDirOf(d), 'doc-p.jsonl')); // 合并解析按首父态删片
  commitAll(d, 'merge: s2 lost by shard drop');
  const s2c = JSON.stringify({ ...JSON.parse(s2), ts: '2026-10-02T05:00:00.000Z', note: '补偿行：原行 ts 2026-10-02T04:00:00.000Z 合并丢失后补登' });
  append(d, s2c); // 终树补登：s2 以**补偿形态**回append（doc/stage/fingerprint 沿原行）
  commitAll(d, 'E restore lost s2 into main ledger (compensation form)');
  const r = run(d);
  check('M8 合并删片缺行终树已补登（补偿形态，语义身份比对）→ 丢失追认 exit 0', r.code === 0 && /补登/.test(r.out) && /丢失追认/.test(r.out), r.out.slice(-400));
  fs.rmSync(d, { recursive: true, force: true });
}

// M12（2026-10-16 自源仓 13f67ef7 回灌补夹具）：合并态 --staged 删掉两父母共有行（不在 manifest
// removes 里）→ 仍拦。共享行被删是 union 语义下的真丢失——manifest 只申报了分支侧行，共有行无凭据消失。
const mkMergePruneRepo = () => {
  const d = mkrepo();
  const BR = G(d, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  const r2 = row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done', doc: 'workflow/intents/gone.md' });
  const comp = row({ ts: '2026-10-13T00:00:00.000Z', stage: 'done', note: '补偿行：doc 仍在' });
  append(d, r2); commitAll(d, 'main r2');
  G(d, ['checkout', '-qb', 'br']);
  fs.writeFileSync(ledPath(d), [row(), comp].join('\n') + '\n');
  writeManifest(d, { ts: '2026-10-13T00:00:00.000Z', authority: 't', reason: 'branch prune', removes: [sha256Of(r2)], docs: ['gone'] });
  commitAll(d, 'br prune + compensation');
  G(d, ['checkout', '-q', BR]);
  fs.writeFileSync(path.join(d, 'other.txt'), 'x');
  commitAll(d, 'main unrelated change');
  G(d, ['merge', '--no-commit', 'br']);
  return { d, r2, comp };
};
{
  const { d, comp } = mkMergePruneRepo();
  fs.writeFileSync(ledPath(d), comp + '\n'); // 双父共有行 row() 被删，comp 也不在 removes 内
  G(d, ['add', '-A']);
  const r = run(d, ['--staged']);
  check('M12 合并态 --staged 删双父共有行 → exit 1',
    r.code === 1 && /合并仍丢失 manifest 外/.test(r.out), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}

// ---- 历史基线（2026-10-13 ledger-history-baseline）：owner 声明豁免前基线时代 ----
// B1：前基线改写无凭据——无基线全史扫描拦；LEDGER_HISTORY_BASELINE 指到 HEAD 后豁免过
//     （kit 缺省无基线 = 全量扫描，与源实现「缺省基线指向自身仓提交、外来仓退化为全扫」同语义）
{
  const d = mkrepo();
  append(d, row({ ts: '2026-10-02T01:00:00.000Z', stage: 'done' }));
  commitAll(d, 'append');
  fs.writeFileSync(ledPath(d), row({ ts: '2026-10-02T02:00:00.000Z', quote: '改写' }) + '\n'); // 非 append 改写，无 manifest
  commitAll(d, 'rewrite pre-baseline');
  const head = G(d, ['rev-parse', 'HEAD']).stdout.trim();
  const rNoBase = run(d); // kit 缺省无基线 → 全史扫描拦
  const rBase = run(d, [], { LEDGER_HISTORY_BASELINE: head });
  check('B1 历史基线：无基线改写拦 / 基线=HEAD 豁免过且 loud', rNoBase.code === 1 && rBase.code === 0 && /豁免/.test(rBase.out), `noBase=${rNoBase.out.slice(-200)} base=${rBase.out.slice(-200)}`);
  fs.rmSync(d, { recursive: true, force: true });
}

console.log(`\n${fail ? `❌ ${fail} failed` : '✅ all passed'}（${pass} passed）`);
process.exit(fail ? 1 : 0);
