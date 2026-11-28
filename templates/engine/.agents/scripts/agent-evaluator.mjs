#!/usr/bin/env node
// agent-evaluator.mjs — 零依赖 Agent 效能评测基准引擎（对标 Co-Sight GoldEval）
//
// 职责：
//   1. 多维评分卡契约（Rubric）：目标达成率、门禁通过率、符号沙箱遵从度、测试影响收敛度、步骤效率；
//   2. 标准研发基准任务集（Benchmark Fixtures）：修复、符号重构、安全兜底、双重背书、自愈处方；
//   3. 自动联动 agent-eval.mjs：支持一键将实测通过率、模型、任务数与详细评分卡落盘。
//
// 零外部依赖，纯 Node.js 标准库实现。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { treeSignature, recordEval, loadConfig as loadAgentEvalConfig } from './agent-eval.mjs';
import { extractSymbols, diffSymbols } from './semantic-sandbox.mjs';
import { buildEndorsementToken, validateEndorsementToken, writeEndorsementToken, resolveReviewEndorsement } from './endorsement-protocol.mjs';
import { isCoreInfraFile, selectDynamicTestImpact } from './dynamic-test-impact.mjs';
import { createPrescription, matchPrescriptions, recordFeedback } from './self-healing-prescriptions.mjs';

export const DEFAULT_RUBRIC_WEIGHTS = {
  taskCompletion: 0.35,
  gatePassRate: 0.25,
  sandboxCompliance: 0.15,
  testImpactPrecision: 0.15,
  stepEfficiency: 0.10,
};

export const DEFAULT_EVALUATOR_CONFIG = {
  version: 1,
  weights: DEFAULT_RUBRIC_WEIGHTS,
  threshold: 0.8,
  minCompletionThreshold: 0.5,
  maxSteps: 10,
  timeoutMs: 30000,
  resultsRel: '.agents/evals/results.jsonl',
  evalLogRel: '.agents/evals/eval-log.json',
};

export function normalizeScore(val) {
  const num = Number(val);
  if (!Number.isFinite(num) || Number.isNaN(num)) return 0.0;
  if (num < 0) return 0.0;
  if (num > 1) return 1.0;
  return Math.round(num * 10000) / 10000;
}

export function computeCompositeScore(rawScores = {}, customWeights = DEFAULT_RUBRIC_WEIGHTS, threshold = 0.8) {
  const weights = { ...DEFAULT_RUBRIC_WEIGHTS, ...(customWeights || {}) };
  const keys = Object.keys(DEFAULT_RUBRIC_WEIGHTS);
  
  let totalWeight = 0;
  for (const k of keys) {
    const w = Number(weights[k]) || 0;
    if (w > 0) totalWeight += w;
  }
  if (totalWeight <= 0) totalWeight = 1;

  const normalizedScores = {};
  const weightedContributions = {};
  let weightedSum = 0;

  for (const k of keys) {
    const s = normalizeScore(rawScores[k]);
    normalizedScores[k] = s;
    const w = Number(weights[k]) || 0;
    const contrib = (s * w) / totalWeight;
    weightedContributions[k] = Math.round(contrib * 10000) / 10000;
    weightedSum += contrib;
  }

  const composite = Math.round(weightedSum * 10000) / 10000;
  const taskCompletion = normalizedScores.taskCompletion ?? 0;
  const passed = composite >= threshold && taskCompletion >= 0.5;

  return {
    composite,
    passed,
    scores: normalizedScores,
    weightedContributions,
    weights,
    threshold,
  };
}

function cleanSubprocessEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

export function formatRadarBar(dimension, score, weight = null) {
  const barLength = 12;
  const filled = Math.min(barLength, Math.max(0, Math.round(score * barLength)));
  const empty = barLength - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const scoreText = (score * 100).toFixed(1).padStart(5, ' ');
  const weightText = weight != null ? ` [权重 ${(weight * 100).toFixed(0)}%]` : '';
  const label = dimension.padEnd(20, ' ');
  return `${label} [${bar}] ${scoreText}%${weightText}`;
}

