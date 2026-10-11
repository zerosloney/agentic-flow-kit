#!/usr/bin/env node
// test-protect — 防 agent 自证清白时弱化测试（2026-10-10 调研 P1 test-protect）。
// 语义：fix/调试任务中，同一提交不得既改被测代码又改它的测试文件——测试是「bug 已修」的证据，
//       证据与结论同一次改动 = 自证，闭环失去意义（Anthropic playbook Stage 4：fix 任务禁止改测试文件）。
// 判定范围：本次提交的暂存 diff（git diff --cached --name-only），只拦「测试文件」与「非测试文件」同框出现。
// 豁免：
//   - 显式声明 `FLOW_KIT_ALLOW_TEST_EDIT=1 git commit`（对应 plan 中显式标注「本次需同步改测试」——测试先行、行为断言变更属于合法测试演进）。
//   - 纯测试提交（只改测试文件，无被测代码同框）——新增/修正测试本身合法。
//   - 测试文件自身之间的改动（如 fixture、helper 互改）。
// 设计（对照调研 P1）：独立 add-gate 模块，不进 check-loop 核心检查面（20 项纪律）；pre-commit 挂载点走 local-pre-commit，
//       不依赖 agent 客户端自觉。本脚本不读任务元数据（plan 状态 / frontmatter）——门禁只判暂存面事实，语义归环境变量显式声明。
// 实现零依赖、纯 Node ≥18。

import { spawnSync } from 'node:child_process';

// 测试文件识别：常见测试目录/文件命名。装户可按项目在脚本头部 CONFIG 扩展。
// 目录面：tests/、__tests__/、test/、spec/（仓库根或任意层级）；文件面：*.test.*、*.spec.*、_test.*（python pytest 风格）。
const TEST_DIR_RE = /(^|\/)(tests?|__tests__|spec|test)\//i;
const TEST_FILE_RE = /\.(test|spec)\.[^.]+$/i;
const PYTEST_FILE_RE = /(^|\/)_?test_[^/]+\.py$/i;

function isTestFile(rel) {
  const n = rel.replace(/\\/g, '/');
  if (TEST_DIR_RE.test(n)) return true;
  if (TEST_FILE_RE.test(n)) return true;
  if (PYTEST_FILE_RE.test(n)) return true;
  return false;
}

function git(args, cwd) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { exit: p.status ?? 1, stdout: p.stdout || '', stderr: p.stderr || '' };
}

function main() {
  const root = process.env.FLOW_KIT_GIT_ROOT || process.cwd();
  // 只判暂存 diff（提交面）；工作区未暂存改动不拦（与 generated-readonly / node-layer 同口径：暂存面即提交意图）
  const r = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], root);
  if (r.exit !== 0) {
    console.error('❌ test-protect：git diff --cached 失败（' + (r.stderr.trim() || '未知错误') + '）');
    process.exit(1);
  }
  const files = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!files.length) return; // 无暂存改动（如 merge 提交）不拦

  const tests = files.filter(isTestFile);
  const nonTests = files.filter((f) => !isTestFile(f));
  if (!tests.length || !nonTests.length) return; // 纯测试提交 / 纯代码提交都合法

  if (process.env.FLOW_KIT_ALLOW_TEST_EDIT === '1') {
    console.log('ℹ️  test-protect：FLOW_KIT_ALLOW_TEST_EDIT=1 显式放行（测试与代码同框改动）');
    return;
  }

  const sample = tests.slice(0, 5).join('、') + (tests.length > 5 ? ` 等 ${tests.length} 个` : '');
  const codeSample = nonTests.slice(0, 3).join('、') + (nonTests.length > 3 ? ` 等 ${nonTests.length} 个` : '');
  console.error(`❌ test-protect：提交同时改动测试与代码——「测试文件」${sample} 与「非测试文件」${codeSample} 同框。`);
  console.error('   fix/调试任务中，测试是 bug 已修的证据；证据与结论同一次改动 = 自证，闭环失去意义。');
  console.error('   若本提交确实需要同步演进测试（测试先行 / 行为断言变更），显式声明后重试：');
  console.error('     FLOW_KIT_ALLOW_TEST_EDIT=1 git commit');
  process.exit(1);
}

main();