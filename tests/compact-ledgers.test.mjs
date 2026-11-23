// tests/compact-ledgers.test.mjs — issue #39：compact-ledgers 部分归并（ts 升序 + 回溯分片保留）
// 与 check-ledger-invariant --staged 暂存删除的归并凭据对账（消除 `:rel` git fatal 噪声）。
// 夹具行必须过检查器行级校验五项：ts ISO 且文件内非降序 / fingerprint 64 位 hex /
// doc ∈ workflow 四目录且当前树存在 / stage ∈ VALID_STAGES（此处取 approved）。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planCompaction } from '../templates/engine/.agents/scripts/compact-ledgers.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(KIT, 'templates', 'engine', '.agents', 'scripts');
const COMPACT = path.join(SCRIPTS, 'compact-ledgers.mjs');
const CHECKER = path.join(SCRIPTS, 'check-ledger-invariant.mjs');

// 与 check-ledger-invariant 行级校验同一口径的 ISO ts（同格式同 时区，字符串比较即时间序）
const T = (n) => `2026-11-01T00:00:${String(n).padStart(2, '0')}.000Z`;
let fpSeq = 0;
const hex = (n) => n.toString(16).padStart(64, '0');
const mkRow = (ts, doc, stage = 'approved') =>
  JSON.stringify({ ts, doc: `workflow/specs/${doc}.md`, stage, fingerprint: hex(++fpSeq) });

// ---- 纯函数单测：planCompaction ----

test('planCompaction：可归并分片按 ts 升序追加，回溯/缺 ts 分片保留且 reason 可读', () => {
  const main = [mkRow(T(1), 'm1'), mkRow(T(2), 'm2'), mkRow(T(3), 'm3')].join('\n') + '\n';
  const shardA = [mkRow(T(6), 'a2'), mkRow(T(5), 'a1')].join('\n') + '\n'; // 片内乱序，验证全局排序
  const shardB = [mkRow(T(2), 'b1'), mkRow(T(7), 'b2')].join('\n') + '\n'; // 首行回溯（ts 早于主台账末行）
  const shardC = ['{"doc":"workflow/specs/c1.md","stage":"approved"}', mkRow(T(8), 'c2')].join('\n') + '\n'; // 首行缺 ts
  const plan = planCompaction({ mainText: main, shardTexts: new Map([['a.jsonl', shardA], ['b.jsonl', shardB], ['c.jsonl', shardC]]) });

  assert.deepEqual(plan.mergedShards.map((s) => s.file), ['a.jsonl']);
  assert.deepEqual(plan.keptShards.map((s) => s.file), ['b.jsonl', 'c.jsonl']);
  assert.match(plan.keptShards[0].reason, /回溯行早于主台账末行/);
  assert.ok(plan.keptShards[0].reason.includes(T(3)) && plan.keptShards[0].reason.includes(T(2)), `reason 应含阈值与违规 ts：${plan.keptShards[0].reason}`);
  assert.match(plan.keptShards[1].reason, /第 1 行缺合法 ts 字段/);

  assert.deepEqual(plan.appended.map((l) => JSON.parse(l).ts), [T(5), T(6)], '追加行按 ts 升序');
  // 主台账前缀逐字节不变 + 追加行拼接在尾部 + 末尾单换行
  assert.ok(plan.mergedText.startsWith(main), '主台账既有行须为逐字节前缀');
  const mergedLines = plan.mergedText.replace(/\n$/, '').split('\n');
  assert.deepEqual(mergedLines.slice(0, 3), main.replace(/\n$/, '').split('\n'));
  assert.deepEqual(mergedLines.slice(3), plan.appended);
  assert.ok(plan.mergedText.endsWith('\n') && !plan.mergedText.endsWith('\n\n'));
});

