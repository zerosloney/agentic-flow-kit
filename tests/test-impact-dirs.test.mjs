// test-impact-dirs.test.mjs — 影响面选测的目录/面口径单源：
// dirs（test/unit/fullchain）与 faces（code/sql）来自 .agents/config/test-impact-map.json；
// 未声明 = 无法裁定 → fail-safe 回退全量，绝不静默跳过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapDirs,
  mapFaces,
  selectForFiles,
  validateMap,
} from '../templates/engine/.agents/scripts/test-impact-lib.mjs';

const baseMap = () => ({
  version: 1,
  namespace: 'Acme.Tests',
  areas: { orders: ['OrderTests'], shared: ['SharedTests'], billing: ['BillingTests'] },
  always: ['SharedTests'],
  paths: [{ glob: 'backend/orders/**', areas: ['orders'] }],
});

test('dirs/faces 未声明：未知路径保守回退全量（不静默跳过）', () => {
  const d = selectForFiles(baseMap(), ['backend/orders/A.cs']);
  assert.equal(d.mode, 'full');
  assert.ok(d.warnings.some((w) => w.includes('faces.code')), JSON.stringify(d.warnings));
});

test('声明 dirs/faces：代码面按规则选域，面外与单测面不触发', () => {
  const map = {
    ...baseMap(),
    dirs: { test: 'tests/Acme.IntegrationTests/', unit: 'tests/Acme.Tests/' },
    faces: { code: ['backend/'], sql: ['db/schema/'] },
  };
  const hit = selectForFiles(map, ['backend/orders/A.cs']);
  assert.equal(hit.mode, 'filter');
  assert.deepEqual(hit.areas, ['orders']);
  assert.match(hit.filter, /Acme\.Tests\.OrderTests\./);
  assert.equal(selectForFiles(map, ['frontend/pages/a.vue']).mode, 'none');
  assert.equal(selectForFiles(map, ['tests/Acme.Tests/Unit.cs']).mode, 'none');
  assert.equal(selectForFiles(map, ['docs/design.md']).mode, 'none');
});

test('schema SQL：声明面内回退全量；未声明 faces.sql 亦回退全量', () => {
  const map = {
    ...baseMap(),
    dirs: { test: 'tests/Acme.IntegrationTests/' },
    faces: { code: ['backend/'], sql: ['db/schema/'] },
  };
  assert.equal(selectForFiles(map, ['db/schema/001.sql']).mode, 'full');
  assert.equal(selectForFiles(map, ['db/backup/001.sql']).mode, 'none');
  const noSqlFace = { ...map, faces: { code: ['backend/'] } };
  assert.equal(selectForFiles(noSqlFace, ['db/backup/001.sql']).mode, 'full');
});

test('validateMap 校验 dirs/faces 形状；mapDirs/mapFaces 归一化小写与尾斜杠', () => {
  assert.throws(() => validateMap({ ...baseMap(), dirs: [] }), /dirs/);
  assert.throws(() => validateMap({ ...baseMap(), faces: { code: [''] } }), /faces\.code/);
  assert.equal(mapDirs({ dirs: { test: 'Tests/Acme.IntegrationTests', unit: 'tests/Acme.Tests/' } }).test, 'tests/acme.integrationtests/');
  assert.deepEqual(mapFaces({ faces: { sql: ['DB/Schema'] } }).sql, ['db/schema/']);
});
