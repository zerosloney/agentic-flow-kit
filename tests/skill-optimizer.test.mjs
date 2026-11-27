// tests/skill-optimizer.test.mjs
// 技能资产自优化进化飞轮（Skill-Optimizer）全套单元测试

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  KNOWN_DEFECT_PATTERNS,
  extractDefectPatterns,
  splitFrontmatterAndBody,
  generateOptimizationPatch,
  generateUnifiedDiff,
  createShadowCandidate,
  evaluateCandidateArmPair,
  formatEvalTsv,
  applySkillOptimization,
  rollbackSkillOptimization,
  optimizeSkillWorkflow,
  parseArgs,
} from '../templates/engine/.agents/scripts/skill-optimizer.mjs';
import { savePrescriptions } from '../templates/engine/.agents/scripts/self-healing-prescriptions.mjs';

describe('Unit 1: 缺陷模式提取与针对性补丁提炼引擎', () => {
  test('extractDefectPatterns 能够从处方列表精准提炼模式并排序', () => {
    const prescriptions = [
      {
        category: 'touch-set',
        failurePattern: 'Modified unpermitted file out-of-scope',
        rootCause: '越界修改了 package.json',
        actionableFix: '仅允许修改 src 目录下的白名单文件',
      },
      {
        category: 'touch-set',
        failurePattern: 'touch-set violation in tests/helper.js',
        rootCause: '未在白名单声明外部辅助文件',
      },
      {
        category: 'semantic-sandbox',
        failurePattern: 'exported function signature destroyed',
        rootCause: '破坏性修改了导出符号契约',
      },
    ];

    const patterns = extractDefectPatterns({ prescriptions });
    assert.ok(patterns.length >= 2, '应提取到至少两种缺陷模式');
    
    // 频次排序，touch-set 命中 2 次应排在第 1
    assert.equal(patterns[0].category, 'touch-set');
    assert.equal(patterns[0].occurrences, 2);
    assert.ok(patterns[0].sources.includes('prescription'));
  });

  test('extractDefectPatterns 能够从失败日志文本提取高频模式', () => {
    const failureLogs = `
      Error: ReferenceError: myFunction is not defined [syntax]
      Uncaught TypeError at calculateSum
      Failed: syntax check aborted
    `;

    const patterns = extractDefectPatterns({ failureLogs });
    const syntaxPattern = patterns.find((p) => p.category === 'syntax');
    assert.ok(syntaxPattern, '应能识别出 syntax 相关缺陷模式');
    assert.ok(syntaxPattern.occurrences > 0);
  });

  test('splitFrontmatterAndBody 能够准确分离 Frontmatter 与正文', () => {
    const raw = `---
name: sample-skill
description: 示例技能定义
---

# sample-skill 正文内容
正文第一段。
`;
    const res = splitFrontmatterAndBody(raw);
    assert.equal(res.hasFrontmatter, true);
    assert.ok(res.frontmatter.includes('name: sample-skill'));
    assert.ok(res.body.includes('# sample-skill 正文内容'));
  });

  test('splitFrontmatterAndBody 在无 Frontmatter 时优雅退化', () => {
    const raw = '# 无 Frontmatter 的普通 Markdown 文档';
    const res = splitFrontmatterAndBody(raw);
    assert.equal(res.hasFrontmatter, false);
    assert.equal(res.frontmatter, '');
    assert.equal(res.body, raw);
  });

  test('generateOptimizationPatch 能够生成针对性检查单并保持幂等性', () => {
    const original = `---
name: test-skill
---

# 核心流程
1. 步骤一
2. 步骤二
`;
    const defectPatterns = [KNOWN_DEFECT_PATTERNS[0], KNOWN_DEFECT_PATTERNS[1]];
    const patchResult = generateOptimizationPatch({
      originalContent: original,
      defectPatterns,
      skillName: 'test-skill',
    });

    assert.ok(patchResult.addedRules.length === 2, '应新增两条防御检查规则');
    assert.ok(patchResult.patchedContent.includes('---'));
    assert.ok(patchResult.patchedContent.includes('name: test-skill'));
    assert.ok(patchResult.patchedContent.includes('## 针对性防御检查单 (Self-Optimized Checklist)'));
    assert.ok(patchResult.patchedContent.includes('触点白名单'));
    assert.ok(patchResult.patchedContent.includes('导出符号兼容性'));

    // 幂等性测试：对已包含规则的内容再次补丁，不再重复注入
    const secondPatch = generateOptimizationPatch({
      originalContent: patchResult.patchedContent,
      defectPatterns,
      skillName: 'test-skill',
    });
    assert.equal(secondPatch.addedRules.length, 0);
    assert.equal(secondPatch.patchedContent, patchResult.patchedContent);
  });
});

