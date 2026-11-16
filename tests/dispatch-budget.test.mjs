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

// 月度分片样例：委派表表头 + N 行带备注的委派记录（备注长度可控；N 行 = N 份报告）
function shardRows(remarkCharsList) {
  const rows = remarkCharsList.map((c, i) => `| 2026-11-${10 + i} | GLM | 实现样例功能 | 一次通过 | ${'派发报告预算样例备注'.repeat(Math.ceil(c / 10)).slice(0, c)} | |`);
  return [
    '## 委派结果',
    '',
    '| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 | 返工原因 |',
    '|------|----------------|------------|------|------|----------|',
    ...rows,
  ].join('\n');
}

function shard(remarkChars) {
  return shardRows(remarkChars > 0 ? [remarkChars] : []); // 0 → 纯表头分片（无数据行）
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
  assert.equal(nov.reports, 1); // 单报告月：数据行数 = 1
  assert.equal(oct.reports, 1);
  assert.equal(nov.chars, shard(600).replace(/\s+/g, '').length); // 计量口径不变：整月分片去空白字符
  assert.equal(nov.over, true); // 单报告 ~600 字 > 1×500 预算 → 超限可辨识
  assert.equal(oct.over, false);
  assert.equal(rb.overCount, 1);
});

test('multi-report month weights budget by report count (old per-month cap would false-flag)', () => {
  const root = makeTmp('dispatch-budget-multi-');
  write(root, 'workflow/delegations.md', '# 委派台账\n');
  write(root, 'workflow/delegations.d/2026-11.md', shardRows([400, 400])); // 2 份报告、月合计远超单报告预算
  write(root, '.agents/config/dispatch.json', read('templates/engine/.agents/config/dispatch.json'));
  const rb = reportBudgetStats(root);
  const nov = rb.byMonth.find((x) => x.ym === '2026-11');
  const chars = shardRows([400, 400]).replace(/\s+/g, '').length; // 期望值独立推导，不依赖被测实现
  assert.equal(nov.reports, 2);
  assert.equal(nov.chars, chars);
  assert.ok(chars > 500, 'fixture sanity：月合计须超单报告预算（旧口径必误报）');
  assert.ok(chars <= 1000, 'fixture sanity：月合计须在报告数×预算内（新口径不超限）');
  assert.equal(nov.over, false); // 旧口径 chars>500 误判超限；新口径 2 报告 × 500 → 预算内
  assert.equal(rb.overCount, 0);
});

test('header-only shard has reports=0 and never flags over (headers are not billable)', () => {
  const root = makeTmp('dispatch-budget-empty-');
  write(root, 'workflow/delegations.md', '# 委派台账\n');
  write(root, 'workflow/delegations.d/2026-11.md', shard(0)); // 只有表头/分隔行，无数据行
  write(root, '.agents/config/dispatch.json', read('templates/engine/.agents/config/dispatch.json'));
  const rb = reportBudgetStats(root);
  const nov = rb.byMonth.find((x) => x.ym === '2026-11');
  assert.equal(nov.reports, 0);
  assert.ok(nov.chars > 0); // 表头仍有字数，但不属任何一份报告、不计费
  assert.equal(nov.over, false); // reports=0 一律不判超限（表头字数不误判）
  assert.equal(rb.overCount, 0);
});

test('self-done rows in the shard are not counted as reports (delegated rows only)', () => {
  // delegations 分片含「委派结果 / 自做任务结果」两节：reports 只计委派节（自做行不是派发报告）。
  // 委派 1 行（备注 600 字 > 500 预算）+ 自做 2 行：新口径 reports=1、上限=500 → 超限可辨识；
  // 旧口径整分片逐行 isDataRow 会计 reports=3、上限=1500 → 600 字被误判预算内（本用例钉死该回归）。
  const delegated = shardRows([600]);
  const selfDone = [
    '## 自做任务结果',
    '',
    '| 日期 | 任务一句话 | 结果 | 备注 | 返工原因 |',
    '|------|------------|------|------|----------|',
    '| 2026-11-11 | 自做任务甲 | 一次通过 | | |',
    '| 2026-11-12 | 自做任务乙 | 一次通过 | | |',
  ].join('\n');
  const mixed = `${delegated}\n\n${selfDone}`;
  const root = makeTmp('dispatch-budget-mixed-');
  write(root, 'workflow/delegations.md', '# 委派台账\n');
  write(root, 'workflow/delegations.d/2026-11.md', mixed);
  write(root, '.agents/config/dispatch.json', read('templates/engine/.agents/config/dispatch.json'));
  const rb = reportBudgetStats(root);
  const nov = rb.byMonth.find((x) => x.ym === '2026-11');
  assert.equal(nov.reports, 1); // 委派 1 行 + 自做 2 行 → 只计委派行
  assert.equal(nov.chars, mixed.replace(/\s+/g, '').length); // 字数口径不变：整分片去空白字符
  assert.equal(nov.over, true); // 上限=1×500：旧口径 reports=3→上限 1500 会误判预算内
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
  assert.match(r.stdout, /2026-11｜delegations\.d\/2026-11\.md 正文字符 \d+\/500（口径：1 报告（=委派行数）×500，分片去空白字符合计） ❌ 超限 \+\d+/);
  assert.match(r.stdout, /2026-10｜delegations\.d\/2026-10\.md 正文字符 \d+\/500（口径：1 报告（=委派行数）×500，分片去空白字符合计） ✅ 预算内/);
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
  assert.match(md, /报告数×单报告预算/); // 口径在列名/单元格标明（按月·报告数加权）
});

test('outcome-metrics lists budget sources as missing when absent', () => {
  const root = makeTmp('dispatch-budget-missing-');
  const m = collect(root, { days: 30 });
  assert.ok(m.missing.includes('.agents/config/dispatch.json'));
  assert.ok(m.missing.includes('workflow/delegations.d/'));
  const md = renderMarkdown(m);
  assert.match(md, /数据缺口/);
});
