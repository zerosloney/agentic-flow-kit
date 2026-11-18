import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { computeFingerprint, applyTransition } from '../templates/engine/.agents/scripts/confirm-doc.mjs';
import { funnelFromLedger } from '../templates/engine/.agents/scripts/metrics-core.mjs';

// policyVersion 台账字段（BACKLOG 33，2026-11-18）：confirm-doc 每条新台账行携带确认时刻的
// kit 规范版本（单源 policy.mjs loadKitPolicy：装户 engine.json 的 policyVersion，缺失/不在表内
// 回退 1）。本文件锁定：① 新字段存在且值正确（engine.json 在场/缺失两态）；② 向前兼容——
// 存量无字段行与新行共存时 s15 指纹配对照常、metrics 生成结果不变。

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const SCRIPTS = path.join(KIT, 'templates', 'engine', '.agents', 'scripts');
const ENUMS_SRC = path.join(KIT, 'templates', 'engine', '.agents', 'config', 'workflow-enums.txt');

function tmpRoot() {
  const dir = makeTmp('fk-confirm-policyver-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

function writeDoc(root, rel, status = 'draft') {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\n状态: ${status}\n级别: L1\n日期: 2026-11-18\n---\n# PLAN — demo\n\n## 入口\n- 来源：工单\n- 目标：验证 policyVersion 落账\n`);
  return abs;
}

function readLedger(root) {
  const shardDir = path.join(root, '.agents', 'confirmations.d');
  const rows = [];
  const main = path.join(root, '.agents', 'confirmations.jsonl');
  if (fs.existsSync(main)) {
    for (const line of fs.readFileSync(main, 'utf8').split(/\r?\n/)) {
      if (line.trim()) rows.push(JSON.parse(line));
    }
  }
  if (fs.existsSync(shardDir)) {
    for (const f of fs.readdirSync(shardDir)) {
      for (const line of fs.readFileSync(path.join(shardDir, f), 'utf8').split(/\r?\n/)) {
        if (line.trim()) rows.push(JSON.parse(line));
      }
    }
  }
  return rows;
}

// runS15(root)：以 CHECK_LOOP_ROOT 指向夹具根起子进程跑 check-loop 15（确认指纹对账）实段，
// 回传该段的 {blockers, warnings}。夹具契约：.agents/config/workflow-enums.txt（缺即 fail-loud，
// 从 kit 自有单源复制）。s15 的配对判据是 doc/stage/fingerprint 三键——本测试用它证「旧行无
// policyVersion 不判红、新旧行共存照常配对」。
function runS15(root) {
  const script = `
import { pathToFileURL } from 'node:url';
const base = pathToFileURL(process.env.S15_SCRIPTS).href + '/';
const kit = await import(base + 'check-loop-kit.mjs');
const s15 = await import(base + 'check-loop-sections/s15-fingerprint.mjs');
s15.run();
process.stdout.write(JSON.stringify({ blockers: kit.blockers, warnings: kit.warnings }));
`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, CHECK_LOOP_ROOT: root, S15_SCRIPTS: SCRIPTS },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

test('new ledger rows carry policyVersion from installed engine.json', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'config', 'engine.json'), JSON.stringify({ policyVersion: 3 }));
  const rel = 'workflow/tasks/2026-11-18-demo/plan.md';
  writeDoc(root, rel);
  const r = run(['run', 'confirm-doc.mjs', '--', rel, '--delegated', '原话：就按这个计划做', '--root', root], root);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const rows = readLedger(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].policyVersion, 3);
});

test('missing engine.json falls back to policyVersion 1', () => {
  const root = tmpRoot(); // 无 .agents/config/engine.json——装户裸仓库形态
  const rel = 'workflow/tasks/2026-11-18-demo/plan.md';
  writeDoc(root, rel);
  const r = run(['run', 'confirm-doc.mjs', '--', rel, '--delegated', '原话：就按这个计划做', '--root', root], root);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const rows = readLedger(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].policyVersion, 1);
});

