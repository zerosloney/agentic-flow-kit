import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-pg-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function install(dir, stack) {
  const r = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', stack, '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
}

// 裸 --list：stdout 只含门 id（SKIP 说明走 stderr），门表三层来源在此可全量对质。
function listIds(dir) {
  const r = run(['run', 'verify.mjs', '--list'], dir);
  assert.equal(r.status, 0, r.stderr);
  return { ids: r.stdout.split(/\r?\n/).filter(Boolean), stderr: r.stderr };
}

function writeGates(dir, name, obj) {
  fs.writeFileSync(path.join(dir, '.agents', 'config', name), JSON.stringify(obj));
}

// 夹具：仓库根 *.sln + frontend/package.json 三脚本，恰好满足 dotnet profile 默认门的全部 when。
function dotnetFixture(dir) {
  fs.writeFileSync(path.join(dir, 'Sample.sln'), '');
  fs.mkdirSync(path.join(dir, 'frontend'));
  fs.writeFileSync(path.join(dir, 'frontend', 'package.json'), JSON.stringify({
    scripts: { 'lint:check': 'x', 'test:unit': 'x', 'type:check': 'x' },
  }));
}

test('dotnet 新装：项目产品门按 when 进清单，母项目专用门不回归', () => {
  const dir = tmpRepo();
  install(dir, 'dotnet');
  dotnetFixture(dir);
  const { ids } = listIds(dir);
  for (const id of ['backend-build', 'frontend-lint', 'frontend-unit-test', 'frontend-build']) {
    assert.ok(ids.includes(id), `清单缺 ${id}：${ids.join(',')}`);
  }
  assert.ok(!ids.includes('backend-test'), 'backend-test 应已出基础表');
  assert.ok(!ids.includes('code-notify-guard'), 'code-notify-guard 应已出基础表');
  // 追加位置契约：项目产品门紧跟 wiki-consistency 之后
  assert.ok(ids.indexOf('wiki-consistency') < ids.indexOf('backend-build'), ids.join(','));
});

test('dotnet 新装：when 未满足的项目产品门不进清单（stderr 打 SKIP 行）', () => {
  const dir = tmpRepo();
  install(dir, 'dotnet');
  const { ids, stderr } = listIds(dir);
  for (const id of ['backend-build', 'frontend-lint', 'frontend-unit-test', 'frontend-build']) {
    assert.ok(!ids.includes(id), `when 未满足不该出现 ${id}`);
    assert.match(stderr, new RegExp(`SKIP: ${id}（未找到 `), stderr);
  }
});

test('node 新装：清单不含任何 backend-*/frontend-* 门', () => {
  const dir = tmpRepo();
  install(dir, 'node');
  const { ids } = listIds(dir);
  for (const id of ids) {
    assert.ok(!/^(backend-|frontend-)/.test(id), `不该出现 ${id}：${ids.join(',')}`);
  }
});

test('自定义 product-gates：单文件生效，第二文件按文件名序并入', () => {
  const dir = tmpRepo();
  install(dir, 'node');
  writeGates(dir, 'product-gates.json', {
    gates: [{ id: 'my-lint', name: '示例检查', cmd: 'node -e "process.exit(0)"' }],
  });
  const first = listIds(dir);
  assert.ok(first.ids.includes('my-lint'), first.ids.join(','));
  assert.ok(first.ids.indexOf('wiki-consistency') < first.ids.indexOf('my-lint'), first.ids.join(','));

  writeGates(dir, 'product-gates.extra.json', {
    gates: [{ id: 'my-extra', name: '附加检查', cmd: 'node -e "process.exit(0)"' }],
  });
  const both = listIds(dir);
  assert.ok(both.ids.includes('my-lint') && both.ids.includes('my-extra'), both.ids.join(','));
  // 排序契约：'product-gates.extra.json' < 'product-gates.json'（文件名序 × 数组序）
  assert.ok(both.ids.indexOf('my-extra') < both.ids.indexOf('my-lint'), both.ids.join(','));
});

test('自定义 product-gates：直接数组顶层与 when 字符串形态均可', () => {
  const dir = tmpRepo();
  install(dir, 'node');
  fs.writeFileSync(path.join(dir, '.agents', 'config', 'product-gates.json'),
    JSON.stringify([{ id: 'my-array', name: '数组顶层', cmd: 'node -e "process.exit(0)"' }]));
  fs.writeFileSync(path.join(dir, 'when-marker.txt'), '');
  writeGates(dir, 'product-gates.extra.json', {
    gates: [{ id: 'my-str-when', name: '字符串 when', cmd: 'node -e "process.exit(0)"', when: 'when-marker.txt' }],
  });
  const { ids } = listIds(dir);
  assert.ok(ids.includes('my-array'), ids.join(','));
  assert.ok(ids.includes('my-str-when'), ids.join(','));
});

test('when 不满足：门不进清单，stderr 打完整 SKIP 行', () => {
  const dir = tmpRepo();
  install(dir, 'node');
  writeGates(dir, 'product-gates.json', {
    gates: [
      { id: 'my-gated', name: '守卫示例', cmd: 'node -e "process.exit(0)"', when: ['no-such-marker.txt'] },
      { id: 'my-open', name: '无条件示例', cmd: 'node -e "process.exit(0)"' },
    ],
  });
  const { ids, stderr } = listIds(dir);
  assert.ok(ids.includes('my-open'), ids.join(','));
  assert.ok(!ids.includes('my-gated'), `when 未满足不该出现 my-gated：${ids.join(',')}`);
  assert.match(stderr, /SKIP: my-gated（未找到 no-such-marker\.txt，跳过——配置好后自动启用）/, stderr);
});

test('非法配置：JSON 坏 → exit 2 并说明原因', () => {
  const dir = tmpRepo();
  install(dir, 'node');
  fs.writeFileSync(path.join(dir, '.agents', 'config', 'product-gates.json'), '{ not json');
  const r = run(['run', 'verify.mjs', '--list'], dir);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /配置失守/);
  assert.match(r.stderr, /JSON 解析失败/);
});

test('非法配置：缺 cmd → exit 2', () => {
  const dir = tmpRepo();
  install(dir, 'node');
  writeGates(dir, 'product-gates.json', { gates: [{ id: 'my-x', name: '示例' }] });
  const r = run(['run', 'verify.mjs', '--list'], dir);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /缺必填字段 cmd/, r.stderr);
});

test('非法配置：id 与内置门重复 → exit 2', () => {
  const dir = tmpRepo();
  install(dir, 'node');
  writeGates(dir, 'product-gates.json', {
    gates: [{ id: 'wiki-consistency', name: '重复示例', cmd: 'node -e "process.exit(0)"' }],
  });
  const r = run(['run', 'verify.mjs', '--list'], dir);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /与既有门重复/, r.stderr);
  assert.match(r.stderr, /wiki-consistency/, r.stderr);
});

test('非法配置：deps 指向不存在的门 → exit 2', () => {
  const dir = tmpRepo();
  install(dir, 'node');
  writeGates(dir, 'product-gates.json', {
    gates: [{ id: 'my-x', name: '示例', cmd: 'node -e "process.exit(0)"', deps: ['no-such-gate'] }],
  });
  const r = run(['run', 'verify.mjs', '--list'], dir);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /deps 指向不存在的门/, r.stderr);
  assert.match(r.stderr, /no-such-gate/, r.stderr);
});
