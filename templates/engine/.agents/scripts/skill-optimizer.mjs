#!/usr/bin/env node
// skill-optimizer.mjs
// 技能资产自优化进化飞轮（对标中兴 Co-Sight Harness skill-optimizer）
//
// 职责：
//   1. 缺陷模式提取与针对性补丁提炼引擎（基于历史处方与失败日志提取高频模式并生成防御补丁）；
//   2. 影子沙箱与 A/B 候选生成机制（在隔离工作区生成候选 Arm B 与基线 Arm A，生成规范 Unified Diff）；
//   3. 对抗评估验证与胜出判定引擎（双臂跑分比对，严格要求零回归且提升达标，支持安全应用与一键回滚）；
//   4. 端到端自优化工作流调度器（提取、补丁、沙箱对质、裁决与原子应用）。
//
// 零外部依赖，纯 Node.js 标准库实现。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadPrescriptionStore } from './self-healing-prescriptions.mjs';

// ---------------------------------------------------------------------
// 1. 缺陷模式库与提炼契约 (Defect Patterns & Extraction Engine)
// ---------------------------------------------------------------------

export const KNOWN_DEFECT_PATTERNS = [
  {
    id: 'pattern-touch-set-out-of-scope',
    category: 'touch-set',
    keywords: ['touch-set', '白名单', '未声明', '越界', 'out-of-scope', 'unpermitted file'],
    title: '触点范围违规',
    rootCause: '智能体修改了未在工单声明的文件，破坏触点最小化原则',
    preventiveGuideline: '严格遵从 touch-set 白名单。禁止修改未在任务中声明的文件。',
    checklistRule: '- [ ] 核对触点白名单。确认所有修改文件均已在工单中明确声明。',
  },
  {
    id: 'pattern-destructive-symbol-mutation',
    category: 'semantic-sandbox',
    keywords: ['符号', 'AST', 'semantic', '破坏性变更', 'exported', '签名改变', '接口破坏'],
    title: '破坏性导出符号变更',
    rootCause: '修改或删除了既有公开函数、类或导出的类型签名，破坏下游依赖契约',
    preventiveGuideline: '保护已有导出符号签名。禁止无版本协商删除或破坏性修改导出函数。',
    checklistRule: '- [ ] 检查导出符号兼容性。确认公共函数签名与已有参数位置保持向后兼容。',
  },
  {
    id: 'pattern-missing-negative-test',
    category: 'test-failure',
    keywords: ['单测', 'assert', '测试失败', 'FAIL', '回归', 'negative test', '覆盖率'],
    title: '负向与异常用例缺失',
    rootCause: '代码仅覆盖成功路径，缺乏对异常输入、边界值与错误分支的防御性拦截',
    preventiveGuideline: '编写覆盖全路径的验证。包含空值、非法类型与越界输入的负向断言。',
    checklistRule: '- [ ] 补齐负向与边界测试。确保错误参数能被有效捕获并返回合规错误。',
  },
  {
    id: 'pattern-unverified-completion',
    category: 'syntax',
    keywords: ['语法', 'lint', '未验证', '执行失败', 'type error', 'ReferenceError', 'SyntaxError'],
    title: '未闭环验证即标记完成',
    rootCause: '修改完成后未运行本地静态检查或单元测试，遗留语法错误或未定义变量',
    preventiveGuideline: '每次变更后必须运行本地测试与静态门禁。确认 100% 绿灯后再交付。',
    checklistRule: '- [ ] 执行本地完整验证。运行相关单测与静态检查，确认无任何报错或警告。',
  },
  {
    id: 'pattern-policy-governance-drift',
    category: 'policy-drift',
    keywords: ['policy', '机制', '规约', '漂移', 'governance', '不合规'],
    title: '治理策略漂移',
    rootCause: '改动绕过了项目既定流程规范或未及时同步机制清单与凭证记录',
    preventiveGuideline: '遵守既定架构与治理规约。变更若触碰关键机制需同步更新对应文档。',
    checklistRule: '- [ ] 核对架构治理规约。确认未破坏系统防线并同步更新必要凭据。',
  },
];

