// stage-gates.mjs 机读节标题回归（issue #56，2026-11-16 装户实证）：模型产出的 spec 常带编号章节，
// 「## 8. 歧义清单」「## 9. 前提质询」曾因 ^##\s*关键词\s*$ 不容忍编号前缀被判「缺节」，确认门拒。
// 解析层统一容忍 `数字[.、)]` 前缀（与 check-scope.mjs 同期修复同款）；真缺节仍 found:false 不误放行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClarifyTable, parsePremiseTable } from '../templates/engine/.agents/scripts/stage-gates.mjs';

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
