// regr-evidence-vocab：incident「防复发验证」证据词表。
// 回归背景（2026-11-16 实证）：仓库验证脚本族 scripts/verify/**/*.mjs 是 kit `verify` 门实际执行的
// 验证资产，却不在词表里——incident 明确引了 UI 断言脚本 `scripts/verify/business/verify-order-filters-ui.mjs`，
// 仍被判「回归证据缺失」硬阻断；而 closed 文档没有补登记出口（confirm-doc --reconfirm 仅受理 approved），
// 只能靠修词表。
// 本测试钉住三件事：基座各族资产都命中（防词表再次漏项）；非资产不误命中（防放宽成万能匹配）；
// 项目配置（engine.json stacks / product-gates / commit-check）按配置追加、缺省不误放。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers/tmp.mjs';
import {
  REGR_EVIDENCE_RE,
  buildRegrEvidenceRe,
} from '../templates/engine/.agents/scripts/check-loop-sections/regr-evidence-vocab.mjs';

const HITS = [
  ['引擎单测', '  - 自动化用例：`tests/loop.test.mjs` 新增用例'],
  ['后端 xunit 文件', '  - 自动化用例：`BuyerCreateSqlTests.cs` 新增两例'],
  ['Java 测试文件', '  - 自动化用例：`OrderAggregateTests.java` 新增两例'],
  ['后端测试目录', '  - 自动化用例：backend/orders/tests/ 增用例'],
  ['前端测试目录', '  - 自动化用例：frontend/src/components/__tests__/table.spec.ts'],
  ['Go 测试文件', '  - 自动化用例：`store_test.go` 覆盖空输入'],
  ['仓库验证脚本（本次补词）', '  - 自动化用例：`scripts/verify/business/verify-order-filters-ui.mjs` 枚举选项行高断言'],
  ['仓库验证脚本（顶层）', '  - 自动化用例：`scripts/verify/run-all.mjs` 纳入本脚本'],
  ['回归清单主台账', '  - 回归清单条目：`workflow/regression-checklist.md` §6'],
  ['回归清单分片', '  - 回归清单条目：`workflow/regression-checklist.d/2026-11.md`'],
  ['冒烟', '  - 落点：regression-smoke 三态'],
  ['引擎测试入口', '  - 判据：run-tests 全绿'],
];

const MISSES = [
  ['人工验证不算证据', '  - 已验证：已人工验证通过'],
  ['非 verify 目录的脚本', '  - 落点：`scripts/build.mjs`'],
  ['verify 目录下的文档', '  - 落点：`scripts/verify/README.md`'],
  ['裸文件名', '  - 落点：`verify.mjs`'],
  ['无栈配置时的 rust 命令', '  - 判据：cargo test 全绿'],
];

function makeRoot(files) {
  const dir = makeTmp('flow-kit-regr-vocab-');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

test('基座词表命中各族可复跑验证资产', () => {
  for (const [label, line] of HITS) {
    assert.ok(REGR_EVIDENCE_RE.test(line), `应命中：${label} —— ${line}`);
  }
});

test('基座词表不误命中非验证资产', () => {
  for (const [label, line] of MISSES) {
    assert.ok(!REGR_EVIDENCE_RE.test(line), `不应命中：${label} —— ${line}`);
  }
});

test('engine.json stacks=[go]：追加 go test 命令词', () => {
  const root = makeRoot({ '.agents/config/engine.json': { options: { stacks: ['go'] } } });
  const re = buildRegrEvidenceRe(root);
  assert.ok(re.test('  - 判据：go test ./... 全绿'));
});

test('engine.json stacks 缺省：不追加任何栈测试命令', () => {
  const root = makeRoot({ '.agents/config/engine.json': { options: { stacks: [] } } });
  const re = buildRegrEvidenceRe(root);
  assert.ok(!re.test('  - 判据：cargo test 全绿'));
  assert.ok(!re.test('  - 判据：dotnet test --filter X --nologo'));
});

test('product-gates 命令词可命中', () => {
  const root = makeRoot({
    '.agents/config/product-gates.frontend.json': {
      gates: [{ id: 'unit', name: '前端单测', cmd: 'pnpm vitest run', when: ['package.json'] }],
    },
  });
  const re = buildRegrEvidenceRe(root);
  assert.ok(re.test('  - 判据：pnpm vitest run 全绿'));
});

test('commit-check pushTests/builds 命令首段可命中', () => {
  const root = makeRoot({
    '.agents/hooks/commit-check.config.json': {
      pushTests: [{ name: 'unit', command: 'vitest run' }],
      builds: [{ name: 'shell', command: 'make build' }],
    },
  });
  const re = buildRegrEvidenceRe(root);
  assert.ok(re.test('  - 判据：vitest run 全绿'));
  assert.ok(re.test('  - 判据：make build 通过'));
});

test('配置读取失败回退基座（fail-open）', () => {
  const root = makeRoot({
    '.agents/config/engine.json': '{ broken',
    '.agents/config/product-gates.json': 'not json',
  });
  const re = buildRegrEvidenceRe(root);
  assert.ok(re.test('  - 自动化用例：`x.test.mjs` 新增'));
  assert.ok(!re.test('  - 判据：cargo test 全绿'));
});
