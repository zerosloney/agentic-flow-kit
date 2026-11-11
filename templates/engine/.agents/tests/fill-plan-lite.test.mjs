// fill-plan-lite.test.mjs — fill-plan --lite 三节模式测试（node:test + node:assert/strict，零新依赖）
// 被测：.agents/scripts/fill-plan.mjs（默认导出 renderPlan）
//
// 测四条（2026-11-10 档二放宽：L1 增加 --lite 三节模式）：
//   1. 默认 L1 仍为五节（--lite 缺省时行为不变，回归保护）；
//   2. --lite 时 L1 收为三节（入口 / 改动方案 / 验证与验收），但红线勾选行与「确认与复核」尾段保留；
//   3. frontmatter 三键（状态 / 级别 / 日期）lite 与默认一致；
//   4. L2/L3 仍走完整 4 节（--lite 不影响非 L1，回归保护）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import renderPlan from '../scripts/fill-plan.mjs';

const TODAY = new Date().toISOString().slice(0, 10);

describe('fill-plan --lite（2026-11-10 档二）', () => {
  test('默认 L1：五节且含确认与复核尾段', () => {
    const r = renderPlan({ topic: '默认五节' });
    assert.deepStrictEqual(r.sections, ['入口', '改动方案', '约束与风险', '验证计划', '验收标准（可测试）']);
    assert.ok(r.body.includes('## 确认与复核'));
  });

  test('lite L1：三节且保留红线勾选行与确认与复核', () => {
    const r = renderPlan({ topic: 'lite 三节', lite: true });
    assert.deepStrictEqual(r.sections, ['入口', '改动方案', '验证与验收（lite）']);
    assert.ok(r.body.includes('规则 / 契约变更'));
    assert.ok(r.body.includes('schema / 迁移 SQL'));
    assert.ok(r.body.includes('## 确认与复核'));
  });

  test('frontmatter：lite 与默认均含 状态/级别/日期 三键', () => {
    for (const lite of [false, true]) {
      const r = renderPlan({ topic: 'fm 检查', lite });
      assert.ok(r.body.startsWith('---\n状态: draft\n级别: L1\n日期: ' + TODAY + '\n'));
    }
  });

  test('L2/L3：仍走完整 4 节（回归保护）', () => {
    for (const level of ['L2', 'L3']) {
      const r = renderPlan({ topic: '完整节回归', level });
      assert.strictEqual(r.sections.length, 4);
      assert.strictEqual(r.sections[0], '改动方案');
      assert.strictEqual(r.sections[3], '验证计划');
      assert.ok(!r.sections.includes('入口'));
    }
  });
});