export function renderAsciiRadar(scores = {}, weights = DEFAULT_RUBRIC_WEIGHTS, composite = null) {
  const lines = [];
  lines.push('------------------------------------------------------------');
  lines.push('  维度评分卡（Rubric Dimensions）');
  lines.push('------------------------------------------------------------');
  for (const [key, weight] of Object.entries(weights)) {
    const score = normalizeScore(scores[key]);
    lines.push(`  ${formatRadarBar(key, score, weight)}`);
  }
  lines.push('------------------------------------------------------------');
  if (composite != null) {
    const compScore = normalizeScore(composite);
    const tag = compScore >= 0.8 ? 'PASS' : 'FAIL';
    lines.push(`  ${formatRadarBar('COMPOSITE', compScore)} -> [${tag}]`);
    lines.push('------------------------------------------------------------');
  }
  return lines.join('\n');
}

export function createSandboxWorkspace(prefix = 'agent-bench-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

// ---------------------------------------------------------------------
// 标准基准任务集（Standard Benchmark Fixtures）
// ---------------------------------------------------------------------

export const FIXTURE_FIX_SYNTAX_BUG = {
  id: 'fix-syntax-bug',
  name: 'Fix Syntax and Logic Flaw',
  category: 'repair',
  description: '修复目标模块中的语法与逻辑缺陷，使单元测试恢复全绿，且无额外触点扩散',
  defaultMaxSteps: 3,
  setup(workspaceDir) {
    const srcDir = path.join(workspaceDir, 'src');
    const testsDir = path.join(workspaceDir, 'tests');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(testsDir, { recursive: true });

    // 含有错误计算逻辑的被测模块
    fs.writeFileSync(
      path.join(srcDir, 'math-calc.mjs'),
      [
        'export function calculateSum(a, b) {',
        '  return a - b; // 缺陷：误将加法写为减法',
        '}',
        'export function calculateProduct(a, b) {',
        '  return a * b;',
        '}',
      ].join('\n'),
      'utf8',
    );

    // 单元测试
    fs.writeFileSync(
      path.join(testsDir, 'math-calc.test.mjs'),
      [
        "import { test } from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { calculateSum, calculateProduct } from '../src/math-calc.mjs';",
        "test('calculateSum returns correct addition', () => {",
        '  assert.equal(calculateSum(2, 3), 5);',
        '});',
        "test('calculateProduct returns correct multiplication', () => {",
        '  assert.equal(calculateProduct(4, 5), 20);',
        '});',
      ].join('\n'),
      'utf8',
    );

    return {
      targetFile: 'src/math-calc.mjs',
      testFile: 'tests/math-calc.test.mjs',
      allowedFiles: ['src/math-calc.mjs'],
    };
  },
  run(workspaceDir, runner) {
    if (typeof runner === 'function') {
      return runner(workspaceDir, { fixtureId: 'fix-syntax-bug' });
    }
    // 默认执行模拟修复：将 a - b 修正为 a + b
    const target = path.join(workspaceDir, 'src', 'math-calc.mjs');
    const content = fs.readFileSync(target, 'utf8');
    fs.writeFileSync(target, content.replace('a - b', 'a + b'), 'utf8');
    return { steps: 1, modifiedFiles: ['src/math-calc.mjs'] };
  },
  evaluate(workspaceDir, runResult = {}) {
    const testPath = path.join(workspaceDir, 'tests', 'math-calc.test.mjs');
    const testExec = spawnSync(process.execPath, ['--test', testPath], {
      cwd: workspaceDir,
      env: cleanSubprocessEnv(),
      encoding: 'utf8',
    });

    const testPassed = testExec.status === 0;
    const modified = runResult.modifiedFiles || ['src/math-calc.mjs'];
    const outOfScope = modified.filter((f) => f !== 'src/math-calc.mjs');
    const sandboxCompliance = outOfScope.length === 0 ? 1.0 : Math.max(0, 1 - outOfScope.length * 0.5);

    const steps = Number(runResult.steps) || 1;
    const maxSteps = FIXTURE_FIX_SYNTAX_BUG.defaultMaxSteps;
    const stepEfficiency = steps <= maxSteps ? 1.0 : Math.max(0, 1 - (steps - maxSteps) / maxSteps);

    const scores = {
      taskCompletion: testPassed ? 1.0 : 0.0,
      gatePassRate: testPassed ? 1.0 : 0.0,
      sandboxCompliance,
      testImpactPrecision: 1.0,
      stepEfficiency,
    };

    return {
      scores,
      details: {
        testStatus: testExec.status,
        testOutput: (testExec.stdout + testExec.stderr).slice(0, 500),
        modifiedFiles: modified,
        steps,
      },
      violations: outOfScope.map((f) => `Unpermitted file modified: ${f}`),
    };
  },
};

export const FIXTURE_REFACTOR_SYMBOL_SAFE = {
  id: 'refactor-symbol-safe',
  name: 'Symbol Safe Refactor',
  category: 'refactor',
  description: '重构内部实现逻辑，严格遵循符号沙箱契约，不破坏已有导出符号与冻结接口',
  defaultMaxSteps: 4,
  setup(workspaceDir) {
    const srcDir = path.join(workspaceDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const originalCode = [
      'export function initializeService(options = {}) {',
      '  return { ready: true, options };',
      '}',
      'export function processDataPayload(payload) {',
      '  const norm = String(payload || "").trim();',
      '  return norm.toUpperCase();',
      '}',
      'export function shutdownService() {',
      '  return true;',
      '}',
    ].join('\n');

    fs.writeFileSync(path.join(srcDir, 'service-handler.mjs'), originalCode, 'utf8');

    return {
      targetFile: 'src/service-handler.mjs',
      frozenSymbols: ['initializeService', 'processDataPayload', 'shutdownService'],
      originalCode,
    };
  },
  run(workspaceDir, runner) {
    if (typeof runner === 'function') {
      return runner(workspaceDir, { fixtureId: 'refactor-symbol-safe' });
    }
    // 默认模拟重构：内部优化逻辑，不破坏外部符号
    const target = path.join(workspaceDir, 'src', 'service-handler.mjs');
    const refactoredCode = [
      '// Refactored with high-performance buffer handling',
      'export function initializeService(options = {}) {',
      '  const opts = Object.freeze({ ...options, initializedAt: Date.now() });',
      '  return { ready: true, options: opts };',
      '}',
      'export function processDataPayload(payload) {',
      '  if (!payload) return "";',
      '  return String(payload).trim().toUpperCase();',
      '}',
      'export function shutdownService() {',
      '  return true;',
      '}',
    ].join('\n');
    fs.writeFileSync(target, refactoredCode, 'utf8');
    return { steps: 2, modifiedFiles: ['src/service-handler.mjs'] };
  },
  evaluate(workspaceDir, runResult = {}, context = {}) {
    const target = path.join(workspaceDir, 'src', 'service-handler.mjs');
    const newContent = fs.readFileSync(target, 'utf8');
    const originalContent = context.originalCode || '';

    const origSymbols = extractSymbols(originalContent, '.mjs', 'service-handler.mjs');
    const newSymbols = extractSymbols(newContent, '.mjs', 'service-handler.mjs');
    const diff = diffSymbols(origSymbols, newSymbols);

    const frozen = context.frozenSymbols || ['initializeService', 'processDataPayload', 'shutdownService'];
    const removedNames = diff.removed.map((s) => s.name);
    const brokenFrozen = frozen.filter((f) => removedNames.includes(f));

    let sandboxScore = 1.0;
    if (brokenFrozen.length > 0) {
      sandboxScore = Math.max(0, 1.0 - (brokenFrozen.length / frozen.length));
    }

    const testSyntax = spawnSync(process.execPath, ['--check', target], {
      cwd: workspaceDir,
      env: cleanSubprocessEnv(),
      encoding: 'utf8',
    });
    const syntaxOk = testSyntax.status === 0;

    const steps = Number(runResult.steps) || 2;
    const maxSteps = FIXTURE_REFACTOR_SYMBOL_SAFE.defaultMaxSteps;
    const stepEfficiency = steps <= maxSteps ? 1.0 : Math.max(0, 1 - (steps - maxSteps) / maxSteps);

    const scores = {
      taskCompletion: (syntaxOk && brokenFrozen.length === 0) ? 1.0 : 0.2,
      gatePassRate: syntaxOk ? 1.0 : 0.0,
      sandboxCompliance: sandboxScore,
      testImpactPrecision: 1.0,
      stepEfficiency,
    };

    const violations = brokenFrozen.map((s) => `Frozen symbol removed or renamed: ${s}`);

    return {
      scores,
      details: {
        syntaxOk,
        addedSymbols: diff.added.map((s) => s.name),
        removedSymbols: removedNames,
        brokenFrozen,
      },
      violations,
    };
  },
};

export const FIXTURE_SECURITY_CORE_FALLBACK = {
  id: 'security-core-fallback',
  name: 'Security Core Fallback Trigger',
  category: 'security',
  description: '核心底层基建文件发生变更时，自动触发安全兜底与全量测试选测决策',
  defaultMaxSteps: 3,
  setup(workspaceDir) {
    const scriptsDir = path.join(workspaceDir, 'templates', 'engine', '.agents', 'scripts');
    const testsDir = path.join(workspaceDir, 'tests');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(testsDir, { recursive: true });

    // 核心基建文件
    fs.writeFileSync(path.join(scriptsDir, 'pipeline-run.mjs'), '// core engine pipeline\n', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'pipeline.test.mjs'), '// pipeline test\n', 'utf8');
    fs.writeFileSync(path.join(testsDir, 'general.test.mjs'), '// general test\n', 'utf8');

    return {
      coreFile: 'templates/engine/.agents/scripts/pipeline-run.mjs',
      testFiles: ['tests/pipeline.test.mjs', 'tests/general.test.mjs'],
    };
  },
  run(workspaceDir, runner) {
    if (typeof runner === 'function') {
      return runner(workspaceDir, { fixtureId: 'security-core-fallback' });
    }
    return {
      steps: 1,
      touchedFiles: ['templates/engine/.agents/scripts/pipeline-run.mjs'],
    };
  },
  evaluate(workspaceDir, runResult = {}) {
    const touched = runResult.touchedFiles || ['templates/engine/.agents/scripts/pipeline-run.mjs'];
    const hitsCore = touched.some((f) => isCoreInfraFile(f));

    const decision = selectDynamicTestImpact(workspaceDir, touched, {
      fallbackOnUntested: true,
    });

    // 核心文件变更必须触发全量兜底策略
    const fallbackCorrect = hitsCore && (decision.mode === 'full' || decision.forceFull || decision.reason?.includes('核心'));

    const scores = {
      taskCompletion: fallbackCorrect ? 1.0 : 0.0,
      gatePassRate: fallbackCorrect ? 1.0 : 0.0,
      sandboxCompliance: 1.0,
      testImpactPrecision: fallbackCorrect ? 1.0 : 0.2,
      stepEfficiency: 1.0,
    };

    return {
      scores,
      details: {
        hitsCore,
        decisionMode: decision.mode,
        forceFull: decision.forceFull,
        reason: decision.reason,
        warnings: decision.warnings || [],
      },
      violations: fallbackCorrect ? [] : ['Core infrastructure modification failed to trigger fallback verification'],
    };
  },
};

export const FIXTURE_DUAL_REVIEW_ENDORSEMENT = {
  id: 'dual-review-endorsement',
  name: 'Heterogeneous Dual Review Endorsement',
  category: 'governance',
  description: '高危研发变更触发异构跨角色背书，双审查员有效签名并抵御篡改攻击',
  defaultMaxSteps: 4,
  setup(workspaceDir) {
    const docPath = path.join(workspaceDir, 'workflow', 'tasks', 'task-001.md');
    fs.mkdirSync(path.dirname(docPath), { recursive: true });
    fs.writeFileSync(docPath, '# Task 001\nImplement payment gateway token validation.\n', 'utf8');

    return {
      docPath: 'workflow/tasks/task-001.md',
      contentHash: 'hash-abc-1234567890',
    };
  },
  run(workspaceDir, runner, context) {
    if (typeof runner === 'function') {
      return runner(workspaceDir, { fixtureId: 'dual-review-endorsement' });
    }
    const token = buildEndorsementToken({
      doc: context.docPath,
      commitmentFingerprint: context.contentHash,
      challenges: [
        { id: 'c1', dimension: 'security_boundary', adversarialPrompt: 'attempt prompt injection', status: 'survived' },
      ],
      endorsements: [
        { reviewer: 'rev1', role: 'architect', model: 'claude-3-7-sonnet', verdict: 'approved', sessionId: 's1', conclusion: 'approved' },
        { reviewer: 'rev2', role: 'security-auditor', model: 'gemini-2.5-pro', verdict: 'approved', sessionId: 's2', conclusion: 'lgtm' },
      ],
    });
    writeEndorsementToken(workspaceDir, token);
    return {
      steps: 2,
      token,
      endorsements: token.endorsements,
    };
  },
  evaluate(workspaceDir, runResult = {}, context = {}) {
    const token = runResult.token;
    const validation = validateEndorsementToken(token);
    const violations = validation.ok ? [] : [...validation.problems];

    const resolved = resolveReviewEndorsement({
      docRel: context.docPath,
      root: workspaceDir,
      commitment: context.contentHash,
    });

    const isHeterogeneous = (resolved.reviewers || []).length >= 2 &&
      new Set((resolved.reviewers || []).map((r) => r.family)).size >= 2;

    const taskPassed = validation.ok && resolved.dualEndorsed && isHeterogeneous;

    const scores = {
      taskCompletion: taskPassed ? 1.0 : 0.0,
      gatePassRate: resolved.dualEndorsed ? 1.0 : 0.0,
      sandboxCompliance: 1.0,
      testImpactPrecision: 1.0,
      stepEfficiency: 1.0,
    };

    return {
      scores,
      details: {
        tokenDigest: token?.digest,
        dualEndorsed: resolved.dualEndorsed,
        isHeterogeneous,
        reviewersCount: (resolved.reviewers || []).length,
      },
      violations: taskPassed ? [] : violations.concat(resolved.dualEndorsed ? [] : ['Dual endorsement check failed']),
    };
  },
};

export const FIXTURE_PRESCRIPTION_SELF_HEALING = {
  id: 'prescription-self-healing',
  name: 'Prescription Self Healing Flywheel',
  category: 'resilience',
  description: '历史失败归因生成结构化知识处方，在新会话中前向精准注入并强化置信度',
  defaultMaxSteps: 3,
  setup(workspaceDir) {
    const rx = createPrescription({
      id: 'rx-err-handling',
      title: 'Mandatory try-catch in async payment handlers',
      rule: 'All payment operations must be wrapped in try/catch with audit log.',
      triggerKeywords: ['payment', 'checkout', 'transaction'],
      tags: ['security', 'resilience'],
      initialConfidence: 0.8,
    });
    return {
      prescription: rx,
      workOrder: {
        title: 'Implement checkout transaction handler',
        spec: 'Process credit card payment and record invoice',
        tags: ['payment'],
      },
    };
  },
  run(workspaceDir, runner, context) {
    if (typeof runner === 'function') {
      return runner(workspaceDir, { fixtureId: 'prescription-self-healing' });
    }
    const matched = matchPrescriptions([context.prescription], context.workOrder, { threshold: 0.2 });
    const updated = recordFeedback([context.prescription], {
      appliedIds: [context.prescription.id],
      succeeded: true,
    });
    return {
      steps: 1,
      matchedCount: matched.length,
      boostedConfidence: updated[0]?.confidence || 0,
    };
  },
  evaluate(workspaceDir, runResult = {}) {
    const matched = (runResult.matchedCount || 0) >= 1;
    const confidenceBoosted = (runResult.boostedConfidence || 0) > 0.8;
    const taskPassed = matched && confidenceBoosted;

    const scores = {
      taskCompletion: taskPassed ? 1.0 : 0.0,
      gatePassRate: taskPassed ? 1.0 : 0.0,
      sandboxCompliance: 1.0,
      testImpactPrecision: 1.0,
      stepEfficiency: 1.0,
    };

    return {
      scores,
      details: {
        matchedCount: runResult.matchedCount,
        boostedConfidence: runResult.boostedConfidence,
      },
      violations: taskPassed ? [] : ['Failed to match prescription or boost confidence'],
    };
  },
};

export const STANDARD_BENCHMARKS = [
  FIXTURE_FIX_SYNTAX_BUG,
  FIXTURE_REFACTOR_SYMBOL_SAFE,
  FIXTURE_SECURITY_CORE_FALLBACK,
  FIXTURE_DUAL_REVIEW_ENDORSEMENT,
  FIXTURE_PRESCRIPTION_SELF_HEALING,
];

// ---------------------------------------------------------------------
// 评测执行器核心（Evaluator Core & Suite Runner）
// ---------------------------------------------------------------------

export function executeBenchmarkCase(benchmark, {
  runner = null,
  weights = DEFAULT_RUBRIC_WEIGHTS,
  threshold = 0.8,
  customWorkspaceDir = null,
} = {}) {
  const sandbox = customWorkspaceDir ? null : createSandboxWorkspace(`bench-${benchmark.id}-`);
  const workspaceDir = customWorkspaceDir || sandbox.dir;
  const startTs = Date.now();

  let context = {};
  let runResult = {};
  let evalOutput = { scores: {}, details: {}, violations: [] };
  let error = null;

  try {
    if (typeof benchmark.setup === 'function') {
      context = benchmark.setup(workspaceDir);
    }
    if (typeof benchmark.run === 'function') {
      runResult = benchmark.run(workspaceDir, runner, context);
    }
    if (typeof benchmark.evaluate === 'function') {
      evalOutput = benchmark.evaluate(workspaceDir, runResult, context);
    }
  } catch (err) {
    error = err.message || String(err);
  } finally {
    if (sandbox) {
      sandbox.cleanup();
    }
  }

  const durationMs = Date.now() - startTs;
  const rawScores = error ? { taskCompletion: 0, gatePassRate: 0, sandboxCompliance: 0, testImpactPrecision: 0, stepEfficiency: 0 } : (evalOutput.scores || {});
  const compositeResult = computeCompositeScore(rawScores, weights, threshold);

  return {
    id: benchmark.id,
    name: benchmark.name,
    category: benchmark.category || 'general',
    description: benchmark.description || '',
    durationMs,
    error,
    status: compositeResult.passed && !error ? 'pass' : 'fail',
    scores: compositeResult.scores,
    weightedContributions: compositeResult.weightedContributions,
    composite: compositeResult.composite,
    threshold,
    details: evalOutput.details || {},
    violations: error ? [error] : (evalOutput.violations || []),
  };
}

export function executeBenchmarkSuite({
  fixtures = STANDARD_BENCHMARKS,
  weights = DEFAULT_RUBRIC_WEIGHTS,
  threshold = 0.8,
  runner = null,
  model = 'default-agent',
  root = process.cwd(),
  record = false,
  evalLog = undefined,
} = {}) {
  const startTs = Date.now();
  const results = [];

  for (const fixture of fixtures) {
    const caseResult = executeBenchmarkCase(fixture, {
      runner,
      weights,
      threshold,
    });
    results.push(caseResult);
  }

  const totalCases = results.length;
  const passedCases = results.filter((r) => r.status === 'pass').length;
  const passRate = totalCases > 0 ? Math.round((passedCases / totalCases) * 10000) / 10000 : 0.0;

  // 计算各维度与综合分均值
  const sumScores = { taskCompletion: 0, gatePassRate: 0, sandboxCompliance: 0, testImpactPrecision: 0, stepEfficiency: 0 };
  let sumComposite = 0;

  for (const r of results) {
    sumComposite += r.composite;
    for (const k of Object.keys(sumScores)) {
      sumScores[k] += (r.scores[k] || 0);
    }
  }

  const averageScores = {};
  for (const k of Object.keys(sumScores)) {
    averageScores[k] = totalCases > 0 ? Math.round((sumScores[k] / totalCases) * 10000) / 10000 : 0;
  }
  const averageComposite = totalCases > 0 ? Math.round((sumComposite / totalCases) * 10000) / 10000 : 0;
  const suitePassed = passRate >= threshold;
  const totalDurationMs = Date.now() - startTs;

  const suiteSummary = {
    version: 1,
    ts: new Date().toISOString(),
    model: String(model || 'default-agent'),
    totalCases,
    passedCases,
    failedCases: totalCases - passedCases,
    passRate,
    averageComposite,
    averageScores,
    weights,
    threshold,
    status: suitePassed ? 'pass' : 'fail',
    totalDurationMs,
    cases: results,
  };

  let recordReceipt = null;
  if (record) {
    const note = `Evaluator run: composite=${averageComposite}, passRate=${passRate}`;
    try {
      recordReceipt = recordEval(root, {
        passRate,
        tasks: totalCases,
        model,
        note,
        evalLog,
      });
      suiteSummary.recorded = true;
      suiteSummary.receipt = recordReceipt;
    } catch (err) {
      suiteSummary.recorded = false;
      suiteSummary.recordError = err.message || String(err);
    }
  }

  return suiteSummary;
}

// ---------------------------------------------------------------------
// 报告生成器（Markdown & JSON）
// ---------------------------------------------------------------------

export function renderMarkdownReport(suiteSummary) {
  const lines = [];
  lines.push('# Agent Evaluator Benchmark Report');
  lines.push('');
  lines.push(`- **评测时间**: ${suiteSummary.ts}`);
  lines.push(`- **被测模型**: \`${suiteSummary.model}\``);
  lines.push(`- **通过率**: **${(suiteSummary.passRate * 100).toFixed(1)}%** (${suiteSummary.passedCases}/${suiteSummary.totalCases})`);
  lines.push(`- **综合均分**: **${suiteSummary.averageComposite.toFixed(4)}** / 1.0000 (阈值: ${suiteSummary.threshold})`);
  lines.push(`- **裁决结果**: **${suiteSummary.status.toUpperCase()}**`);
  lines.push(`- **总耗时**: ${suiteSummary.totalDurationMs} ms`);
  lines.push('');

  lines.push('## 1. 维度评分卡总览');
  lines.push('');
  lines.push('| 评分维度 | 平均得分 | 权重 | 加权贡献 |');
  lines.push('| :--- | :--- | :--- | :--- |');
  for (const [key, weight] of Object.entries(suiteSummary.weights || DEFAULT_RUBRIC_WEIGHTS)) {
    const avg = suiteSummary.averageScores[key] ?? 0;
    const contrib = avg * weight;
    lines.push(`| \`${key}\` | ${(avg * 100).toFixed(1)}% | ${(weight * 100).toFixed(0)}% | ${contrib.toFixed(4)} |`);
  }
  lines.push('');

  lines.push('```text');
  lines.push(renderAsciiRadar(suiteSummary.averageScores, suiteSummary.weights, suiteSummary.averageComposite));
  lines.push('```');
  lines.push('');

  lines.push('## 2. 评测用例执行明细');
  lines.push('');
  lines.push('| ID | 场景分类 | 状态 | 综合得分 | 目标达成 | 门禁 | 沙箱 | 选测 | 步骤 | 耗时 |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

  for (const c of suiteSummary.cases || []) {
    const st = c.status === 'pass' ? '✅ PASS' : '❌ FAIL';
    const s = c.scores || {};
    lines.push(
      `| \`${c.id}\` | ${c.category} | ${st} | ${c.composite.toFixed(2)} | ${(s.taskCompletion * 100).toFixed(0)}% | ${(s.gatePassRate * 100).toFixed(0)}% | ${(s.sandboxCompliance * 100).toFixed(0)}% | ${(s.testImpactPrecision * 100).toFixed(0)}% | ${(s.stepEfficiency * 100).toFixed(0)}% | ${c.durationMs}ms |`,
    );
  }
  lines.push('');

  const violations = [];
  for (const c of suiteSummary.cases || []) {
    if (c.violations && c.violations.length > 0) {
      for (const v of c.violations) {
        violations.push(`- [${c.id}] ${v}`);
      }
    }
  }

  if (violations.length > 0) {
    lines.push('## 3. 拦截违规项清单');
    lines.push('');
    lines.push(violations.join('\n'));
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------
// CLI 交互入口
// ---------------------------------------------------------------------

function argOf(argv, name, fallback = null) {
  const eqPrefix = `--${name}=`;
  const eqToken = argv.find((a) => a.startsWith(eqPrefix));
  if (eqToken !== undefined) return eqToken.slice(eqPrefix.length);
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

export function main(argv = process.argv.slice(2)) {
  const cmd = argv[0] || 'run';
  const root = path.resolve(argOf(argv, 'root', process.env.FLOW_KIT_PROJECT_ROOT || process.cwd()));
  const json = argv.includes('--json');
  const rubric = argv.includes('--rubric');
  const record = argv.includes('--record');
  const model = argOf(argv, 'model', 'default-agent');
  const reportPath = argOf(argv, 'report');
  const evalLogArg = argOf(argv, 'eval-log');
  const thresholdArg = argOf(argv, 'threshold');
  const categoryArg = argOf(argv, 'category');
  const threshold = thresholdArg ? Number(thresholdArg) : 0.8;

  if (cmd === 'list') {
    let fixtures = STANDARD_BENCHMARKS;
    if (categoryArg && typeof categoryArg === 'string') {
      fixtures = fixtures.filter((f) => f.category === categoryArg);
    }
    const list = fixtures.map((f) => ({
      id: f.id,
      name: f.name,
      category: f.category,
      description: f.description,
    }));
    if (json) {
      console.log(JSON.stringify(list, null, 2));
    } else {
      console.log('可用基准任务集（Standard Benchmark Fixtures）：');
      for (const f of list) {
        console.log(`  - [${f.id}] (${f.category}) ${f.name}: ${f.description}`);
      }
    }
    return 0;
  }

  if (cmd === 'run') {
    const fixtureId = argOf(argv, 'fixture');
    let fixtures = STANDARD_BENCHMARKS;
    if (categoryArg && typeof categoryArg === 'string') {
      fixtures = fixtures.filter((f) => f.category === categoryArg);
      if (!fixtures.length) {
        console.error(`未知 category 或无匹配用例: ${categoryArg}`);
        return 2;
      }
    }
    if (fixtureId && typeof fixtureId === 'string') {
      fixtures = fixtures.filter((f) => f.id === fixtureId);
      if (!fixtures.length) {
        console.error(`未知 fixture: ${fixtureId}（通过 agent-evaluator.mjs list 查看可用夹具）`);
        return 2;
      }
    }

    const suite = executeBenchmarkSuite({
      fixtures,
      threshold,
      model: typeof model === 'string' ? model : 'default-agent',
      root,
      record,
      evalLog: evalLogArg || undefined,
    });

    if (reportPath && typeof reportPath === 'string') {
      const absReport = path.resolve(root, reportPath);
      fs.mkdirSync(path.dirname(absReport), { recursive: true });
      fs.writeFileSync(absReport, renderMarkdownReport(suite), 'utf8');
    }

    if (rubric) {
      suite.rubric = {
        weights: suite.weights,
        radar: renderAsciiRadar(suite.averageScores, suite.weights, suite.averageComposite),
      };
    }

    if (json) {
      console.log(JSON.stringify(suite, null, 2));
    } else {
      console.log(renderAsciiRadar(suite.averageScores, suite.weights, suite.averageComposite));
      if (rubric) {
        for (const [dim, w] of Object.entries(suite.weights || {})) {
          console.log(`  - ${dim}: score=${((suite.averageScores[dim] ?? 0) * 100).toFixed(1)}% weight=${(w * 100).toFixed(0)}%`);
        }
      }
      console.log(`\n结果: ${suite.status.toUpperCase()} | 通过率: ${(suite.passRate * 100).toFixed(1)}% (${suite.passedCases}/${suite.totalCases}) | 模型: ${suite.model}`);
      if (record && suite.recorded) {
        console.log(`已将凭证自动登记至 agent-eval: signature=${suite.receipt?.signature?.slice(0, 12)}`);
      }
    }

    return suite.status === 'pass' ? 0 : 1;
  }

  console.error(`未知命令: ${cmd}（支持 run, list）`);
  return 2;
}

const isMain = process.argv[1] && process.argv[1].endsWith('agent-evaluator.mjs');
if (isMain) process.exit(main());