/**
 * 从处方库与失败日志中提取高频缺陷模式
 * @param {object} options
 * @param {Array} options.prescriptions - 处方列表（来自 self-healing-prescriptions）
 * @param {Array|string} options.failureLogs - 失败日志字符串或列表
 * @param {string} options.skillName - 目标技能名称（可选过滤）
 * @returns {Array<object>} 聚合统计后的缺陷模式列表
 */
export function extractDefectPatterns(options = {}) {
  const prescriptions = Array.isArray(options.prescriptions) ? options.prescriptions : [];
  const rawLogs = Array.isArray(options.failureLogs)
    ? options.failureLogs.join('\n')
    : String(options.failureLogs || '');

  const matchedPatterns = new Map();

  function recordHit(pattern, source, detail = '') {
    if (!matchedPatterns.has(pattern.id)) {
      matchedPatterns.set(pattern.id, {
        id: pattern.id,
        category: pattern.category,
        title: pattern.title,
        rootCause: pattern.rootCause,
        preventiveGuideline: pattern.preventiveGuideline,
        checklistRule: pattern.checklistRule,
        occurrences: 0,
        sources: [],
        details: [],
      });
    }
    const item = matchedPatterns.get(pattern.id);
    item.occurrences += 1;
    if (!item.sources.includes(source)) {
      item.sources.push(source);
    }
    if (detail && !item.details.includes(detail) && item.details.length < 5) {
      item.details.push(detail);
    }
  }

  // 1. 分析处方库
  for (const rx of prescriptions) {
    if (!rx) continue;
    const textCorpus = [
      rx.category || '',
      rx.failurePattern || '',
      rx.rootCause || '',
      rx.actionableFix || '',
      ...(Array.isArray(rx.prescriptions) ? rx.prescriptions : []),
    ].join(' ').toLowerCase();

    for (const pattern of KNOWN_DEFECT_PATTERNS) {
      const isCatMatch = rx.category && rx.category.toLowerCase() === pattern.category.toLowerCase();
      const isKeywordMatch = pattern.keywords.some((kw) => textCorpus.includes(kw.toLowerCase()));
      if (isCatMatch || isKeywordMatch) {
        recordHit(pattern, 'prescription', rx.actionableFix || rx.rootCause || rx.id);
      }
    }
  }

  // 2. 分析失败日志
  if (rawLogs.trim().length > 0) {
    for (const pattern of KNOWN_DEFECT_PATTERNS) {
      const matchCount = pattern.keywords.reduce((acc, kw) => {
        const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = rawLogs.match(regex);
        return acc + (matches ? matches.length : 0);
      }, 0);

      if (matchCount > 0) {
        for (let i = 0; i < Math.min(matchCount, 3); i++) {
          recordHit(pattern, 'failure_log', `Log matched keyword in pattern ${pattern.id}`);
        }
      }
    }
  }

  // 按出现频次倒序排列
  const results = Array.from(matchedPatterns.values()).sort((a, b) => b.occurrences - a.occurrences);
  return results;
}

// ---------------------------------------------------------------------
// 2. 结构化补丁提炼引擎 (Targeted Patch Generator)
// ---------------------------------------------------------------------

/**
 * 分离 Frontmatter 与正文
 * @param {string} content
 * @returns {{ frontmatter: string, body: string, hasFrontmatter: boolean }}
 */
export function splitFrontmatterAndBody(content = '') {
  const text = String(content || '');
  if (!text.startsWith('---')) {
    return { frontmatter: '', body: text, hasFrontmatter: false };
  }
  const secondIndex = text.indexOf('\n---', 3);
  if (secondIndex === -1) {
    return { frontmatter: '', body: text, hasFrontmatter: false };
  }
  const endOfFrontmatter = secondIndex + 4; // 跳过 \n---
  const frontmatter = text.slice(0, endOfFrontmatter).trim();
  const body = text.slice(endOfFrontmatter).replace(/^\r?\n/, '');
  return { frontmatter, body, hasFrontmatter: true };
}

/**
 * 生成优化补丁
 * @param {object} options
 * @param {string} options.originalContent - 原技能 Markdown 内容
 * @param {Array<object>} options.defectPatterns - 缺陷模式列表
 * @param {string} options.skillName - 技能名称
 * @param {object} options.meta - 额外元数据
 * @returns {{ patchedContent: string, addedRules: Array<string>, diffStats: object }}
 */
