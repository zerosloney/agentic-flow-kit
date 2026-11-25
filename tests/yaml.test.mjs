import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, stringifyYaml, parseYamlScalar, stripYamlComment } from '../src/rules/yaml.mjs';

test('yaml - stripYamlComment', () => {
  assert.equal(stripYamlComment('key: value # comment'), 'key: value');
  assert.equal(stripYamlComment('  # full comment'), '');
  assert.equal(stripYamlComment('pattern: "foo # bar" # trailing'), 'pattern: "foo # bar"');
  assert.equal(stripYamlComment("pattern: 'foo # bar' # trailing"), "pattern: 'foo # bar'");
});

test('yaml - # without preceding whitespace is not a comment (URL fragment)', () => {
  assert.equal(stripYamlComment('url: http://example.com/#frag'), 'url: http://example.com/#frag');
  assert.deepEqual(parseYaml('url: http://example.com/#frag\n'), { url: 'http://example.com/#frag' });
});

test('yaml - parseYamlScalar', () => {
  assert.equal(parseYamlScalar('123'), 123);
  assert.equal(parseYamlScalar('true'), true);
  assert.equal(parseYamlScalar('false'), false);
  assert.equal(parseYamlScalar('null'), null);
  assert.equal(parseYamlScalar('~'), null);
  assert.equal(parseYamlScalar('"hello \\n world"'), 'hello \n world');
  assert.equal(parseYamlScalar("'single ''quoted'''"), "single 'quoted'");
  assert.deepEqual(parseYamlScalar('[a, b, "c, d"]'), ['a', 'b', 'c, d']);
  assert.deepEqual(parseYamlScalar('{zh: "中文", en: "English"}'), { zh: '中文', en: 'English' });
});

test('yaml - parseYaml basic mapping and list', () => {
  const yaml = `
# 规则配置示例
version: 1
name: my-rules
faces:
  ui:
    - src/ui
    - public
  code:
    - src
rules:
  - id: arch.no-direct-fetch
    face: code
    phase: pre-commit
    severity: block
    files:
      ext:
        - js
        - ts
    assert:
      kind: content
      args:
        pattern: "fetch\\\\("
    message:
      zh: 禁止直接调用 fetch
      en: Do not call fetch directly
waivers: []
`;
  const result = parseYaml(yaml, 'test.yml');
  assert.equal(result.version, 1);
  assert.equal(result.name, 'my-rules');
  assert.deepEqual(result.faces.ui, ['src/ui', 'public']);
  assert.deepEqual(result.faces.code, ['src']);
  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0].id, 'arch.no-direct-fetch');
  assert.equal(result.rules[0].face, 'code');
  assert.equal(result.rules[0].phase, 'pre-commit');
  assert.equal(result.rules[0].severity, 'block');
  assert.deepEqual(result.rules[0].files.ext, ['js', 'ts']);
  assert.equal(result.rules[0].assert.kind, 'content');
  assert.equal(result.rules[0].assert.args.pattern, 'fetch\\(');
  assert.equal(result.rules[0].message.zh, '禁止直接调用 fetch');
  assert.deepEqual(result.waivers, []);
});

test('yaml - nested lists and objects inside list item', () => {
  const yaml = `
rules:
  - id: complex.rule
    face: code
    phase: pre-commit
    severity: block
    when:
      - pkg:package.json
      - env:CI=true
    files:
      ext:
        - js
        - ts
      exclude:
        - tests/**
    assert:
      kind: content
      args:
        targets:
          - src/index.js
        contains:
          - copyright
`;
  const res = parseYaml(yaml);
  assert.equal(res.rules.length, 1);
  const r = res.rules[0];
  assert.equal(r.id, 'complex.rule');
  assert.deepEqual(r.when, ['pkg:package.json', 'env:CI=true']);
  assert.deepEqual(r.files.ext, ['js', 'ts']);
  assert.deepEqual(r.files.exclude, ['tests/**']);
  assert.equal(r.assert.kind, 'content');
  assert.deepEqual(r.assert.args.targets, ['src/index.js']);
  assert.deepEqual(r.assert.args.contains, ['copyright']);
});

test('yaml - block scalar | and >', () => {
  const yaml = `
text_pipe: |
  line 1
  line 2
text_fold: >
  line 1
  line 2
`;
  const res = parseYaml(yaml);
  assert.equal(res.text_pipe, 'line 1\nline 2');
  assert.equal(res.text_fold, 'line 1 line 2');
});

test('yaml - stringifyYaml and roundtrip', () => {
  const obj = {
    version: 1,
    name: 'test-project',
    faces: {
      ui: ['src/views', 'src/components'],
      code: ['src/lib'],
    },
    rules: [
      {
        id: 'rule.one',
        face: 'code',
        phase: 'pre-commit',
        severity: 'block',
        assert: {
          kind: 'content',
          args: { pattern: 'eval\\(' },
        },
        message: {
          zh: '禁止 eval',
          en: 'No eval allowed',
        },
      },
      {
        id: 'rule.two',
        face: 'ui',
        phase: 'verify',
        severity: 'warn',
        assert: {
          kind: 'command',
          args: { run: 'npm run test:ui' },
        },
        message: {
          zh: 'UI 检查',
          en: 'UI check',
        },
      },
    ],
    waivers: [
      {
        rule: 'rule.one',
        glob: 'legacy/**',
        expires: '2026-12-31',
        reason: '旧代码暂未改造',
      },
    ],
  };

  const yamlStr = stringifyYaml(obj);
  assert.ok(yamlStr.includes('version: 1'));
  assert.ok(yamlStr.includes('- id: rule.one'));
  assert.ok(yamlStr.includes('    args:'));
  assert.ok(yamlStr.includes('      pattern: "eval\\\\("'));

  const parsed = parseYaml(yamlStr);
  assert.deepEqual(parsed, obj);
});

test('yaml - syntax errors throw RulesConfigError', () => {
  assert.throws(() => {
    parseYaml('  foo: bar', 'bad-indent.yml');
  }, /bad-indent\.yml/);

  assert.throws(() => {
    parseYaml('{ invalid flow mapping }');
  }, /flow mapping/);
});

