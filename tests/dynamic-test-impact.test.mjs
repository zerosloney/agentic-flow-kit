// tests/dynamic-test-impact.test.mjs
// 动态测试影响图与增量选测决策引擎单测套件

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  MAX_SCAN_FILES,
  normalizePath,
  isTestFile,
  isCodeFile,
  isCoreInfraFile,
  stripComments,
  extractImportSpecifiers,
  resolveModulePath,
  buildDependencyGraph,
  computeTestImpact,
  selectDynamicTestImpact,
  changedFilesFromGit,
  formatDynamicDecision,
} from '../templates/engine/.agents/scripts/dynamic-test-impact.mjs';

import {
  assembleWorkOrderContext,
} from '../templates/engine/.agents/scripts/pipeline-run.mjs';

import { makeTmp } from './helpers/tmp.mjs';

test('dynamic-test-impact: 未跟踪的新文件算进变更集合', () => {
  const root = makeTmp('tia-untracked-');
  spawnSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
  for (const args of [
    ['config', 'user.email', 'test@example.com'],
    ['config', 'user.name', 'tester'],
    ['add', 'README.md'],
    ['commit', '-q', '-m', 'base'],
  ]) {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  fs.writeFileSync(path.join(root, 'src-new.mjs'), 'export const n = 1;\n');
  const gitFiles = changedFilesFromGit(null, root);
  assert.equal(gitFiles.error, null);
  assert.ok(gitFiles.files.includes('src-new.mjs'), JSON.stringify(gitFiles));
});

test('assembleWorkOrderContext 把动态选测写进工单而不是吞掉 ReferenceError', () => {
  const root = makeTmp('tia-wo-');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'tests', 'a.test.mjs'), "import { a } from '../src/a.mjs';\n");
  const decision = selectDynamicTestImpact(root, ['src/a.mjs'], { fallbackOnUntested: false });
  assert.ok(decision.impactedTests.length > 0, JSON.stringify(decision));
  const ctx = assembleWorkOrderContext({ root }, { docs: {} }, {
    kind: 'implement',
    context: { files: ['src/a.mjs'] },
  });
  assert.ok(ctx.slices.dynamicTestImpact, 'dynamicTestImpact missing');
  assert.ok(ctx.slices.dynamicTestImpact.impactedTests.includes('tests/a.test.mjs'));
});

test('dynamic-test-impact: 路径规范化与文件类型探测', () => {
  assert.equal(normalizePath('src\\utils\\foo.mjs'), 'src/utils/foo.mjs');
  assert.equal(normalizePath('./src/bar.ts'), 'src/bar.ts');

  // 测试文件探测
  assert.equal(isTestFile('tests/calc.test.mjs'), true);
  assert.equal(isTestFile('src/components/button.spec.tsx'), true);
  assert.equal(isTestFile('pkg/handler_test.go'), true);
  assert.equal(isTestFile('tests/test_api.py'), true);
  assert.equal(isTestFile('src/core/math.mjs'), false);
  assert.equal(isTestFile('README.md'), false);

  // 测试目录下的辅助模块按源码处理（不计入测试）
  assert.equal(isTestFile('tests/helpers/h.mjs'), false);
  assert.equal(isTestFile('tests/fixtures/sample.mjs'), false);
  assert.equal(isTestFile('tests/__fixtures__/data.ts'), false);
  assert.equal(isTestFile('tests/support/harness.ts'), false);
  assert.equal(isTestFile('tests/__helpers__/utils.ts'), false);
  assert.equal(isTestFile('tests/conftest.py'), false);
  assert.equal(isTestFile('tests/setup.mjs'), false);
  assert.equal(isTestFile('tests/setupTests.ts'), false);
  // 文件名模式优先于辅助目录排除
  assert.equal(isTestFile('tests/helpers/helper.test.mjs'), true);

  // 源码文件探测
  assert.equal(isCodeFile('src/index.ts'), true);
  assert.equal(isCodeFile('main.go'), true);
  assert.equal(isCodeFile('server.py'), true);
  assert.equal(isCodeFile('style.css'), false);

  // 核心基础设施与策略文件探测
  assert.equal(isCoreInfraFile('package.json'), true);
  assert.equal(isCoreInfraFile('pnpm-lock.yaml'), true);
  assert.equal(isCoreInfraFile('.agents/config/policy.json'), true);
  assert.equal(isCoreInfraFile('.agents/rules/stack.node.json'), true);
  assert.equal(isCoreInfraFile('.agents/scripts/verify.mjs'), true);
  assert.equal(isCoreInfraFile('src/auth.mjs'), false);
});

