// 审计 D39a：latestFreshVerifyLine 是 confirm-doc 关单 24h 新鲜度凭证的单源——verify.mjs
// --stub-gate 的桩门绿行（stub:true，suite=all-gates 但门表被注入命令整表替换）必须与
// testCmd / engineOnly 行同处置，不得满足新鲜度证明。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestFreshVerifyLine, hasFreshVerifyLine } from '../templates/engine/.agents/scripts/policy.mjs';

const NOW = Date.parse('2026-11-27T12:00:00.000Z');
const row = (over = {}) => JSON.stringify({
  ts: '2026-11-27T11:00:00.000Z', exitCode: 0, suite: 'all-gates', headShort: 'abc1234', ...over,
});

test('latestFreshVerifyLine：stub 绿行不算关单新鲜度凭证', () => {
  assert.equal(latestFreshVerifyLine([row({ stub: true })], NOW), null);
  assert.equal(hasFreshVerifyLine([row({ stub: true })], NOW), false);
});

test('latestFreshVerifyLine：stub 行被跳过，仍取窗口内更早的真实绿行', () => {
  const got = latestFreshVerifyLine([
    row({ ts: '2026-11-27T10:00:00.000Z', headShort: 'def5678' }),
    row({ ts: '2026-11-27T11:30:00.000Z', stub: true }),
  ], NOW);
  assert.equal(got && got.headShort, 'def5678');
});

test('latestFreshVerifyLine：真实绿行照常返回（回归护栏）', () => {
  const got = latestFreshVerifyLine([row()], NOW);
  assert.equal(got && got.headShort, 'abc1234');
});