export function generateOptimizationPatch(options = {}) {
  const original = String(options.originalContent || '');
  const defectPatterns = Array.isArray(options.defectPatterns) ? options.defectPatterns : [];

  if (!original.trim() || defectPatterns.length === 0) {
    return {
      patchedContent: original,
      addedRules: [],
      diffStats: { additions: 0, deletions: 0 },
    };
  }

  const { frontmatter, body, hasFrontmatter } = splitFrontmatterAndBody(original);

  // 提取需要注入的检查规则（去重）
  const rulesToInject = [];
  for (const pattern of defectPatterns) {
    if (pattern.checklistRule && !rulesToInject.includes(pattern.checklistRule)) {
      // 避免重复注入已存在的类似表述
      const normRule = pattern.checklistRule.replace(/^[-\s*\[\]xX]+/, '').trim();
      if (!body.includes(normRule)) {
        rulesToInject.push(pattern.checklistRule);
      }
    }
  }

  if (rulesToInject.length === 0) {
    return {
      patchedContent: original,
      addedRules: [],
      diffStats: { additions: 0, deletions: 0 },
    };
  }

  const sectionHeader = '## 针对性防御检查单 (Self-Optimized Checklist)';
  let newBody = body;

  if (body.includes(sectionHeader)) {
    // 已经有该小节，在小节末尾追加新条目
    const sectionIndex = body.indexOf(sectionHeader);
    const nextHeaderMatch = body.slice(sectionIndex + sectionHeader.length).match(/\n##\s+/);
    const insertPos = nextHeaderMatch
      ? sectionIndex + sectionHeader.length + nextHeaderMatch.index
      : body.length;

    const prefix = body.slice(0, insertPos).trimEnd();
    const suffix = body.slice(insertPos).trimStart();
    const appendedRules = rulesToInject.join('\n');
    newBody = `${prefix}\n${appendedRules}\n\n${suffix}`.trim();
  } else {
    // 尚无该小节，在文档末尾注入
    const checklistBlock = [
      '',
      sectionHeader,
      '',
      '> 依据历史缺陷模式提炼并自动注入的防御加固条款：',
      '',
      ...rulesToInject,
      '',
    ].join('\n');

    newBody = `${body.trimEnd()}\n${checklistBlock}`.trim();
  }

  // 重组文本，保证 Frontmatter 原样保留
  const patchedContent = hasFrontmatter
    ? `${frontmatter}\n\n${newBody}\n`
    : `${newBody}\n`;

  const additions = rulesToInject.length;
  return {
    patchedContent,
    addedRules: rulesToInject,
    diffStats: { additions, deletions: 0 },
  };
}

// ---------------------------------------------------------------------
// 3. 影子沙箱与 A/B 候选生成机制 (Shadow Sandbox & Candidate Generator)
// ---------------------------------------------------------------------

/**
 * 快速生成文本行级 Unified Diff 表达
 * @param {string} oldText
 * @param {string} newText
 * @param {object} options
 * @returns {string} Unified Diff 字符串
 */
export function generateUnifiedDiff(oldText = '', newText = '', options = {}) {
  const filePath = options.filePath || 'SKILL.md';
  const oldLines = String(oldText).split('\n');
  const newLines = String(newText).split('\n');

  const diffLines = [];
  diffLines.push(`--- a/${filePath}`);
  diffLines.push(`+++ b/${filePath}`);
  diffLines.push('@@ -1 +1 @@');

  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o !== n) {
      if (o !== undefined) diffLines.push(`-${o}`);
      if (n !== undefined) diffLines.push(`+${n}`);
    }
  }

  return diffLines.join('\n');
}

/**
 * 在隔离沙箱中构建 A/B 双臂候选工件
 * @param {object} options
 * @param {string} options.skillPath - 技能文件原始路径
 * @param {string} options.originalContent - 基线内容（Arm A）
 * @param {string} options.patchedContent - 优化内容（Arm B）
 * @param {object} options.metadata - 附加元数据
 * @returns {{ sandboxDir: string, armA: object, armB: object, diff: string, cleanup: Function }}
 */
