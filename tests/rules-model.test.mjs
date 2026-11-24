// rules-model.test.mjs — 规则模型：校验、分层合并（同 id 替换 + 只读禁用）、豁免过期、JSONC 层文件
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers/tmp.mjs';
import { loadLayer, mergeLayers, splitWaivers, validateRule } from '../src/rules/model.mjs';

const baseRule = (over = {}) => ({
  id: 'arch.no-foo',
  face: 'code',
  phase: 'pre-commit',
  severity: 'block',
  assert: { kind: 'content', args: { targets: ['src/**/*.cs'], contains: ['Foo'] } },
  message: { zh: 'no foo', en: 'no foo' },
  ...over,
});

test('rule validation rejects unknown fields, bad enums and bad args', () => {
  assert.throws(() => validateRule(baseRule({ face: 'backend' }), 'r'), /face 非法/);
  assert.throws(() => validateRule(baseRule({ extra: 1 }), 'r'), /未知字段/);
  assert.throws(() => validateRule(baseRule({ assert: { kind: 'content', args: {} } }), 'r'), /targets/);
  assert.throws(() => validateRule(baseRule({ assert: { kind: 'nope', args: {} } }), 'r'), /assert.kind 非法/);
  assert.throws(() => validateRule(baseRule({ message: { zh: 'x' } }), 'r'), /message/);
});

test('disabled entries only need id + enabled (read-only override)', () => {
  assert.doesNotThrow(() => validateRule({ id: 'arch.no-foo', enabled: false }, 'r'));
  assert.throws(() => validateRule({ id: 'arch.no-foo', enabled: false, severity: 'warn' }, 'r'), /禁用条目只允许/);
});

test('layers merge by id with later winning and provenance recorded', () => {
  const legacy = { name: 'legacy', rules: [baseRule()], waivers: [], faces: { code: ['src/'] } };
  const project = {
    name: 'project',
    rules: [baseRule({ severity: 'warn', message: { zh: 'warn', en: 'warn' } })],
    waivers: [{ rule: 'arch.no-foo', glob: 'src/legacy/**', expires: '2099-01-01' }],
    faces: { code: ['src/', 'pkg/'] },
  };
  const model = mergeLayers([legacy, project]);
  assert.equal(model.rules.length, 1);
  assert.equal(model.rules[0].severity, 'warn');
  assert.equal(model.rules[0].source, 'project');
  assert.deepEqual(model.faces.code, ['src/', 'pkg/']);
  assert.equal(model.waivers.length, 1);
});

test('waivers expire by date and are reported separately', () => {
  const { active, expired } = splitWaivers([
    { rule: 'a.b', expires: '2000-01-01' },
    { rule: 'a.b', expires: '2099-01-01' },
    { rule: 'a.b' },
  ], new Date('2026-11-24T00:00:00Z'));
  assert.equal(active.length, 2);
  assert.equal(expired.length, 1);
});

test('layer files support JSONC and validate structure', () => {
  const root = makeTmp('rules-layer-');
  const dir = path.join(root, '.agents/rules');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), `{
    // 规则覆盖
    "version": 1,
    "faces": { "code": ["src/"] },
    "rules": [{ "id": "arch.no-foo", "enabled": false }],
    "waivers": [{ "rule": "arch.no-foo", "glob": "src/**", "expires": "2099-01-01", "reason": "legacy" }],
  }`);
  const layer = loadLayer(root, '.agents/rules/project.json', 'project');
  assert.equal(layer.rules.length, 1);
  assert.equal(layer.rules[0].enabled, false);
  assert.equal(layer.waivers.length, 1);
  assert.equal(layer.faces.code[0], 'src/');

  fs.writeFileSync(path.join(dir, 'bad.json'), '{"rules":[{"id":"x.y","face":"code"}]}');
  assert.throws(() => loadLayer(root, '.agents/rules/bad.json', 'bad'), /phase 非法|severity 非法|assert|缺少必填字段「phase」/);
});
