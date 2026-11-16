// projectTasks 纯函数测试（2026-11-16 P3 任务投影）——只测新增聚合面：入口配对（含 L1 plan 即入口）、
// spec 三件套齐缺、confirmations 台账计数、nextHint 查表。
// 边界：gen-workflow-index 的 CLI 生成面旧测试已随引擎减重退役（2026-10-28，owner 决策），此处不回建。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectTasks } from '../templates/engine/.agents/scripts/gen-workflow-index.mjs';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
}

// 中文键 frontmatter（intents/plans/incidents 与 spec 文档同一受限子集，对照 _TEMPLATE.md）
const zhDoc = ({ status, level, date, module = 'engine', flow = '' }, title) =>
  `---\n状态: ${status}\n级别: ${level}\n日期: ${date}\n模块: ${module}${flow ? `\n流程: ${flow}` : ''}\n---\n\n# INTENT — ${title}\n`;

// spec 三件套包（workflow/specs/<name>/，spec.md 用英文键，对照 scaffold specs/_TEMPLATE/）
function seedPackage(root, name, { specStatus = 'draft', tasks = ['- [ ] T1 实现', '- [x] T2 测试'], verify } = {}) {
  write(root, `workflow/specs/${name}/spec.md`, `---\nstatus: ${specStatus}\nlevel: M\n---\n\n# ${name} Spec\n`);
  write(root, `workflow/specs/${name}/tasks.md`, `# ${name} Tasks\n\n${tasks.join('\n')}\n`);
  if (verify !== undefined) {
    write(root, `workflow/specs/${name}/verify-report.md`, `# Verify\n\n## 结果\n\n结论: ${verify}\n\n## 证据\n\n- 测试命令：npm test\n`);
  }
}

test('L1 plan 即入口：plan-only 单件成任务，无台账时 confirmations 为 0 且不炸', () => {
  const root = makeTmp('fk-ptasks-l1-');
  write(root, 'workflow/plans/2026-11-01-solo.md', zhDoc({ status: 'approved', level: 'L1', date: '2026-11-01' }, 'solo'));
  const tasks = projectTasks(root);
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.equal(t.name, '2026-11-01-solo');
  assert.equal(t.entryType, 'plan');
  assert.equal(t.level, 'L1');
  assert.equal(t.status, 'approved');
  assert.deepEqual(t.plan, { status: 'approved' }); // plan 即入口：plan 字段指向自身
  assert.equal(t.spec, null);
  assert.equal(t.confirmations, 0); // .agents/ 台账缺失：0，不抛
  assert.equal(t.nextHint, '齐备，待关单');
});

test('排序稳定（date, name）', () => {
  const root = makeTmp('fk-ptasks-sort-');
  write(root, 'workflow/plans/2026-11-02-b.md', zhDoc({ status: 'approved', level: 'L1', date: '2026-11-02' }, 'b'));
  write(root, 'workflow/plans/2026-10-20-a.md', zhDoc({ status: 'approved', level: 'L1', date: '2026-10-20' }, 'a'));
  write(root, 'workflow/plans/2026-11-02-a.md', zhDoc({ status: 'approved', level: 'L1', date: '2026-11-02' }, 'a'));
  const tasks = projectTasks(root);
  assert.deepEqual(tasks.map((t) => t.name), ['2026-10-20-a', '2026-11-02-a', '2026-11-02-b']);
});

