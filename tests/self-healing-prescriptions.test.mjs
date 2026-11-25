// tests/self-healing-prescriptions.test.mjs
// 知识处方自愈飞轮单元测试套件。
// 验证结构化契约、退火淘汰、归因过滤提炼、多维加权匹配与闭环反馈。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers/tmp.mjs';
import {
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
  savePrescriptions,
} from '../templates/engine/.agents/scripts/self-healing-prescriptions.mjs';
import {
  assembleWorkOrderContext,
  generatePostMortem,
} from '../templates/engine/.agents/scripts/pipeline-run.mjs';

function createTempDir() {
  return makeTmp('flow-kit-rx-test-');
}

test('generatePrescriptionId creates deterministic id based on category and signature', () => {
  const id1 = generatePrescriptionId('touch-set', 'unauthorized file src/core.mjs');
  const id2 = generatePrescriptionId('touch-set', 'unauthorized file src/core.mjs');
  const id3 = generatePrescriptionId('touch-set', 'unauthorized file src/other.mjs');

  assert.equal(id1, id2);
  assert.notEqual(id1, id3);
  assert.ok(id1.startsWith('rx-touch-set-'));
});

test('createPrescription builds structured entity with normalized paths and defaults', () => {
  const rx = createPrescription({
    category: 'semantic-sandbox',
    failurePattern: 'freezeExports violation',
    rootCause: '公共导出符号被非法修改',
    actionableFix: '还原公共导出签名',
    targetFiles: ['src\\api\\client.mjs', 'src/api/client.mjs'],
    module: 'api',
  });

  assert.equal(rx.category, 'semantic-sandbox');
  assert.equal(rx.confidence, 0.8);
  assert.equal(rx.decayHalfLifeDays, 14);
  assert.equal(rx.hitCount, 0);
  assert.equal(rx.successCount, 0);
  assert.deepEqual(rx.targetFiles, ['src/api/client.mjs']);
  assert.deepEqual(rx.prescriptions, ['还原公共导出签名']);
  assert.ok(rx.id.startsWith('rx-semantic-sandbox-'));
});

test('normalizePrescription transparently adapts legacy string and postMortem objects', () => {
  const legacyStr = '变动涉及计划外文件触点，规划阶段必须预先将修改路径纳入 plan.md 白名单';
  const adaptedStr = normalizePrescription(legacyStr);
  assert.equal(adaptedStr.category, 'touch-set');
  assert.equal(adaptedStr.confidence, 0.8);
  assert.equal(adaptedStr.actionableFix, legacyStr);

  const legacyObj = {
    id: 'rx-20261125-auth',
    runId: '20261125-auth',
    categories: ['arch'],
    affectedFiles: ['src/auth/token.mjs'],
    problems: ['跨层直连数据层违规'],
    prescriptions: ['触发架构防线阻断，杜绝跨层直接调用'],
    retriesCount: 2,
    module: 'auth',
  };
  const adaptedObj = normalizePrescription(legacyObj);
  assert.equal(adaptedObj.id, 'rx-20261125-auth');
  assert.equal(adaptedObj.category, 'arch');
  assert.equal(adaptedObj.module, 'auth');
  assert.deepEqual(adaptedObj.targetFiles, ['src/auth/token.mjs']);
  assert.equal(adaptedObj.actionableFix, '触发架构防线阻断，杜绝跨层直接调用');
  assert.equal(adaptedObj.hitCount, 2);
});

