// check-loop §1 红线判低：否定语境剔除 + 项目策略 redline.activeOnly（2026-11-28）
// 背景：装户仓一份 done 的 L1 plan 因正文「不触 API/DTO/schema」被判红线 hard-block，而同一提交在 CI
// （项目 fork 注入）为绿——同一提交两套判据，本地推送被卡。本用例锁三件事：
//   ① 否定声明不计入触达面（并打印豁免行，可自证）；
//   ② 缺省行为不变：终态文档仍全量判定（不静默放行）；
//   ③ `.agents/config/check-loop.json` 的 redline.activeOnly=true 时跳过终态，但活跃态（approved）照判。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(KIT, 'templates', 'engine', '.agents', 'scripts');
const CHECK_LOOP = path.join(SCRIPTS, 'check-loop.mjs');
const ENUMS_SRC = path.join(KIT, 'templates', 'engine', '.agents', 'config', 'workflow-enums.txt');

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function writePlan(dir, name, { status, body }) {
  const file = path.join(dir, 'workflow', 'plans', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\n状态: ${status}\n级别: L1\n---\n\n# PLAN\n\n${body}\n`);
}

function makeRepo(plan, projectPolicy = null) {
  const dir = makeTmp('flow-kit-check-loop-redline-');
  const cfgDir = path.join(dir, '.agents', 'config');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.copyFileSync(ENUMS_SRC, path.join(cfgDir, 'workflow-enums.txt'));
  if (projectPolicy) fs.writeFileSync(path.join(cfgDir, 'check-loop.json'), JSON.stringify(projectPolicy));
  writePlan(dir, plan.name, plan);
  git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init']);
  return dir;
}

function runLoop(dir) {
  return spawnSync(process.execPath, [CHECK_LOOP], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      FLOW_KIT_TEST: '1',
      FLOW_KIT_RUNTIME_SCRIPTS: SCRIPTS,
      CHECK_LOOP_VERBOSE: '1',
      CHECK_LOOP_ROOT: '',
      CHECK_LOOP_FULL: '1',
    },
  });
}

// 文件名日期早于 kitPolicy.confirmDocsEffective（2026-09-28）：让终态文档走 §15「存量豁免」，
// 本用例只锁 §1 红线判低，不与确认台账纠缠（台账面由 s15 自己的用例覆盖）。
const NAME = '2026-08-01-negation-and-policy.md';

test('否定声明（不触 … schema）不计入触达面，且打印豁免行', () => {
  const dir = makeRepo({ name: NAME, status: 'draft', body: '判级自查：不触 API/DTO/schema，纯前端交互。' });
  const r = runLoop(dir);
  assert.equal(r.status, 0, `否定声明不应判红线：\n${r.stdout}${r.stderr}`);
  assert.ok(!r.stderr.includes('[红线判低]'), r.stderr);
  assert.match(r.stderr, /红线判低豁免（否定声明）/);
});

test('缺省行为不变：终态文档的裸触达仍判红线', () => {
  const dir = makeRepo({ name: NAME, status: 'superseded', body: '本批涉及 schema 变更（新增两列）。' });
  const r = runLoop(dir);
  assert.equal(r.status, 1, `缺省应判红线：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /\[红线判低\][^\n]*触达schema/);
});

test('redline.activeOnly=true：终态文档跳过，活跃态（approved）照判', () => {
  const policy = { redline: { activeOnly: true } };
  const done = makeRepo({ name: NAME, status: 'superseded', body: '本批涉及 schema 变更（新增两列）。' }, policy);
  const rDone = runLoop(done);
  assert.equal(rDone.status, 0, `终态应被策略跳过：\n${rDone.stdout}${rDone.stderr}`);
  assert.ok(!rDone.stderr.includes('[红线判低]'), rDone.stderr);

  const approved = makeRepo({ name: NAME, status: 'approved', body: '本批涉及 schema 变更（新增两列）。' }, policy);
  const rApproved = runLoop(approved);
  assert.equal(rApproved.status, 1, `活跃态仍应判红线：\n${rApproved.stdout}${rApproved.stderr}`);
  assert.match(rApproved.stderr, /\[红线判低\]/);
});
