// rules-yaml-parity.test.mjs — CLI 侧 src/rules/yaml.mjs 与引擎侧 rules-loader.mjs 的
// parseYamlSimple / stripJsonc 必须对同一份语料给出同一结果：规则包只写一次，两侧都要读。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers/tmp.mjs';
import { parseYaml } from '../src/rules/yaml.mjs';
import { parseYamlSimple, stripJsonc } from '../templates/engine/.agents/scripts/rules-loader.mjs';
import { parseJsonc } from '../src/rules/jsonc.mjs';

const WORK = makeTmp('rules-yaml-parity-');

function parseBoth(name, text) {
  const abs = path.join(WORK, `${name}.yml`);
  fs.writeFileSync(abs, text, 'utf8');
  const body = fs.readFileSync(abs, 'utf8');
  return { abs, body, cli: parseYaml(body, abs), engine: parseYamlSimple(body) };
}

const validCorpora = {
  mapping: `version: 1
name: demo
enabled: true
count: 42
ratio: 3.5
`,
  scalarList: `files:
  - src/a.js
  - src/b.js
  - 123
  - false
`,
  listItemObjects: `rules:
  - id: rule-one
    severity: block
    message:
      zh: 第一条
      en: first
  - id: rule-two
    files:
      - src/x.js
      - src/y.js
`,
  blockScalars: `literal: |
  line one
  line two
folded: >
  folded one
  folded two
`,
  flowSequence: `tags: [alpha, "beta, gamma", 7, true, null]
`,
  flowMapping: `args: { cwd: backend, timeout: YES, retries: 3, label: "a,b" }
`,
  quotesAndComments: `# 顶层注释
name: "quoted # not comment" # 行尾注释
single: 'it''s fine'
plain: value # trailing
hash: "a#b"
`,
  booleans: `t1: true
t2: True
t3: TRUE
t4: yes
t5: Yes
t6: YES
t7: on
t8: On
f1: false
f2: False
f3: FALSE
f4: no
f5: No
f6: NO
f7: off
f8: Off
`,
  nulls: `n1: null
n2: Null
n3: NULL
n4: ~
n5:
`,
  numbers: `i1: 0
i2: 42
i3: -7
d1: 3.14
d2: -0.5
e1: 1e3
notnum: 007
`,
  emptyStructures: `emptyMap: {}
emptyList: []
`,
  nestedMixed: `outer:
  inner:
    - id: x
      when: [pkg:src, env:A=1]
    - id: y
      message:
        zh: 中文
`,
  nonIndentedSequence: `version: 1
rules:
- id: product.a
  when:
  - pkg:package.json
  - file:src/a.js
  severity: block
- id: product.b
  when:
  - env:A=1
waivers:
- id: w1
  rule: product.a
`,
  nonIndentedNestedSequence: `rules:
- id: product.a
  when:
  - pkg:package.json
  message:
    zh: 示例
- id: product.b
  files:
  - src/x.js
  - src/y.js
  severity: warn
`,
  nonIndentedScalarSequence: `files:
- src/a.js
- src/b.js
name: demo
`,
  nonIndentedSequenceDedent: `outer:
  rules:
  - id: a
    when:
    - pkg:x
root: 1
`,
  blockScalarRawLines: `literal: |
  first paragraph

  # 这是正文不是注释
  second paragraph
  nested:
    deeper: line
  end
folded: >
  folded one
  folded two

  after blank
next: value
`,
  blockScalarInListItem: `rules:
- id: a
  message:
    zh-CN: |
      第一段

      # 这是正文不是注释
      第二段
    en: plain
`,
  blockScalarListItemSibling: `rules:
  - id: a
    message: |
      第一行

      # 正文
      第二行
    name: A
  - id: b
    name: B
`,
  blockScalarListItemFirstLine: `rules:
- message: >
    a
    b
  id: x
`,
};

for (const [name, text] of Object.entries(validCorpora)) {
  test(`yaml parity: ${name}`, () => {
    const { cli, engine } = parseBoth(name, text);
    assert.deepEqual(engine, cli);
  });
}

