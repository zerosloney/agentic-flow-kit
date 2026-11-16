// regr-evidence-vocab：incident「防复发验证」证据词表。
// 回归背景（2026-11-16 Shipyard.Material PR 895 实证）：仓库验证脚本族 scripts/verify/**/*.mjs 是
// kit `verify` 门实际执行的验证资产，却不在词表里——incident 明确引了 UI 断言脚本
// `scripts/verify/business/verify-mto-column-filters-ui.mjs`，仍被判「回归证据缺失」硬阻断；
// 而 closed 文档没有补登记出口（confirm-doc --reconfirm 仅受理 approved），只能靠修词表。
// 本测试钉住两件事：各族资产都命中（防词表再次漏项）；非资产不误命中（防放宽成万能匹配）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGR_EVIDENCE_RE } from '../templates/engine/.agents/scripts/check-loop-sections/regr-evidence-vocab.mjs';

const HITS = [
  ['引擎单测', '  - 自动化用例：`tests/loop.test.mjs` 新增用例'],
  ['后端 xunit 文件', '  - 自动化用例：`BuyerCreateSqlTests.cs` 新增两例'],
  ['后端测试工程', '  - 自动化用例：backend/material/Shipyard.Material.Tests/ 增用例'],
  ['前端测试目录', '  - 自动化用例：frontend/src/components/__tests__/table.spec.ts'],
  ['仓库验证脚本（本次补词）', '  - 自动化用例：`scripts/verify/business/verify-mto-column-filters-ui.mjs` 枚举选项行高断言'],
  ['仓库验证脚本（顶层）', '  - 自动化用例：`scripts/verify/run-all.mjs` 纳入本脚本'],
  ['回归清单主台账', '  - 回归清单条目：`workflow/regression-checklist.md` §6'],
  ['回归清单分片', '  - 回归清单条目：`workflow/regression-checklist.d/2026-11.md`'],
  ['冒烟', '  - 落点：regression-smoke 三态'],
  ['测试命令', '  - 判据：npm test 全绿'],
  ['dotnet 测试命令', '  - 判据：dotnet test --filter XxxTests'],
];

const MISSES = [
  ['人工验证不算证据', '  - 已验证：已人工验证通过'],
  ['非 verify 目录的脚本', '  - 落点：`scripts/build.mjs`'],
  ['verify 目录下的文档', '  - 落点：`scripts/verify/README.md`'],
  ['裸文件名', '  - 落点：`verify.mjs`'],
];

test('词表命中各族可复跑验证资产', () => {
  for (const [label, line] of HITS) {
    assert.ok(REGR_EVIDENCE_RE.test(line), `应命中：${label} —— ${line}`);
  }
});

test('词表不误命中非验证资产', () => {
  for (const [label, line] of MISSES) {
    assert.ok(!REGR_EVIDENCE_RE.test(line), `不应命中：${label} —— ${line}`);
  }
});
