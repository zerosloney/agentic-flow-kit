import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { makeTmp } from './helpers/tmp.mjs';
import {
  normalizeScore,
  computeCompositeScore,
  formatRadarBar,
  renderAsciiRadar,
  renderMarkdownReport,
  executeBenchmarkCase,
  executeBenchmarkSuite,
  STANDARD_BENCHMARKS,
  FIXTURE_FIX_SYNTAX_BUG,
  FIXTURE_REFACTOR_SYMBOL_SAFE,
  FIXTURE_SECURITY_CORE_FALLBACK,
  FIXTURE_DUAL_REVIEW_ENDORSEMENT,
  FIXTURE_PRESCRIPTION_SELF_HEALING,
  main,
} from '../templates/engine/.agents/scripts/agent-evaluator.mjs';
import { evaluate } from '../templates/engine/.agents/scripts/agent-eval.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('../templates/engine/.agents/scripts/agent-evaluator.mjs', import.meta.url));

test('normalizeScore handles boundaries, NaNs and rounding', () => {
  assert.equal(normalizeScore(0.85432), 0.8543);
  assert.equal(normalizeScore(-0.5), 0.0);
  assert.equal(normalizeScore(1.5), 1.0);
  assert.equal(normalizeScore(NaN), 0.0);
  assert.equal(normalizeScore('0.75'), 0.75);
  assert.equal(normalizeScore(null), 0.0);
});

test('computeCompositeScore calculates weighted composite and enforces thresholds', () => {
  const perfect = {
    taskCompletion: 1.0,
    gatePassRate: 1.0,
    sandboxCompliance: 1.0,
    testImpactPrecision: 1.0,
    stepEfficiency: 1.0,
  };
  const r1 = computeCompositeScore(perfect);
  assert.equal(r1.composite, 1.0);
  assert.equal(r1.passed, true);

  // taskCompletion < 0.5 fails even if other dimensions are high
  const lowCompletion = {
    taskCompletion: 0.4,
    gatePassRate: 1.0,
    sandboxCompliance: 1.0,
    testImpactPrecision: 1.0,
    stepEfficiency: 1.0,
  };
  const r2 = computeCompositeScore(lowCompletion);
  assert.equal(r2.passed, false);

  // Custom weights
  const customWeights = {
    taskCompletion: 0.8,
    gatePassRate: 0.2,
    sandboxCompliance: 0,
    testImpactPrecision: 0,
    stepEfficiency: 0,
  };
  const r3 = computeCompositeScore({ taskCompletion: 1.0, gatePassRate: 0.5 }, customWeights);
  assert.equal(r3.composite, 0.9);
});

test('formatRadarBar and renderAsciiRadar render formatted indicators', () => {
  const bar = formatRadarBar('taskCompletion', 0.8, 0.35);
  assert.ok(bar.includes('taskCompletion'));
  assert.ok(bar.includes('80.0%'));
  assert.ok(bar.includes('权重 35%'));

  const radar = renderAsciiRadar({ taskCompletion: 1.0, gatePassRate: 0.9 }, undefined, 0.95);
  assert.ok(radar.includes('维度评分卡'));
  assert.ok(radar.includes('COMPOSITE'));
  assert.ok(radar.includes('[PASS]'));
});

test('FIXTURE_FIX_SYNTAX_BUG verifies fix and penalizes out-of-scope files', () => {
  // 1. Success case with default simulator
  const rPass = executeBenchmarkCase(FIXTURE_FIX_SYNTAX_BUG);
  assert.equal(rPass.status, 'pass');
  assert.equal(rPass.scores.taskCompletion, 1.0);
  assert.equal(rPass.scores.sandboxCompliance, 1.0);

  // 2. Failure case: out-of-scope files modified
  const rViolation = executeBenchmarkCase(FIXTURE_FIX_SYNTAX_BUG, {
    runner: (dir) => {
      // Modify target file
      const target = path.join(dir, 'src', 'math-calc.mjs');
      const content = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(target, content.replace('a - b', 'a + b'), 'utf8');
      // Modify unexpected file
      fs.writeFileSync(path.join(dir, 'unauthorized.txt'), 'illegal\n', 'utf8');
      return { steps: 1, modifiedFiles: ['src/math-calc.mjs', 'unauthorized.txt'] };
    },
  });
  assert.equal(rViolation.scores.sandboxCompliance, 0.5);
  assert.ok(rViolation.violations.some((v) => v.includes('Unpermitted file modified')));

  // 3. Failure case: test still broken
  const rBroken = executeBenchmarkCase(FIXTURE_FIX_SYNTAX_BUG, {
    runner: () => ({ steps: 1, modifiedFiles: ['src/math-calc.mjs'] }),
  });
  assert.equal(rBroken.status, 'fail');
  assert.equal(rBroken.scores.taskCompletion, 0.0);
});

test('FIXTURE_REFACTOR_SYMBOL_SAFE intercepts removal of frozen symbols', () => {
  // 1. Safe refactor passes
  const rPass = executeBenchmarkCase(FIXTURE_REFACTOR_SYMBOL_SAFE);
  assert.equal(rPass.status, 'pass');
  assert.equal(rPass.scores.sandboxCompliance, 1.0);

  // 2. Refactor that deletes a frozen symbol
  const rBrokenSymbol = executeBenchmarkCase(FIXTURE_REFACTOR_SYMBOL_SAFE, {
    runner: (dir) => {
      const target = path.join(dir, 'src', 'service-handler.mjs');
      // Delete processDataPayload
      fs.writeFileSync(
        target,
        'export function initializeService() { return {}; }\nexport function shutdownService() { return true; }\n',
        'utf8',
      );
      return { steps: 1, modifiedFiles: ['src/service-handler.mjs'] };
    },
  });
  assert.equal(rBrokenSymbol.status, 'fail');
  assert.ok(rBrokenSymbol.scores.sandboxCompliance < 1.0);
  assert.ok(rBrokenSymbol.violations.some((v) => v.includes('Frozen symbol removed or renamed: processDataPayload')));
});

