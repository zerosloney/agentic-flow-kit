import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(KIT, rel), 'utf8');
}

// BACKLOG #28：跨模型复核在新装项目不可达——delegations 台账记录实现者模型族（@ 模型族后缀），
// independent-reviewer 按三阶判定取代恒写「跨模型不可得」。zh 与 en 覆盖同批对齐。
test('independent-reviewer (zh + en) carries the three-tier cross-model ladder', () => {
  const zh = read('templates/engine/.agents/roles/independent-reviewer.md');
  for (const phrase of ['实现者模型族', '跨模型已满足', '仅同族可指派', '无实现者模型族记录']) {
    assert.ok(zh.includes(phrase), `zh independent-reviewer 缺三阶判定关键短语「${phrase}」`);
  }

  const en = read('locales/en/overrides/.agents/roles/independent-reviewer.md');
  for (const phrase of ['Implementer model family', 'cross-model satisfied', 'same-family only', 'no implementer model-family record']) {
    assert.ok(en.includes(phrase), `en independent-reviewer override misses three-tier key phrase "${phrase}"`);
  }
});

test('workflow README (zh + en) records the @model-family delegation convention', () => {
  const zh = read('templates/scaffold/workflow/README.md');
  assert.ok(zh.includes('<子智能体/角色>@<模型族>'), 'zh workflow README 缺被委派方 @ 记录约定');
  assert.ok(zh.includes('存量行不回补'), 'zh workflow README 缺存量行不回补口径');

  const en = read('locales/en/overrides/workflow/README.md');
  assert.ok(en.includes('<subagent/role>@<model family>'), 'en workflow README misses the @ model-family notation');
  assert.ok(en.includes('existing rows are not backfilled'), 'en workflow README misses the no-backfill rule');
});
