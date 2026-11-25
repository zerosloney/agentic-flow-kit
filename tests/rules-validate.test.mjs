// rules-validate.test.mjs — `rules validate` 的引用 / 语义检查：层内重复 id、悬空豁免、缺失插件、
// 永不成立的 when 谓词、畸形 whenEnv；另覆盖 --json、退出码契约与插件 config 透传。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function fixture() {
  const dir = makeTmp('rules-validate-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const json = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

const rule = (id, extra = {}) => ({
  id,
  face: 'any',
  phase: 'pre-commit',
  severity: 'block',
  assert: { kind: 'content', args: { targets: ['src/**/*.js'], pattern: 'TODO' } },
  message: { zh: id, en: id },
  ...extra,
});

const rules = (root, ...args) => spawnSync(process.execPath, [BIN, 'rules', ...args, '--lang', 'zh-CN', '--target', root], { encoding: 'utf8' });

test('duplicate rule id inside one layer is a finding (exit 2)', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({ version: 1, rules: [rule('dup.same'), rule('dup.same')] }));

  const r = rules(dir, 'validate');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /project: rules\[1\] id「dup\.same」在本层重复/);
  assert.match(r.stdout, /规则校验未通过：1 处问题/);
});

test('same rule id in two different layers is a legal override (exit 0)', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({ version: 1, rules: [rule('layer.same')] }));
  write(dir, '.agents/rules/local.json', json({ version: 1, rules: [rule('layer.same', { severity: 'warn' })] }));

  const r = rules(dir, 'validate');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /在本层重复/);
});

test('waiver pointing at a non-existent rule is a finding', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({ version: 1, waivers: [{ rule: 'ghost.rule', expires: '2099-01-01', reason: 'gone' }] }));

  const r = rules(dir, 'validate');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /project: waivers\[0\] 指向不存在的规则「ghost\.rule」/);
});

test('plugin whitelist entry with a missing module is a finding', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    plugins: [{ id: 'proj.missing', module: 'nope', face: 'code', phase: 'pre-commit' }],
  }));

  const r = rules(dir, 'validate');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /project: plugins\[0\] 插件模块不存在：\.agents\/rules\/plugins\/nope\.mjs/);
});

test('unsatisfiable when predicates (empty pkg path / env without =) are findings', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    rules: [rule('when.pkg', { when: ['pkg:'] }), rule('when.env', { when: ['env:NO_EQUALS_HERE'] })],
  }));

  const r = rules(dir, 'validate');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /rules\[0\] when 谓词永不成立：「pkg:」/);
  assert.match(r.stdout, /rules\[1\] when 谓词永不成立：「env:NO_EQUALS_HERE」/);
  assert.match(r.stdout, /规则校验未通过：2 处问题/);
});

test('malformed whenEnv is a finding', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({ version: 1, rules: [rule('env.bad', { whenEnv: 'NOEQUALS' })] }));

  const r = rules(dir, 'validate');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /project: rules\[0\] whenEnv 写法有误（应为 KEY=VAL）：「NOEQUALS」/);
});

test('clean project validates with exit 0', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({ version: 1, rules: [rule('clean.rule')] }));

  const r = rules(dir, 'validate');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('validate --json prints a single object with findings', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({ version: 1, rules: [rule('dup.same'), rule('dup.same')] }));

  const r = rules(dir, 'validate', '--json');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.findings.length, 1);
  assert.match(parsed.findings[0], /在本层重复/);
  assert.equal(typeof parsed.rules, 'number');
  assert.deepEqual(parsed.layers, ['legacy', 'project']);
  assert.equal(typeof parsed.waivers, 'number');
  assert.equal(typeof parsed.expired, 'number');
  assert.ok(Array.isArray(parsed.unsupported));
});

test('init --json writes project.json and reports path/count', () => {
  const dir = fixture();
  const r = rules(dir, 'init', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.written, '.agents/rules/project.json');
  assert.equal(typeof parsed.count, 'number');
  assert.ok(fs.existsSync(path.join(dir, '.agents/rules/project.json')));
});

test('init twice without --force is a usage error (exit 2)', () => {
  const dir = fixture();
  assert.equal(rules(dir, 'init').status, 0);
  const again = rules(dir, 'init');
  assert.equal(again.status, 2, again.stdout + again.stderr);
  assert.match(again.stderr, /已存在/);
});

test('check with a non-existent range is a usage error (exit 2), not a violation', () => {
  const dir = fixture();
  const r = rules(dir, 'check', '--range', 'deadbeef..cafebabe');
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test('top-level timeoutMs on a non-command/plugin rule is a config error (exit 2)', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({ version: 1, rules: [rule('bad.timeout', { timeoutMs: 1000 })] }));

  const r = rules(dir, 'validate');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /timeoutMs 仅适用于 command \/ plugin 规则/);
});

