// tests/pipeline-config.test.mjs
// 流水线配置严格加载（fail-closed）与工单上下文预算校准测试

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  loadPipelineConfig,
  loadDispatchConfig,
  loadModelRolesConfig,
  estimateContextUnits,
  pruneWorkOrderContext,
} from '../templates/engine/.agents/scripts/pipeline-config.mjs';

describe('Unit 1: 流水线配置严格加载 (Fail-Closed)', () => {
  let tmpRoot = null;
  let configDir = null;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-config-test-'));
    configDir = path.join(tmpRoot, '.agents', 'config');
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('文件不存在时安全降级返回空对象', () => {
    const pCfg = loadPipelineConfig(tmpRoot);
    const dCfg = loadDispatchConfig(tmpRoot);
    const mCfg = loadModelRolesConfig(tmpRoot);

    assert.deepEqual(pCfg, {});
    assert.deepEqual(dCfg, {});
    assert.deepEqual(mCfg, {});
  });

  test('合法 JSON 正常解析', () => {
    const pipelinePath = path.join(configDir, 'pipeline.json');
    fs.writeFileSync(pipelinePath, JSON.stringify({ version: 1, stages: ['plan', 'verify'] }), 'utf8');

    const loaded = loadPipelineConfig(tmpRoot);
    assert.equal(loaded.version, 1);
    assert.deepEqual(loaded.stages, ['plan', 'verify']);
  });

  test('语法损坏的 JSON 必须抛出 BAD_CONFIG 异常 (fail-closed)', () => {
    const pipelinePath = path.join(configDir, 'pipeline.json');
    fs.writeFileSync(pipelinePath, '{ "broken": [true, }', 'utf8');

    assert.throws(
      () => loadPipelineConfig(tmpRoot),
      (err) => err.code === 'BAD_CONFIG' && err.message.includes('JSON 解析失败')
    );
  });

  test('顶层为数组或非对象时必须抛出 BAD_CONFIG 异常 (fail-closed)', () => {
    const dispatchPath = path.join(configDir, 'dispatch.json');
    fs.writeFileSync(dispatchPath, JSON.stringify(['not', 'an', 'object']), 'utf8');

    assert.throws(
      () => loadDispatchConfig(tmpRoot),
      (err) => err.code === 'BAD_CONFIG' && err.message.includes('顶层必须为 JSON 对象')
    );
  });

  test('model-roles.json 损坏时 fail-closed 拦截', () => {
    const modelRolesPath = path.join(configDir, 'model-roles.json');
    fs.writeFileSync(modelRolesPath, 'null', 'utf8');

    assert.throws(
      () => loadModelRolesConfig(tmpRoot),
      (err) => err.code === 'BAD_CONFIG' && err.message.includes('顶层必须为 JSON 对象')
    );
  });
});

describe('Unit 2: 多语言等效上下文单位估算与智能裁剪', () => {
  test('estimateContextUnits 准确支持中英文差异权重', () => {
    assert.equal(estimateContextUnits(''), 0);
    assert.equal(estimateContextUnits(null), 0);

    // 纯英文 10 字符 -> 10 * 0.5 = 5 单位
    assert.equal(estimateContextUnits('abcdefghij'), 5);

    // 纯中文 9 字符 -> 9 * 1.5 = 13.5 -> Math.ceil = 14 单位
    assert.equal(estimateContextUnits('测试中文上下文预算'), 14);
    assert.equal(estimateContextUnits('一二三四五'), Math.ceil(5 * 1.5)); // 5 * 1.5 = 7.5 -> 8

    // 混合文本: 5 英文 (2.5) + 2 中文 (3.0) = 5.5 -> 6
    const mixed = 'Hello世界';
    assert.equal(estimateContextUnits(mixed), 6);
  });

  test('pruneWorkOrderContext 在预算充足时保留全量内容', () => {
    const workOrder = {
      orderId: 'WO-101',
      title: 'Small task',
      target: 'Fix minor bug',
      relatedDocs: ['doc1.md', 'doc2.md'],
    };

    const pruned = pruneWorkOrderContext(workOrder, 2000);
    assert.equal(pruned.budget.pruned, false);
    assert.deepEqual(pruned.relatedDocs, ['doc1.md', 'doc2.md']);
  });

  test('pruneWorkOrderContext 在超出预算时智能裁剪中间字段并保留预算统计', () => {
    const longErr = Array.from({ length: 30 }, (_, i) => `error line ${i}: detailed trace stack info`).join('\n');
    const workOrder = {
      orderId: 'WO-102',
      title: 'Huge task',
      target: 'Big migration',
      relatedDocs: ['doc1.md', 'doc2.md', 'doc3.md', 'doc4.md', 'doc5.md', 'doc6.md'],
      kbHits: [
        'a'.repeat(200),
        'b'.repeat(200),
        'c'.repeat(200),
        'd'.repeat(200),
      ],
      stderrTail: longErr,
      handoff: {
        touchSetAllowed: Array.from({ length: 20 }, (_, i) => `file_${i}.js`),
        notes: 'n'.repeat(300),
      },
    };

    // 紧凑预算 100 单位（远小于当前超千字符的内容）
    const pruned = pruneWorkOrderContext(workOrder, 100);
    assert.equal(pruned.budget.pruned, true);
    assert.ok(pruned.budget.prunedUnits < pruned.budget.originalUnits);
    assert.ok(pruned.budget.savingsPercent > 0);

    // 检查字段裁剪约束
    assert.equal(pruned.relatedDocs.length, 4);
    assert.equal(pruned.kbHits.length, 3);
    assert.ok(pruned.kbHits[0].endsWith('...'));
    assert.ok(pruned.stderrTail.includes('跳过'));
    assert.equal(pruned.handoff.touchSetAllowed.length, 10);
    assert.ok(pruned.handoff.notes.endsWith('...'));
  });
});
