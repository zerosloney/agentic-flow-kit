// self-healing-prescriptions.mjs
// 知识处方自愈飞轮核心实现。
// 负责结构化处方生命周期建模、退火淘汰、失败归因提炼、多维加权匹配与闭环反馈。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { classifyFailure } from './failure-attribution.mjs';

export const PRESCRIPTION_CATEGORIES = [
  'touch-set',
  'semantic-sandbox',
  'arch',
  'test-failure',
  'syntax',
  'template-lint',
  'artifact-missing',
  'policy-drift',
  'budget-exceeded',
  'general',
];

export function generatePrescriptionId(category, signature = '') {
  const normCat = String(category || 'general').trim().toLowerCase();
  const raw = `${normCat}:${String(signature || '').trim()}`;
  const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 8);
  return `rx-${normCat}-${hash}`;
}

export function createPrescription(opts = {}) {
  const now = new Date().toISOString();
  const rawCat = opts.category || (Array.isArray(opts.categories) && opts.categories[0]) || 'general';
  const category = PRESCRIPTION_CATEGORIES.includes(rawCat) ? rawCat : 'general';
  const signature = String(opts.failurePattern || opts.signature || opts.rootCause || '').trim();
  const id = opts.id || generatePrescriptionId(category, signature);

  const confidence = typeof opts.confidence === 'number'
    ? Math.max(0.0, Math.min(1.0, opts.confidence))
    : 0.8;

  const rawFiles = opts.targetFiles || opts.affectedFiles || [];
  const targetFiles = Array.isArray(rawFiles)
    ? [...new Set(rawFiles.map((f) => String(f || '').replace(/\\/g, '/')).filter(Boolean))]
    : [];

  const actionableFix = String(
    opts.actionableFix || (Array.isArray(opts.prescriptions) && opts.prescriptions[0]) || ''
  ).trim();

  const item = {
    id,
    category,
    failurePattern: signature,
    rootCause: String(opts.rootCause || opts.summary || '').trim(),
    actionableFix,
    targetFiles,
    affectedFiles: targetFiles,
    module: String(opts.module || 'general').trim(),
    confidence: Number(confidence.toFixed(2)),
    hitCount: Number(opts.hitCount || opts.retriesCount) || 0,
    successCount: Number(opts.successCount) || 0,
    failureCount: Number(opts.failureCount) || 0,
    createdAt: opts.createdAt || now,
    lastAppliedAt: opts.lastAppliedAt || null,
    decayHalfLifeDays: Number(opts.decayHalfLifeDays) || 14,
  };

  if (opts.runId) item.runId = opts.runId;
  if (Array.isArray(opts.prescriptions) && opts.prescriptions.length > 0) {
    item.prescriptions = opts.prescriptions;
  } else if (actionableFix) {
    item.prescriptions = [actionableFix];
  } else {
    item.prescriptions = [];
  }

  if (Array.isArray(opts.occurredGates)) item.occurredGates = opts.occurredGates;
  if (Array.isArray(opts.categories)) item.categories = opts.categories;
  if (Array.isArray(opts.problems)) item.problems = opts.problems;
  if (opts.summary) item.summary = opts.summary;

  return item;
}

export function normalizePrescription(raw, fallbackRunId = '') {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    let cat = 'general';
    if (/touch-set|未授权|白名单/i.test(s)) cat = 'touch-set';
    else if (/符号|AST|semantic/i.test(s)) cat = 'semantic-sandbox';
    else if (/架构|分层|依赖/i.test(s)) cat = 'arch';
    else if (/单测|测试|assert|FAIL/i.test(s)) cat = 'test-failure';
    else if (/语法|格式|lint/i.test(s)) cat = 'syntax';
    else if (/产物|契约|落盘/i.test(s)) cat = 'artifact-missing';
    else if (/策略|机制/i.test(s)) cat = 'policy-drift';
    else if (/体积|超限|budget/i.test(s)) cat = 'budget-exceeded';

    return createPrescription({
      id: generatePrescriptionId(cat, s),
      category: cat,
      failurePattern: s,
      rootCause: s,
      actionableFix: s,
      confidence: 0.8,
    });
  }

  if (typeof raw !== 'object') return null;

  return createPrescription(raw);
}