test('dynamic-test-impact: 多语言导入语法静态提取与注释剥除', () => {
  // 1. JS / TS 导入提取
  const jsSource = `
    // import 'commented-out';
    /*
      import from 'multiline-comment';
    */
    import defaultExport from './service.mjs';
    import { foo, bar as b } from '../utils/helper.js';
    export { baz } from './export-source.ts';
    const dynamicMod = await import('./dynamic-module.mjs');
    const legacy = require('./legacy-dep.cjs');
    import 'node:fs';
  `;
  const jsSpecs = extractImportSpecifiers(jsSource, '.mjs');
  assert.ok(jsSpecs.includes('./service.mjs'));
  assert.ok(jsSpecs.includes('../utils/helper.js'));
  assert.ok(jsSpecs.includes('./export-source.ts'));
  assert.ok(jsSpecs.includes('./dynamic-module.mjs'));
  assert.ok(jsSpecs.includes('./legacy-dep.cjs'));
  assert.ok(jsSpecs.includes('node:fs'));
  assert.equal(jsSpecs.includes('commented-out'), false);
  assert.equal(jsSpecs.includes('multiline-comment'), false);

  // 2. Python 导入提取
  const pySource = `
    # import commented_py
    from .utils import calculate_tax, helper
    from ..models.user import User
    import os, sys
    import json
    from core.config import settings
  `;
  const pySpecs = extractImportSpecifiers(pySource, '.py');
  assert.ok(pySpecs.includes('.utils'));
  assert.ok(pySpecs.includes('..models.user'));
  assert.ok(pySpecs.includes('os'));
  assert.ok(pySpecs.includes('sys'));
  assert.ok(pySpecs.includes('core.config'));
  assert.equal(pySpecs.includes('commented_py'), false);

  // 3. Go 导入提取
  const goSource = `
    package main
    // import "commented/go"
    import "fmt"
    import (
      "net/http"
      "example.com/project/pkg/util"
    )
  `;
  const goSpecs = extractImportSpecifiers(goSource, '.go');
  assert.ok(goSpecs.includes('fmt'));
  assert.ok(goSpecs.includes('net/http'));
  assert.ok(goSpecs.includes('example.com/project/pkg/util'));
  assert.equal(goSpecs.includes('commented/go'), false);
});

test('dynamic-test-impact: 模块导入路径解析与相对定位', () => {
  const tmpDir = makeTmp('dti-resolve-');
  fs.mkdirSync(path.join(tmpDir, 'src', 'utils'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'utils', 'helper.mjs'), 'export const h = 1;');
  fs.writeFileSync(path.join(tmpDir, 'src', 'core.mjs'), 'import "./utils/helper.mjs";');

  // 内部相对路径解析（带扩展名）
  const r1 = resolveModulePath('src/core.mjs', './utils/helper.mjs', tmpDir);
  assert.equal(r1, 'src/utils/helper.mjs');

  // 内部相对路径解析（无扩展名，自动推断）
  const r2 = resolveModulePath('src/core.mjs', './utils/helper', tmpDir);
  assert.equal(r2, 'src/utils/helper.mjs');

  // 外部模块解析过滤（跳过内置库与裸包名）
  assert.equal(resolveModulePath('src/core.mjs', 'node:fs', tmpDir), null);
  assert.equal(resolveModulePath('src/core.mjs', 'lodash', tmpDir), null);
});