test('FIXTURE_SECURITY_CORE_FALLBACK triggers full verification on core infra modification', () => {
  const r = executeBenchmarkCase(FIXTURE_SECURITY_CORE_FALLBACK);
  assert.equal(r.status, 'pass');
  assert.equal(r.scores.taskCompletion, 1.0);
  assert.equal(r.scores.testImpactPrecision, 1.0);
  assert.equal(r.details.hitsCore, true);
  assert.equal(r.details.decisionMode, 'full');
});

test('FIXTURE_DUAL_REVIEW_ENDORSEMENT validates multi-role heterogeneous tokens', () => {
  const r = executeBenchmarkCase(FIXTURE_DUAL_REVIEW_ENDORSEMENT);
  assert.equal(r.status, 'pass');
  assert.equal(r.scores.taskCompletion, 1.0);
  assert.equal(r.details.dualEndorsed, true);
  assert.equal(r.details.isHeterogeneous, true);
});

test('FIXTURE_PRESCRIPTION_SELF_HEALING verifies matching and feedback confidence boost', () => {
  const r = executeBenchmarkCase(FIXTURE_PRESCRIPTION_SELF_HEALING);
  assert.equal(r.status, 'pass');
  assert.equal(r.scores.taskCompletion, 1.0);
  assert.ok(r.details.boostedConfidence > 0.8);
});

test('executeBenchmarkCase handles unexpected runtime exception in fixture gracefully', () => {
  const faultyFixture = {
    id: 'faulty',
    name: 'Faulty Fixture',
    setup: () => {
      throw new Error('Exploding setup');
    },
  };
  const r = executeBenchmarkCase(faultyFixture);
  assert.equal(r.status, 'fail');
  assert.equal(r.composite, 0.0);
  assert.ok(r.violations.some((v) => v.includes('Exploding setup')));
});

test('executeBenchmarkSuite runs full benchmark suite and renders markdown report', () => {
  const suite = executeBenchmarkSuite({
    model: 'test-claude-3-7',
    threshold: 0.8,
  });

  assert.equal(suite.totalCases, 5);
  assert.equal(suite.passedCases, 5);
  assert.equal(suite.passRate, 1.0);
  assert.equal(suite.status, 'pass');
  assert.ok(suite.averageComposite >= 0.8);

  const md = renderMarkdownReport(suite);
  assert.ok(md.includes('# Agent Evaluator Benchmark Report'));
  assert.ok(md.includes('`test-claude-3-7`'));
  assert.ok(md.includes('100.0%'));
  assert.ok(md.includes('| `fix-syntax-bug` |'));
  assert.ok(md.includes('| `refactor-symbol-safe` |'));
  assert.ok(md.includes('| `security-core-fallback` |'));
  assert.ok(md.includes('| `dual-review-endorsement` |'));
  assert.ok(md.includes('| `prescription-self-healing` |'));
});

test('executeBenchmarkSuite with record:true records credential into agent-eval gate', () => {
  const root = makeTmp('evaluator-integration-');

  // Setup minimal .agents/config/agent-eval.json
  const cfgDir = path.join(root, '.agents', 'config');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, 'agent-eval.json'),
    JSON.stringify({ threshold: 0.8, minTasks: 5 }),
    'utf8',
  );

  // Initially agent-eval gate check should fail
  const before = evaluate(root);
  assert.equal(before.ok, false);
  assert.equal(before.reason, 'no-eval-for-tree');

  // Execute suite with record: true
  const suite = executeBenchmarkSuite({
    root,
    model: 'benchmarking-runner',
    record: true,
  });

  assert.equal(suite.recorded, true);
  assert.ok(suite.receipt);
  assert.equal(suite.receipt.tasks, 5);
  assert.equal(suite.receipt.passRate, 1.0);

  // Now agent-eval gate check must pass
  const after = evaluate(root);
  assert.equal(after.ok, true);
  assert.equal(after.reason, 'pass');

  // Verify eval-log.json exists and has entries
  const logPath = path.join(root, '.agents', 'evals', 'eval-log.json');
  assert.ok(fs.existsSync(logPath));
  const logContent = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  assert.ok(Array.isArray(logContent.entries));
  assert.equal(logContent.entries[0].passRate, 1.0);
});

test('CLI interaction supports list and run commands', () => {
  const run = (args) => spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
  });

  // list --json
  const listRes = run(['list', '--json']);
  assert.equal(listRes.status, 0);
  const listJson = JSON.parse(listRes.stdout);
  assert.ok(Array.isArray(listJson));
  assert.equal(listJson.length, 5);
  assert.ok(listJson.some((f) => f.id === 'fix-syntax-bug'));

  // run --fixture fix-syntax-bug --json
  const singleRes = run(['run', '--fixture', 'fix-syntax-bug', '--json']);
  assert.equal(singleRes.status, 0);
  const singleJson = JSON.parse(singleRes.stdout);
  assert.equal(singleJson.totalCases, 1);
  assert.equal(singleJson.passedCases, 1);
  assert.equal(singleJson.cases[0].id, 'fix-syntax-bug');

  // unknown command
  const unknownRes = run(['nonexistent-cmd']);
  assert.equal(unknownRes.status, 2);
});
