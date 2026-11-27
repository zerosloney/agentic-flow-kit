// tests/e2e-evolution-drill.test.mjs
// 全套机制联合演练（8 大演进方向端到端集成验证）
//
// 验证链路：
//   1. 调度与观测初始化（方向 7 + 方向 8：影子工作区 + 时序事件记录）
//   2. 语义沙箱破坏性变更拦截与修复放行（方向 2：符号差异比对拦截公共契约破坏）
//   3. 反向拓扑增量选测（方向 4：精确裁剪无关测试，命中受影响用例）
//   4. 失败提炼知识处方并前向自愈转绿（方向 3：自愈处方生命周期与置信度提升）
//   5. 异构双角色挑战背书（方向 1：架构与安全去中心化分片凭据验签）
//   6. 效能基准评测打分（方向 5：5 维 Rubric 评分卡与雷达图投影）
//   7. 技能资产自优化与零回归 A/B 裁决（方向 6：模式固化回 SKILL.md 并安全应用）
//   8. 流水线终态复盘与时间旅行回溯（方向 8：导出离线 post-mortem 包与任意时刻状态投影）

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 引入 8 大核心演进模块
import {
  buildEndorsementToken,
  writeEndorsementToken,
  resolveReviewEndorsement,
} from '../templates/engine/.agents/scripts/endorsement-protocol.mjs'; // 方向 1

import {
  extractSymbols,
  diffSymbols,
} from '../templates/engine/.agents/scripts/semantic-sandbox.mjs'; // 方向 2

import {
  createPrescription,
  recordFeedback,
} from '../templates/engine/.agents/scripts/self-healing-prescriptions.mjs'; // 方向 3

import {
  selectDynamicTestImpact,
} from '../templates/engine/.agents/scripts/dynamic-test-impact.mjs'; // 方向 4

import {
  computeCompositeScore,
  renderAsciiRadar,
} from '../templates/engine/.agents/scripts/agent-evaluator.mjs'; // 方向 5

import {
  optimizeSkillWorkflow,
} from '../templates/engine/.agents/scripts/skill-optimizer.mjs'; // 方向 6

import {
  createShadowWorkspace,
  scanFileTreeHashes,
} from '../templates/engine/.agents/scripts/headless-driver.mjs'; // 方向 7

import {
  appendTimelineEvent,
  loadTimelineTrace,
  buildKeyframeIndex,
  projectStateAtTimestamp,
  exportPostMortemBundle,
  renderPostMortemHtml,
} from '../templates/engine/.agents/scripts/timeline-trace.mjs'; // 方向 8