test('planCompaction：主台账为空时全片按 ts 升序归并（不设阈值）', () => {
  const a = [mkRow(T(5), 'a1'), mkRow(T(9), 'a2')].join('\n') + '\n';
  const b = mkRow(T(3), 'b1') + '\n';
  const plan = planCompaction({ mainText: '', shardTexts: new Map([['a.jsonl', a], ['b.jsonl', b]]) });
  assert.deepEqual(plan.keptShards, []);
  assert.deepEqual(plan.mergedShards.map((s) => s.file), ['a.jsonl', 'b.jsonl']);
  assert.deepEqual(plan.appended.map((l) => JSON.parse(l).ts), [T(3), T(5), T(9)], '跨片按 ts 升序');
});

test('planCompaction：等 ts 行保持收集序（文件名序 × 片内序，稳定排序）', () => {
  const x = mkRow(T(4), 'x1');
  const y = mkRow(T(4), 'x2');
  const z = mkRow(T(4), 'x3');
  const plan = planCompaction({ mainText: '', shardTexts: new Map([['a.jsonl', [x, y].join('\n') + '\n'], ['b.jsonl', z + '\n']]) });
  assert.deepEqual(plan.appended, [x, y, z]);
});

test('planCompaction：主台账已有行不重复追加，且不影响该片可归并判定', () => {
  const dup = mkRow(T(1), 'dup'); // 旧 ts（若参与判定即回溯行），但已在主台账
  const main = [dup, mkRow(T(2), 'm2')].join('\n') + '\n';
  const a = [dup, mkRow(T(3), 'a1')].join('\n') + '\n'; // 含主台账重复行 + 1 新行 → 可归并
  const b = dup + '\n'; // 整片皆为主台账重复行 → 可归并（零追加）
  const plan = planCompaction({ mainText: main, shardTexts: new Map([['a.jsonl', a], ['b.jsonl', b]]) });
  assert.deepEqual(plan.mergedShards.map((s) => s.file), ['a.jsonl', 'b.jsonl']);
  assert.deepEqual(plan.keptShards, []);
  assert.equal(plan.appended.length, 1, '重复行不追加');
  assert.equal(JSON.parse(plan.appended[0]).doc, 'workflow/specs/a1.md');
});

test('planCompaction：违规行不进去重集——后续分片含同一行时仍独立判定', () => {
  // shardA 含回溯行 R（被保留）；shardB 含同一行 R + 合法新行——R 不得因 A 被跳过，
  // 否则 B 会删片而 R 从未进主台账（历史全扫删片对账必红）。
  const r = mkRow(T(1), 'back'); // 回溯行
  const main = [mkRow(T(2), 'm1')].join('\n') + '\n';
  const a = [r, mkRow(T(3), 'a1')].join('\n') + '\n';
  const b = [r, mkRow(T(4), 'b1')].join('\n') + '\n';
  const plan = planCompaction({ mainText: main, shardTexts: new Map([['a.jsonl', a], ['b.jsonl', b]]) });
  assert.deepEqual(plan.mergedShards.map((s) => s.file), [], '两片均须保留');
  assert.deepEqual(plan.keptShards.map((s) => s.file), ['a.jsonl', 'b.jsonl']);
});