describe('Unit 2: 影子沙箱与 A/B 候选生成机制', () => {
  let shadowWorkspace = null;

  afterEach(() => {
    if (shadowWorkspace) {
      shadowWorkspace.cleanup();
      shadowWorkspace = null;
    }
  });

  test('createShadowCandidate 建立隔离双臂沙箱与 Unified Diff', () => {
    const original = '# Baseline Skill\n原有步骤。';
    const patched = '# Baseline Skill\n原有步骤。\n\n## 防御加固条款';

    shadowWorkspace = createShadowCandidate({
      skillPath: 'skills/sample/SKILL.md',
      originalContent: original,
      patchedContent: patched,
      skillName: 'sample',
    });

    assert.ok(fs.existsSync(shadowWorkspace.sandboxDir), '临时沙箱目录应存在');
    assert.ok(fs.existsSync(shadowWorkspace.armA.filePath), 'Arm A 文件应存在');
    assert.ok(fs.existsSync(shadowWorkspace.armB.filePath), 'Arm B 文件应存在');

    assert.equal(fs.readFileSync(shadowWorkspace.armA.filePath, 'utf8'), original);
    assert.equal(fs.readFileSync(shadowWorkspace.armB.filePath, 'utf8'), patched);

    assert.ok(shadowWorkspace.diff.includes('--- a/skills/sample/SKILL.md'));
    assert.ok(shadowWorkspace.diff.includes('+++ b/skills/sample/SKILL.md'));
    assert.ok(shadowWorkspace.diff.includes('+## 防御加固条款'));

    // 验证 cleanup 能够清理目录
    shadowWorkspace.cleanup();
    assert.equal(fs.existsSync(shadowWorkspace.sandboxDir), false);
    shadowWorkspace = null;
  });

  test('generateUnifiedDiff 能够准确生成行级 Diff', () => {
    const diff = generateUnifiedDiff('line 1\nline 2', 'line 1\nline 2 edited\nline 3');
    assert.ok(diff.includes('-line 2'));
    assert.ok(diff.includes('+line 2 edited'));
    assert.ok(diff.includes('+line 3'));
  });
});