test('old rows without policyVersion keep pairing in s15 alongside new rows', () => {
  const root = tmpRoot();
  // 夹具契约件：枚举单源（check-loop-kit 模块加载即 fail-loud 校验）
  fs.mkdirSync(path.join(root, '.agents', 'config'), { recursive: true });
  fs.copyFileSync(ENUMS_SRC, path.join(root, '.agents', 'config', 'workflow-enums.txt'));
  // 文档 A：手工按「存量 schema」构造——旧行无 policyVersion/commit 字段（BACKLOG 33 之前形态）
  const relA = 'workflow/intents/2026-11-18-old.md';
  writeDoc(root, relA);
  const textA = fs.readFileSync(path.join(root, relA), 'utf8');
  const fpA = computeFingerprint(textA);
  fs.writeFileSync(path.join(root, relA), applyTransition(textA, 'approved', fpA.slice(0, 16)));
  const oldRow = {
    ts: '2026-11-18T00:00:00.000Z', doc: relA, stage: 'approved', fingerprint: fpA, prev: 'draft',
    source: 'tty', batch: 'c0ffee', seq: 1, of: 1, // 无 policyVersion、无 commit——与存量行同构
  };
  fs.mkdirSync(path.join(root, '.agents', 'confirmations.d'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'confirmations.d', '2026-11-18-old.jsonl'), `${JSON.stringify(oldRow)}\n`);
  // 文档 B：走真实 confirm-doc 落新行（带 policyVersion）
  const relB = 'workflow/intents/2026-11-18-new.md';
  writeDoc(root, relB);
  const r = run(['run', 'confirm-doc.mjs', '--', relB, '--delegated', '原话：就按这个新档确认', '--root', root], root);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);

  const rows = readLedger(root);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((e) => e.doc === relA).policyVersion, undefined); // 旧行未被改写
  assert.equal(typeof rows.find((e) => e.doc === relB).policyVersion, 'number'); // 新行带字段

  // s15 全量对账（CHECK_LOOP_ROOT=夹具根 → 全量扫描面）：新旧行都须配对成功，零 blocker
  const pass = runS15(root);
  assert.deepEqual(pass.blockers, [], `s15 blockers: ${pass.blockers.join('\n')}`);

  // 负例控制：破坏 B 的确认指纹 → 配对必断（证明上面的零 blocker 是「真跑通了判定」，不是空扫描）
  const absB = path.join(root, relB);
  const tampered = fs.readFileSync(absB, 'utf8').replace(/确认指纹: [0-9a-f]{16}/, `确认指纹: ${'dead'.repeat(4)}`);
  fs.writeFileSync(absB, tampered);
  const fail = runS15(root);
  assert.ok(fail.blockers.some((b) => b.includes('确认未对账') && b.includes('2026-11-18-new.md')), fail.blockers.join('\n'));
});

test('funnelFromLedger output is identical with and without policyVersion fields', () => {
  const baseRows = [
    { ts: '2026-11-01T01:00:00.000Z', doc: 'workflow/intents/2026-11-01-a.md', stage: 'approved', fingerprint: 'a'.repeat(64), prev: 'draft', source: 'tty', batch: 'aa', seq: 1, of: 1 },
    { ts: '2026-11-02T01:00:00.000Z', doc: 'workflow/intents/2026-11-01-a.md', stage: 'done', fingerprint: 'b'.repeat(64), prev: 'approved', source: 'tty', batch: 'aa', seq: 2, of: 1 },
  ];
  const upgraded = baseRows.map((e) => ({ ...e, policyVersion: 1 })); // 新 schema 同一台账
  const firstAdded = new Map([['workflow/intents/2026-11-01-a.md', '2026-11-01T00:00:00.000Z']]);
  const legacy = funnelFromLedger(baseRows, '2026-11', firstAdded);
  const withField = funnelFromLedger(upgraded, '2026-11', firstAdded);
  assert.deepEqual(withField, legacy);
  // sanity：两侧都真算出了漏斗（防「同坏得等」的假等价）
  assert.equal(legacy.closed, 1);
  assert.equal(legacy.once, 1);
});

test('--reconfirm 重录的台账行同样携带 policyVersion（四落点一致性）', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'config', 'engine.json'), JSON.stringify({ policyVersion: 4 }));
  const rel = 'workflow/tasks/t4/2026-11-18-d.md';
  writeDoc(root, rel);
  let r = run(['run', 'confirm-doc.mjs', '--', rel, '--delegated', '原话：同意', '--root', root], root);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  r = run(['run', 'confirm-doc.mjs', '--', rel, '--reconfirm', '--delegated', '原话：改后重新同意', '--root', root], root);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const rows = readLedger(root);
  const last = rows[rows.length - 1];
  assert.equal(last.policyVersion, 4, 'reconfirm 落点漏 policyVersion');
});
