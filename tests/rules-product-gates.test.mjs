// rules-product-gates.test.mjs — 项目产品门投影：与 verify 同口径枚举 product-gates*.json 全族 + 严格校验。
// 回归：适配器曾只读 product-gates.json——放在 product-gates.<名称>.json 里的门在规则引擎里不存在，
// verify 调 `rules check --prefix product.<id>` 得到「0 条规则、exit 0」= 假绿；配置失守也曾被静默跳过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const GATES = '.agents/config/product-gates.json';
const RED = 'node -e "process.exit(7)"';

function fixture() {
  const dir = makeTmp('rules-product-gates-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(text, null, 2)}\n`);
}

function rules(root, args = []) {
  return spawnSync(process.execPath, [BIN, 'rules', 'check', '--target', root, ...args], { encoding: 'utf8' });
}

test('gates in product-gates.<name>.json are evaluated (no false green)', () => {
  const dir = fixture();
  // 主文件里是一道会通过的门，分文件里是一道会红的门：两道都必须进规则模型。
  write(dir, GATES, { gates: [{ id: 'ok', name: 'OK gate', cmd: 'node -e "process.exit(0)"' }] });
  write(dir, '.agents/config/product-gates.extra.json', [{ id: 'red', name: 'Red gate', cmd: RED }]);
  const red = rules(dir, ['--with-commands', '--prefix', 'product.red', '--json']);
  assert.equal(red.status, 1, red.stderr + red.stdout);
  assert.deepEqual(JSON.parse(red.stdout).violations.map((v) => v.ruleId), ['product.red']);
  const ok = rules(dir, ['--with-commands', '--prefix', 'product.ok', '--json']);
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.deepEqual(JSON.parse(ok.stdout).passed.map((p) => p.ruleId), ['product.ok']);
});

test('broken product gate config fails closed with exit 2', () => {
  const cases = [
    [{ foo: 1 }, '顶层未知字段「foo」'],
    [[{ id: 'a', cmd: 'node -v' }], 'gates[0]: 缺必填字段「name」'],
    [[{ id: 'a', name: 'x', cmd: 'node -v', when: 5 }], 'when 必须是非空字符串数组'],
    [[{ id: 'a', name: 'x', cmd: 'node -v', deps: 'b' }], '「deps」须为 id 数组'],
  ];
  for (const [config, fragment] of cases) {
    const dir = fixture();
    write(dir, GATES, config);
    const r = rules(dir, ['--staged']);
    assert.equal(r.status, 2, `${JSON.stringify(config)}\n${r.stderr}`);
    assert.ok(r.stderr.includes(fragment), r.stderr);
  }
});

test('gate ids that normalise to the same rule id collide (also across files)', () => {
  const dir = fixture();
  write(dir, GATES, [{ id: 'Build', name: 'Main', cmd: 'node -v' }]);
  write(dir, '.agents/config/product-gates.ci.json', [{ id: 'build', name: 'CI', cmd: 'node -v' }]);
  const r = rules(dir, ['--with-commands', '--prefix', 'product.build', '--json']);
  // 不报错的话后一条会静默顶掉前一条：verify 对两个门跑的是同一条规则。
  assert.equal(r.status, 2, r.stderr + r.stdout);
  assert.ok(r.stderr.includes('撞车'), r.stderr);
});

test('when as a plain string is honoured; blank folder means the repo root', () => {
  const dir = fixture();
  write(dir, GATES, [{ id: 'g', name: 'G', cmd: RED, folder: '  ', when: 'frontend/package.json' }]);
  const args = ['--with-commands', '--prefix', 'product.g', '--json'];
  const skipped = rules(dir, args);
  assert.equal(skipped.status, 0, skipped.stderr + skipped.stdout);
  assert.deepEqual(JSON.parse(skipped.stdout).skipped.map((s) => s.reason), ['when']);
  write(dir, 'frontend/package.json', {});
  const ran = rules(dir, args);
  assert.equal(ran.status, 1, ran.stderr + ran.stdout);
  assert.deepEqual(JSON.parse(ran.stdout).violations.map((v) => v.ruleId), ['product.g']);
});

test('pkg: path with empty segments follows the legacy scripts (empty segments are ignored)', () => {
  // 旧 verify 对 pkg:scripts..lint 判「启用」；引擎若判「不满足」就会跳过执行 = 假绿。
  const dir = fixture();
  write(dir, 'frontend/package.json', { scripts: { lint: 'x' } });
  write(dir, GATES, [{ id: 'g', name: 'G', cmd: RED, folder: 'frontend', when: ['pkg:scripts..lint'] }]);
  const r = rules(dir, ['--with-commands', '--prefix', 'product.g', '--json']);
  assert.equal(r.status, 1, r.stderr + r.stdout);
});
