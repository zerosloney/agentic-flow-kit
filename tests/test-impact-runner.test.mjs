// test-impact runner 配置：vstest 缺省逐字节保持；generic 由项目 filter 模板驱动，
// 未给模板则安全回退全量；列名命令经 args 数组执行（不经 shell）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import {
  countListedIntegrationTests,
  selectForFiles,
  validateMap,
} from '../templates/engine/.agents/scripts/test-impact-lib.mjs';

const SCRIPTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../templates/engine/.agents/scripts',
);

const baseMap = () => ({
  namespace: 'Acme.Tests',
  dirs: { test: 'tests/Acme.IntegrationTests/', unit: 'tests/Acme.Tests/' },
  faces: { code: ['backend/'], sql: [] },
  areas: { orders: ['OrderTests'], billing: ['BillingTests'], shared: ['SharedTests'] },
  always: ['SharedTests'],
  paths: [{ glob: 'backend/orders/**', areas: ['orders'] }],
});

test('缺省 vstest：filter 表达式逐字节保持旧口径', () => {
  for (const runner of [undefined, {}]) {
    const map = baseMap();
    if (runner !== undefined) map.runner = runner;
    const d = selectForFiles(map, ['backend/orders/A.cs']);
    assert.equal(d.mode, 'filter');
    assert.equal(d.filter, 'FullyQualifiedName~Acme.Tests.OrderTests.|FullyQualifiedName~Acme.Tests.SharedTests.');
  }
});

test('generic 未配 filter：回退全量并写明原因', () => {
  const map = { ...baseMap(), runner: { kind: 'generic' } };
  const d = selectForFiles(map, ['backend/orders/A.cs']);
  assert.equal(d.mode, 'full');
  assert.equal(d.reason, 'generic runner 未配置 filter 模板，回退全量');
  assert.equal(d.filter, null);
});

test('generic 配 filter：按模板生成（{classes} = FQN | 连接）', () => {
  const map = { ...baseMap(), runner: { kind: 'generic', filter: '-run {classes}' } };
  const d = selectForFiles(map, ['backend/orders/A.cs']);
  assert.equal(d.mode, 'filter');
  assert.equal(d.filter, '-run Acme.Tests.OrderTests|Acme.Tests.SharedTests');
});

test('validateMap 校验 runner 形状（未知键/类型错误 fail-closed）', () => {
  const ok = {
    ...baseMap(),
    runner: {
      kind: 'generic',
      project: 'tests/Acme.IntegrationTests/Acme.IntegrationTests.csproj',
      list: ['go', 'test', '{project}', '-list', '.'],
      listNamePattern: '^-+ ',
      filter: '-run {classes}',
    },
  };
  assert.doesNotThrow(() => validateMap(ok));
  const bad = [
    [{ kind: 'mocha' }, /runner\.kind/],
    [{ list: 'go test' }, /runner\.list/],
    [{ filter: 1 }, /runner\.filter/],
    [{ project: '' }, /runner\.project/],
    [{ listNamePattern: '(' }, /runner\.listNamePattern/],
    [{ unknown: true }, /runner 未知键/],
  ];
  for (const [runner, re] of bad) {
    assert.throws(() => validateMap({ ...baseMap(), runner }), re);
  }
});

test('countListedIntegrationTests：runner.list 按模板执行并按 listNamePattern 计数', () => {
  const project = 'tests/Acme.IntegrationTests/Acme.IntegrationTests.csproj';
  const map = {
    ...baseMap(),
    runner: {
      kind: 'generic',
      project,
      list: [
        process.execPath,
        '-e',
        'console.log("  " + process.argv[1]); console.log("  Acme.Tests.OrderTests.Case"); console.log("  Acme.Tests.BillingTests.Case");',
        '{project}',
      ],
    },
  };
  // 默认用例行正则：两条缩进行命中；工程路径行无点号尾，不计数。
  assert.equal(countListedIntegrationTests('ignored', { map, cwd: process.cwd() }), 2);
  // 自定义正则只认工程行 → 证明 {project} 已替换。
  map.runner.listNamePattern = 'Acme\\.IntegrationTests\\.csproj';
  assert.equal(countListedIntegrationTests('ignored', { map, cwd: process.cwd() }), 1);
});

test('check-test-impact-map.mjs：generic runner 明确 SKIP（exit 0）', () => {
  const root = makeTmp('flow-kit-tim-generic-');
  fs.mkdirSync(path.join(root, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'config', 'test-impact-map.json'), JSON.stringify({
    namespace: 'Acme.Tests',
    dirs: { test: 'tests/Acme.IntegrationTests/', unit: '', fullchain: '' },
    faces: { code: ['backend/'], sql: [] },
    areas: { orders: ['OrderTests'] },
    always: [],
    paths: [{ glob: 'backend/**', areas: ['orders'] }],
    runner: { kind: 'generic' },
  }));
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'check-test-impact-map.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /generic runner：无内建测试类解析，跳过类清单比对（映射完整性由项目自检）/);
});