export function normalizePrescriptionsList(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  const seenIds = new Set();
  for (const item of list) {
    const rx = normalizePrescription(item);
    if (rx && !seenIds.has(rx.id)) {
      seenIds.add(rx.id);
      result.push(rx);
    }
  }
  return result;
}

export function calculateDecayedConfidence(rx, opts = {}) {
  if (!rx) return 0.0;
  const now = opts.now || Date.now();
  const halfLifeDays = rx.decayHalfLifeDays || opts.halfLifeDays || 14;
  const referenceTime = rx.lastAppliedAt ? new Date(rx.lastAppliedAt).getTime() : new Date(rx.createdAt).getTime();
  // 时间非法时不衰减（否则 NaN 会让 prunePrescriptions 静默丢弃记录）——返回原始可信度
  if (Number.isNaN(referenceTime)) return rx.confidence;
  const elapsedDays = Math.max(0, (now - referenceTime) / (1000 * 60 * 60 * 24));

  if (elapsedDays <= halfLifeDays) {
    return rx.confidence;
  }

  const overtime = elapsedDays - halfLifeDays;
  const factor = Math.pow(0.5, overtime / halfLifeDays);
  const decayed = rx.confidence * factor;
  return Number(Math.max(0.0, decayed).toFixed(3));
}

export function prunePrescriptions(list, opts = {}) {
  const normList = normalizePrescriptionsList(list);
  const minConfidence = typeof opts.minConfidence === 'number' ? opts.minConfidence : 0.2;
  const maxItems = typeof opts.maxItems === 'number' ? opts.maxItems : 50;
  const now = opts.now || Date.now();

  const scored = [];
  for (const rx of normList) {
    const decayed = calculateDecayedConfidence(rx, { now });
    if (decayed >= minConfidence) {
      scored.push({ rx, decayed });
    }
  }

  scored.sort((a, b) => {
    if (b.decayed !== a.decayed) return b.decayed - a.decayed;
    return (b.rx.hitCount || 0) - (a.rx.hitCount || 0);
  });

  return scored.slice(0, maxItems).map((item) => item.rx);
}