test('L2 intent+spec 包+plan 完整（verify=pass）：齐备待关单，confirmations 主台账+分片合并计数', () => {
  const root = makeTmp('fk-ptasks-full-');
  write(root, 'workflow/intents/2026-11-02-full.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-02', module: 'board' }, 'full'));
  write(root, 'workflow/plans/2026-11-02-full.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-02', module: 'board' }, 'full'));
  seedPackage(root, '2026-11-02-full', { verify: 'pass' });
  // 主台账（两行同名族：intent 行 + plan 行，stage 不同不去重掉）+ 一行他者文档 + 分片一行
  write(root, '.agents/confirmations.jsonl', [
    JSON.stringify({ ts: '2026-11-02T10:00:00Z', doc: 'workflow/intents/2026-11-02-full.md', stage: 'draft→approved', fingerprint: 'fa' }),
    JSON.stringify({ ts: '2026-11-02T11:00:00Z', doc: 'workflow/plans/2026-11-02-full.md', stage: 'draft→approved', fingerprint: 'fb' }),
    JSON.stringify({ ts: '2026-11-02T12:00:00Z', doc: 'workflow/intents/other.md', stage: 'draft→approved', fingerprint: 'fc' }),
    '',
  ].join('\n'));
  write(root, '.agents/confirmations.d/2026-11-02-full.jsonl', `${JSON.stringify({ ts: '2026-11-03T09:00:00Z', doc: 'workflow/intents/2026-11-02-full.md', stage: 'approved→done', fingerprint: 'fd' })}\n`);
  const tasks = projectTasks(root);
  assert.equal(tasks.length, 1); // 同名 plan 非 L1 不成第二任务（挂在 intent 下）
  const t = tasks[0];
  assert.equal(t.entryType, 'intent');
  assert.deepEqual(t.plan, { status: 'approved' });
  assert.deepEqual(t.spec, { present: true, specStatus: 'draft', tasksChecked: 1, tasksTotal: 2, verifyConclusion: 'pass' });
  assert.equal(t.confirmations, 3); // 主台账 2 行 + 分片 1 行；other.md 不计（按文档名匹配）
  assert.equal(t.nextHint, '齐备，待关单');
});

test('L2 缺 spec（无包也无同名文档）：待 Design（缺 spec）', () => {
  const root = makeTmp('fk-ptasks-nospec-');
  write(root, 'workflow/intents/2026-11-03-nospec.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-03' }, 'nospec'));
  write(root, 'workflow/plans/2026-11-03-nospec.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-03' }, 'nospec'));
  const [t] = projectTasks(root);
  assert.equal(t.spec, null);
  assert.equal(t.nextHint, '待 Design（缺 spec）');
});

test('L2 有 spec 包缺 verify-report.md：待验证（缺 verify-report）', () => {
  const root = makeTmp('fk-ptasks-noverify-');
  write(root, 'workflow/intents/2026-11-04-noverify.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-04' }, 'noverify'));
  write(root, 'workflow/plans/2026-11-04-noverify.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-04' }, 'noverify'));
  seedPackage(root, '2026-11-04-noverify'); // verify 未传 → 不写 verify-report.md
  const [t] = projectTasks(root);
  assert.equal(t.spec.present, true);
  assert.equal(t.spec.verifyConclusion, null);
  assert.equal(t.nextHint, '待验证（缺 verify-report）');
});

test('verify 结论 fail / partial 各自命中对应 advisory 文案', () => {
  const root = makeTmp('fk-ptasks-fail-');
  write(root, 'workflow/intents/2026-11-05-fail.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-05' }, 'fail'));
  write(root, 'workflow/plans/2026-11-05-fail.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-05' }, 'fail'));
  seedPackage(root, '2026-11-05-fail', { verify: 'fail' });
  write(root, 'workflow/intents/2026-11-06-partial.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-06' }, 'partial'));
  write(root, 'workflow/plans/2026-11-06-partial.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-06' }, 'partial'));
  seedPackage(root, '2026-11-06-partial', { verify: 'partial' });
  const tasks = projectTasks(root);
  assert.deepEqual(tasks.map((t) => t.nextHint), ['verify 结论 fail，待修复', 'verify 结论 partial，待补验']);
});