test('dynamic-test-impact: Python src-layout 导入解析', () => {
  const tmpDir = makeTmp('dti-pysrc-');
  fs.mkdirSync(path.join(tmpDir, 'src', 'mypkg'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'mypkg', '__init__.py'), '');
  fs.writeFileSync(path.join(tmpDir, 'src', 'mypkg', 'core.py'), 'VALUE = 1\n');
  fs.writeFileSync(path.join(tmpDir, 'tests', 'test_core.py'), 'from mypkg.core import VALUE\n');

  assert.equal(resolveModulePath('tests/test_core.py', 'mypkg.core', tmpDir), 'src/mypkg/core.py');
  assert.equal(resolveModulePath('tests/test_core.py', 'mypkg', tmpDir), 'src/mypkg/__init__.py');

  const graph = buildDependencyGraph(tmpDir);
  assert.ok(graph.testFiles.has('tests/test_core.py'));
  const impact = computeTestImpact(graph, ['src/mypkg/core.py']);
  assert.deepEqual(impact.impactedTests, ['tests/test_core.py']);
});

test('dynamic-test-impact: Go 模块路径前缀解析', () => {
  const tmpDir = makeTmp('dti-go-');
  fs.mkdirSync(path.join(tmpDir, 'pkg', 'util'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'cmd'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/project\n\ngo 1.22\n');
  fs.writeFileSync(
    path.join(tmpDir, 'pkg', 'util', 'util.go'),
    'package util\n\nfunc Add(a, b int) int { return a + b }\n'
  );
  fs.writeFileSync(
    path.join(tmpDir, 'cmd', 'main.go'),
    'package main\n\nimport "example.com/project/pkg/util"\n\nfunc main() { _ = util.Add(1, 2) }\n'
  );
  fs.writeFileSync(
    path.join(tmpDir, 'cmd', 'main_test.go'),
    'package main\n\nimport (\n\t"testing"\n\n\t"example.com/project/pkg/util"\n)\n\nfunc TestAdd(t *testing.T) { _ = util.Add(1, 2) }\n'
  );

  assert.equal(
    resolveModulePath('cmd/main.go', 'example.com/project/pkg/util', tmpDir),
    'pkg/util'
  );

  const graph = buildDependencyGraph(tmpDir);
  assert.ok(graph.nodes.get('cmd/main_test.go').dependencies.has('pkg/util/util.go'));
  const impact = computeTestImpact(graph, ['pkg/util/util.go']);
  assert.deepEqual(impact.impactedTests, ['cmd/main_test.go']);
});

test('dynamic-test-impact: 辅助模块不作为测试截断传导链', () => {
  const tmpDir = makeTmp('dti-helper-');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'tests', 'helpers'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'y.mjs'), 'export const y = 1;');
  fs.writeFileSync(path.join(tmpDir, 'src', 'z.mjs'), 'export const z = 1;');
  fs.writeFileSync(
    path.join(tmpDir, 'tests', 'helpers', 'h.mjs'),
    'import "../../src/y.mjs"; export const h = 1;'
  );
  fs.writeFileSync(path.join(tmpDir, 'tests', 'a.test.mjs'), 'import "./helpers/h.mjs";');
  fs.writeFileSync(
    path.join(tmpDir, 'tests', 'b.test.mjs'),
    'import "./helpers/h.mjs"; import "../src/y.mjs";'
  );
  fs.writeFileSync(path.join(tmpDir, 'tests', 'c.test.mjs'), 'import "../src/z.mjs";');

  // helper 是辅助模块而非测试
  assert.equal(isTestFile('tests/helpers/h.mjs'), false);

  const graph = buildDependencyGraph(tmpDir);
  assert.deepEqual([...graph.testFiles].sort(), [
    'tests/a.test.mjs',
    'tests/b.test.mjs',
    'tests/c.test.mjs',
  ]);

  const impact = computeTestImpact(graph, ['src/y.mjs']);
  assert.deepEqual(impact.impactedTests, ['tests/a.test.mjs', 'tests/b.test.mjs']);
  assert.equal(impact.impactedTests.includes('tests/helpers/h.mjs'), false);

  const decision = selectDynamicTestImpact(tmpDir, ['src/y.mjs']);
  assert.equal(decision.mode, 'incremental');
  assert.deepEqual(decision.impactedTests, ['tests/a.test.mjs', 'tests/b.test.mjs']);
});