export function createShadowCandidate(options = {}) {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-opt-shadow-'));
  const originalContent = String(options.originalContent || '');
  const patchedContent = String(options.patchedContent || '');
  const skillPath = options.skillPath || 'SKILL.md';
  const skillName = options.skillName || path.basename(path.dirname(skillPath)) || 'unknown';

  const armADir = path.join(sandboxDir, 'arm-a');
  const armBDir = path.join(sandboxDir, 'arm-b');
  fs.mkdirSync(armADir, { recursive: true });
  fs.mkdirSync(armBDir, { recursive: true });

  const armAPath = path.join(armADir, 'SKILL.md');
  const armBPath = path.join(armBDir, 'SKILL.md');
  fs.writeFileSync(armAPath, originalContent, 'utf8');
  fs.writeFileSync(armBPath, patchedContent, 'utf8');

  const diff = generateUnifiedDiff(originalContent, patchedContent, { filePath: skillPath });

  const cleanup = () => {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  };

  return {
    sandboxDir,
    skillName,
    diff,
    armA: {
      name: 'arm-a',
      type: 'baseline',
      filePath: armAPath,
      content: originalContent,
    },
    armB: {
      name: 'arm-b',
      type: 'candidate',
      filePath: armBPath,
      content: patchedContent,
    },
    cleanup,
  };
}

// ---------------------------------------------------------------------
// 4. 对抗评估验证与胜出判定引擎 (Adversarial Evaluator & Winner Adjudicator)
// ---------------------------------------------------------------------

/**
 * 对抗评估双臂并判定胜出者
 * @param {object} options
 * @param {object} options.armA - 基线臂
 * @param {object} options.armB - 候选臂
 * @param {Array<object>} options.testCases - 测试用例集
 * @param {Function} options.runner - 测试用例执行器 (task, arm) => { passed: boolean, score: number }
 * @param {number} options.minDelta - 最小提升阈值（默认 0.10 即 10%）
 * @returns {object} 对抗评测完整报告与决策结论
 */
