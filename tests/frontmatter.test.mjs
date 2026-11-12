import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  setField,
  getField,
  yamlScalar,
} from '../src/install/frontmatter.mjs';

test('parseFrontmatter reads top-level scalars and quoted values', () => {
  const text = [
    '---',
    'name: implementer',
    'description: "Implements: a scoped change"',
    'tools:',
    '  - Read',
    '  - Edit',
    'model: inherit',
    '---',
    '',
    '# body',
  ].join('\n');
  const fm = parseFrontmatter(text);
  assert.equal(fm.name, 'implementer');
  assert.equal(fm.description, 'Implements: a scoped change');
  assert.equal(fm.model, 'inherit');
  assert.equal(fm.tools, '');
  assert.equal(getField(text, 'name'), 'implementer');
});

test('setField replaces, inserts and removes without touching lists or body', () => {
  const text = [
    '---',
    'name: implementer',
    'tools:',
    '  - Read',
    'model: inherit',
    '---',
    '',
    'Body stays.',
  ].join('\n');

  const replaced = setField(text, 'model', 'sonnet');
  assert.match(replaced, /^model: sonnet$/m);
  assert.match(replaced, /^  - Read$/m);
  assert.match(replaced, /Body stays\./);
  assert.equal(getField(replaced, 'model'), 'sonnet');

  const inserted = setField(text, 'approvalMode', 'auto-edit');
  assert.match(inserted, /^approvalMode: auto-edit$/m);
  assert.equal(getField(inserted, 'approvalMode'), 'auto-edit');

  const removed = setField(text, 'model', null);
  assert.doesNotMatch(removed, /^model:/m);
  assert.match(removed, /^tools:$/m);
});

test('setField creates frontmatter when absent and preserves CRLF', () => {
  const plain = '# Title\n\nbody\n';
  const created = setField(plain, 'model', 'haiku');
  assert.ok(created.startsWith('---\nmodel: haiku\n---\n\n# Title'));
  assert.equal(getField(created, 'model'), 'haiku');

  const crlf = '---\r\nname: x\r\n---\r\n\r\nbody\r\n';
  const updated = setField(crlf, 'model', 'opus');
  assert.ok(updated.includes('\r\n'));
  assert.match(updated, /^model: opus\r$/m);
  assert.equal(getField(updated, 'model'), 'opus');
});

test('yamlScalar quotes values that could break YAML', () => {
  assert.equal(yamlScalar('inherit'), 'inherit');
  assert.equal(yamlScalar('provider/model#variant'), '"provider/model#variant"');
  assert.equal(yamlScalar('with space'), '"with space"');
  assert.equal(yamlScalar('a: b'), '"a: b"');
  assert.equal(yamlScalar(''), '""');
  assert.equal(yamlScalar('true'), '"true"');
});