describe('全套机制联合演练（8 大演进方向完整闭环验证）', () => {
  let drillRoot = null;
  let shadowWorkspace = null;
  const runId = 'drill-run-20261125-e2e';

  beforeEach(() => {
    // 建立临时测试主工作区
    drillRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-drill-root-'));

    // 初始化基础目录结构与源代码
    const srcDir = path.join(drillRoot, 'src');
    const testsDir = path.join(drillRoot, 'tests');
    const skillsDir = path.join(drillRoot, '.agents', 'skills', 'calc-worker');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(testsDir, { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });

    // 原始计算模块（包含 3 个导出函数）
    fs.writeFileSync(
      path.join(srcDir, 'calculator.mjs'),
      [
        'export function calculateAdd(a, b) { return a + b; }',
        'export function calculateMultiply(a, b) { return a * b; }',
        'export function calculateDivide(a, b) {',
        '  if (b === 0) throw new Error("Division by zero");',
        '  return a / b;',
        '}',
      ].join('\n'),
      'utf8',
    );

    // 计算器相关测试
    fs.writeFileSync(
      path.join(testsDir, 'calculator.test.mjs'),
      [
        'import { calculateAdd, calculateMultiply, calculateDivide } from "../src/calculator.mjs";',
        'export function runTest() { return calculateAdd(1, 2) === 3; }',
      ].join('\n'),
      'utf8',
    );

    // 无关模块测试
    fs.writeFileSync(
      path.join(testsDir, 'unrelated.test.mjs'),
      'export function runUnrelatedTest() { return true; }',
      'utf8',
    );

    // 基础技能文件
    fs.writeFileSync(
      path.join(skillsDir, 'SKILL.md'),
      [
        '---',
        'name: calc-worker',
        'description: 计算器研发代理',
        '---',
        '# 计算器研发代理',
        '负责实现与维护核心运算逻辑。',
      ].join('\n'),
      'utf8',
    );
  });

  afterEach(() => {
    if (shadowWorkspace) {
      shadowWorkspace.cleanup();
      shadowWorkspace = null;
    }
    if (drillRoot && fs.existsSync(drillRoot)) {
      fs.rmSync(drillRoot, { recursive: true, force: true });
    }
  });

  test('8 大演进机制串联执行与端到端协同验证', () => {
    // -----------------------------------------------------------------
    // 步骤 1: 调度与观测初始化（方向 7: Headless Driver + 方向 8: Timeline Trace）
    // -----------------------------------------------------------------
    shadowWorkspace = createShadowWorkspace(drillRoot, { prefix: 'drill-shadow-' });
    const workDir = shadowWorkspace.shadowDir;
    assert.ok(fs.existsSync(path.join(workDir, 'src', 'calculator.mjs')), '影子工作区文件应完整镜像');

    const initialHashes = scanFileTreeHashes(workDir);
    const rootSnapshotHash = initialHashes.get('src/calculator.mjs');
    assert.ok(rootSnapshotHash, '初始快照 Hash 应成功计算');

    const startEvt = {
      runId,
      seq: 1,
      eventType: 'RUN_STARTED',
      stage: 'init',
      actor: 'headless-driver',
      summary: '全套机制演练在影子沙箱中启动',
      snapshotHash: rootSnapshotHash,
    };
    appendTimelineEvent(workDir, startEvt);

    // -----------------------------------------------------------------
    // 步骤 2: 语义沙箱破坏性变更拦截与修复放行（方向 2: Semantic Sandbox）
    // -----------------------------------------------------------------
    const calcFile = path.join(workDir, 'src', 'calculator.mjs');
    const originalContent = fs.readFileSync(calcFile, 'utf8');

    // 2.1 模拟误删公开导出函数 calculateDivide 的破坏性改动
    const destructiveCode = [
      'export function calculateAdd(a, b) { return a + b; }',
      'export function calculateMultiply(a, b) { return a * b; }',
      '// calculateDivide 被意外删除',
    ].join('\n');

    const beforeSymbols = extractSymbols(originalContent, '.mjs', 'src/calculator.mjs');
    const brokenSymbols = extractSymbols(destructiveCode, '.mjs', 'src/calculator.mjs');
    const destructiveDiff = diffSymbols(beforeSymbols, brokenSymbols);

    const isBreaking = destructiveDiff.removed.some((s) => s.isExported) || destructiveDiff.signatureChanged.some((s) => s.isExported);
    assert.equal(isBreaking, true, '破坏性变更应被语义沙箱识别');
    assert.ok(destructiveDiff.removed.some((s) => s.name === 'calculateDivide'), '被删除的导出符号应被精准捕获');

    appendTimelineEvent(workDir, {
      runId,
      seq: 2,
      eventType: 'STATUS_ROLLBACK',
      stage: 'implement',
      actor: 'semantic-sandbox',
      status: 'rollback',
      summary: '检测到破坏性导出符号变更，阻止非法交付并触发回退',
      payload: { removedSymbols: destructiveDiff.removed.map((s) => s.name) },
    });

    // 2.2 智能体修正为兼容代码（保留原导出签名并进行安全优化）
    const compatibleCode = [
      'export function calculateAdd(a, b) { return a + b; }',
      'export function calculateMultiply(a, b) { return a * b; }',
      'export function calculateDivide(a, b) {',
      '  if (Number(b) === 0) throw new RangeError("Division by zero");',
      '  return a / b;',
      '}',
    ].join('\n');
    fs.writeFileSync(calcFile, compatibleCode, 'utf8');

    const fixedSymbols = extractSymbols(compatibleCode, '.mjs', 'src/calculator.mjs');
    const fixedDiff = diffSymbols(beforeSymbols, fixedSymbols);
    const isFixedBreaking = fixedDiff.removed.some((s) => s.isExported) || fixedDiff.signatureChanged.some((s) => s.isExported);
    assert.equal(isFixedBreaking, false, '修正后破坏性变更应清零');

    appendTimelineEvent(workDir, {
      runId,
      seq: 3,
      eventType: 'STEP_EXECUTED',
      stage: 'implement',
      actor: 'developer-agent',
      status: 'success',
      summary: '代码重构完成且通过语义沙箱契约核验',
    });

    // -----------------------------------------------------------------
    // 步骤 3: 动态测试影响图拓扑感知选测（方向 4: Dynamic Test Impact）
    // -----------------------------------------------------------------
    const changedFiles = ['src/calculator.mjs'];
    const impactResult = selectDynamicTestImpact(workDir, changedFiles);

    assert.equal(impactResult.impactedTests.length > 0, true, '应选出受影响测试用例');
    assert.ok(
      impactResult.impactedTests.some((t) => t.includes('calculator.test.mjs')),
      '必须精准命中关联的 calculator.test.mjs',
    );
    assert.equal(
      impactResult.impactedTests.some((t) => t.includes('unrelated.test.mjs')),
      false,
      '无关测试应当被安全剪枝排除',
    );

    appendTimelineEvent(workDir, {
      runId,
      seq: 4,
      eventType: 'GATE_EVALUATED',
      stage: 'verify',
      actor: 'dynamic-test-impact',
      status: 'success',
      summary: '增量选测决策通过，无关用例已剪枝',
      payload: { selectedCount: impactResult.impactedTests.length },
    });

    // -----------------------------------------------------------------
    // 步骤 4: 知识处方自愈提炼与置信度强化（方向 3: Self-Healing Prescriptions）
    // -----------------------------------------------------------------
    const prescription = createPrescription({
      category: 'test-failure',
      failurePattern: 'RangeError: Division by zero',
      rootCause: '未防御非法零分母输入',
      actionableFix: '增加入参合法性校验与负向边界断言',
      confidence: 0.8,
    });
    assert.equal(prescription.category, 'test-failure');

    // 模拟应用处方后测试顺利转绿，反馈强化置信度
    const feedbackList = recordFeedback([prescription], {
      appliedIds: [prescription.id],
      succeeded: true,
    });
    assert.equal(feedbackList.length, 1);
    assert.ok(feedbackList[0].confidence > 0.8, '正向反馈后处方置信度应显著提升');

    appendTimelineEvent(workDir, {
      runId,
      seq: 5,
      eventType: 'PRESCRIPTION_APPLIED',
      stage: 'verify',
      actor: 'self-healing-engine',
      status: 'success',
      summary: '应用知识处方并验证转绿，置信度强化',
      payload: { prescriptionId: prescription.id, newConfidence: feedbackList[0].confidence },
    });

    // -----------------------------------------------------------------
    // 步骤 5: 异构对抗审计与去中心化背书协议（方向 1: Endorsement Protocol）
    // -----------------------------------------------------------------
    const docPath = 'workflow/spec.d/calculator.md';
    const commitSha = 'a1b2c3d4e5f6';

    const tokenDual = buildEndorsementToken({
      doc: docPath,
      commitmentFingerprint: commitSha,
      endorsements: [
        {
          role: 'architect-reviewer',
          model: 'claude-3-7-sonnet',
          sessionId: 'sess-arch-01',
          conclusion: 'approved',
          comments: '接口保持向后兼容且设计清晰',
        },
        {
          role: 'security-reviewer',
          model: 'o3-mini',
          sessionId: 'sess-sec-02',
          conclusion: 'approved',
          comments: '无越界触点与安全边界穿透',
        },
      ],
    });

    // 分片写入独立账本
    writeEndorsementToken(workDir, tokenDual, { shard: true });

    const endorsementResult = resolveReviewEndorsement({
      root: workDir,
      docRel: docPath,
      text: '## 确认与复核\n',
    });
    assert.equal(endorsementResult.dualEndorsed, true, '双角色异构背书必须成功达成');
    assert.equal(endorsementResult.fromToken, true, '跨会话双审查凭证核实通过');

    appendTimelineEvent(workDir, {
      runId,
      seq: 6,
      eventType: 'ENDORSEMENT_RECORDED',
      stage: 'review',
      actor: 'endorsement-protocol',
      status: 'success',
      summary: '架构与安全双角色异构背书通过',
    });

    // -----------------------------------------------------------------
    // 步骤 6: 零依赖效能评测评分卡与雷达图投影（方向 5: Agent Evaluator）
    // -----------------------------------------------------------------
    const evalScores = {
      taskCompletion: 1.0,
      gatePassRate: 1.0,
      sandboxCompliance: 1.0,
      testImpactPrecision: 1.0,
      stepEfficiency: 0.9,
    };
    const compositeResult = computeCompositeScore(evalScores);
    assert.equal(compositeResult.passed, true, '效能评分综合门禁必须通过');
    assert.ok(compositeResult.composite >= 0.9, '综合得分应在 0.9 以上');

    const radarView = renderAsciiRadar(evalScores, compositeResult.weights, compositeResult.composite);
    assert.ok(radarView.includes('COMPOSITE'), '雷达图应包含综合评分指标');

    appendTimelineEvent(workDir, {
      runId,
      seq: 7,
      eventType: 'GATE_EVALUATED',
      stage: 'review',
      actor: 'agent-evaluator',
      status: 'success',
      summary: '5 维效能评分卡通过',
      payload: { composite: compositeResult.composite },
    });

    // -----------------------------------------------------------------
    // 步骤 7: 技能资产自优化进化飞轮（方向 6: Skill Optimizer）
    // -----------------------------------------------------------------
    // 演练未接真实 runner：评测结论为未验证，落盘须显式放行（与 skill-optimizer 的未验证保护一致）。
    const optResult = optimizeSkillWorkflow({
      root: workDir,
      skillName: 'calc-worker',
      prescriptions: [prescription],
      apply: true,
      allowUnverifiedApply: true,
      minDelta: 0.10,
    });

    assert.equal(optResult.success, true, '技能自优化评测必须判定胜出');
    assert.equal(optResult.verified, false, '未接 runner 的评测应标记为未验证');
    assert.equal(optResult.applied, true, '显式放行后优化成果应安全落盘应用');
    assert.ok(fs.existsSync(optResult.backupPath), '应保留原始技能 .bak 备份');

    const patchedSkill = fs.readFileSync(optResult.targetPath, 'utf8');
    assert.ok(
      patchedSkill.includes('针对性防御检查单'),
      '自优化后的技能应包含防御检查单',
    );

    appendTimelineEvent(workDir, {
      runId,
      seq: 8,
      eventType: 'STEP_EXECUTED',
      stage: 'closeout',
      actor: 'skill-optimizer',
      status: 'success',
      summary: '技能资产优化补丁经影子 A/B 裁决胜出并安全应用',
    });

    // -----------------------------------------------------------------
    // 步骤 8: 流水线终态复盘与时间旅行回溯（方向 8: Timeline Trace）
    // -----------------------------------------------------------------
    const finalHashes = scanFileTreeHashes(workDir);
    const finalSnapshotHash = finalHashes.get('src/calculator.mjs');

    appendTimelineEvent(workDir, {
      runId,
      seq: 9,
      eventType: 'RUN_COMPLETED',
      stage: 'closeout',
      actor: 'headless-driver',
      status: 'success',
      summary: '流水线全部阶段闭环完成',
      snapshotHash: finalSnapshotHash,
    });

    // 8.1 导出离线自包含复盘包
    const bundle = exportPostMortemBundle(workDir, runId);
    assert.equal(bundle.runId, runId);
    assert.equal(bundle.metrics.totalEvents, 9, '时序事件总数应为 9 条');
    assert.ok(bundle.metrics.endorsementsCount >= 1, '复盘包应关联背书凭证');
    assert.ok(bundle.endorsements[0].endorsements.length >= 2, '背书记录应包含至少两个异构审查人');
    assert.ok(fs.existsSync(bundle.bundleFile), '复盘包 JSON 文件必须落盘');

    // 8.2 渲染独立复盘 HTML 网页
    const postMortemHtml = renderPostMortemHtml(bundle);
    assert.ok(postMortemHtml.includes(`流水线时序复盘 — ${runId}`));
    assert.ok(postMortemHtml.includes('RUN_COMPLETED'));

    // 8.3 时间旅行（Time-Travel）回溯验证
    const allEvents = loadTimelineTrace(workDir, runId);
    const keyframes = buildKeyframeIndex(allEvents);
    assert.ok(keyframes.length >= 3, '关键帧索引应捕获核心状态跃迁点');

    // 针对第 2 步回滚点的时间切片回放
    const rollbackEvent = allEvents.find((e) => e.eventType === 'STATUS_ROLLBACK');
    assert.ok(rollbackEvent, '应记录有回滚事件');
    const pastProjection = projectStateAtTimestamp(allEvents, rollbackEvent.timestamp, { maxSeq: rollbackEvent.seq });

    assert.equal(pastProjection.rollbacksCount, 1, '历史切片应精准反映当时发生了 1 次回滚');
    assert.equal(pastProjection.totalStepsExecuted, 2, '当时仅执行了 2 步');
  });
});