// ---- 集成：临时 git 仓 → compact 部分归并 → 全扫绿 → --staged 删片语义 ----

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败: ${r.stderr}`);
  return r;
}

function runScript(script, dir, args = []) {
  return spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, FLOW_KIT_TEST: '1' } });
}

function dropCheckerCache(dir) {
  // 检查器绿跑会写 .agents/cache/{ledger-invariant,ledger-history-index}.json，防止被 git add -A 带入提交
  fs.rmSync(path.join(dir, '.agents', 'cache'), { recursive: true, force: true });
}

test('集成：compact 部分归并 → 追加时序单调 → 全扫绿 → --staged 删片认可/拦截', () => {
  const dir = makeTmp('flow-kit-compact-');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'tester']);

  // 行级校验④：doc 指向的文件须真实存在于 workflow 四目录
  fs.mkdirSync(path.join(dir, 'workflow', 'specs'), { recursive: true });
  for (const d of ['m1', 'm2', 'm3', 'a1', 'a2', 'b1', 'c1']) {
    fs.writeFileSync(path.join(dir, 'workflow', 'specs', `${d}.md`), `# ${d}\n`);
  }

  const shardDir = path.join(dir, '.agents', 'confirmations.d');
  fs.mkdirSync(shardDir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'confirmations.jsonl'),
    [mkRow(T(1), 'm1'), mkRow(T(2), 'm2'), mkRow(T(3), 'm3')].join('\n') + '\n');
  const shardA = '20261101-a.jsonl'; // 可归并（全部行 ts ≥ 主台账末行）
  const shardB = '20261102-b.jsonl'; // 回溯分片（须保留）
  fs.writeFileSync(path.join(shardDir, shardA), [mkRow(T(6), 'a2'), mkRow(T(5), 'a1')].join('\n') + '\n');
  fs.writeFileSync(path.join(shardDir, shardB), mkRow(T(2), 'b1') + '\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init: main ledger + shards']);

  // 用例 2：compact 部分归并——A 归并、B 保留且清单明确
  const r1 = runScript(COMPACT, dir);
  assert.equal(r1.status, 0, `compact exit ${r1.status}: ${r1.stderr}`);
  assert.ok(r1.stdout.includes('归并 1 片 / 2 行'), `stdout 应含归并摘要：${r1.stdout}`);
  assert.match(r1.stdout, /保留 1 片/);
  assert.ok(r1.stdout.includes(shardB), '保留清单应列出回溯分片名');
  assert.ok(fs.existsSync(path.join(shardDir, shardB)), '回溯分片应原样保留');
  assert.ok(!fs.existsSync(path.join(shardDir, shardA)), '可归并分片应删除');
  // 追加行 ts 升序：整文件非降序（与检查器 683 行同口径的字符串比较）
  const tsSeq = fs.readFileSync(path.join(dir, '.agents', 'confirmations.jsonl'), 'utf8')
    .replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l).ts);
  assert.deepEqual(tsSeq.slice(3), [T(5), T(6)]);
  for (let i = 1; i < tsSeq.length; i++) assert.ok(tsSeq[i - 1] <= tsSeq[i], `追加时序非单调 @行 ${i + 1}`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'compact: merge shard a']);

  // 归并结果过全量历史扫描 + 终树行级校验
  const r2 = runScript(CHECKER, dir, ['--root', dir]);
  assert.equal(r2.status, 0, `check-ledger-invariant exit ${r2.status}: ${r2.stderr}`);

  // 用例 3：新分片 commit 后 compact 归并，git add -A → --staged 应认可删片且无 fatal 噪声
  const shardC = '20261103-c.jsonl';
  fs.writeFileSync(path.join(shardDir, shardC), mkRow(T(7), 'c1') + '\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'add shard c']);
  dropCheckerCache(dir);
  const r3 = runScript(COMPACT, dir);
  assert.equal(r3.status, 0, `compact#2 exit ${r3.status}: ${r3.stderr}`);
  assert.ok(!fs.existsSync(path.join(shardDir, shardC)), 'shard c 应被归并删除');
  git(dir, ['add', '-A']);
  const r4 = runScript(CHECKER, dir, ['--staged']);
  assert.equal(r4.status, 0, `--staged(删片认可) exit ${r4.status}: ${r4.stderr}`);
  assert.ok(!r4.stderr.includes('fatal: ambiguous'), `stderr 不应有 git fatal 噪声：${r4.stderr}`);
  assert.match(r4.stdout, /分片归并删除认可/);
  git(dir, ['commit', '-q', '-m', 'compact: merge shard c']);

  // 用例 4：未归并分片被 git rm 暂存删除 → [删片未归并] 拦截，无 fatal 噪声
  git(dir, ['rm', '-q', '--', `.agents/confirmations.d/${shardB}`]);
  const r5 = runScript(CHECKER, dir, ['--staged']);
  assert.equal(r5.status, 1, `--staged(删片未归并) 应 exit 1`);
  assert.match(r5.stderr, /\[删片未归并\]/);
  assert.ok(!r5.stderr.includes('fatal: ambiguous'), `stderr 不应有 git fatal 噪声：${r5.stderr}`);
  git(dir, ['reset', '-q', '--hard', 'HEAD']);

  // 用例 5：主台账被暂存删除 → [主台账删除] 拦截（旧版静默放行属漏检）
  git(dir, ['rm', '-q', '--', '.agents/confirmations.jsonl']);
  const r6 = runScript(CHECKER, dir, ['--staged']);
  assert.equal(r6.status, 1, `--staged(主台账删除) 应 exit 1`);
  assert.match(r6.stderr, /\[主台账删除\]/);
  assert.ok(!r6.stderr.includes('fatal: ambiguous'), `stderr 不应有 git fatal 噪声：${r6.stderr}`);
  git(dir, ['reset', '-q', '--hard', 'HEAD']);
});