test('plugin config is folded into assert.args.config of the explain output', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    plugins: [{ id: 'proj.cfg', module: 'cfg-mod', face: 'code', phase: 'pre-commit', config: { threshold: 3, tags: ['a'] } }],
  }));

  const r = rules(dir, 'explain', 'proj.cfg');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.assert.kind, 'plugin');
  assert.equal(parsed.assert.args.module, 'cfg-mod');
  assert.deepEqual(parsed.assert.args.config, { threshold: 3, tags: ['a'] });
});

test('plugins in a stack layer is a config error naming the layer (exit 2)', () => {
  const dir = fixture();
  write(dir, '.agents/rules/stack.node.json', json({
    version: 1,
    plugins: [{ id: 'stack.no-todo', module: 'no-todo', face: 'code', phase: 'pre-commit' }],
  }));

  const r = rules(dir, 'validate');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /plugins 只能在项目层声明/);
  assert.match(r.stderr, /stack\.node/);
});

test('plugins in the local layer is a config error naming the layer (exit 2)', () => {
  const dir = fixture();
  write(dir, '.agents/rules/local.json', json({
    version: 1,
    plugins: [{ id: 'local.no-todo', module: 'no-todo', face: 'code', phase: 'pre-commit' }],
  }));

  const r = rules(dir, 'validate');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /plugins 只能在项目层声明/);
  assert.match(r.stderr, /当前层为 local/);
});

test('explain lists the merge chain in stacking order (two layers)', () => {
  const dir = fixture();
  write(dir, '.agents/rules/stack.node.json', json({ version: 1, rules: [rule('chain.same', { severity: 'warn' })] }));
  write(dir, '.agents/rules/project.json', json({ version: 1, rules: [rule('chain.same')] }));

  const r = rules(dir, 'explain', 'chain.same');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.deepEqual(parsed.layers, [
    { layer: 'stack.node', face: 'any', phase: 'pre-commit', severity: 'warn', enabled: true },
    { layer: 'project', face: 'any', phase: 'pre-commit', severity: 'block', enabled: true },
  ]);
  assert.equal(parsed.source, 'project');
});

test('explain lists a disabled-only entry with null face/phase/severity', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({ version: 1, rules: [rule('chain.off')] }));
  write(dir, '.agents/rules/local.json', json({ version: 1, rules: [{ id: 'chain.off', enabled: false }] }));

  const r = rules(dir, 'explain', 'chain.off');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.deepEqual(parsed.layers, [
    { layer: 'project', face: 'any', phase: 'pre-commit', severity: 'block', enabled: true },
    { layer: 'local', face: null, phase: null, severity: null, enabled: false },
  ]);
  assert.equal(parsed.reason.enabled, false);
});

test('explain reports per-predicate when satisfaction', () => {
  const dir = fixture();
  write(dir, 'package.json', json({ name: 'when-fixture', scripts: { test: 'node --test' } }));
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    rules: [rule('why.when', { when: ['pkg:scripts.test', 'env:FLOW_KIT_EXPLAIN_TEST_XYZ=1'] })],
  }));

  const r = rules(dir, 'explain', 'why.when');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.deepEqual(parsed.reason.when, [
    { predicate: 'pkg:scripts.test', satisfied: true },
    { predicate: 'env:FLOW_KIT_EXPLAIN_TEST_XYZ=1', satisfied: false },
  ]);
});

test('explain reports whenEnv satisfied / unsatisfied / invalid', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    rules: [
      rule('env.ok', { whenEnv: 'FLOW_KIT_EXPLAIN_ENV=on' }),
      rule('env.miss', { whenEnv: 'FLOW_KIT_EXPLAIN_ENV=off' }),
      rule('env.bad', { whenEnv: 'NOEQUALS' }),
    ],
  }));
  const explainEnv = (id) => spawnSync(process.execPath, [BIN, 'rules', 'explain', id, '--lang', 'zh-CN', '--target', dir], {
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_EXPLAIN_ENV: 'on' },
  });

  const ok = explainEnv('env.ok');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).reason.whenEnv, { value: 'FLOW_KIT_EXPLAIN_ENV=on', satisfied: true, invalid: false });

  const miss = explainEnv('env.miss');
  assert.equal(miss.status, 0, miss.stdout + miss.stderr);
  assert.deepEqual(JSON.parse(miss.stdout).reason.whenEnv, { value: 'FLOW_KIT_EXPLAIN_ENV=off', satisfied: false, invalid: false });

  const bad = explainEnv('env.bad');
  assert.equal(bad.status, 0, bad.stdout + bad.stderr);
  assert.deepEqual(JSON.parse(bad.stdout).reason.whenEnv, { value: 'NOEQUALS', satisfied: false, invalid: true });
});