export function distillPrescriptionsFromRun(run, opts = {}) {
  if (!run) return [];

  const events = run.events || [];
  const retries = run.retries || {};
  const retrySum = Object.values(retries).reduce((a, b) => a + (Number(b) || 0), 0);
  const failEvents = events.filter((e) => e.type === 'route' || e.type === 'gate-fail' || (e.type === 'gate' && e.exit !== 0));
  const hasFailures = retrySum > 0 || failEvents.length > 0 || Boolean(run.gateFail);

  if (!hasFailures && !opts.force) {
    return [];
  }

  // 1. 收集原始错误信息并过滤假红（env / flaky）
  const allProblems = [];
  if (run.gateFail?.problems) allProblems.push(...run.gateFail.problems);
  for (const e of events) {
    if (Array.isArray(e.problems)) allProblems.push(...e.problems);
    if (typeof e.problem === 'string') allProblems.push(e.problem);
  }
  const uniqueProblems = [...new Set(allProblems)].map(String);
  const joinedText = uniqueProblems.join('\n');
  // 沙箱违例消息里也含「未授权」等触点关键词，先剥离沙箱问题行，后置分支不再对其归类。
  const SANDBOX_RE = /semantic-sandbox|符号违规|unauthorizedSymbolChanges|frozenSymbolsModified|未经声明的公共符号|语义沙箱|授权符号之外|未授权修改符号|冻结保护|公共接口冻结|导出面出现|无法识别符号|不支持该语言的符号级分析/;
  const classifyText = uniqueProblems.filter((p) => !SANDBOX_RE.test(p)).join('\n');

  // 若全部为环境缺失或偶发死锁，不污染代码知识库
  if (uniqueProblems.length > 0 && uniqueProblems.every((p) => {
    const c = classifyFailure(p);
    return c === 'env' || c === 'flaky';
  })) {
    return [];
  }

  const moduleName = run.triage?.module || 'general';
  const targetFiles = [...new Set([
    ...(run.lastFiles || []),
    ...(run.workOrder?.context?.handoff?.touchSetAllowed || []),
    ...(run.workOrder?.context?.slices?.allowedFiles || []),
  ])].map((f) => String(f || '').replace(/\\/g, '/')).filter(Boolean);

  const allCategories = new Set([
    ...(run.gateFail?.analysis?.category ? [run.gateFail.analysis.category] : []),
    ...events.map((e) => e.analysis?.category).filter(Boolean),
  ]);

  const distilled = [];

  // 2. 符号沙箱违规（放最前：沙箱消息含「未授权」等词，不能落到其他类别）
  if (SANDBOX_RE.test(joinedText) ||
      allCategories.has('semantic-sandbox')) {
    distilled.push(createPrescription({
      category: 'semantic-sandbox',
      failurePattern: '未授权或冻结符号变更',
      rootCause: '修改了未被 plan.md 授权的导出符号或破坏了冻结函数签名',
      actionableFix: '在 plan.md 中显式声明该符号为允许改动，或还原被修改的公共符号签名',
      targetFiles,
      module: moduleName,
      confidence: 0.9,
    }));
  }

  // 3. 触点超限
  if (/touch-set|未授权|超出计划|超出回填清单|scope-deviation|白名单/i.test(classifyText) ||
      allCategories.has('touch-set') || allCategories.has('scope-deviation')) {
    distilled.push(createPrescription({
      category: 'touch-set',
      failurePattern: '计划外文件修改触点阻断',
      rootCause: '改动涉及未在 plan.md 白名单中登记的文件',
      actionableFix: '变动涉及计划外文件触点，规划阶段必须预先将修改路径纳入 plan.md 白名单',
      targetFiles,
      module: moduleName,
      confidence: 0.85,
    }));
  }

  // 4. 架构防线阻断
  if (/\barch(?:itecture)?\b|check-architecture|架构|分层|反向依赖|循环依赖/i.test(classifyText) ||
      allCategories.has('arch')) {
    distilled.push(createPrescription({
      category: 'arch',
      failurePattern: '架构分层依赖违规',
      rootCause: '代码引用跨越了架构隔离边界或产生了循环依赖',
      actionableFix: '触发架构防线或层级依赖阻断，必须遵循单一依赖方向，杜绝跨层直连或反向依赖',
      targetFiles,
      module: moduleName,
      confidence: 0.85,
    }));
  }

  // 5. 单测与断言失败
  if (/test-failure|AssertionError|ERR_ASSERTION|✖|测试失败|测试用例|用例失败|\bFAIL\b|\btests? failed\b|\b\d+ (?:tests? )?failed\b|npm ERR! Test failed/i.test(classifyText) ||
      allCategories.has('test-failure')) {
    const mTest = classifyText.match(/([\w./\\-]+\.test\.(?:mjs|js|ts|cjs))/i);
    const testFile = mTest ? mTest[1].replace(/\\/g, '/') : '';
    const files = testFile ? [testFile, ...targetFiles] : targetFiles;

    distilled.push(createPrescription({
      category: 'test-failure',
      failurePattern: testFile ? `测试用例执行失败: ${path.basename(testFile)}` : '单元测试或断言未通过',
      rootCause: '业务逻辑修改破坏了既有用例契约或新增边界未被覆盖',
      actionableFix: testFile
        ? `单测或集成验证失败，在提交 review 阶段前须在本地定向运行该测试文件 ${testFile}`
        : '单测或集成验证失败，在提交 review 阶段前须在本地定向运行对应 test 命令',
      targetFiles: files,
      module: moduleName,
      confidence: 0.8,
    }));
  }

  // 6. 语法格式与模板合规
  if (/\b(?:eslint|prettier|biome|ruff|flake8|black|isort|mypy|pylint|clang-format|clang-tidy|gofmt|rustfmt|clippy|tsc|typecheck|template-lint)\b|\bsyntax ?error\b|\blint(?:er|ing)?\b|\bformatting\b|格式|语法|占位符残留/i.test(classifyText) ||
      allCategories.has('typecheck') || allCategories.has('template-lint') || allCategories.has('syntax')) {
    distilled.push(createPrescription({
      category: 'syntax',
      failurePattern: '语法、格式或模板占位符检查未通过',
      rootCause: '交付文档残留未经填充的占位符或代码存在语法与 Lint 警告',
      actionableFix: '静态语法或格式不合规，进入验证前必须先跑本地代码类型与格式检查',
      targetFiles,
      module: moduleName,
      confidence: 0.8,
    }));
  }

  // 7. 策略漂移
  if (/policy-drift|策略配置不一致|未登记机制/i.test(classifyText) ||
      allCategories.has('policy-drift')) {
    distilled.push(createPrescription({
      category: 'policy-drift',
      failurePattern: '机制与策略注册表漂移',
      rootCause: '代码中使用的机制未在 mechanism-registry 中登记或与 policy.json 冲突',
      actionableFix: '策略与机制注册表漂移，需运行 node tools/policy-check.mjs 同步配置',
      targetFiles: ['.agents/config/mechanism-registry.md', '.agents/config/policy.json'],
      module: moduleName,
      confidence: 0.85,
    }));
  }

  // 8. 常驻面超限
  if (/budget-exceeded|常驻面超限|体积超限/i.test(classifyText) ||
      allCategories.has('budget-exceeded')) {
    distilled.push(createPrescription({
      category: 'budget-exceeded',
      failurePattern: '常驻面文件体积超标',
      rootCause: '规则或指引文档超出了设定的体积预算上限',
      actionableFix: '常驻面体积超限，精简正文与注释或将非核心描述下沉至 skills/',
      targetFiles,
      module: moduleName,
      confidence: 0.8,
    }));
  }

  // 9. 产物缺失
  if (/missing-artifact|产物缺失|契约缺失/i.test(classifyText) ||
      allCategories.has('missing-artifact') || allCategories.has('artifact-missing')) {
    distilled.push(createPrescription({
      category: 'artifact-missing',
      failurePattern: '阶段契约产物缺失',
      rootCause: '阶段交接前必需产物未落盘写入',
      actionableFix: '阶段移交前产物未完全落盘，交接时须检查对应工件文件已真实存在并写入完毕',
      targetFiles,
      module: moduleName,
      confidence: 0.8,
    }));
  }

  // 10. 通用后备处方
  if (distilled.length === 0) {
    distilled.push(createPrescription({
      category: 'general',
      failurePattern: '阶段门禁重试未收敛',
      rootCause: '阶段交接校验未通过且无明确单一已知签名',
      actionableFix: '阶段门禁曾触发重试，交接前须严格按照 Checklist 对齐工件契约',
      targetFiles,
      module: moduleName,
      confidence: 0.6,
    }));
  }

  return distilled;
}