test('yaml parity: non-indented sequences keep their parent key and siblings', () => {
  const { cli, engine } = parseBoth('nonIndentedSequence-expected', validCorpora.nonIndentedSequence);
  const expected = {
    version: 1,
    rules: [
      { id: 'product.a', when: ['pkg:package.json', 'file:src/a.js'], severity: 'block' },
      { id: 'product.b', when: ['env:A=1'] },
    ],
    waivers: [{ id: 'w1', rule: 'product.a' }],
  };
  assert.deepEqual(cli, expected);
  assert.deepEqual(engine, expected);
});

test('yaml parity: block scalars keep blank lines and # lines', () => {
  const { cli, engine } = parseBoth('blockScalarRawLines-expected', validCorpora.blockScalarRawLines);
  const expectedLiteral = 'first paragraph\n\n# 这是正文不是注释\nsecond paragraph\nnested:\n  deeper: line\nend';
  const expectedFolded = 'folded one folded two\nafter blank';
  for (const parsed of [cli, engine]) {
    assert.equal(parsed.literal, expectedLiteral);
    assert.equal(parsed.folded, expectedFolded);
    assert.equal(parsed.next, 'value');
  }
  const listItem = parseBoth('blockScalarInListItem-expected', validCorpora.blockScalarInListItem);
  for (const parsed of [listItem.cli, listItem.engine]) {
    assert.equal(parsed.rules[0].message['zh-CN'], '第一段\n\n# 这是正文不是注释\n第二段');
    assert.equal(parsed.rules[0].message.en, 'plain');
  }
});

test('yaml parity: block scalars as list item properties', () => {
  const sibling = parseBoth('blockScalarListItemSibling-expected', validCorpora.blockScalarListItemSibling);
  for (const parsed of [sibling.cli, sibling.engine]) {
    assert.equal(parsed.rules[0].message, '第一行\n\n# 正文\n第二行');
    assert.equal(parsed.rules[0].name, 'A');
    assert.equal(parsed.rules[1].id, 'b');
    assert.equal(parsed.rules[1].name, 'B');
  }
  const firstLine = parseBoth('blockScalarListItemFirstLine-expected', validCorpora.blockScalarListItemFirstLine);
  for (const parsed of [firstLine.cli, firstLine.engine]) {
    assert.equal(parsed.rules[0].message, 'a b');
    assert.equal(parsed.rules[0].id, 'x');
  }
});

const invalidCorpora = {
  duplicateTopLevelKey: `rules:
  - id: a
rules:
  - id: b
`,
  duplicateListItemKey: `rules:
  - id: a
    id: b
`,
  duplicateFlowMappingKey: `args: { a: 1, a: 2 }
`,
  missingColonInMapping: `version: 1
bogus line
`,
  missingColonInListItem: `rules:
  - id: a
    bogus line
`,
  badIndentInList: `rules:
  - id: a
    - id: b
`,
  badIndentInMapping: `outer:
  a: 1
   b: 2
`,
  badIndentInNonIndentedSequence: `rules:
- id: a
  when:
  - pkg:a
   - pkg:b
`,
};

for (const [name, text] of Object.entries(invalidCorpora)) {
  test(`yaml parity rejects: ${name}`, () => {
    const abs = path.join(WORK, `${name}.yml`);
    fs.writeFileSync(abs, text, 'utf8');
    const body = fs.readFileSync(abs, 'utf8');
    assert.throws(() => parseYaml(body, abs));
    assert.throws(() => parseYamlSimple(body));
  });
}

test('duplicate key messages name the key in both parsers', () => {
  const abs = path.join(WORK, 'dup-message.yml');
  const body = 'a: 1\na: 2\n';
  fs.writeFileSync(abs, body, 'utf8');
  assert.throws(() => parseYaml(body, abs), /重复键「a」/);
  assert.throws(() => parseYamlSimple(body), /重复键「a」/);
});

const jsoncCorpora = {
  lineComment: `{
  // 行注释
  "a": 1
}`,
  blockComment: `{ /* 块注释 */ "a": 1 }`,
  trailingCommas: `{"a": [1, 2,], "b": {"c": 3,},}`,
  markersInsideStrings: `{"url": "https://example.com/a//b", "glob": "/* not comment */"}`,
  bomAndComments: `\uFEFF{
  "a": 1, // 尾注释
  /* 块 */ "b": [true, null]
}`,
};

for (const [name, text] of Object.entries(jsoncCorpora)) {
  test(`jsonc parity: ${name}`, () => {
    assert.deepEqual(JSON.parse(stripJsonc(text)), parseJsonc(text));
  });
}