describe('Unit 3: 对抗评估验证与胜出判定引擎', () => {
  test('evaluateCandidateArmPair 在无回归且达标提升时判定候选臂胜出', () => {
    const armA = { content: '普通基线技能说明' };
    const armB = { content: '增强技能说明，含严格触点白名单与边界校验' };

    const testCases = [
      {
        id: 'case-1-happy-path',
        name: '常规场景',
        baselinePass: true,
        candidatePass: true,
      },
      {
        id: 'case-2-touch-set-boundary',
        name: '触点边界检查',
        expectedKeywords: ['触点白名单'],
        baselinePass: false,
        candidatePass: true,
      },
    ];

    const evalResult = evaluateCandidateArmPair({
      armA,
      armB,
      testCases,
      runner: (task, arm) => {
        const passed = arm === armA ? task.baselinePass : task.candidatePass;
        return { passed, score: passed ? 1.0 : 0.0 };
      },
      minDelta: 0.10,
    });

    assert.equal(evalResult.evaluated, true);
    assert.equal(evalResult.verified, true);
    assert.equal(evalResult.approved, true);
    assert.equal(evalResult.verdict, 'winner_candidate');
    assert.equal(evalResult.regressions.length, 0);
    assert.equal(evalResult.flips.length, 1);
    assert.equal(evalResult.metrics.deltaPassRate, 0.5);
  });

  test('evaluateCandidateArmPair 无 runner 时只给未验证结论，不宣布候选胜出', () => {
    const armA = { content: '普通基线技能说明' };
    const armB = { content: '增强技能说明，含触点白名单' };
    const testCases = [
      { id: 'case-1', expectedKeywords: [] },
      { id: 'case-2', expectedKeywords: ['触点白名单'] },
    ];

    const evalResult = evaluateCandidateArmPair({ armA, armB, testCases, minDelta: 0.10 });

    assert.equal(evalResult.evaluated, true);
    assert.equal(evalResult.verified, false);
    assert.equal(evalResult.approved, false);
    assert.equal(evalResult.verdict, 'unverified');
    assert.match(evalResult.reason, /未验证/);
  });

  test('evaluateCandidateArmPair 在候选臂存在哪怕 1 个回归时严格一票否决', () => {
    const armA = { content: '基线' };
    const armB = { content: '修改后的候选' };

    const testCases = [
      {
        id: 'case-1',
        name: '用例 1（候选优化成功）',
        baselinePass: false,
        candidatePass: true,
      },
      {
        id: 'case-2-regression',
        name: '用例 2（基线通过但候选失败，发生回归）',
        baselinePass: true,
        candidatePass: false,
      },
    ];

    const evalResult = evaluateCandidateArmPair({
      armA,
      armB,
      testCases,
      runner: (task, arm) => {
        const passed = arm === armA ? task.baselinePass : task.candidatePass;
        return { passed, score: passed ? 1.0 : 0.0 };
      },
      minDelta: 0.10,
    });

    assert.equal(evalResult.evaluated, true);
    assert.equal(evalResult.approved, false);
    assert.equal(evalResult.verdict, 'rejected_has_regressions');
    assert.equal(evalResult.regressions.length, 1);
    assert.equal(evalResult.regressions[0].taskId, 'case-2-regression');
  });

  test('evaluateCandidateArmPair 在提升幅度未达预设门限时予以拒绝', () => {
    const armA = { content: '基线内容' };
    const armB = { content: '无实质提升的候选' };

    const testCases = [
      { id: 'case-1', baselinePass: true, candidatePass: true },
      { id: 'case-2', baselinePass: true, candidatePass: true },
    ];

    const evalResult = evaluateCandidateArmPair({
      armA,
      armB,
      testCases,
      runner: (task, arm) => {
        const passed = arm === armA ? task.baselinePass : task.candidatePass;
        return { passed, score: passed ? 1.0 : 0.0 };
      },
      minDelta: 0.10,
    });

    assert.equal(evalResult.evaluated, true);
    assert.equal(evalResult.approved, false);
    assert.equal(evalResult.verdict, 'rejected_insufficient_gain');
  });

  test('formatEvalTsv 能正确生成 TSV 盲评比对表', () => {
    const testCases = [{ id: 't-1' }, { id: 't-2' }];
    const resA = [{ passed: true }, { passed: false }];
    const resB = [{ passed: true }, { passed: true }];

    const tsv = formatEvalTsv(testCases, resA, resB);
    assert.ok(tsv.includes('task\texpected\ta\tb'));
    assert.ok(tsv.includes('t-1\tpass\tpass\tpass'));
    assert.ok(tsv.includes('t-2\tpass\tfail\tpass'));
  });
});

