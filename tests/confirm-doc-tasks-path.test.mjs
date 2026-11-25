import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

// tasks-path（2026-11-18）：pipeline-run 自动化产物落 workflow/tasks/<task>/，
// 执行器人件门（intent-confirm / plan-confirm）以 --delegated 过 confirm-doc。
// DOC_RE 闭集曾只含手动四目录 → tasks 文档被静默跳过（exit 0、零写入）→
// pipeline 误判已确认 → docsCommit「nothing to commit」→ gate-fail。
// 本文件锁定：tasks 路径可确认（落台账 + 状态前移），非法层级仍拒绝。

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRoot() {
  const dir = makeTmp('fk-confirm-tasks-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

function writeDoc(root, rel, status = 'draft') {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\n状态: ${status}\n级别: L1\n日期: 2026-11-18\n---\n# PLAN — demo\n\n## 入口\n- 来源：工单\n- 目标：验证 tasks 路径确认\n`);
  return abs;
}

function readLedger(root) {
  const shardDir = path.join(root, '.agents', 'confirmations.d');
  const rows = [];
  if (fs.existsSync(shardDir)) {
    for (const f of fs.readdirSync(shardDir)) {
      for (const line of fs.readFileSync(path.join(shardDir, f), 'utf8').split(/\r?\n/)) {
        if (line.trim()) rows.push(JSON.parse(line));
      }
    }
  }
  return rows;
}

test('confirm-doc accepts workflow/tasks/<task>/plan.md: ledger row + draft→approved', () => {
  const root = tmpRoot();
  const rel = 'workflow/tasks/2026-11-18-demo/plan.md';
  writeDoc(root, rel);
  const r = run(['run', 'confirm-doc.mjs', '--', rel, '--delegated', '原话：就按这个计划做', '--root', root], root);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.ok(!`${r.stdout}${r.stderr}`.includes('路径须匹配'), `${r.stdout}\n${r.stderr}`);
  const rows = readLedger(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].doc, rel);
  assert.equal(rows[0].source, 'chat-delegated');
  assert.equal(rows[0].quote, '原话：就按这个计划做');
  assert.equal(rows[0].stage, 'approved');
  assert.match(fs.readFileSync(path.join(root, rel), 'utf8'), /^状态: approved$/m);
});

test('confirm-doc still rejects tasks paths that are not exactly <task>/<file>.md', () => {
  const root = tmpRoot();
  const flat = 'workflow/tasks/plan.md'; // 缺任务目录层
  const deep = 'workflow/tasks/a/b/c.md'; // 超出一层
  writeDoc(root, flat);
  writeDoc(root, deep);
  for (const rel of [flat, deep]) {
    const r = run(['run', 'confirm-doc.mjs', '--', rel, '--delegated', '原话：尝试非法层级', '--root', root], root);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); // 跳过不落账，进程仍 0（与四目录外路径同语义）
    assert.ok(`${r.stdout}${r.stderr}`.includes('路径须匹配'), `${rel}: ${r.stdout}\n${r.stderr}`);
  }
  assert.equal(readLedger(root).length, 0);
  assert.match(fs.readFileSync(path.join(root, flat), 'utf8'), /^状态: draft$/m);
  assert.match(fs.readFileSync(path.join(root, deep), 'utf8'), /^状态: draft$/m);
});

// ---- 跨界一致性（2026-11-18）：confirm-doc 收编 tasks 路径后，check-ledger-invariant 的行级校验④
// 与 docExists 若仍闭死于手动四目录，tasks 行一旦过 confirm 落台账（append-only，污染不可逆）必
// HARD-BLOCK「doc 路径不在 workflow 四目录协议内」→ gate-fail 只是后移一格。本组用例锁定：
// 已提交的 tasks 台账行过不变量（正例），协议外路径仍被拦（负例，其余各项合规仅 doc 越界）。

const CHECKER = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'check-ledger-invariant.mjs');

function commitAll(root, msg) {
  // 不变量只对「有提交史的路径」做终树行级校验（零提交历史静默跳过）——不 commit 则断裂复现不出
  for (const args of [['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'tester'], ['add', '-A'], ['commit', '-q', '-m', msg]]) {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  }
}

function runChecker(root) {
  return spawnSync(process.execPath, [CHECKER, '--root', root], { cwd: root, encoding: 'utf8' });
}

test('check-ledger-invariant accepts committed ledger row pointing at workflow/tasks doc', () => {
  const root = tmpRoot();
  const rel = 'workflow/tasks/2026-11-18-demo/plan.md';
  writeDoc(root, rel);
  const r = run(['run', 'confirm-doc.mjs', '--', rel, '--delegated', '原话：就按这个计划做', '--root', root], root);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(readLedger(root).length, 1);
  commitAll(root, 'chore(ledger): tasks doc confirmation');
  const c = runChecker(root);
  assert.equal(c.status, 0, `${c.stdout}\n${c.stderr}`);
  assert.ok(!`${c.stdout}${c.stderr}`.includes('不在'), `${c.stdout}\n${c.stderr}`);
});

test('check-ledger-invariant still blocks doc paths outside four dirs + tasks protocol', () => {
  const root = tmpRoot();
  // 手工台账行：ts/fingerprint/stage 全合规，仅 doc 越出协议——锁住「扩 tasks 不放任任意路径」
  const shard = path.join(root, '.agents', 'confirmations.d', 'handmade.jsonl');
  fs.mkdirSync(path.dirname(shard), { recursive: true });
  const row = JSON.stringify({ ts: '2026-11-18T00:00:00.000Z', fingerprint: 'ab'.repeat(32), stage: 'approved', doc: 'workflow/notes/x.md' });
  fs.writeFileSync(shard, `${row}\n`);
  commitAll(root, 'chore(ledger): out-of-protocol doc row');
  const c = runChecker(root);
  assert.equal(c.status, 1, `${c.stdout}\n${c.stderr}`);
  assert.match(`${c.stdout}${c.stderr}`, /doc 路径不在 .*协议/);
});