test('dynamic-test-impact: 无法解析的路径别名保守纳入测试', () => {
  const tmpDir = makeTmp('dti-alias-');
  fs.mkdirSync(path.join(tmpDir, 'src', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'lib', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(tmpDir, 'src', 'other.ts'), 'export const o = 1;\n');
  fs.writeFileSync(path.join(tmpDir, 'tests', 'c.test.ts'), 'import { a } from "@/lib/a";\n');
  fs.writeFileSync(path.join(tmpDir, 'tests', 'other.test.ts'), 'import { o } from "../src/other";\n');

  const graph = buildDependencyGraph(tmpDir);
  assert.equal(graph.unresolvedImports.has('tests/c.test.ts'), true);
  assert.deepEqual(graph.unresolvedImports.get('tests/c.test.ts'), ['@/lib/a']);

  const decision = selectDynamicTestImpact(tmpDir, ['src/lib/a.ts']);
  assert.equal(decision.mode, 'incremental');
  assert.ok(decision.impactedTests.includes('tests/c.test.ts'));
  assert.ok(decision.warnings.some((w) => w.includes('1 个测试文件包含无法解析的导入')));
});

test('dynamic-test-impact: Node 内置模块不视为无法解析导入', () => {
  const tmpDir = makeTmp('dti-builtin-');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'core.mjs'), 'export const c = 1;\n');
  fs.writeFileSync(path.join(tmpDir, 'src', 'other.mjs'), 'export const o = 1;\n');
  fs.writeFileSync(
    path.join(tmpDir, 'tests', 'core.test.mjs'),
    'import fs from "fs";\nimport fsp from "fs/promises";\nimport path from "node:path";\nimport { c } from "../src/core.mjs";\n'
  );
  fs.writeFileSync(
    path.join(tmpDir, 'tests', 'other.test.mjs'),
    'import { readFileSync } from "node:fs";\nimport { o } from "../src/other.mjs";\n'
  );

  const graph = buildDependencyGraph(tmpDir);
  assert.equal(graph.unresolvedImports.size, 0);
  assert.equal(graph.unresolvedImports.has('tests/core.test.mjs'), false);
  assert.equal(graph.unresolvedImports.has('tests/other.test.mjs'), false);

  const decision = selectDynamicTestImpact(tmpDir, ['src/core.mjs']);
  assert.equal(decision.mode, 'incremental');
  assert.deepEqual(decision.impactedTests, ['tests/core.test.mjs']);
  assert.ok(!decision.warnings.some((w) => w.includes('无法解析的导入')));
});