export function matchPrescriptions(list, criteria = {}) {
  const normList = normalizePrescriptionsList(list);
  const targetModule = criteria.module ? String(criteria.module).trim() : '';
  const targetFiles = Array.isArray(criteria.files)
    ? criteria.files.map((f) => String(f || '').replace(/\\/g, '/')).filter(Boolean)
    : [];
  const targetCategory = criteria.category ? String(criteria.category).trim() : '';
  const minConfidence = typeof criteria.minConfidence === 'number' ? criteria.minConfidence : 0.2;
  const limit = typeof criteria.limit === 'number' ? criteria.limit : 5;
  const now = criteria.now || Date.now();

  const fileSet = new Set(targetFiles);
  const candidates = [];

  for (const rx of normList) {
    const decayedConfidence = calculateDecayedConfidence(rx, { now });
    if (decayedConfidence < minConfidence) continue;

    let matchScore = 0.0;
    let hitReason = [];

    // 模块匹配加权
    if (targetModule && rx.module && rx.module !== 'general' && rx.module === targetModule) {
      matchScore += 0.35;
      hitReason.push('module');
    }

    // 类别匹配加权
    if (targetCategory && rx.category === targetCategory) {
      matchScore += 0.25;
      hitReason.push('category');
    }

    // 文件与路径重合度加权
    const rxFiles = rx.targetFiles || rx.affectedFiles || [];
    if (targetFiles.length > 0 && rxFiles.length > 0) {
      let matchedFileCount = 0;
      for (const rxFile of rxFiles) {
        if (fileSet.has(rxFile)) {
          matchedFileCount += 1;
          continue;
        }
        for (const tf of fileSet) {
          if (rxFile === tf || rxFile.startsWith(`${tf}/`) || tf.startsWith(`${rxFile}/`)) {
            matchedFileCount += 1;
            break;
          }
        }
      }
      if (matchedFileCount > 0) {
        const overlapRatio = matchedFileCount / Math.max(1, rxFiles.length);
        matchScore += Math.min(0.4, 0.2 + (overlapRatio * 0.2));
        hitReason.push('files');
      }
    }

    // 无特定定向条件时的通用回退
    if (!targetModule && targetFiles.length === 0 && !targetCategory) {
      matchScore += 0.1;
      hitReason.push('default');
    }

    if (matchScore > 0 || hitReason.length > 0) {
      const finalScore = Number(((decayedConfidence * 0.5) + (matchScore * 0.5)).toFixed(3));
      candidates.push({
        rx,
        finalScore,
        decayedConfidence,
        hitReason,
      });
    }
  }

  candidates.sort((a, b) => b.finalScore - a.finalScore);
  const top = candidates.slice(0, limit);

  return top.map((item) => {
    const rx = item.rx;
    const fix = rx.actionableFix || rx.failurePattern || '遵循门禁 Checklist';
    const rxPrescriptions = Array.isArray(rx.prescriptions) && rx.prescriptions.length > 0
      ? rx.prescriptions
      : [fix];
    return {
      ...rx,
      runId: rx.runId || rx.id,
      affectedFiles: rx.targetFiles || rx.affectedFiles || [],
      prescriptions: rxPrescriptions,
      matchScore: item.finalScore,
      decayedConfidence: item.decayedConfidence,
      formattedSummary: `[${rx.module}:${rx.category}] ${fix}`,
    };
  });
}

