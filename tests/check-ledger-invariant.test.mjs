// tests/check-ledger-invariant.test.mjs — PR 可写的基线声明与缓存索引不可作为豁免依据（2026-11 审计 D45）
// 锁两件事：仓库声明基线若在声明区间内被改动 → 不采用并 loud 告警（回落内置基线/全史）；
// 被 git 跟踪的 .agents/cache 历史索引/增量验证缓存 → 忽略并重建，不按伪造内容裁决。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'check-ledger-invariant.mjs');
const NOTE = '.agents/notes/ledger-history-baseline.md';
const IDX = '.agents/cache/ledger-history-index.json';
const VERIFY = '.agents/cache/ledger-invariant.json';

const row = (stage, fp, ts) => JSON.stringify({ doc: 'workflow/intents/x.md', stage, fingerprint: fp, ts });
const R1 = row('approved', '1'.repeat(64), '2026-01-01T00:00:00.000Z');
const R2 = row('done', '2'.repeat(64), '2026-01-02T00:00:00.000Z');
const R3 = row('approved', '3'.repeat(64), '2026-01-03T00:00:00.000Z');
const TAMPERED = row('done', 'd'.repeat(64), '2026-01-02T00:00:00.000Z');

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败: ${r.stderr}`);
  return r;
}

function write(dir, rel, text) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function makeRepo() {
  const dir = makeTmp('flow-kit-ledger-invariant-');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'tester']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  write(dir, 'workflow/intents/x.md', '---\n状态: done\n---\n\nbody\n');
  return dir;
}

function commit(dir, msg) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', msg]);
}

// 基线：v1 合法三行 → tamper 改写中间行（仍是合法行）→ 返回篡改提交 sha
function tamperedRepo() {
  const dir = makeRepo();
  write(dir, '.agents/confirmations.jsonl', [R1, R2, R3].join('\n') + '\n');
  commit(dir, 'v1');
  write(dir, '.agents/confirmations.jsonl', [R1, TAMPERED, R3].join('\n') + '\n');
  commit(dir, 'tamper');
  return { dir, tamperSha: git(dir, ['rev-parse', 'HEAD']).stdout.trim() };
}

function run(dir) {
  const env = { ...process.env };
  delete env.LEDGER_HISTORY_BASELINE;
  return spawnSync(process.execPath, [CHECKER, '--root', dir], { cwd: dir, encoding: 'utf8', env });
}

function scriptHash(script) {
  return crypto.createHash('sha256').update(fs.readFileSync(script, 'utf8')).digest('hex').slice(0, 16);
}

test('仓库声明基线在声明区间内被提交改动 → 不采用、告警，篡改提交仍被抓', () => {
  const { dir, tamperSha } = tamperedRepo();
  write(dir, NOTE, `LEDGER_HISTORY_BASELINE=${tamperSha}\n`);
  commit(dir, 'declare tampering commit as baseline');

  const r = run(dir);
  assert.notEqual(r.status, 0, `自我豁免的基线声明不得放行: ${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /仓库声明基线/);
  assert.match(r.stderr, /不采用/);
  assert.match(r.stderr, /前缀破坏/);
});

// 2026-11-28 全量套件并行负载下复现的 fail-open（#90 修复收口）：无 trunk 时 git rev-list 失败
// （瞬时 spawn 失败 / 声明不可达）被旧 catch 吞掉后落入 return sha——未通过反篡改核查的声明直接
// 生效，篡改被豁免 exit 0 假绿。修复后 fail-closed：核查无法执行 = 不采用 + loud 告警 + 全史兜底。
// 不可达声明值可确定性触发同一路径（rev-list 必抛「unknown revision」）。
test('声明区间核查无法执行（git rev-list 失败）→ fail-closed：不采用、告警，篡改提交仍被抓', () => {
  const { dir } = tamperedRepo();
  write(dir, NOTE, `LEDGER_HISTORY_BASELINE=${'d'.repeat(40)}\n`);
  commit(dir, 'declare unreachable baseline');

  const r = run(dir);
  assert.notEqual(r.status, 0, `核查失败不得放行声明: ${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /仓库声明基线/);
  assert.match(r.stderr, /核查无法执行/);
  assert.match(r.stderr, /前缀破坏/);
});

test('被 git 跟踪的历史索引缓存不可信 → 忽略并重建，篡改仍被抓', () => {
  const { dir } = tamperedRepo();
  const head = git(dir, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  write(dir, IDX, JSON.stringify({ v: 1, root: dir, scriptHash: scriptHash(CHECKER), head, index: {} }));
  commit(dir, 'force-add forged history index');

  const r = run(dir);
  assert.notEqual(r.status, 0, `伪造索引不得让所有路径「零历史」: ${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /历史索引/);
  assert.match(r.stderr, /前缀破坏/);
});

test('被 git 跟踪的增量验证缓存不可信 → 忽略并按全史复核', () => {
  const { dir, tamperSha } = tamperedRepo();
  const head = tamperSha.slice(0, 7);
  write(dir, VERIFY, JSON.stringify({ v: 1, root: dir, head, baseline: '', scriptHash: scriptHash(CHECKER) }));
  commit(dir, 'force-add forged verification cache');

  const r = run(dir);
  assert.notEqual(r.status, 0, `伪造「上次绿跑到篡改提交」不得跳过历史扫描: ${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /增量验证缓存|验证缓存/);
  assert.match(r.stderr, /前缀破坏/);
});
