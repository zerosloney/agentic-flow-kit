import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { reportBudgetStats } from '../templates/engine/.agents/scripts/agg-delegations.mjs';
import { collect, renderMarkdown } from '../templates/engine/.agents/scripts/outcome-metrics.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROLES = ['implementer', 'independent-reviewer', 'pr-adjudicator', 'pr-finder', 'pr-verifier', 'ui-verifier', 'wiki-compiler'];

function read(rel) {
  return fs.readFileSync(path.join(KIT, rel), 'utf8');
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

// 月度分片样例：委派表表头 + 一行带备注的委派记录（备注长度可控）
function shard(remarkChars) {
  const remark = remarkChars > 0 ? '派发报告预算样例备注'.repeat(Math.ceil(remarkChars / 10)).slice(0, remarkChars) : '';
  const row = remark ? `| 2026-11-10 | GLM | 实现样例功能 | 一次通过 | ${remark} | |\n` : '';
  return [
    '## 委派结果',
    '',
    '| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 | 返工原因 |',
    '|------|----------------|------------|------|------|----------|',
    row,
  ].join('\n');
}

function seedBudgetRoot(root, { withConfig = true } = {}) {
  write(root, 'workflow/delegations.md', '# 委派台账\n');
  write(root, 'workflow/delegations.d/2026-11.md', shard(600)); // 超限月（>500）
  write(root, 'workflow/delegations.d/2026-10.md', shard(80)); // 预算内月
  if (withConfig) {
    const cfg = read('templates/engine/.agents/config/dispatch.json');
    write(root, '.agents/config/dispatch.json', cfg);
  }
  return root;
}

test('dispatch.json parses with valid budget fields and advisory note', () => {
  const cfg = JSON.parse(read('templates/engine/.agents/config/dispatch.json'));
  assert.equal(cfg.version, 1);
  assert.equal(Number.isInteger(cfg.maxParallel) && cfg.maxParallel >= 1, true);
  assert.equal(Number.isInteger(cfg.reportBudgetChars) && cfg.reportBudgetChars > 0, true);
  assert.equal(cfg.reportBudgetChars, 500);
  assert.match(cfg.note, /只计量不阻断/);
  assert.match(cfg.note, /2026-11-16/); // 与 gate-budgets.json 同风格：note 写明依据与日期
});

test('all 7 role files (zh + en overrides) carry the report budget line', () => {
  for (const role of ROLES) {
    const zh = read(`templates/engine/.agents/roles/${role}.md`);
    assert.match(zh, /reportBudgetChars/, `${role}.md 缺预算单源引用`);
    assert.match(zh, /500/, `${role}.md 缺 500 字符预算`);
    const en = read(`locales/en/overrides/.agents/roles/${role}.md`);
    assert.match(en, /reportBudgetChars/, `en override ${role}.md 缺预算单源引用`);
  }
});

test('reportBudgetStats meters delegations.d shard body chars against the budget', () => {
  const root = seedBudgetRoot(makeTmp('dispatch-budget-'));
  const rb = reportBudgetStats(root);
  assert.equal(rb.budget, 500);
  assert.equal(rb.hasShards, true);
  assert.equal(rb.byMonth.length, 2);
  const nov = rb.byMonth.find((x) => x.ym === '2026-11');
  const oct = rb.byMonth.find((x) => x.ym === '2026-10');
  assert.equal(nov.over, true); // 600 字符样例 → 超限可辨识
  assert.equal(oct.over, false);
  assert.equal(rb.overCount, 1);
});

test('agg-delegations prints the budget section and marks over-budget months', () => {
  const root = seedBudgetRoot(makeTmp('dispatch-budget-cli-'));
  const r = spawnSync(process.execPath, [path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'agg-delegations.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /## 派发报告预算（单源 \.agents\/config\/dispatch\.json reportBudgetChars=500；advisory 只计量不阻断）/);
  assert.match(r.stdout, /2026-11｜delegations\.d\/2026-11\.md 正文字符 \d+\/500（口径：分片去空白字符合计，非逐报告全文） ❌ 超限/);
  assert.match(r.stdout, /2026-10｜delegations\.d\/2026-10\.md 正文字符 \d+\/500（口径：分片去空白字符合计，非逐报告全文） ✅ 预算内/);
});

test('budget metering is advisory: missing dispatch.json still lists chars without verdict', () => {
  const root = seedBudgetRoot(makeTmp('dispatch-budget-advisory-'), { withConfig: false });
  const rb = reportBudgetStats(root);
  assert.equal(rb.budget, null);
  assert.equal(rb.configMissing, true);
  assert.equal(rb.overCount, 0); // 无预算不判超限（只计量）
  const r = spawnSync(process.execPath, [path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'agg-delegations.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /预算单源缺失\/非法：只列字数，不判超限/);
  assert.doesNotMatch(r.stdout, /超限 \+/);
});

test('outcome-metrics surfaces over-budget months through its aggregation', () => {
  const root = seedBudgetRoot(makeTmp('dispatch-budget-outcome-'));
  const m = collect(root, { days: 30 });
  assert.equal(m.reportBudget.budget, 500);
  assert.equal(m.reportBudget.overCount, 1);
  // overMonths 期望值从 fixture 独立推导（分片去空白字符总数），不依赖被测实现
  assert.deepEqual(m.reportBudget.overMonths, [`2026-11:${shard(600).replace(/\s+/g, '').length}`]);
  const md = renderMarkdown(m);
  assert.match(md, /派发报告预算超限/);
  assert.match(md, /超限 1\/2 月/);
  assert.match(md, /非逐报告全文/); // 口径在列名/单元格标明
});

test('outcome-metrics lists budget sources as missing when absent', () => {
  const root = makeTmp('dispatch-budget-missing-');
  const m = collect(root, { days: 30 });
  assert.ok(m.missing.includes('.agents/config/dispatch.json'));
  assert.ok(m.missing.includes('workflow/delegations.d/'));
  const md = renderMarkdown(m);
  assert.match(md, /数据缺口/);
});
