import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseBaseline, decideAction } from '../tools/eval-freshness.mjs';
import { treeSignature } from '../templates/engine/.agents/scripts/agent-eval.mjs';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(KIT, 'tools', 'eval-freshness.mjs');

function runTool(args) {
  return spawnSync(process.execPath, [TOOL, ...args], {
    cwd: KIT,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
    windowsHide: true,
  });
}

function writeBacklog(text) {
  const dir = makeTmp('fk-eval-fresh-');
  const file = path.join(dir, 'BACKLOG.md');
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

test('parseBaseline：双哈希 / 单哈希 / 无（loud-skip）三态', () => {
  const dbl = parseBaseline('## 旧节（2026-11-01）\n\n## 凭证（2026-11-17）\n签名定型 fab13142d6f4/f0145f530b21（59 敏感文件）\n');
  assert.deepEqual(dbl, { found: true, zh: 'fab13142d6f4', en: 'f0145f530b21', date: '2026-11-17' });

  const single = parseBaseline('签名定型 abc123456789\n');
  assert.deepEqual(single, { found: true, zh: 'abc123456789', en: null, date: null });

  const none = parseBaseline('# BACKLOG\n\n没有任何定型记录。\n');
  assert.deepEqual(none, { found: false, zh: null, en: null, date: null });
});

test('parseBaseline：多次出现取最后一次能提出 hex 的，容忍 markdown 修饰', () => {
  const last = parseBaseline('签名定型 111111111111/222222222222\n后续修订\n签名定型 333333333333\n');
  assert.equal(last.zh, '333333333333');
  assert.equal(last.en, null);

  const decorated = parseBaseline('## 出厂凭证（2026-11-17）\n签名定型：**`fab13142d6f4`** / **`f0145f530b21`**\n');
  assert.deepEqual(decorated, { found: true, zh: 'fab13142d6f4', en: 'f0145f530b21', date: '2026-11-17' });
});

test('parseBaseline：定型日取向上最近的「（YYYY-MM-DD」，含同行后缀、不含后续行', () => {
  const before = parseBaseline('（2026-01-01 早期\n（2026-11-17 重跑\n签名定型 fab13142d6f4/f0145f530b21\n（2027-01-01 未来\n');
  assert.equal(before.date, '2026-11-17');

  const sameLine = parseBaseline('签名定型 fab13142d6f4（2026-11-17 定型）\n');
  assert.equal(sameLine.date, '2026-11-17');

  const noDate = parseBaseline('签名定型 fab13142d6f4\n');
  assert.equal(noDate.date, null);
});

test('decideAction：全绿（记录值为签名前缀）/ mismatch / age 超限 / 无基线 / age unknown', () => {
  const baseline = { found: true, zh: 'fab13142d6f4', en: 'f0145f530b21', date: '2026-11-17' };
  const zhLive = `${'fab13142d6f4'}${'0'.repeat(52)}`;
  const enLive = `${'f0145f530b21'}${'1'.repeat(52)}`;
  const now = Date.UTC(2026, 10, 17, 12);

  const green = decideAction({ baseline, zhSig: zhLive, enSig: enLive, now, maxAgeDays: 30 });
  assert.equal(green.verdict, 'green');
  assert.equal(green.actionNeeded, false);
  assert.equal(green.ageDays, 0);

  const drift = decideAction({ baseline, zhSig: zhLive, enSig: `${'deadbeefcafe'}${'2'.repeat(52)}`, now, maxAgeDays: 30 });
  assert.equal(drift.verdict, 'drift');
  assert.equal(drift.actionNeeded, true);
  assert.equal(drift.zhMatch, true);
  assert.equal(drift.enMatch, false);

  const stale = decideAction({ baseline, zhSig: zhLive, enSig: enLive, now: Date.UTC(2027, 0, 20), maxAgeDays: 30 });
  assert.equal(stale.verdict, 'stale');
  assert.equal(stale.actionNeeded, true);
  assert.ok(stale.ageDays > 30);

  const noBaseline = decideAction({ baseline: { found: false, zh: null, en: null, date: null }, zhSig: zhLive, enSig: enLive, now, maxAgeDays: 30 });
  assert.equal(noBaseline.verdict, 'no-baseline');
  assert.equal(noBaseline.actionNeeded, false);

  const unknownAge = decideAction({ baseline: { ...baseline, date: null }, zhSig: zhLive, enSig: enLive, now, maxAgeDays: 30 });
  assert.equal(unknownAge.verdict, 'green');
  assert.equal(unknownAge.ageDays, null);
  assert.equal(unknownAge.actionNeeded, false);
});

test('端到端：临时 zh 安装跑 treeSignature 返回 hex（与历史定型不等是预期漂移，不断言具体值）', () => {
  const dir = makeTmp('fk-eval-fresh-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const r = spawnSync(process.execPath, [path.join(KIT, 'bin', 'flow-kit.mjs'), 'install', '--agent', 'claude', '--stack', 'node', '--target', dir], {
    cwd: KIT,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
    windowsHide: true,
  });
  assert.equal(r.status, 0, r.stderr);
  const { signature, files } = treeSignature(dir);
  assert.match(signature, /^[0-9a-f]{64}$/);
  assert.ok(files.length > 0);
});

test('工具 --check：合成基线两态（match/mismatch）均 exit 0，--json 判定正确', () => {
  const zhSig = 'a'.repeat(64);
  const enSig = 'b'.repeat(64);
  const today = new Date().toISOString().slice(0, 10);

  const okFile = writeBacklog(`## 出厂凭证（${today}）\n\n签名定型 aaaaaaaaaaaa/bbbbbbbbbbbb\n`);
  const ok = runTool(['--json', '--check', `${zhSig}/${enSig}`, '--backlog', okFile]);
  assert.equal(ok.status, 0, ok.stderr);
  const okJson = JSON.parse(ok.stdout);
  assert.equal(okJson.verdict, 'green');
  assert.equal(okJson.actionNeeded, false);
  assert.equal(okJson.trees.zh.match, true);
  assert.equal(okJson.trees.en.match, true);

  const driftFile = writeBacklog(`## 出厂凭证（${today}）\n\n签名定型 123456789012/123456789012\n`);
  const drift = runTool(['--json', '--check', `${zhSig}/${enSig}`, '--backlog', driftFile]);
  assert.equal(drift.status, 0, drift.stderr);
  const driftJson = JSON.parse(drift.stdout);
  assert.equal(driftJson.verdict, 'drift');
  assert.equal(driftJson.actionNeeded, true);
  assert.equal(driftJson.behaviorNote.includes('人工重评'), true);

  const human = runTool(['--check', zhSig, '--backlog', driftFile]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /WARN action-needed/);
  assert.match(human.stdout, /MISMATCH/);
});

test('工具：BACKLOG 读不到 / --check 参数坏 → 真实异常 exit 1', () => {
  const missing = path.join(makeTmp('fk-eval-fresh-'), 'nope.md');
  assert.equal(runTool(['--json', '--backlog', missing]).status, 1);
  assert.equal(runTool(['--check', 'nothex']).status, 1);
});