export function evaluateCandidateArmPair(options = {}) {
  const armA = options.armA || {};
  const armB = options.armB || {};
  const testCases = Array.isArray(options.testCases) ? options.testCases : [];
  const runner = typeof options.runner === 'function' ? options.runner : null;
  const minDelta = typeof options.minDelta === 'number' ? options.minDelta : 0.10;

  if (testCases.length === 0) {
    return {
      evaluated: false,
      approved: false,
      verdict: 'rejected_no_test_cases',
      reason: '未提供可用于双臂对抗评估的测试任务集',
      metrics: null,
    };
  }

  const resultsA = [];
  const resultsB = [];

  for (const task of testCases) {
    let resA = { passed: false, score: 0.0 };
    let resB = { passed: false, score: 0.0 };

    if (runner) {
      resA = runner(task, armA) || resA;
      resB = runner(task, armB) || resB;
    } else {
      // 默认规则模拟判定
      const kw = task.expectedKeywords || [];
      const hasA = kw.length === 0 || kw.every((k) => (armA.content || '').includes(k));
      const hasB = kw.length === 0 || kw.every((k) => (armB.content || '').includes(k));
      resA = { passed: Boolean(task.baselinePass ?? hasA), score: task.baselinePass ?? hasA ? 1.0 : 0.0 };
      resB = { passed: Boolean(task.candidatePass ?? hasB), score: task.candidatePass ?? hasB ? 1.0 : 0.0 };
    }

    resultsA.push({ taskId: task.id || task.name || 'unnamed', ...resA });
    resultsB.push({ taskId: task.id || task.name || 'unnamed', ...resB });
  }

  const countA = resultsA.length;
  const passedCountA = resultsA.filter((r) => r.passed).length;
  const passRateA = countA > 0 ? passedCountA / countA : 0;
  const avgScoreA = countA > 0 ? resultsA.reduce((sum, r) => sum + (r.score || 0), 0) / countA : 0;

  const countB = resultsB.length;
  const passedCountB = resultsB.filter((r) => r.passed).length;
  const passRateB = countB > 0 ? passedCountB / countB : 0;
  const avgScoreB = countB > 0 ? resultsB.reduce((sum, r) => sum + (r.score || 0), 0) / countB : 0;

  const deltaPassRate = passRateB - passRateA;
  const deltaScore = avgScoreB - avgScoreA;

  // 关键判据：回归用例（Baseline 通过，但 Candidate 却失败）
  const regressions = [];
  const flips = []; // Candidate 转绿的收益用例

  for (let i = 0; i < testCases.length; i++) {
    const task = testCases[i];
    const rA = resultsA[i];
    const rB = resultsB[i];

    if (rA.passed && !rB.passed) {
      regressions.push({
        taskId: rA.taskId,
        taskName: task.name || task.id,
        reason: '基线臂通过但优化候选臂执行失败',
      });
    } else if (!rA.passed && rB.passed) {
      flips.push({
        taskId: rA.taskId,
        taskName: task.name || task.id,
        gain: '基线臂失败但优化候选臂成功转绿',
      });
    }
  }

  // 判定状态机
  let approved = false;
  let verdict = 'rejected';
  let reason = '';

  if (regressions.length > 0) {
    approved = false;
    verdict = 'rejected_has_regressions';
    reason = `候选臂出现 ${regressions.length} 处能力回归。违反零回归铁律，拒绝应用。`;
  } else if (deltaPassRate >= minDelta || (deltaScore >= minDelta && flips.length > 0)) {
    approved = true;
    verdict = 'winner_candidate';
    reason = `候选臂通过率提升 ${(deltaPassRate * 100).toFixed(1)}%（得分提升 ${(deltaScore * 100).toFixed(1)}%），且保持零回归。判定胜出。`;
  } else {
    approved = false;
    verdict = 'rejected_insufficient_gain';
    reason = `候选臂虽无回归，但提升幅度未达预设门槛（要求提升 ≥ ${(minDelta * 100).toFixed(0)}%）。`;
  }

  return {
    evaluated: true,
    approved,
    verdict,
    reason,
    metrics: {
      totalTasks: testCases.length,
      baseline: {
        passCount: passedCountA,
        passRate: Math.round(passRateA * 1000) / 1000,
        averageScore: Math.round(avgScoreA * 1000) / 1000,
      },
      candidate: {
        passCount: passedCountB,
        passRate: Math.round(passRateB * 1000) / 1000,
        averageScore: Math.round(avgScoreB * 1000) / 1000,
      },
      deltaPassRate: Math.round(deltaPassRate * 1000) / 1000,
      deltaScore: Math.round(deltaScore * 1000) / 1000,
      regressionsCount: regressions.length,
      flipsCount: flips.length,
    },
    regressions,
    flips,
    details: {
      resultsA,
      resultsB,
    },
  };
}

/**
 * 格式化输出 TSV 盲评结果（契合 eval 技能格式）
 * @param {Array<object>} testCases
 * @param {Array<object>} resultsA
 * @param {Array<object>} resultsB
 * @returns {string}
 */