export function recordFeedback(list, feedback = {}) {
  const normList = normalizePrescriptionsList(list);
  const appliedIds = new Set(Array.isArray(feedback.appliedIds) ? feedback.appliedIds : []);
  const succeeded = Boolean(feedback.succeeded);
  const failedCategories = new Set(Array.isArray(feedback.failedCategories) ? feedback.failedCategories : []);
  const now = new Date().toISOString();

  for (const rx of normList) {
    if (appliedIds.has(rx.id)) {
      rx.hitCount = (rx.hitCount || 0) + 1;
      rx.lastAppliedAt = now;

      if (succeeded) {
        rx.successCount = (rx.successCount || 0) + 1;
        rx.confidence = Number(Math.min(1.0, rx.confidence + 0.1).toFixed(2));
      } else {
        rx.failureCount = (rx.failureCount || 0) + 1;
        if (failedCategories.has(rx.category)) {
          rx.confidence = Number(Math.max(0.1, rx.confidence - 0.2).toFixed(2));
        }
      }
    }
  }

  return normList;
}

export function loadPrescriptions(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizePrescriptionsList(raw);
  } catch (err) {
    try {
      const corruptBackup = `${filePath}.corrupt-${Date.now()}`;
      fs.renameSync(filePath, corruptBackup);
      console.warn(`[pipeline-run] 处方文件损坏，已自动备份至 ${corruptBackup}：${err.message}`);
    } catch {}
    return [];
  }
}

/**
 * 读处方库：单源是 `.agents/notes/prescriptions.json`；该文件不存在时只读回退旧版
 * `.agents/prescriptions.jsonl`（老装户遗留），回退路径不写任何文件。
 */
export function loadPrescriptionStore(root) {
  const canonical = path.join(root, '.agents', 'notes', 'prescriptions.json');
  if (fs.existsSync(canonical)) return loadPrescriptions(canonical);

  const legacy = path.join(root, '.agents', 'prescriptions.jsonl');
  if (!fs.existsSync(legacy)) return [];
  const list = [];
  try {
    for (const line of fs.readFileSync(legacy, 'utf8').split('\n').filter(Boolean)) {
      try {
        list.push(JSON.parse(line));
      } catch {
        /* 坏行跳过 */
      }
    }
  } catch {
    /* 读不到就当没有 */
  }
  return list;
}

export function savePrescriptions(filePath, list) {
  if (!filePath) return false;
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const norm = prunePrescriptions(list);
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(norm, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, filePath);
    return true;
  } catch {
    return false;
  }
}

export default {
  PRESCRIPTION_CATEGORIES,
  generatePrescriptionId,
  createPrescription,
  normalizePrescription,
  normalizePrescriptionsList,
  calculateDecayedConfidence,
  prunePrescriptions,
  distillPrescriptionsFromRun,
  matchPrescriptions,
  recordFeedback,
  loadPrescriptions,
  loadPrescriptionStore,
  savePrescriptions,
};
