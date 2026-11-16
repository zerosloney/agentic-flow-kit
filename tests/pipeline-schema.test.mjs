import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// pipeline.schema.json 结构合同：零依赖手写断言（不引 ajv），只测 schema 管的结构面；
// stage 可达性 / onFail 边闭包等源码分析归 check-pipeline-state.mjs（analyze），此处不重复。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO, 'schemas', 'pipeline.schema.json'), 'utf8'));
const CONFIG = JSON.parse(fs.readFileSync(path.join(REPO, 'templates', 'engine', '.agents', 'config', 'pipeline.json'), 'utf8'));

// 与 schemas/pipeline.schema.json 的 properties 定义逐条对应的最小结构校验器
function validatePipelineConfig(cfg) {
  const problems = [];
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) return ['顶层须为对象'];
  const KNOWN = ['$schema', 'version', 'stages', 'stopTypes', 'stageArtifacts', 'onFail'];
  const extra = Object.keys(cfg).filter((k) => !KNOWN.includes(k));
  if (extra.length) problems.push(`未知字段：${extra.join('、')}`);
  if (!Number.isInteger(cfg.version) || cfg.version < 1) problems.push('version 须为 ≥1 整数');
  if (!Array.isArray(cfg.stages) || cfg.stages.length === 0 || !cfg.stages.every((s) => typeof s === 'string')) {
    problems.push('stages 须为非空字符串数组');
  } else if (new Set(cfg.stages).size !== cfg.stages.length) {
    problems.push('stages 项须唯一');
  }
  if (!Array.isArray(cfg.stopTypes) || cfg.stopTypes.length === 0 || !cfg.stopTypes.every((s) => typeof s === 'string')) {
    problems.push('stopTypes 须为非空字符串数组');
  }
  if (cfg.stageArtifacts !== undefined) {
    if (typeof cfg.stageArtifacts !== 'object' || cfg.stageArtifacts === null || Array.isArray(cfg.stageArtifacts)) {
      problems.push('stageArtifacts 须为对象');
    } else {
      for (const [k, v] of Object.entries(cfg.stageArtifacts)) {
        if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) problems.push(`stageArtifacts['${k}'] 须为字符串数组`);
      }
    }
  }
  if (cfg.onFail !== undefined) {
    if (typeof cfg.onFail !== 'object' || cfg.onFail === null || Array.isArray(cfg.onFail)) {
      problems.push('onFail 须为对象');
    } else {
      for (const [k, edge] of Object.entries(cfg.onFail)) {
        if (typeof edge !== 'object' || edge === null || Array.isArray(edge)) { problems.push(`onFail['${k}'] 须为对象`); continue; }
        const edgeExtra = Object.keys(edge).filter((x) => x !== 'to' && x !== 'retry');
        if (edgeExtra.length) problems.push(`onFail['${k}'] 未知字段：${edgeExtra.join('、')}`);
        if (typeof edge.to !== 'string') problems.push(`onFail['${k}'].to 须为字符串`);
        if (!Number.isInteger(edge.retry) || edge.retry < 0 || edge.retry > 5) problems.push(`onFail['${k}'].retry 须为 0-5 整数`);
      }
    }
  }
  return problems;
}

test('schema 文件与既有 schemas 风格对齐且关键约束在场', () => {
  assert.equal(SCHEMA.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.ok(SCHEMA.$id.endsWith('/schemas/pipeline.schema.json'));
  assert.equal(SCHEMA.type, 'object');
  assert.equal(SCHEMA.additionalProperties, false);
  assert.ok(SCHEMA.required.includes('version'));
  // 结构规则与手写校验器同源：stages 非空唯一、stopTypes 非空、onFail.retry 0-5
  assert.equal(SCHEMA.properties.stages.minItems, 1);
  assert.equal(SCHEMA.properties.stages.uniqueItems, true);
  assert.equal(SCHEMA.properties.stopTypes.minItems, 1);
  assert.equal(SCHEMA.properties.onFail.additionalProperties.properties.retry.minimum, 0);
  assert.equal(SCHEMA.properties.onFail.additionalProperties.properties.retry.maximum, 5);
  assert.deepEqual(SCHEMA.properties.onFail.additionalProperties.required, ['to', 'retry']);
});

test('engine 模板 pipeline.json 逐条符合 schema 结构', () => {
  assert.deepEqual(validatePipelineConfig(CONFIG), []);
});

test('故意违规：retry 越界被拒', () => {
  const bad = { version: 1, stages: ['verify', 'fix', 'done'], stopTypes: ['gate-fail', 'done'], onFail: { verify: { to: 'fix', retry: 6 } } };
  const problems = validatePipelineConfig(bad);
  assert.ok(problems.some((p) => /retry 须为 0-5 整数/.test(p)), problems.join('；'));
  assert.equal(validatePipelineConfig({ ...bad, onFail: { verify: { to: 'fix', retry: -1 } } }).length, 1);
});

test('分工边界：to 指向未登记 stage 在结构层面放行（闭包归 check-pipeline-state.mjs）', () => {
  const dangling = { version: 1, stages: ['verify', 'done'], stopTypes: ['gate-fail', 'done'], onFail: { verify: { to: 'no-such-stage', retry: 2 } } };
  assert.deepEqual(validatePipelineConfig(dangling), []);
});