describe('Unit 4: 安全应用、一键回滚与端到端工作流', () => {
  let tmpRoot = null;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-opt-test-root-'));
  });

  afterEach(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('applySkillOptimization 与 rollbackSkillOptimization 安全闭环', () => {
    const skillDir = path.join(tmpRoot, '.agents', 'skills', 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    const targetFile = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(targetFile, '# 原始基线内容\n', 'utf8');

    // 1. 应用优化
    const applyRes = applySkillOptimization(tmpRoot, {
      skillName: 'my-skill',
      candidateContent: '# 优化后的候选内容\n',
      proposal: { verdict: 'winner_candidate' },
    });

    assert.equal(applyRes.applied, true);
    assert.equal(fs.readFileSync(targetFile, 'utf8'), '# 优化后的候选内容\n');
    assert.ok(fs.existsSync(applyRes.backupPath), '应生成 .bak 备份文件');
    assert.equal(fs.readFileSync(applyRes.backupPath, 'utf8'), '# 原始基线内容\n');

    // 审计日志应被记录
    const logFile = path.join(tmpRoot, '.agents', 'evals', 'skill-optimizer.jsonl');
    assert.ok(fs.existsSync(logFile));
    const logLines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    assert.ok(logLines.length >= 1);

    // 2. 一键回滚
    const rollRes = rollbackSkillOptimization(tmpRoot, 'my-skill');
    assert.equal(rollRes.rolledBack, true);
    assert.equal(fs.readFileSync(targetFile, 'utf8'), '# 原始基线内容\n');
    assert.equal(fs.existsSync(applyRes.backupPath), false, '回滚后备份文件应被自动清理');
  });

  test('applySkillOptimization 原子替换并轮转旧备份，保留上一版', () => {
    const skillDir = path.join(tmpRoot, '.agents', 'skills', 'rotate-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    const targetFile = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(targetFile, '# v1\n', 'utf8');

    const first = applySkillOptimization(tmpRoot, {
      skillName: 'rotate-skill',
      candidateContent: '# v2\n',
      proposal: { verdict: 'winner_candidate' },
    });
    assert.equal(first.applied, true);

    const second = applySkillOptimization(tmpRoot, {
      skillName: 'rotate-skill',
      candidateContent: '# v3\n',
      proposal: { verdict: 'winner_candidate' },
    });
    assert.equal(second.applied, true);
    assert.equal(fs.readFileSync(targetFile, 'utf8'), '# v3\n');
    assert.equal(fs.readFileSync(second.backupPath, 'utf8'), '# v2\n');
    const backups = fs.readdirSync(skillDir).filter((f) => f.startsWith('SKILL.md.bak'));
    assert.equal(backups.length, 2, '旧备份应轮转保留而不是被覆盖');
    assert.ok(backups.some((f) => fs.readFileSync(path.join(skillDir, f), 'utf8') === '# v1\n'));
    assert.equal(fs.readdirSync(skillDir).some((f) => f.includes('.tmp-')), false, '原子写入不得遗留临时文件');
  });

  test('optimizeSkillWorkflow 能够端到端完成模式提取、补丁生成、对抗评估并自动应用', () => {
    const skillDir = path.join(tmpRoot, '.agents', 'skills', 'auto-opt-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(
      skillFile,
      `---
name: auto-opt-skill
description: 自优化测试技能
---

# 原始执行指引
请按步骤修改代码。
`,
      'utf8',
    );

    const prescriptions = [
      {
        category: 'touch-set',
        failurePattern: 'Modified file outside touch-set',
        rootCause: '未遵守触点范围',
      },
    ];

    const workflowRes = optimizeSkillWorkflow({
      root: tmpRoot,
      skillName: 'auto-opt-skill',
      prescriptions,
      apply: true,
      allowUnverifiedApply: true,
      minDelta: 0.10,
    });

    assert.equal(workflowRes.success, true);
    assert.equal(workflowRes.verified, false, '未接 runner 的评估不得标记为已验证');
    assert.equal(workflowRes.evalResult.verdict, 'unverified');
    assert.equal(workflowRes.applied, true, '显式 --allow-unverified-apply 后才允许未验证落盘');
    assert.ok(workflowRes.diff.includes('+++ b/'));
    assert.ok(workflowRes.diff.includes('触点白名单'));

    // 验证文件已被安全替换，并保留原 Frontmatter
    const updatedContent = fs.readFileSync(skillFile, 'utf8');
    assert.ok(updatedContent.includes('name: auto-opt-skill'));
    assert.ok(updatedContent.includes('## 针对性防御检查单 (Self-Optimized Checklist)'));
  });

  test('optimizeSkillWorkflow 未验证且未显式放行时拒绝 --apply 落盘', () => {
    const skillDir = path.join(tmpRoot, '.agents', 'skills', 'guard-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, 'SKILL.md');
    const original = `---
name: guard-skill
description: 未验证应用闸门测试
---

# 原始执行指引
请按步骤修改代码。
`;
    fs.writeFileSync(skillFile, original, 'utf8');

    const workflowRes = optimizeSkillWorkflow({
      root: tmpRoot,
      skillName: 'guard-skill',
      prescriptions: [{ category: 'touch-set', failurePattern: 'Modified file outside touch-set' }],
      apply: true,
      minDelta: 0.10,
    });

    assert.equal(workflowRes.verified, false);
    assert.equal(workflowRes.applied, false);
    assert.match(workflowRes.applySkipped, /未验证|allow-unverified-apply/);
    assert.equal(fs.readFileSync(skillFile, 'utf8'), original, '未验证时不得改写用户的 SKILL.md');
  });

  test('parseArgs 正确解析 CLI 命令行选项', () => {
    const args = parseArgs(['optimize', '--skill', 'eval', '--apply', '--min-delta', '0.20']);
    assert.equal(args.command, 'optimize');
    assert.equal(args.skill, 'eval');
    assert.equal(args.apply, true);
    assert.equal(args.minDelta, 0.20);
  });

  test('optimizeSkillWorkflow 从 canonical 处方库 (.agents/notes/prescriptions.json) 自动加载处方', () => {
    const skillDir = path.join(tmpRoot, '.agents', 'skills', 'canonical-rx-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: canonical-rx-skill
description: canonical 处方库测试技能
---

# 原始执行指引
请按步骤修改代码。
`,
      'utf8',
    );

    // 处方写入 canonical 单源位置；此处不传 prescriptions，走自动加载分支
    const rxFile = path.join(tmpRoot, '.agents', 'notes', 'prescriptions.json');
    const saved = savePrescriptions(rxFile, [
      {
        category: 'touch-set',
        failurePattern: 'Modified file outside touch-set',
        rootCause: '未遵守触点范围',
        actionableFix: '仅允许修改声明过的文件',
      },
    ]);
    assert.equal(saved, true);
    assert.ok(fs.existsSync(rxFile), 'canonical 处方库应落盘');

    const workflowRes = optimizeSkillWorkflow({
      root: tmpRoot,
      skillName: 'canonical-rx-skill',
      apply: true,
      minDelta: 0.10,
    });

    assert.ok(workflowRes.defectPatterns.length > 0, '应从 canonical 处方库提取到缺陷模式');
    assert.ok(
      workflowRes.defectPatterns.some((p) => p.category === 'touch-set'),
      '处方类别应被识别为 touch-set',
    );
    assert.equal(workflowRes.success, true);
  });

  test('optimizeSkillWorkflow 在 canonical 缺失时只读回退旧版 .agents/prescriptions.jsonl', () => {
    const skillDir = path.join(tmpRoot, '.agents', 'skills', 'legacy-rx-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: legacy-rx-skill
description: 旧版处方库测试技能
---

# 原始执行指引
请按步骤修改代码。
`,
      'utf8',
    );

    const legacyFile = path.join(tmpRoot, '.agents', 'prescriptions.jsonl');
    fs.writeFileSync(
      legacyFile,
      `${JSON.stringify({
        category: 'touch-set',
        failurePattern: 'Modified file outside touch-set',
        rootCause: '未遵守触点范围',
        actionableFix: '仅允许修改声明过的文件',
      })}\n`,
      'utf8',
    );

    const workflowRes = optimizeSkillWorkflow({
      root: tmpRoot,
      skillName: 'legacy-rx-skill',
      apply: true,
      minDelta: 0.10,
    });

    assert.ok(
      workflowRes.defectPatterns.some((p) => p.category === 'touch-set'),
      '应从旧版 jsonl 回退读取到处方',
    );
    assert.ok(fs.existsSync(legacyFile), '旧版处方文件应保持存在');
    assert.equal(
      fs.existsSync(path.join(tmpRoot, '.agents', 'notes', 'prescriptions.json')),
      false,
      '回退路径不得写回 canonical 处方库',
    );
  });
});