test('calculateDecayedConfidence and prunePrescriptions anneal stale or low-confidence knowledge', () => {
  const baseTime = Date.now();
  const rxActive = createPrescription({
    category: 'touch-set',
    actionableFix: '及时登记触点',
    confidence: 0.9,
    createdAt: new Date(baseTime).toISOString(),
  });
  const rxOld = createPrescription({
    category: 'syntax',
    actionableFix: '清理未用变量',
    confidence: 0.3,
    createdAt: new Date(baseTime - 30 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const activeConf = calculateDecayedConfidence(rxActive, { now: baseTime });
  assert.equal(activeConf, 0.9);

  const oldConf = calculateDecayedConfidence(rxOld, { now: baseTime });
  assert.ok(oldConf < 0.2);

  const pruned = prunePrescriptions([rxActive, rxOld], { now: baseTime, minConfidence: 0.2 });
  assert.equal(pruned.length, 1);
  assert.equal(pruned[0].id, rxActive.id);
});

test('prunePrescriptions 不因非法日期丢弃处方（非法参考时间不衰减）', () => {
  // 两条须有不同 failurePattern：无签名时同类别处方 id 相同，会先被 normalize 去重
  const okDate = createPrescription({ category: 'arch', failurePattern: '正常日期样例' });
  const badDate = createPrescription({ category: 'arch', failurePattern: '非法日期样例', createdAt: 'not-a-date' });

  assert.equal(calculateDecayedConfidence(badDate), badDate.confidence);
  const pruned = prunePrescriptions([okDate, badDate]);
  assert.equal(pruned.length, 2);
  assert.ok(pruned.some((r) => r.id === badDate.id), '非法日期的处方不得被静默丢弃');
});

test('distillPrescriptionsFromRun filters env and flaky failures without polluting knowledge', () => {
  const envFailureRun = {
    runId: 'run-env-fail',
    triage: { module: 'core' },
    retries: { verify: 1 },
    gateFail: {
      stage: 'verify',
      problems: ['Cannot find module node_modules/lodash', 'gitleaks: 未安装'],
    },
    events: [],
  };

  const distilledEnv = distillPrescriptionsFromRun(envFailureRun);
  assert.equal(distilledEnv.length, 0);

  const flakyFailureRun = {
    runId: 'run-flaky-fail',
    triage: { module: 'db' },
    retries: { verify: 1 },
    gateFail: {
      stage: 'verify',
      problems: ['deadlock detected: Msg 1205 resource temporarily unavailable'],
    },
    events: [],
  };

  const distilledFlaky = distillPrescriptionsFromRun(flakyFailureRun);
  assert.equal(distilledFlaky.length, 0);
});

test('distillPrescriptionsFromRun extracts semantic-sandbox and test-failure signals', () => {
  const realFailRun = {
    runId: 'run-real-fail',
    triage: { module: 'billing' },
    retries: { verify: 1 },
    gateFail: {
      stage: 'verify',
      problems: [
        'semantic-sandbox: unauthorizedSymbolChanges in src/billing/tax.mjs',
        'FAIL tests/billing-calc.test.mjs: AssertionError expected 100 but got 80',
      ],
    },
    lastFiles: ['src/billing/tax.mjs'],
    events: [],
  };

  const distilled = distillPrescriptionsFromRun(realFailRun);
  assert.equal(distilled.length, 2);

  const sandboxRx = distilled.find((d) => d.category === 'semantic-sandbox');
  assert.ok(sandboxRx);
  assert.ok(sandboxRx.actionableFix.includes('plan.md'));
  assert.ok(sandboxRx.targetFiles.includes('src/billing/tax.mjs'));

  const testRx = distilled.find((d) => d.category === 'test-failure');
  assert.ok(testRx);
  assert.ok(testRx.actionableFix.includes('billing-calc.test.mjs'));
});

function distillOne(problem) {
  return distillPrescriptionsFromRun({
    runId: 'run-attribution', triage: { module: 'core' }, retries: {},
    gateFail: { stage: 'verify', problems: [problem] }, events: [],
  });
}

test('distillPrescriptionsFromRun 收紧归因：子串不再误命中 arch / syntax / test-failure', () => {
  // 「search」里的 arch 不算架构违规 → general 兜底
  assert.deepEqual(distillOne('kb-search.mjs 退出 1：ENOENT').map((d) => d.category), ['general']);
  // 「dateFormat」不是格式检查 → general 兜底
  assert.deepEqual(distillOne('TypeError: Invalid time value at dateFormat()').map((d) => d.category), ['general']);
  // 「gate failure」不是测试失败；lint 只产 syntax 一条
  assert.deepEqual(distillOne('verify gate failure: lint 退出 1').map((d) => d.category), ['syntax']);
});

test('distillPrescriptionsFromRun 四种语义沙箱违例各只产一条 semantic-sandbox', () => {
  const messages = [
    '语义沙箱阻断: 未授权修改符号 src/billing/tax.mjs#calculateFee',
    '语义沙箱阻断: src/billing/tax.mjs#parseTaxTable 违反冻结保护',
    '语义沙箱阻断: 违反公共接口冻结契约 src/api/client.mjs#request',
    '语义沙箱阻断: 未授权新增公共导出 src/billing/tax.mjs#newExport',
  ];
  for (const msg of messages) {
    const distilled = distillOne(msg);
    assert.equal(distilled.length, 1, `${msg} 应只产一条处方`);
    assert.equal(distilled[0].category, 'semantic-sandbox');
  }
});

test('distillPrescriptionsFromRun 的修复指引不绑定具体测试运行器', () => {
  const distilled = distillOne('FAIL tests/billing-calc.test.mjs: AssertionError expected 1 but got 2');
  assert.equal(distilled.length, 1);
  assert.equal(distilled[0].category, 'test-failure');
  assert.ok(distilled[0].actionableFix.includes('该测试文件 tests/billing-calc.test.mjs'));
  assert.doesNotMatch(distilled[0].actionableFix, /node --test/);
});

test('matchPrescriptions performs multi-dimensional scoring and ranks relevant prescriptions', () => {
  const rx1 = createPrescription({
    category: 'touch-set',
    module: 'auth',
    targetFiles: ['src/auth/token.mjs', 'src/auth/session.mjs'],
    actionableFix: '白名单登记触点',
    confidence: 0.9,
  });
  const rx2 = createPrescription({
    category: 'arch',
    module: 'billing',
    targetFiles: ['src/billing/invoice.mjs'],
    actionableFix: '禁止跨层依赖',
    confidence: 0.8,
  });
  const rx3 = createPrescription({
    category: 'syntax',
    module: 'general',
    targetFiles: ['src/common/util.mjs'],
    actionableFix: '修复语法警告',
    confidence: 0.7,
  });

  const matched = matchPrescriptions([rx1, rx2, rx3], {
    module: 'auth',
    files: ['src/auth/token.mjs'],
  });

  assert.ok(matched.length >= 1);
  assert.equal(matched[0].id, rx1.id);
  assert.ok(matched[0].matchScore > 0.6);
  assert.ok(matched[0].formattedSummary.includes('[auth:touch-set]'));
});

test('recordFeedback reinforces success and penalizes repeated failures', () => {
  const rx = createPrescription({
    id: 'rx-test-feedback',
    category: 'touch-set',
    actionableFix: '白名单登记触点',
    confidence: 0.8,
  });

  // 1. 成功反馈
  const afterSuccess = recordFeedback([rx], {
    appliedIds: [rx.id],
    succeeded: true,
  });
  assert.equal(afterSuccess[0].successCount, 1);
  assert.equal(afterSuccess[0].hitCount, 1);
  assert.equal(afterSuccess[0].confidence, 0.9);
  assert.ok(afterSuccess[0].lastAppliedAt);

  // 2. 同类失败惩罚
  const afterFail = recordFeedback(afterSuccess, {
    appliedIds: [rx.id],
    succeeded: false,
    failedCategories: ['touch-set'],
  });
  assert.equal(afterFail[0].failureCount, 1);
  assert.equal(afterFail[0].confidence, 0.7);
});

test('loadPrescriptions and savePrescriptions handle file persistence and corrupt recovery', () => {
  const tmpDir = createTempDir();
  const filePath = path.join(tmpDir, 'prescriptions.json');

  const rx = createPrescription({
    category: 'touch-set',
    actionableFix: '登记白名单',
    confidence: 0.85,
  });

  const ok = savePrescriptions(filePath, [rx]);
  assert.equal(ok, true);

  const loaded = loadPrescriptions(filePath);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, rx.id);

  // 损坏测试
  fs.writeFileSync(filePath, '{ invalid json', 'utf8');
  const rescued = loadPrescriptions(filePath);
  assert.deepEqual(rescued, []);

  const files = fs.readdirSync(tmpDir);
  assert.ok(files.some((f) => f.startsWith('prescriptions.json.corrupt-')));
});

test('pipeline-run end-to-end backflow and feedback loop integration', () => {
  const tmpDir = createTempDir();
  const rxFile = path.join(tmpDir, 'prescriptions.json');
  const ctx = {
    root: tmpDir,
    prescriptionsFile: rxFile,
  };

  const rx = createPrescription({
    id: 'rx-billing-test',
    category: 'test-failure',
    module: 'billing',
    targetFiles: ['src/billing/calc.mjs'],
    actionableFix: '补充阶梯计费防溢出校验用例',
    confidence: 0.8,
  });
  savePrescriptions(rxFile, [rx]);

  const run = {
    runId: 'run-e2e-rx',
    triage: { module: 'billing', level: 'L1' },
    docs: {},
    lastFiles: ['src/billing/calc.mjs'],
    events: [],
  };

  const assembled = assembleWorkOrderContext(ctx, run, {
    kind: 'implement',
    role: 'code',
    context: { files: ['src/billing/calc.mjs'] },
  });

  assert.ok(Array.isArray(assembled.slices.prescriptions));
  assert.ok(assembled.slices.prescriptions.some((p) => p.includes('阶梯计费防溢出')));
  assert.deepEqual(assembled.slices.appliedRxIds, ['rx-billing-test']);

  // 验证 postMortem 结构化处方挂载
  const failedRun = {
    runId: 'run-postmortem-test',
    triage: { module: 'billing' },
    retries: { verify: 1 },
    gateFail: {
      stage: 'verify',
      problems: ['触点未授权: src/billing/extra.mjs 不在 plan.md 白名单内'],
      analysis: { category: 'touch-set' },
    },
    lastFiles: ['src/billing/extra.mjs'],
    events: [],
  };

  const pm = generatePostMortem(ctx, failedRun, { persist: true });
  assert.ok(pm);
  assert.ok(Array.isArray(pm.structuredPrescriptions));
  assert.ok(pm.prescriptions.some((p) => p.includes('plan.md 白名单')));

  const stored = loadPrescriptions(rxFile);
  const touchRx = stored.find((s) => s.category === 'touch-set');
  assert.ok(touchRx);
  assert.equal(touchRx.confidence, 0.85);
  assert.equal(touchRx.runId, 'run-postmortem-test');
});
