// rules-schema.test.mjs — schema「写错必报错」回归闸：未知字段 / 类型不符 / 必填缺失 / 正则非法
// 一律是配置错误（RULES_CONFIG），绝不静默忽略；覆盖各原语 args 契约、嵌套对象、已移除字段、
// 豁免与插件条目、禁用条目，以及 CLI 端到端的 JSON 路径定位。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { loadLayer, validateRule } from '../src/rules/model.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

// 最小合法规则；args 覆盖原语参数，extra 覆盖顶层字段。
const rule = (kind, args = {}, extra = {}) => ({
  id: 'x.y',
  face: 'code',
  phase: 'pre-commit',
  severity: 'block',
  assert: { kind, args },
  message: { zh: 'zh', en: 'en' },
  ...extra,
});
const contentRule = (args = {}, extra = {}) =>
  rule('content', { targets: ['src/**/*.js'], contains: ['Foo'], ...args }, extra);

// 走 loadLayer 的真实入口（相对路径 + JSON 解析 + 分层 schema），返回可重复调用的 loader。
function writeLayer(dir, data) {
  const rel = '.agents/rules/project.json';
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify({ version: 1, ...data }, null, 2)}\n`);
  return () => loadLayer(dir, rel, 'project');
}

test('unknown args key is rejected for every primitive and lists allowed keys', () => {
  const cases = [
    ['content', contentRule({ unlesss: 'x' }), 'unlesss'],
    ['require', rule('require', { files: ['a.js'], trigger: 't', require: 'r', trigerr: 'x' }), 'trigerr'],
    ['absence', rule('absence', { glob: 'src/**', globs: ['x'] }), 'globs'],
    ['inventory', rule('inventory', { scan: [{ dir: 'src' }], baseline: 'b.json', baselinee: 'x' }), 'baselinee'],
    ['env', rule('env', { name: 'NODE_ENV', forbiddenValue: ['prod'] }), 'forbiddenValue'],
    ['command', rule('command', { run: 'true', runn: 'x' }), 'runn'],
    ['navProperties', rule('navProperties', { dir: 'src', dirs: ['x'] }), 'dirs'],
    ['plugin', rule('plugin', { module: 'm', modul: 'x' }), 'modul'],
  ];
  for (const [kind, bad, key] of cases) {
    assert.throws(
      () => validateRule(bad, 'r'),
      new RegExp(`未知字段「${key}」（允许：.*_note）`),
      `${kind} must reject unknown arg「${key}」and list allowed keys`,
    );
  }
});

test('content args are scope-strict: repo rejects diff-only keys and vice versa', () => {
  assert.throws(
    () => validateRule(contentRule({ pattern: 'x', copyPattern: 'y' }), 'r'),
    /「copyPattern」只在 diff 作用域生效（本规则 scope 为 repo）/,
  );
  assert.throws(
    () => validateRule(rule('content', { targets: ['src/**/*.js'], pattern: 'x' }, { scope: 'diff' }), 'r'),
    /「targets」只在 repo 作用域生效（本规则 scope 为 diff）/,
  );
});

test('invalid regexes fail at load time with the offending path', () => {
  assert.throws(
    () => validateRule(contentRule({ matches: ['('] }), 'r'),
    /assert\.args\.matches\[0\] 正则非法/,
  );
  assert.throws(
    () => validateRule(rule('inventory', { scan: [{ dir: 'src', call: '(' }], baseline: 'b.json' }), 'r'),
    /assert\.args\.scan\[0\]\.call 正则非法/,
  );
  assert.throws(
    () => validateRule(rule('command', { run: 'true', lockPattern: '(' }), 'r'),
    /assert\.args\.lockPattern 正则非法/,
  );
});

test('nested objects reject unknown keys (files, assert, allow, message, layer, waiver, plugin)', () => {
  assert.throws(() => validateRule(contentRule({}, { files: { exlude: ['x'] } }), 'r'), /files 未知字段「exlude」/);
  assert.throws(
    () => validateRule(contentRule({}, { assert: { kind: 'content', args: { targets: ['a'], contains: ['b'] }, arg: 1 } }), 'r'),
    /assert 未知字段「arg」/,
  );
  assert.throws(
    () => validateRule(contentRule({ matches: ['x'], allow: [{ glob: 'a', patern: 'x' }] }), 'r'),
    /allow\[0\] 未知字段「patern」/,
  );
  assert.throws(
    () => validateRule(contentRule({}, { message: { zh: 'z', en: 'e', fr: 'f' } }), 'r'),
    /message 未知字段「fr」/,
  );

  const dir = makeTmp('rules-schema-');
  assert.throws(writeLayer(dir, { rule: [] }), /未知字段「rule」（允许：version/);
  assert.throws(
    writeLayer(dir, { waivers: [{ rule: 'x.y', expires: '2099-01-01', reason: 'x', extra: 1 }] }),
    /waivers\[0\] 未知字段「extra」/,
  );
  assert.throws(
    writeLayer(dir, { plugins: [{ id: 'p', module: 'm', face: 'code', phase: 'pre-commit', extra: 1 }] }),
    /plugins\[0\] 未知字段「extra」/,
  );
});

test('removed fields level / waiverFile are unknown fields', () => {
  assert.throws(() => validateRule(contentRule({}, { level: 'warn' }), 'r'), /未知字段「level」/);
  assert.throws(() => validateRule(contentRule({}, { waiverFile: 'x.json' }), 'r'), /未知字段「waiverFile」/);
});

test('wrong types are rejected (arrays, booleans, env values, _note)', () => {
  assert.throws(() => validateRule(contentRule({}, { files: { ext: '.cs' } }), 'r'), /files\.ext 必须是字符串数组/);
  assert.throws(() => validateRule(contentRule({}, { enabled: 'false' }), 'r'), /enabled 必须是布尔值/);
  assert.throws(() => validateRule(contentRule({}, { when: [''] }), 'r'), /when 必须是非空字符串数组/);
  // 空 when 在旧脚本里是「永不启用」，语义含糊：schema 一律拒绝（要么写条件，要么别声明）。
  assert.throws(() => validateRule(contentRule({}, { when: [] }), 'r'), /when 必须是非空字符串数组/);
  assert.throws(() => validateRule(contentRule({ targets: [] }), 'r'), /targets 必须是非空字符串数组/);
  assert.throws(
    () => validateRule(rule('inventory', { scan: [], baseline: 'b.json' }), 'r'),
    /scan 必须是非空的对象数组/,
  );
  assert.throws(
    () => validateRule(rule('command', { run: 'true', env: { A: {} } }), 'r'),
    /env 必须是对象（值为字符串/,
  );
  assert.throws(() => validateRule(contentRule({}, { _note: 1 }), 'r'), /_note 必须是字符串（注释键）/);
});

test('waivers require a real expiry date and a reason', () => {
  const dir = makeTmp('rules-schema-');
  assert.throws(
    writeLayer(dir, { waivers: [{ rule: 'x.y', reason: 'r' }] }),
    /waivers\[0\] 缺少必填字段「expires」/,
  );
  assert.throws(
    writeLayer(dir, { waivers: [{ rule: 'x.y', expires: '2099-01-01' }] }),
    /waivers\[0\] 缺少必填字段「reason」/,
  );
  assert.throws(
    writeLayer(dir, { waivers: [{ rule: 'x.y', expires: '2026-13-45', reason: 'r' }] }),
    /waivers\[0\]\.expires 必须是日期字符串（YYYY-MM-DD）/,
  );
  assert.doesNotThrow(
    writeLayer(dir, { waivers: [{ rule: 'x.y', expires: '2099-01-01', reason: 'x' }] }),
  );
});

test('_note is accepted at every object level', () => {
  assert.doesNotThrow(() =>
    validateRule(
      contentRule({ _note: 'args' }, { _note: 'rule', files: { ext: ['.js'], _note: 'files' } }),
      'r',
    ),
  );
  assert.doesNotThrow(() =>
    validateRule(
      rule('inventory', { scan: [{ dir: 'src', _note: 'scan' }], baseline: 'b.json' }, { _note: 'rule' }),
      'r',
    ),
  );
  const dir = makeTmp('rules-schema-');
  assert.doesNotThrow(
    writeLayer(dir, {
      _note: 'layer',
      waivers: [{ rule: 'x.y', expires: '2099-01-01', reason: 'x', _note: 'waiver' }],
      plugins: [{ id: 'p', module: 'm', face: 'code', phase: 'pre-commit', _note: 'plugin' }],
    }),
  );
});

test('timeoutMs contract: null only on command, positive integer otherwise', () => {
  assert.doesNotThrow(() => validateRule(rule('command', { run: 'true' }, { timeoutMs: null }), 'r'));
  assert.throws(
    () => validateRule(rule('plugin', { module: 'm' }, { timeoutMs: null }), 'r'),
    /插件必须有时限/,
  );
  assert.throws(
    () => validateRule(rule('command', { run: 'true' }, { timeoutMs: 0 }), 'r'),
    /必须是正整数（毫秒）或 null/,
  );
  assert.throws(
    () => validateRule(contentRule({}, { timeoutMs: 1000 }), 'r'),
    /仅适用于 command \/ plugin 规则/,
  );
});

test('scope diff is only meaningful for content rules', () => {
  assert.throws(
    () => validateRule(rule('require', { files: ['a.js'], trigger: 't', require: 'r' }, { scope: 'diff' }), 'r'),
    /diff 作用域只对 content 有意义/,
  );
});

test('content scope combos: required targets/pattern in both modes', () => {
  assert.throws(
    () => validateRule(rule('content', { pattern: 'x' }), 'r'),
    /repo 作用域的 content 必须配 targets 或 files/,
  );
  assert.throws(
    () => validateRule(rule('content', { ext: ['.js'] }, { scope: 'diff' }), 'r'),
    /diff 作用域的 content 必须配 pattern/,
  );
  assert.doesNotThrow(() => validateRule(contentRule(), 'r'));
  assert.doesNotThrow(() =>
    validateRule(rule('content', { pattern: 'x', ext: ['.js'] }, { scope: 'diff' }), 'r'),
  );
});

test('disabled entries accept only id / enabled / _note (id must still be valid)', () => {
  assert.doesNotThrow(() => validateRule({ id: 'arch.no-foo', enabled: false, _note: 'off' }, 'r'));
  assert.throws(() => validateRule({ id: 'Bad Id', enabled: false }, 'r'), /id 必须是规则 id/);
});

test('CLI rules check reports the JSON path of a typo in assert.args and exits 2', () => {
  const dir = makeTmp('rules-schema-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.agents', 'rules'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agents', 'rules', 'project.json'),
    `${JSON.stringify({
      version: 1,
      rules: [
        rule('content', { targets: ['src/**/*.js'], contains: ['Foo'], unlesss: 'x' }),
      ],
    }, null, 2)}\n`,
  );
  const r = spawnSync(process.execPath, [BIN, 'rules', 'check', '--target', dir], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /\.agents\/rules\/project\.json: rules\[0\]\.assert\.args/);
  assert.match(r.stderr, /未知字段/);
});