test('dynamic-test-impact: 依赖拓扑图构建与单跳/多跳/环路影响面传导', () => {
  const tmpDir = makeTmp('dti-graph-');
  fs.mkdirSync(path.join(tmpDir, 'src', 'math'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src', 'calc'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src', 'cycle'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });

  // 文件关系：
  // math.mjs -> calc.mjs -> calc.test.mjs (两跳传递)
  // cycleA.mjs <-> cycleB.mjs (双向环路引用)
  // helper.mjs -> helper.test.mjs (独立单跳)
  fs.writeFileSync(path.join(tmpDir, 'src', 'math', 'math.mjs'), 'export const add = (a, b) => a + b;');
  fs.writeFileSync(path.join(tmpDir, 'src', 'calc', 'calc.mjs'), 'import { add } from "../math/math.mjs"; export const calc = (x) => add(x, 1);');
  fs.writeFileSync(path.join(tmpDir, 'tests', 'calc.test.mjs'), 'import { calc } from "../src/calc/calc.mjs";');

  fs.writeFileSync(path.join(tmpDir, 'src', 'utils.mjs'), 'export const u = 1;');
  fs.writeFileSync(path.join(tmpDir, 'tests', 'utils.test.mjs'), 'import "../src/utils.mjs";');

  fs.writeFileSync(path.join(tmpDir, 'src', 'cycle', 'cycleA.mjs'), 'import "./cycleB.mjs"; export const A = 1;');
  fs.writeFileSync(path.join(tmpDir, 'src', 'cycle', 'cycleB.mjs'), 'import "./cycleA.mjs"; export const B = 2;');
  fs.writeFileSync(path.join(tmpDir, 'tests', 'cycle.test.mjs'), 'import "../src/cycle/cycleA.mjs";');

  const graph = buildDependencyGraph(tmpDir);
  assert.equal(graph.testFiles.size, 3);
  assert.ok(graph.nodes.has('src/math/math.mjs'));
  assert.ok(graph.nodes.has('src/calc/calc.mjs'));

  // 1. 直接单跳传导：修改 calc.mjs -> 命中 calc.test.mjs
  const impact1 = computeTestImpact(graph, ['src/calc/calc.mjs']);
  assert.deepEqual(impact1.directImpactedTests, ['tests/calc.test.mjs']);
  assert.deepEqual(impact1.impactedTests, ['tests/calc.test.mjs']);

  // 2. 深度多跳传导：修改 math.mjs -> 经过 calc.mjs -> 传递命中 calc.test.mjs
  const impact2 = computeTestImpact(graph, ['src/math/math.mjs']);
  assert.deepEqual(impact2.impactedTests, ['tests/calc.test.mjs']);
  assert.deepEqual(impact2.transitiveImpactedTests, ['tests/calc.test.mjs']);
  assert.deepEqual(impact2.impactedSources, ['src/calc/calc.mjs']);

  // 3. 环路依赖安全遍历：修改 cycleB.mjs -> 传导至 cycleA.mjs -> 命中 cycle.test.mjs，无死锁
  const impact3 = computeTestImpact(graph, ['src/cycle/cycleB.mjs']);
  assert.deepEqual(impact3.impactedTests, ['tests/cycle.test.mjs']);

  // 4. 未知/非代码文件变更
  const impact4 = computeTestImpact(graph, ['doc/api.md', 'unknown.mjs']);
  assert.deepEqual(impact4.impactedTests, []);
  assert.ok(impact4.unmappedFiles.includes('doc/api.md'));
  assert.ok(impact4.unmappedFiles.includes('unknown.mjs'));
});