test('draft 入口 / incident legacy 豁免 plan / spec 文档在场但包缺席', () => {
  const root = makeTmp('fk-ptasks-mix-');
  // draft：先确认，再看产物
  write(root, 'workflow/intents/2026-11-07-draft.md', zhDoc({ status: 'draft', level: 'L2', date: '2026-11-07' }, 'draft'));
  // legacy incident：免 plan 配对（对照看板 legacyIncident 豁免），L1 免 spec → 齐备
  write(root, 'workflow/incidents/2026-11-08-legacy.md', zhDoc({ status: 'open', level: 'L1', date: '2026-11-08', flow: 'legacy' }, 'legacy'));
  // spec 文档在场、包缺席：Design 已起步，但 tasks/verify 只在包 → 待验证
  write(root, 'workflow/intents/2026-11-09-doconly.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-09' }, 'doconly'));
  write(root, 'workflow/plans/2026-11-09-doconly.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-09' }, 'doconly'));
  write(root, 'workflow/specs/2026-11-09-doconly.md', zhDoc({ status: 'approved', level: 'L2', date: '2026-11-09' }, 'doconly'));
  const tasks = projectTasks(root);
  const byName = Object.fromEntries(tasks.map((t) => [t.name, t]));
  assert.equal(byName['2026-11-07-draft'].nextHint, '待确认（draft）');
  assert.equal(byName['2026-11-08-legacy'].entryType, 'incident');
  assert.equal(byName['2026-11-08-legacy'].plan, null);
  assert.equal(byName['2026-11-08-legacy'].nextHint, '齐备，待关单'); // legacy 免 plan、L1 免 spec
  assert.equal(byName['2026-11-09-doconly'].spec.specStatus, 'approved'); // 中文键状态兜底
  assert.equal(byName['2026-11-09-doconly'].spec.tasksTotal, 0);
  assert.equal(byName['2026-11-09-doconly'].nextHint, '待验证（缺 verify-report）');
});

test('CLI 生成器把任务投影写进 INDEX（fixture 全链路，抽查生成节）', () => {
  const root = makeTmp('fk-ptasks-index-');
  // scaffold 新装户四目录俱全（scan() 沿既有口径按目录直下扫描）
  for (const d of ['intents', 'incidents', 'plans', 'specs']) fs.mkdirSync(path.join(root, 'workflow', d), { recursive: true });
  write(root, 'workflow/plans/2026-11-01-solo.md', zhDoc({ status: 'approved', level: 'L1', date: '2026-11-01' }, 'solo'));
  const r = spawnSync(process.execPath, [path.join(KIT, 'templates/engine/.agents/scripts/gen-workflow-index.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const index = fs.readFileSync(path.join(root, 'workflow/INDEX.md'), 'utf8');
  assert.ok(index.includes('## 任务投影（1）'));
  assert.ok(index.includes('| 2026-11-01-solo | L1 | approved | — | — | 0 | 齐备，待关单 |'));
  assert.ok(index.includes('## 档案计数'));
});

test('隔离：pipeline 任务目录（workflow/tasks/）不进入手动任务投影', () => {
  const root = makeTmp('fk-ptasks-iso-');
  // 手动路径任务（正常投影）
  write(root, 'workflow/plans/2026-11-01-solo.md', zhDoc({ status: 'approved', level: 'L1', date: '2026-11-01' }, 'solo'));
  // pipeline 自动化产物（2026-11-16 起 pipeline-run 落点）——手动扫描器不扫 tasks/
  write(root, 'workflow/tasks/2026-11-02-auto/intent.md', zhDoc({ status: 'draft', level: 'L2', date: '2026-11-02' }, 'auto'));
  write(root, 'workflow/tasks/2026-11-02-auto/plan.md', zhDoc({ status: 'draft', level: 'L2', date: '2026-11-02' }, 'auto'));
  const tasks = projectTasks(root);
  assert.deepEqual(tasks.map((t) => t.name), ['2026-11-01-solo'], 'tasks/ 下文档不参与手动投影');
});
