// rules-parity-static.test.mjs — 跨运行上下文的静态对拍：kit 侧（src/rules，安装器进程）与引擎模板侧
// （templates/engine，装进项目后独立运行）无法互相 import，同一份常量 / 归一函数各有一份实现，只能靠对拍防漂移。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARG_KEYS, ARG_ITEM_KEYS } from '../src/rules/model.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(KIT, rel), 'utf8').replace(/\r\n/g, '\n');

test('notify guard defaults are identical in the adapter and in the legacy gate script', () => {
  const body = (rel, name) => {
    const m = new RegExp(`const ${name} = \\{\\n([\\s\\S]*?)\\n\\};`).exec(read(rel));
    assert.ok(m, `${rel}: ${name} not found`);
    return m[1];
  };
  assert.equal(
    body('src/rules/adapters.mjs', 'NOTIFY_DEFAULTS'),
    body('templates/engine/.agents/hooks/check-notify-guard.mjs', 'DEFAULTS'),
  );
});

test('product gate id slug is the same in the adapter and in verify (rule id = product.<slug>)', () => {
  const rhs = (rel, name) => {
    const m = new RegExp(`const ${name} = \\(s\\) => (.*);`).exec(read(rel));
    assert.ok(m, `${rel}: ${name} not found`);
    return m[1];
  };
  assert.equal(
    rhs('src/rules/adapters.mjs', 'slug'),
    rhs('templates/engine/.agents/scripts/verify.mjs', 'ruleSlug'),
  );
});

test('primitive reference in the shipped docs lists every arg key of the schema (zh and en)', () => {
  // 文档是作者写规则的唯一依据：schema 加了键而「原语参考」没跟上，用户就只能靠报错试出来。
  const docs = [
    ['templates/engine/.agents/notes/project-configs.md', '原语参考'],
    ['locales/en/overrides/.agents/notes/project-configs.md', 'Primitive reference'],
  ];
  for (const [rel, heading] of docs) {
    const lines = read(rel).split('\n');
    const start = lines.findIndex((line) => line.includes(heading));
    assert.ok(start >= 0, `${rel}: section "${heading}" not found`);
    const bullets = [];
    for (const line of lines.slice(start + 1)) {
      if (!line.startsWith('  - ')) break;
      bullets.push(line);
    }
    const documented = (kind, key) => bullets.some((line) => line.includes(`\`${kind}\``) && new RegExp(`\\b${key}\\b`).test(line));
    for (const [kind, keys] of Object.entries(ARG_KEYS)) {
      for (const key of keys) assert.ok(documented(kind, key), `${rel}: "${kind}" key "${key}" is not documented`);
    }
    for (const [field, keys] of Object.entries(ARG_ITEM_KEYS)) {
      for (const key of keys) assert.ok(documented(field.split('.')[0], key), `${rel}: "${field}" key "${key}" is not documented`);
    }
  }
});