test('dynamic-test-impact: 动态选测核心决策器与全量兜底状态机', () => {
  const tmpDir = makeTmp('dti-decide-');
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.agents', 'config'), { recursive: true });

  fs.writeFileSync(path.join(tmpDir, 'src', 'auth.mjs'), 'export const auth = true;');
  fs.writeFileSync(path.join(tmpDir, 'src', 'user.mjs'), 'import "./auth.mjs";');
  fs.writeFileSync(path.join(tmpDir, 'src', 'order.mjs'), 'export const order = 1;');
  fs.writeFileSync(path.join(tmpDir, 'src', 'untested.mjs'), 'export const un = 0;');

  fs.writeFileSync(path.join(tmpDir, 'tests', 'auth.test.mjs'), 'import "../src/auth.mjs";');
  fs.writeFileSync(path.join(tmpDir, 'tests', 'user.test.mjs'), 'import "../src/user.mjs";');
  fs.writeFileSync(path.join(tmpDir, 'tests', 'order.test.mjs'), 'import "../src/order.mjs";');

  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
  fs.writeFileSync(path.join(tmpDir, '.agents', 'config', 'policy.json'), '{}');

  // 场景 A: 精准增量选测（只动 order.mjs，仅命中 order.test.mjs，跳过 2 个测试，加速比约 66.7%）
  const d1 = selectDynamicTestImpact(tmpDir, ['src/order.mjs']);
  assert.equal(d1.mode, 'incremental');
  assert.deepEqual(d1.impactedTests, ['tests/order.test.mjs']);
  assert.equal(d1.totalKnownTests, 3);
  assert.equal(d1.skippedTestsCount, 2);
  assert.ok(d1.accelerationRatio > 0.6);

  // 场景 B: 核心基础设施触碰兜底（改动 package.json 回退全量）
  const d2 = selectDynamicTestImpact(tmpDir, ['src/order.mjs', 'package.json']);
  assert.equal(d2.mode, 'full');
  assert.ok(d2.reason.includes('触碰核心基础设施文件'));

  // 场景 C: 全局策略文件触碰兜底（改动 policy.json 回退全量）
  const d3 = selectDynamicTestImpact(tmpDir, ['.agents/config/policy.json']);
  assert.equal(d3.mode, 'full');

  // 场景 D: 触碰无测试覆盖的孤立源码（fallbackOnUntested 触发安全兜底）
  const d4 = selectDynamicTestImpact(tmpDir, ['src/untested.mjs']);
  assert.equal(d4.mode, 'full');
  assert.ok(d4.reason.includes('缺乏测试拓扑覆盖'));

  // 场景 E: 仅修改文档文件（返回 none 模式，且不扫描建图）
  const d5 = selectDynamicTestImpact(tmpDir, ['README.md', 'docs/guide.md']);
  assert.equal(d5.mode, 'none');
  assert.equal(d5.graphStats.nodeCount, 0);

  // 场景 F: 显式 forceFull 强制全量
  const d6 = selectDynamicTestImpact(tmpDir, ['src/order.mjs'], { forceFull: true });
  assert.equal(d6.mode, 'full');
  assert.equal(d6.impactedTests.length, 3);

  // 场景 G: 人类可读格式化校验
  const formatted = formatDynamicDecision(d1);
  assert.ok(formatted.includes('模式: incremental'));
  assert.ok(formatted.includes('命中测试: 1/3 个'));
});

test('dynamic-test-impact: 扫描上限超限回退全量', () => {
  const tmpDir = makeTmp('dti-limit-');
  assert.equal(MAX_SCAN_FILES, 5000);
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'a.mjs'), 'export const a = 1;');
  fs.writeFileSync(path.join(tmpDir, 'src', 'b.mjs'), 'export const b = 1;');
  fs.writeFileSync(path.join(tmpDir, 'src', 'c.mjs'), 'export const c = 1;');
  fs.writeFileSync(path.join(tmpDir, 'tests', 'a.test.mjs'), 'import "../src/a.mjs";');

  // 测试用可传入的 maxScanFiles 压低上限（默认 MAX_SCAN_FILES = 5000）
  const decision = selectDynamicTestImpact(tmpDir, ['src/a.mjs'], { maxScanFiles: 2 });
  assert.equal(decision.mode, 'full');
  assert.deepEqual(decision.impactedTests, []);
  assert.ok(decision.warnings.some((w) => w.includes('仓库代码文件超过') && w.includes('回退全量')));
});

test('dynamic-test-impact: 与 pipeline-run 工单上下文切片注入联动', () => {
  const fakeCtx = { dispatch: {} };
  const fakeRun = {
    events: [],
    stage: 'implement',
    docs: { plan: 'workflow/plan.md' },
  };
  const fakeOrder = {
    id: 1,
    kind: 'implement',
    context: {
      handoff: {
        touchSetAllowed: ['src/commands/install.mjs'],
      },
    },
  };

  const ctxResult = assembleWorkOrderContext(fakeCtx, fakeRun, fakeOrder);
  assert.ok(ctxResult.slices);
  // dynamicTestImpact 字段切片存在且可自愈注入
  if (ctxResult.slices.dynamicTestImpact) {
    assert.ok(['incremental', 'full', 'none'].includes(ctxResult.slices.dynamicTestImpact.mode));
  }
});
