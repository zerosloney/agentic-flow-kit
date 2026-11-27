// tests/archive-sweep.test.mjs — 台账 ts 格式校验与归档目标包含性（2026-11 审计 D46）
// 台账 ts 是归档的终态锚：不合法的值曾让 new Date() 变 NaN（冷却窗失效）且原串前缀被当作归档月份
// （`..` 可把 git mv 带出 workflow/archive/）。锁定三件事：非法 ts 被拒且不回退其它日期源、
// analyze 直接收到垃圾值也不产出候选、--execute 不移动文档。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze, loadLedgerTs } from '../templates/engine/.agents/scripts/archive-sweep.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SWEEP = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'archive-sweep.mjs');
const DOC = 'workflow/intents/2020-01-01-old.md';
const DOC_TEXT = '---\n状态: done\n---\n\nbody\n';
const TODAY = Date.parse('2026-11-26T12:00:00Z');

function fixture() {
  const root = makeTmp('flow-kit-archive-');
  fs.mkdirSync(path.join(root, 'workflow', 'intents'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(root, DOC), DOC_TEXT);
  return root;
}

function writeLedger(root, ts) {
  fs.writeFileSync(path.join(root, '.agents', 'confirmations.jsonl'),
    JSON.stringify({ ts, doc: DOC, stage: 'done', fingerprint: 'f'.repeat(64) }) + '\n');
}

function analyzeRoot(root) {
  return analyze({
    docs: [{ rel: DOC, file: path.basename(DOC), dir: 'intents', text: DOC_TEXT }],
    ledgerTs: loadLedgerTs(root),
    lastTouch: {},
    activeTexts: [],
    windowDays: 21,
    today: TODAY,
  });
}

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败: ${r.stderr}`);
  return r;
}

function initRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'tester']);
  git(dir, ['config', 'core.autocrlf', 'false']);
}

test('非法 ts 被拒绝：文档不归档，也不回退到文件名日期', () => {
  for (const bad of ['../../pwn', '../../../x', '9999-99-99', 'not-a-date', 123, null, {}, '']) {
    const root = fixture();
    writeLedger(root, bad);
    assert.equal(loadLedgerTs(root)[DOC], null, `非法 ts ${JSON.stringify(bad)} 不得产出日期`);
    const res = analyzeRoot(root);
    assert.deepEqual(res.candidates, [], `非法 ts ${JSON.stringify(bad)} 不得让文档可归档`);
    assert.ok(res.noDate.some((x) => x.rel === DOC), `非法 ts ${JSON.stringify(bad)} 应计入无日期`);
  }
});

test('合法 ts 仍按 YYYY-MM 归档（对照）', () => {
  const root = fixture();
  writeLedger(root, '2020-01-01T00:00:00.000Z');
  const res = analyzeRoot(root);
  assert.equal(res.candidates.length, 1, JSON.stringify(res));
  assert.equal(res.candidates[0].tTime, '2020-01-01');
  assert.equal(res.candidates[0].month, '2020-01');
});

test('analyze 直接收到非法 ledgerTs 也不得归档（月份不可出界）', () => {
  for (const bad of ['../../pwn', '../../../x', '9999-99-99', '2026-11']) {
    const res = analyze({
      docs: [{ rel: DOC, file: path.basename(DOC), dir: 'intents', text: DOC_TEXT }],
      ledgerTs: { [DOC]: bad },
      lastTouch: {},
      activeTexts: [],
      windowDays: 21,
      today: TODAY,
    });
    assert.deepEqual(res.candidates, [], `ledgerTs=${JSON.stringify(bad)} 不得产出候选`);
  }
});

test('集成：ts 非法时 --execute 不移动文档，也不会把归档目标带出 workflow/archive/', () => {
  const root = fixture();
  initRepo(root);
  writeLedger(root, '../../pwn');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'bad ts row']);

  const bad = spawnSync(process.execPath, [SWEEP, '--window=21', '--execute'], { cwd: root, encoding: 'utf8' });
  assert.equal(bad.status, 0, `非法 ts 扫档应正常结束: ${bad.stdout}\n${bad.stderr}`);
  assert.ok(fs.existsSync(path.join(root, DOC)), '文档必须留在原路径');
  assert.ok(!fs.existsSync(path.join(root, 'p')), '不得出现 ../../pwn 逃逸出的 p/ 目录');

  writeLedger(root, '2020-01-01T00:00:00.000Z');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'valid old ts row']);

  const ok = spawnSync(process.execPath, [SWEEP, '--window=21', '--execute'], { cwd: root, encoding: 'utf8' });
  assert.equal(ok.status, 0, `合法旧 ts 扫档应成功: ${ok.stdout}\n${ok.stderr}`);
  assert.ok(fs.existsSync(path.join(root, 'workflow', 'archive', '2020-01', 'intents', path.basename(DOC))),
    `文档应移入 workflow/archive/2020-01/intents/: ${ok.stdout}`);
  assert.ok(!fs.existsSync(path.join(root, DOC)), '原路径应已移走');
});