// ---- 复核红线申报（2026-11-24 issue #84）：reviews.d 任一行含 review-fix: 标记即判红 ----
// 2026-11-23 双臂评测实证 independent-reviewer 只读禁令 2/2 被操作者「顺手修掉并提交」指令穿透。
// 契约升格后违例须在复核意见级台账逐笔申报 review-fix: <hash,…>，台账不变量对申报判红——申报即
// 只读红线被突破的具名证据（修复交回实现侧）。锁四件事：全扫正/负例、--staged 只暂存 reviews.d 正/负例。
test('集成：reviews.d 含 review-fix: 申报 → 全扫与 --staged 判红；普通复核行不红', () => {
  const dir = makeTmp('flow-kit-reviews-fix-');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'tester']);

  const ledger = path.join(dir, 'workflow', 'reviews.d', '2026-11.md');
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  const normalLine = '- 2026-11-23 spec 复核：Approved（reviewed by glm-4.7）\n';

  // 负例（全扫）：普通意见级台账行（无申报标记）→ 不因本规则 exit 1
  fs.writeFileSync(ledger, `# 评审意见级台账 2026-11\n\n${normalLine}`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'reviews: normal opinion ledger']);
  const r1 = runScript(CHECKER, dir, ['--root', dir]);
  assert.equal(r1.status, 0, `全扫(普通复核行) 应绿: ${r1.stdout}\n${r1.stderr}`);

  // 正例（全扫）：申报行含 review-fix: → exit 1 且输出含红线说明
  fs.appendFileSync(ledger, '- 2026-11-24 违例申报：复核会话顺手修复并提交了 src/a.ts（review-fix: abc1234567）\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'reviews: declare review-fix violation']);
  const r2 = runScript(CHECKER, dir, ['--root', dir]);
  assert.equal(r2.status, 1, `全扫(review-fix 申报) 应 exit 1: ${r2.stdout}\n${r2.stderr}`);
  assert.match(r2.stderr, /\[复核红线申报\]/);
  assert.ok(r2.stderr.includes('issue #84'), `stderr 应含 issue #84 指引: ${r2.stderr}`);

  // 负例（--staged）：只暂存 reviews.d（未触任何确认台账）且无申报 → 仍走静默 0 退出
  const ledger2 = path.join(dir, 'workflow', 'reviews.d', '2026-12.md');
  fs.writeFileSync(ledger2, `# 评审意见级台账 2026-12\n\n${normalLine}`);
  git(dir, ['add', '-A']);
  const r3 = runScript(CHECKER, dir, ['--staged']);
  assert.equal(r3.status, 0, `--staged(普通复核行) 应绿: ${r3.stdout}\n${r3.stderr}`);

  // 正例（--staged）：只暂存含申报的 reviews.d → exit 1（未触确认台账也不得静默放行）
  fs.appendFileSync(ledger2, '- 2026-11-24 违例申报：顺手修复并提交了 src/b.ts（review-fix: deadbeef）\n');
  git(dir, ['add', '-A']);
  const r4 = runScript(CHECKER, dir, ['--staged']);
  assert.equal(r4.status, 1, `--staged(review-fix 申报) 应 exit 1: ${r4.stdout}\n${r4.stderr}`);
  assert.match(r4.stderr, /\[复核红线申报\]/);
  assert.match(r4.stderr, /review-fix/);
});
