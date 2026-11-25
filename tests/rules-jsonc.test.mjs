// rules-jsonc.test.mjs — JSONC 解析（规则包允许 // 与 /* */ 注释、尾逗号）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonc, stripJsonc } from '../src/rules/jsonc.mjs';

test('line and block comments are stripped outside strings', () => {
  const src = `{
    // line comment
    "a": "http://example.com//not-a-comment",
    /* block
       comment */
    "b": 1
  }`;
  assert.deepEqual(parseJsonc(src), { a: 'http://example.com//not-a-comment', b: 1 });
});

test('trailing commas before } and ] are tolerated, strings are preserved', () => {
  const src = '{"a":[1,2,], "b":"x,]//",}';
  assert.deepEqual(parseJsonc(src), { a: [1, 2], b: 'x,]//' });
});

test('escaped quotes inside strings do not end the string early', () => {
  const src = '{ "a": "he said \\"// not comment\\"", "b": 2 }';
  assert.deepEqual(parseJsonc(src), { a: 'he said "// not comment"', b: 2 });
});

test('BOM is ignored and invalid JSON still fails closed', () => {
  assert.deepEqual(parseJsonc('\uFEFF{"a":1}'), { a: 1 });
  assert.throws(() => parseJsonc('{oops', 'x.json'), /JSONC 解析失败/);
  assert.equal(stripJsonc('{/*x*/"a"://c\n1}').includes('comment'), false);
});
