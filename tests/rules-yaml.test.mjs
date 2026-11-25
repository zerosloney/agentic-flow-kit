import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers/tmp.mjs';
import { loadModel } from '../src/rules/load.mjs';
import { evaluateModel } from '../src/rules/evaluate.mjs';
import { parseYaml } from '../src/rules/yaml.mjs';

function withTempDir(fn) {
  const dir = makeTmp('rules-yaml-test-');
  return fn(dir);
}

test('rules yaml - loadModel loads flow-rules.yml', () => {
  withTempDir((root) => {
    const yaml = `
version: 1
name: my-app-rules
faces:
  ui:
    - web/src
  code:
    - src
rules:
  - id: custom.no-secrets
    face: code
    phase: pre-commit
    severity: block
    assert:
      kind: content
      args:
        targets:
          - src/app.js
        contains:
          - safe
    message:
      zh: 文件必须包含 safe 标记
      en: Must contain safe mark
waivers: []
`;
    fs.writeFileSync(path.join(root, 'flow-rules.yml'), yaml, 'utf8');

    const loaded = loadModel(root);
    assert.ok(loaded.layers.some((l) => l.name === 'my-app-rules' || l.name === 'project'));
    assert.ok(loaded.model.rules.some((r) => r.id === 'custom.no-secrets'));
    assert.deepEqual(loaded.model.faces.ui, ['web/src']);
  });
});

test('rules yaml - extends preset:stack/node loads built-in preset layer', () => {
  withTempDir((root) => {
    const yaml = `
version: 1
name: extended-rules
extends:
  - preset:stack/node
rules:
  - id: custom.extra
    face: code
    phase: pre-commit
    severity: warn
    assert:
      kind: content
      args:
        targets:
          - src/index.js
        contains:
          - ok
    message:
      zh: 自定义额外检查
      en: Custom extra check
`;
    fs.writeFileSync(path.join(root, 'flow-rules.yml'), yaml, 'utf8');

    const loaded = loadModel(root);
    assert.ok(loaded.layers.some((l) => l.name === 'preset:stack/node'), '成功加载内置 stack preset 层');
    assert.ok(loaded.model.rules.some((r) => r.id === 'custom.extra'), '包含用户自定义规则');
  });
});

test('rules yaml - evaluateModel with flow-rules.yml', () => {
  withTempDir((root) => {
    const yaml = `
version: 1
name: eval-rules
rules:
  - id: test.ban-eval
    face: code
    phase: pre-commit
    severity: block
    assert:
      kind: content
      args:
        targets:
          - src/app.js
        pattern: "eval\\\\("
    message:
      zh: 禁止 eval
      en: No eval
`;
    fs.writeFileSync(path.join(root, 'flow-rules.yml'), yaml, 'utf8');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'app.js'), 'const a = eval("1+1");\n', 'utf8');

    const loaded = loadModel(root);
    const result = evaluateModel(loaded.model, {
      root,
      phases: ['pre-commit'],
      faces: ['code'],
    });

    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].ruleId, 'test.ban-eval');
    assert.equal(result.violations[0].severity, 'block');
  });
});

test('rules yaml - rejects uncoloned lines and malformed items (D6)', () => {
  // 顶层多一行无冒号文本
  assert.throws(() => {
    parseYaml('invalid text\nrules:\n  - id: r1\n', 'bad.yml');
  }, /无法解析的未识别内容或语法错误/);

  // 映射内部出现无冒号行
  assert.throws(() => {
    parseYaml('key1: val1\ninvalid_middle_line\nkey2: val2\n', 'bad.yml');
  }, /键值对格式错误，缺少冒号分隔符/);

  // 列表内部非 `-` 行
  assert.throws(() => {
    parseYaml('items:\n  - item1\n  invalid item\n  - item2\n', 'bad.yml');
  }, /列表项格式错误，必须以 '-' 开头/);
});

test('rules model - requires face, phase, and severity (S2/P1)', () => {
  withTempDir((root) => {
    // 缺少 face
    fs.writeFileSync(path.join(root, 'flow-rules.yml'), `
version: 1
name: missing-face
rules:
  - id: rule.missing-face
    phase: verify
    severity: block
    assert:
      kind: command
      args:
        run: echo 1
    message:
      zh: 测试
      en: Test
`, 'utf8');
    assert.throws(() => {
      loadModel(root);
    }, /face/);

    // 缺少 phase
    fs.writeFileSync(path.join(root, 'flow-rules.yml'), `
version: 1
name: missing-phase
rules:
  - id: rule.missing-phase
    face: any
    severity: block
    assert:
      kind: command
      args:
        run: echo 1
    message:
      zh: 测试
      en: Test
`, 'utf8');
    assert.throws(() => {
      loadModel(root);
    }, /phase/);

    // 缺少 severity
    fs.writeFileSync(path.join(root, 'flow-rules.yml'), `
version: 1
name: missing-severity
rules:
  - id: rule.missing-severity
    face: any
    phase: verify
    assert:
      kind: command
      args:
        run: echo 1
    message:
      zh: 测试
      en: Test
`, 'utf8');
    assert.throws(() => {
      loadModel(root);
    }, /severity/);
  });
});