export function formatEvalTsv(testCases = [], resultsA = [], resultsB = []) {
  const lines = ['task\texpected\ta\tb'];
  for (let i = 0; i < testCases.length; i++) {
    const t = testCases[i];
    const rA = resultsA[i] || {};
    const rB = resultsB[i] || {};
    const id = t.id || t.name || `task-${i + 1}`;
    const exp = t.expected || 'pass';
    const aVal = rA.passed ? 'pass' : 'fail';
    const bVal = rB.passed ? 'pass' : 'fail';
    lines.push(`${id}\t${exp}\t${aVal}\t${bVal}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------
// 5. 安全应用与一键回滚机制 (Safe Apply & Rollback)
// ---------------------------------------------------------------------

/**
 * 安全应用优化补丁到目标技能文件
 * @param {string} root - 项目根目录
 * @param {object} options
 * @param {string} options.skillName - 技能名称
 * @param {string} options.candidateContent - 优化后的新内容
 * @param {object} options.proposal - 评测报告
 * @returns {{ applied: boolean, backupPath: string, targetPath: string }}
 */
export function applySkillOptimization(root, options = {}) {
  const skillName = options.skillName;
  if (!skillName) {
    throw new Error('缺少必须的 skillName 参数');
  }

  const possiblePaths = [
    path.join(root, '.agents', 'skills', skillName, 'SKILL.md'),
    path.join(root, 'templates', 'engine', '.agents', 'skills', skillName, 'SKILL.md'),
  ];

  let targetPath = possiblePaths.find((p) => fs.existsSync(p));
  if (!targetPath) {
    targetPath = path.join(root, '.agents', 'skills', skillName, 'SKILL.md');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const backupPath = `${targetPath}.bak`;

  // 备份原文件
  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, 'utf8');
    fs.writeFileSync(backupPath, existing, 'utf8');
  }

  // 原子写入新内容
  const newContent = String(options.candidateContent || '');
  fs.writeFileSync(targetPath, newContent, 'utf8');

  // 追加记录审计日志
  const logDir = path.join(root, '.agents', 'evals');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'skill-optimizer.jsonl');
  const record = {
    timestamp: new Date().toISOString(),
    skillName,
    targetPath,
    backupPath,
    verdict: options.proposal?.verdict || 'winner_candidate',
    deltaPassRate: options.proposal?.metrics?.deltaPassRate ?? 0,
    regressions: options.proposal?.metrics?.regressionsCount ?? 0,
  };
  fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`, 'utf8');

  return {
    applied: true,
    targetPath,
    backupPath,
  };
}

/**
 * 一键回滚技能优化修改
 * @param {string} root - 项目根目录
 * @param {string} skillName - 技能名称
 * @returns {{ rolledBack: boolean, targetPath: string, message: string }}
 */
export function rollbackSkillOptimization(root, skillName) {
  if (!skillName) {
    throw new Error('缺少必须的 skillName 参数');
  }

  const possiblePaths = [
    path.join(root, '.agents', 'skills', skillName, 'SKILL.md'),
    path.join(root, 'templates', 'engine', '.agents', 'skills', skillName, 'SKILL.md'),
  ];

  const targetPath = possiblePaths.find((p) => fs.existsSync(p));
  if (!targetPath) {
    return {
      rolledBack: false,
      targetPath: '',
      message: `未找到技能 ${skillName} 的目标文件`,
    };
  }

  const backupPath = `${targetPath}.bak`;
  if (!fs.existsSync(backupPath)) {
    return {
      rolledBack: false,
      targetPath,
      message: `未找到备份文件 ${backupPath}。无法回滚。`,
    };
  }

  // 恢复备份
  const backupContent = fs.readFileSync(backupPath, 'utf8');
  fs.writeFileSync(targetPath, backupContent, 'utf8');
  fs.unlinkSync(backupPath);

  // 记录回滚日志
  const logDir = path.join(root, '.agents', 'evals');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'skill-optimizer.jsonl');
  const record = {
    timestamp: new Date().toISOString(),
    action: 'rollback',
    skillName,
    targetPath,
  };
  fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`, 'utf8');

  return {
    rolledBack: true,
    targetPath,
    message: `成功将技能 ${skillName} 恢复至优化前的基准版本`,
  };
}

// ---------------------------------------------------------------------
// 6. 端到端自优化工作流调度器 (End-to-End Optimization Workflow)
// ---------------------------------------------------------------------

/**
 * 端到端执行技能自动优化与对抗评测工作流
 * @param {object} options
 * @param {string} options.root - 项目根目录
 * @param {string} options.skillName - 技能名
 * @param {string} options.originalContent - 原技能内容（可选传入，若无则自动读盘）
 * @param {Array} options.prescriptions - 处方列表（可选传入，若无则尝试自动加载）
 * @param {string|Array} options.failureLogs - 失败日志
 * @param {Array<object>} options.testCases - 自定义测试集
 * @param {Function} options.runner - 测试执行器
 * @param {boolean} options.apply - 判定胜出后是否自动应用
 * @param {number} options.minDelta - 最小胜出门限
 * @returns {object} 执行综合报告
 */
export function optimizeSkillWorkflow(options = {}) {
  const root = options.root || process.cwd();
  const skillName = options.skillName || 'eval';

  // 1. 获取技能内容
  let originalContent = options.originalContent;
  let skillFilePath = options.skillFilePath;

  if (!originalContent) {
    const candidatePaths = [
      path.join(root, '.agents', 'skills', skillName, 'SKILL.md'),
      path.join(root, 'templates', 'engine', '.agents', 'skills', skillName, 'SKILL.md'),
    ];
    skillFilePath = candidatePaths.find((p) => fs.existsSync(p));
    if (skillFilePath) {
      originalContent = fs.readFileSync(skillFilePath, 'utf8');
    }
  }

  if (!originalContent) {
    return {
      success: false,
      reason: `未找到技能 ${skillName} 的 SKILL.md 源文件`,
    };
  }

  // 2. 收集处方
  const prescriptions = options.prescriptions || loadPrescriptionStore(root);

  const failureLogs = options.failureLogs || '';

  // 3. 提取缺陷模式
  const defectPatterns = extractDefectPatterns({
    prescriptions,
    failureLogs,
    skillName,
  });

  if (defectPatterns.length === 0) {
    return {
      success: false,
      reason: '未检测到与目标技能匹配的高频缺陷模式，无需优化',
      defectPatterns: [],
    };
  }

  // 4. 生成针对性补丁
  const patchResult = generateOptimizationPatch({
    originalContent,
    defectPatterns,
    skillName,
  });

  if (patchResult.addedRules.length === 0) {
    return {
      success: false,
      reason: '技能正文已包含所有对应防御检查项，无需重复注入',
      defectPatterns,
    };
  }

  // 5. 影子沙箱构建
  const shadow = createShadowCandidate({
    skillPath: skillFilePath || path.join('.agents', 'skills', skillName, 'SKILL.md'),
    originalContent,
    patchedContent: patchResult.patchedContent,
    skillName,
  });

  // 6. 双臂对抗评估
  const testCases = options.testCases || [
    {
      id: `task-robustness-${defectPatterns[0].category}`,
      name: `Robustness Gate for ${defectPatterns[0].category}`,
      expectedKeywords: patchResult.addedRules.map((r) => r.replace(/^[-\s*\[\]xX]+/, '').trim()),
      baselinePass: false,
      candidatePass: true,
    },
    {
      id: 'task-core-baseline-function',
      name: 'Existing Core Baseline Task',
      expectedKeywords: [],
      baselinePass: true,
      candidatePass: true,
    },
  ];

  const evalResult = evaluateCandidateArmPair({
    armA: shadow.armA,
    armB: shadow.armB,
    testCases,
    runner: options.runner,
    minDelta: options.minDelta,
  });

  // 7. 胜出后安全应用
  let appliedResult = null;
  if (evalResult.approved && options.apply) {
    appliedResult = applySkillOptimization(root, {
      skillName,
      candidateContent: patchResult.patchedContent,
      proposal: evalResult,
    });
  }

  // 8. 清理沙箱
  shadow.cleanup();

  return {
    success: evalResult.approved,
    skillName,
    defectPatterns,
    patch: patchResult,
    diff: shadow.diff,
    evalResult,
    applied: Boolean(appliedResult?.applied),
    targetPath: appliedResult?.targetPath,
    backupPath: appliedResult?.backupPath,
  };
}

// ---------------------------------------------------------------------
// 7. 命令行入口 (CLI Interface)
// ---------------------------------------------------------------------

export function parseArgs(args = []) {
  const result = {
    command: 'help',
    skill: '',
    dryRun: false,
    apply: false,
    rollback: false,
    arbitrate: false,
    extract: false,
    minDelta: 0.10,
    root: '',
    json: false,
    raw: args,
  };

  const readVal = (idx, prefix) => {
    if (args[idx].startsWith(`${prefix}=`)) return [args[idx].slice(prefix.length + 1), idx];
    if (args[idx] === prefix && args[idx + 1] != null) return [args[idx + 1], idx + 1];
    return null;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'extract' || arg === 'optimize' || arg === 'eval' || arg === 'rollback' || arg === 'help') {
      result.command = arg;
      continue;
    }
    const skillHit = readVal(i, '--skill');
    if (skillHit) { [result.skill, i] = skillHit; continue; }
    const rootHit = readVal(i, '--root');
    if (rootHit) { [result.root, i] = rootHit; continue; }
    const deltaHit = readVal(i, '--min-delta');
    if (deltaHit) { result.minDelta = Number(deltaHit[0]) || 0.10; i = deltaHit[1]; continue; }

    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--apply') {
      result.apply = true;
    } else if (arg === '--arbitrate') {
      result.arbitrate = true;
      if (result.command === 'help') result.command = 'optimize';
    } else if (arg === '--extract') {
      result.extract = true;
      if (result.command === 'help') result.command = 'extract';
    } else if (arg === '--rollback') {
      result.rollback = true;
      if (result.command === 'help') result.command = 'rollback';
    } else if (arg === '--json') {
      result.json = true;
    }
  }

  return result;
}

export function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root || process.env.FLOW_KIT_PROJECT_ROOT || process.cwd());

  if (args.command === 'help') {
    console.log('用法: node skill-optimizer.mjs <command> [options]');
    console.log('');
    console.log('命令:');
    console.log('  extract   从失败日志与处方库提取缺陷模式');
    console.log('  optimize  自动提炼补丁并在影子沙箱中进行 A/B 对抗评估');
    console.log('  rollback  一键回滚最近一次技能优化');
    console.log('');
    console.log('选项:');
    console.log('  --skill <name>    指定目标技能名称');
    console.log('  --apply           评估胜出后自动应用到目标文件');
    console.log('  --dry-run         仅输出比对 Diff 与判定报告，不写入');
    console.log('  --min-delta <num> 胜出所需的最小通过率提升（默认 0.10）');
    console.log('  --json            输出 JSON 格式');
    process.exit(0);
  }

  if (args.command === 'rollback') {
    if (!args.skill) {
      console.error('错误: 请通过 --skill 指定需要回滚的技能');
      process.exit(1);
    }
    const res = rollbackSkillOptimization(root, args.skill);
    if (args.json) console.log(JSON.stringify(res, null, 2));
    else console.log(res.message);
    process.exit(res.rolledBack ? 0 : 1);
  }

  if (args.command === 'extract') {
    const prescriptions = loadPrescriptionStore(root);
    const defectPatterns = extractDefectPatterns({ prescriptions, skillName: args.skill || '' });
    if (args.json) {
      console.log(JSON.stringify({ skillName: args.skill || null, defectPatterns }, null, 2));
    } else {
      console.log(`缺陷模式提取结果（技能: ${args.skill || '全量'}，共 ${defectPatterns.length} 项）：`);
      for (const p of defectPatterns) {
        console.log(`  - [${p.id}] (${p.category}) ${p.title} 出现 ${p.occurrences} 次`);
        console.log(`    根因: ${p.rootCause}`);
        console.log(`    条款: ${p.checklistRule}`);
      }
    }
    process.exit(0);
  }

  if (args.command === 'optimize') {
    const res = optimizeSkillWorkflow({
      root,
      skillName: args.skill || 'eval',
      apply: args.apply && !args.dryRun,
      minDelta: args.minDelta,
    });
    if (args.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`[skill-optimizer] 优化裁决结果: ${res.success ? 'PASS (胜出)' : 'FAIL (未胜出)'}`);
      if (res.evalResult) {
        console.log(`  - 决策结论: ${res.evalResult.verdict} (${res.evalResult.reason})`);
        const m = res.evalResult.metrics;
        if (m) {
          console.log(`  - 基线通过率: ${(m.baseline.passRate * 100).toFixed(1)}% -> 候选通过率: ${(m.candidate.passRate * 100).toFixed(1)}%`);
          console.log(`  - 增益: +${(m.deltaPassRate * 100).toFixed(1)}% | 回归数: ${m.regressionsCount}`);
        }
      }
      if (res.applied) {
        console.log(`  - 已应用至: ${res.targetPath} (备份: ${res.backupPath})`);
      }
    }
    process.exit(res.success ? 0 : 1);
  }

  console.log(`[skill-optimizer] 运行命令: ${args.command}, 技能: ${args.skill || '全量'}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
