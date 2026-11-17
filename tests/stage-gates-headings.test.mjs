// stage-gates.mjs 机读节标题回归（issue #56，2026-11-16 装户实证）：模型产出的 spec 常带编号章节，
// 「## 8. 歧义清单」「## 9. 前提质询」曾因 ^##\s*关键词\s*$ 不容忍编号前缀被判「缺节」，确认门拒。
// 解析层统一容忍 `数字[.、)]` 前缀（与 check-scope.mjs 同期修复同款）；真缺节仍 found:false 不误放行。
// 另承载承诺面指纹回归（issue #67，2026-11-17）：commitmentFingerprint ⑤' 表格证据列归一——spec
// 验收判据表把证据写在独立列（无「证据：」token），仅回填证据列曾被判承诺面改写、confirm-doc 拒关单；
// 列结构变化（增删列 / 列数漂移）仍须被指纹捕捉。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClarifyTable, parsePremiseTable, commitmentFingerprint } from '../templates/engine/.agents/scripts/stage-gates.mjs';

const SPEC = [
  '# SPEC — demo',
  '',
  '## 1. 目标',
  '做点什么',
  '',
  '## 8. 歧义清单',
  '',
  '| 维度 | 结论 | 依据 | 状态 |',
  '|---|---|---|---|',
  '| 方案分叉 | 取 B | 实验闭环 | 已关闭 |',
  '',
  '## 9. 前提质询',
  '',
  '| 前提 | 质询 | 结论 |',
  '|---|---|---|',
  '| 展示诉求 vs 存储改写 | 换成对立解读会怎样 | 用户原话选定 |',
  '',
].join('\n');

test('编号节标题「## 8. 歧义清单」照常解析（found + 行数据）', () => {
  const r = parseClarifyTable(SPEC);
  assert.equal(r.found, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].dim, '方案分叉');
  assert.equal(r.rows[0].concl, '取 B');
});

test('编号节标题「## 9. 前提质询」照常解析（found + 行数据）', () => {
  const r = parsePremiseTable(SPEC);
  assert.equal(r.found, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].premise, '展示诉求 vs 存储改写');
});

test('无编号基线形态与「8、」「8)」变体同样命中；真缺节仍 found:false', () => {
  const ok = (h) => parseClarifyTable(`x\n\n${h}\n\n| 维度 | 结论 | 依据 | 状态 |\n|---|---|---|---|\n| d | c | b | s |\n`).found;
  assert.equal(ok('## 歧义清单'), true); // 基线形态不回归
  assert.equal(ok('## 8、歧义清单'), true); // 顿号变体
  assert.equal(ok('## 8) 歧义清单'), true); // 括号变体
  assert.equal(parseClarifyTable('x\n\n## 其他节\n').found, false); // 真缺节不误放行
  assert.equal(parsePremiseTable('x\n\n## 其他节\n').found, false);
});

// ---- 承诺面指纹：⑤' 表格证据列归一（issue #67）----
// 数据取 issue #67 最小复现的两行 markdown（仅验收判据表第 2 列证据不同）。
const CRIT67 = '现有 12 个 `ResizableTable` 消费方零改动编译通过，`npm run build` 与 eslint 0 error。';
const accTable = (...rows) => ['## 验收判据',
  '| 判据（可观察行为） | 证据（测试文件 / 命令 / 证据文件） | 状态 | 对应验收 |',
  '|---|---|---|---|', ...rows, ''].join('\n');
const row67 = (ev, crit = CRIT67) => `| ${crit} | ${ev} | 覆盖 | A1 |`;
const EV67_A = '`cd frontend && npm run build`；`cd frontend && npx eslint …`';
const EV67_B = '`frontend/src/components/ResizableTable.vue`；`frontend/tests/unit/resizableTable.spec.ts`';

test('issue #67 回归：仅「验收判据」表证据列（第 2 列）不同 → 承诺面指纹相等', () => {
  const before = accTable(row67(EV67_A));
  const after = accTable(row67(EV67_B));
  assert.notEqual(before, after); // 原文确有差异
  assert.equal(commitmentFingerprint(after), commitmentFingerprint(before));
});

test('表内判据列（第 1 列）文本变化仍被指纹捕捉（承诺仍绑定）', () => {
  const base = commitmentFingerprint(accTable(row67(EV67_A)));
  const critChanged = commitmentFingerprint(accTable(row67(EV67_A, '现有 12 个消费方编译失败，`npm run build` 1 error。')));
  assert.notEqual(critChanged, base);
});

test('表结构变化仍被指纹捕捉：增一列（表头+分隔+数据行同变）；仅数据行多一格（列数漂移）', () => {
  const base = commitmentFingerprint(accTable(row67(EV67_A)));
  const colAdded = commitmentFingerprint(['## 验收判据',
    '| 判据（可观察行为） | 证据（测试文件 / 命令 / 证据文件） | 状态 | 对应验收 | 备注 |',
    '|---|---|---|---|---|',
    `| ${CRIT67} | ${EV67_A} | 覆盖 | A1 | 附注 |`, ''].join('\n'));
  assert.notEqual(colAdded, base);
  const drifted = commitmentFingerprint(accTable(`| ${CRIT67} | ${EV67_A} | 覆盖 | A1 | 多出的一格 |`));
  assert.notEqual(drifted, base);
});

test('多个证据列同口径：两列表头均含「证据」，改任一证据列指纹不变', () => {
  const two = (e1, e2) => ['## 验收判据',
    '| 判据（可观察行为） | 证据（命令） | 状态 | 证据文件（路径） |',
    '|---|---|---|---|',
    `| ${CRIT67} | ${e1} | 覆盖 | ${e2} |`, ''].join('\n');
  assert.equal(commitmentFingerprint(two('npm test', 'a.spec.ts')), commitmentFingerprint(two('npm run build', 'b.spec.ts')));
});

test('行内证据尾注与勾选归一零回归；表格列置空与行内剥除可叠加', () => {
  // 行内形态（⑤）：勾验收 + 换证据 = 合法关单动作，指纹不变
  assert.equal(commitmentFingerprint('- [ ] 构建通过（证据：commit def）'), commitmentFingerprint('- [x] 构建通过（证据：commit abc）'));
  // 叠加顺序（表格列置空先于行内剥除）：判据单元格带行内证据尾注 + 证据列内容不同 → 归一相等
  const mixA = accTable(`| ${CRIT67}（证据：评审记录 X） | path/a | 覆盖 | A1 |`);
  const mixB = accTable(`| ${CRIT67} | path/b | 覆盖 | A1 |`);
  assert.equal(commitmentFingerprint(mixA), commitmentFingerprint(mixB));
});

test('表头不含「证据」的表不剥列：数据单元格含「证据」字样仍计入承诺面', () => {
  const a = commitmentFingerprint(['| 维度 | 结论 |', '|---|---|', '| 数据口径 | 证据不足 |', ''].join('\n'));
  const b = commitmentFingerprint(['| 维度 | 结论 |', '|---|---|', '| 数据口径 | 证据充分 |', ''].join('\n'));
  assert.notEqual(b, a);
});
