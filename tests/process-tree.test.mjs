// process-tree 的纯函数单测：进程表解析与后代收集。
// 为什么单测：杀树的实际路径跨平台不同（Windows 走 taskkill /T，POSIX 走进程组 + 逐个杀），
// 「从快照里找出全部后代」这段共用逻辑在任何平台都能验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProcessTable, collectDescendants } from '../src/rules/process-tree.mjs';

test('parseProcessTable 把 ps 输出拆成 父 pid → 子 pid', () => {
  const table = parseProcessTable([
    '  100    1',
    '  200  100',
    '  300  200',
    'garbage line',
  ].join('\n'));
  assert.deepEqual(table.get(1), [100]);
  assert.deepEqual(table.get(100), [200]);
  assert.deepEqual(table.get(200), [300]);
  assert.equal(table.get(300), undefined);
});

test('collectDescendants 收全部子孙，且父先于子', () => {
  const table = parseProcessTable([
    '  100    1',
    '  200  100',
    '  300  200',
    '  400  300',
    '  500  100',
    '  600    1',
  ].join('\n'));
  const descendants = collectDescendants(table, 100);
  assert.deepEqual([...descendants].sort((a, b) => a - b), [200, 300, 400, 500]);
  assert.ok(descendants.indexOf(200) < descendants.indexOf(300), '父必须先于子');
  assert.ok(descendants.indexOf(300) < descendants.indexOf(400), '父必须先于子');
  assert.ok(!descendants.includes(600), '别人的后代不归我');
});

test('collectDescendants 不被环带偏，也不重复计数', () => {
  const table = parseProcessTable([
    '  100    1',
    '  200  100',
    '  100  200',
  ].join('\n'));
  const descendants = collectDescendants(table, 100);
  assert.deepEqual(descendants, [200]);
});

test('空快照不炸', () => {
  assert.deepEqual(collectDescendants(parseProcessTable(''), 100), []);
});
