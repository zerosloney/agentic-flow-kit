import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { reportBudgetStats } from '../templates/engine/.agents/scripts/agg-delegations.mjs';
import { collect, renderMarkdown } from '../templates/engine/.agents/scripts/outcome-metrics.mjs';
import { renderPlan } from '../templates/engine/.agents/scripts/fill-plan.mjs';
import { buildTour } from '../templates/engine/.agents/scripts/dev-tour-model.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROLES = ['implementer', 'independent-reviewer', 'pr-adjudicator', 'pr-finder', 'pr-verifier', 'ui-verifier', 'wiki-compiler', 'test-designer'];

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

test('all 8 role files (zh + en overrides) carry the report budget line', () => {
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

// BACKLOG #16：任务粒度判据（垂直切片 + 触达面预算，advisory）。
// 三处必须同形状：模板（zh/en）、生成器 fill-plan、playbook stages.md Build §3（预算单源）。
test('plan task rows carry a slice criterion in template, generator and playbook', () => {
  const generated = renderPlan({ topic: 'slice', level: 'L2' }).body;
  const tasks = generated.split('## 任务拆解')[1].split('## 执行顺序')[0];
  assert.equal((tasks.match(/- \[ \] \d+\./g) || []).length, 2, 'two example tasks');
  assert.equal((tasks.match(/- 切片：/g) || []).length, 2, 'every task row has a slice line');
  assert.match(tasks, /stages\.md` Build §3/, 'generator points at the budget single source');

  for (const rel of [
    'templates/scaffold/workflow/plans/_TEMPLATE.md',
    'locales/en/overrides/workflow/plans/_TEMPLATE.md',
  ]) {
    assert.equal((read(rel).match(/- 切片：/g) || []).length, 2, `${rel} must carry the same row shape`);
  }

  for (const rel of [
    'templates/engine/.agents/commands/stages.md',
    'locales/en/overrides/.agents/commands/stages.md',
  ]) {
    const text = read(rel);
    assert.match(text, /≤5 /, `${rel} must state the file budget`);
    assert.match(text, /≤400 /, `${rel} must state the diff budget`);
    assert.match(text, /advisory/, `${rel} must keep the criterion advisory`);
  }
});

test('slice rows do not disturb dev-tour step×file or dependency parsing', () => {
  const root = makeTmp('dispatch-budget-slice-');
  const git = { files: { 'src/api/supplier.ts': { added: 12, deleted: 1 }, 'src/views/SupplierList.vue': { added: 8, deleted: 2 } } };
  const base = [
    '---', '状态: approved', '级别: L2', '日期: 2026-11-17', '模块: pipeline', '---',
    '# PLAN — slice', '', '## 任务拆解', '',
    '- [ ] 1. 新建供应商端到端',
    '   - 文件：src/api/supplier.ts',
    '   - 判据：接口返回新行',
    '   - 依赖：无（可立即开工）',
    '   - 风险：低',
    '- [ ] 2. 列表显示新行',
    '   - 文件：src/views/SupplierList.vue',
    '   - 判据：列表出现该行',
    '   - 依赖：被任务 1 阻塞',
    '   - 风险：低',
    '',
  ].join('\n');
  const withSlices = base
    .replace('   - 判据：接口返回新行', '   - 判据：接口返回新行\n   - 切片：新建后列表可查到该行；触达：1 文件 / 12 行')
    .replace('   - 判据：列表出现该行', '   - 判据：列表出现该行\n   - 切片：列表渲染新行；触达：1 文件 / 8 行');

  const docRel = 'workflow/plans/2026-11-17-slice.md';
  const model = (text) => {
    const abs = path.join(root, docRel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    return buildTour({ root, docPath: docRel, git });
  };
  // 插入行只会移动行号；比较时剔除 line 字段，其余（步骤×文件、依赖边、解析健康度）必须逐字相同。
  const dropLines = (v) => {
    if (Array.isArray(v)) return v.map(dropLines);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) if (k !== 'line') out[k] = dropLines(val);
      return out;
    }
    return v;
  };
  const shape = (m) => dropLines({
    steps: m.steps.map((s) => ({ title: s.title, files: s.files.map((f) => (typeof f === 'string' ? f : f.path)).sort() })),
    deps: m.deps,
    parseHealth: m.parseHealth,
  });
  const before = shape(model(base));
  const after = shape(model(withSlices));
  assert.ok(before.steps.length >= 2, 'fixture must parse into steps');
  assert.deepEqual(after, before, 'advisory slice rows must be inert to the tour model');
});

// BACKLOG #27：任务行形状单源漂移——模板（zh/en）与生成器 fill-plan 的骨架行类型集合必须一致。
// 2026-11-17 实测漂移：模板有「依赖」无「文件」（复制模板起 plan 过不了 --strict 每步文件门），
// 生成器有「文件」无「依赖」（生成器起 plan 缺 frontier 依赖锚）。统一行形状 = 文件/判据/切片/依赖/风险/留痕。
const ROW_TYPES = ['文件', '判据', '切片', '依赖', '风险', '留痕'];

// 取「任务拆解」节首任务块的行类型序列（有序比对，行顺序也属形状契约）
function firstTaskRowTypes(text) {
  const skeleton = text.split('## 任务拆解')[1].split('## 执行顺序')[0];
  const first = skeleton.split('- [ ] 1.')[1].split('- [ ] 2.')[0];
  return [...first.matchAll(/-\s*(文件|判据|切片|依赖|风险|留痕)[：:]/g)].map((m) => m[1]);
}

test('plan task-row shape is single-sourced: template (zh/en) row types equal the fill-plan skeleton', () => {
  const genTypes = firstTaskRowTypes(renderPlan({ topic: 'shape', level: 'L2' }).body);
  assert.deepEqual(genTypes, ROW_TYPES, 'fill-plan L2 skeleton must carry 文件/判据/切片/依赖/风险/留痕 in order');
  for (const rel of [
    'templates/scaffold/workflow/plans/_TEMPLATE.md',
    'locales/en/overrides/workflow/plans/_TEMPLATE.md',
  ]) {
    assert.deepEqual(firstTaskRowTypes(read(rel)), genTypes, `${rel} row-type sequence must equal the generator skeleton`);
  }
});

// 按骨架占位符逐行填实的夹具（两个任务各六行全填），路径用已知根目录前缀（backend/frontend）
// ——extractPaths 裸路径只认已知根目录，无须真实仓库即可直认步骤文件。
function fillSkeleton(text) {
  return text
    .replace('级别: L1', '级别: L2')
    .replace('- [ ] 1. <任务>', '- [ ] 1. 新建供应商端到端')
    .replace('- [ ] 2. <任务>', '- [ ] 2. 列表显示新行')
    .replace('   - 文件：<本步会改的文件路径；每步至少一个；纯验证步骤写「验证步骤：无代码文件」>', '   - 文件：backend/src/api/supplier.ts')
    .replace('   - 判据：<怎样算完成；尽量对应一个测试或可复现操作>', '   - 判据：接口返回新行')
    .replace('   - 切片：<端到端可演示的行为，如「新建供应商后列表出现该行」>；触达：<N 文件 / M 行>', '   - 切片：新建后列表可查到该行；触达：1 文件 / 12 行')
    .replace('   - 切片：<端到端可演示的行为>；触达：<N 文件 / M 行>', '   - 切片：新建后列表可查到该行；触达：1 文件 / 12 行')
    .replace('   - 依赖：无（可立即开工）/ 被任务 <N> 阻塞', '   - 依赖：无（可立即开工）')
    .replace('   - 风险：低 / 中 / 高（<原因>）', '   - 风险：低')
    .replace('   - 文件：…', '   - 文件：frontend/src/views/SupplierList.vue')
    .replace('   - 判据：…', '   - 判据：列表出现该行')
    .replace('   - 切片：…；触达：…', '   - 切片：列表渲染新行；触达：1 文件 / 8 行')
    .replace('   - 依赖：…', '   - 依赖：被任务 1 阻塞')
    .replace('   - 风险：…', '   - 风险：低');
}

test('a plan filled from the template skeleton passes the gen-dev-tour --strict per-step file gate', () => {
  const root = makeTmp('plan-shape-strict-');
  const abs = path.join(root, 'workflow', 'plans', '2026-11-17-shape.md');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, fillSkeleton(read('templates/scaffold/workflow/plans/_TEMPLATE.md')));
  const r = spawnSync(process.execPath, [
    path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'gen-dev-tour.mjs'),
    abs, '--no-diff', '--json', '--strict',
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0, `--strict gate must pass:\n${r.stderr}`);
  const model = JSON.parse(r.stdout);
  const steps = model.steps.filter((s) => s.source === 'tasks');
  assert.equal(steps.length, 2, 'both template tasks parse as direct steps');
  assert.deepEqual(steps.map((s) => [...s.files].sort()), [
    ['backend/src/api/supplier.ts'],
    ['frontend/src/views/SupplierList.vue'],
  ], 'each task step must bind its 文件 row path directly');
});

test('fill-plan L2 skeleton carries dependency anchors and dev-tour derives the frontier from them', () => {
  // 骨架本体含依赖锚（漂移的另一半：生成器曾有「文件」无「依赖」）
  const genTasks = renderPlan({ topic: 'frontier', level: 'L2' }).body.split('## 任务拆解')[1].split('## 执行顺序')[0];
  assert.equal((genTasks.match(/- 依赖：/g) || []).length, 2, 'generator skeleton must carry 依赖 rows for both example tasks');
  const root = makeTmp('plan-shape-frontier-');
  const docRel = 'workflow/plans/2026-11-17-frontier.md';
  const abs = path.join(root, docRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, fillSkeleton(renderPlan({ topic: 'frontier', level: 'L2' }).body));
  const git = {
    files: {
      'backend/src/api/supplier.ts': { added: 12, deleted: 1 },
      'frontend/src/views/SupplierList.vue': { added: 8, deleted: 2 },
    },
  };
  const model = buildTour({ root, docPath: docRel, git });
  assert.equal(model.deps.source, 'task-rows');
  assert.deepEqual(model.deps.edges, [{ from: 'T1', to: 'T2' }], '「被任务 1 阻塞」must produce the declared edge');
  assert.equal(model.deps.unresolved, 1, '「依赖：无（可立即开工）」has no predecessor to resolve (advisory, pre-existing behavior)');
  const frontier = model.steps.filter((s) => s.source !== 'git' && s.source !== 'fallback' && !model.deps.edges.some((e) => e.to === s.id));
  assert.deepEqual(frontier.map((s) => s.id), ['T1'], 'frontier = tasks with no unresolved blockers');
});
