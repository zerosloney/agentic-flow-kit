// rules-legacy-strict.test.mjs — 旧门禁配置的严格口径：适配器「只认旧脚本认的键」（拼错的键必须点名报错，
// 不得悄悄把规则变形），外加 timeoutMs 三态（数字 / null / 缺省）与 require 的目录 ext 过滤。
// 全是 CLI 级断言：`rules check --json` 的退出码 / stderr，`rules explain` 的 JSON。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const ARCH = '.agents/hooks/architecture-redlines.json';
const CC = '.agents/hooks/commit-check.config.json';
const GATES = '.agents/config/product-gates.json';

function fixture() {
  const dir = makeTmp('rules-legacy-strict-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

const json = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const writeJson = (root, rel, obj) => write(root, rel, json(obj));

function check(root, args = []) {
  return spawnSync(process.execPath, [BIN, 'rules', 'check', '--target', root, '--json', ...args], { encoding: 'utf8' });
}

function explain(root, id) {
  return spawnSync(process.execPath, [BIN, 'rules', 'explain', id, '--target', root, '--json'], { encoding: 'utf8' });
}

/** 配置错误：exit 2 + 本地化前缀 + 具体定位（stderr）。 */
function expectConfigError(root, fragment, args = []) {
  const r = check(root, args);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /规则配置错误/);
  assert.match(r.stderr, fragment);
  return r;
}

// 回归：缺 id 的条目曾被投影成 arch.undefined，两条还会 merge 成一条——必须 exit 2。
test('architecture: entry without id is a config error', () => {
  const dir = fixture();
  writeJson(dir, ARCH, {
    forbidden: [
      { targets: ['src/'], contains: ['Foo'], message: 'm1' },
      { targets: ['src/'], contains: ['Foo'], message: 'm2' },
    ],
  });
  const r = expectConfigError(dir, /缺必填字段「id」/);
  assert.match(r.stderr, /forbidden\[0\]/);
});

// id 形状：曾放行的大写 / 下划线会让规则 id 与旧脚本口径分叉。
test('architecture: id must match [a-z0-9-]', () => {
  const dir = fixture();
  writeJson(dir, ARCH, { forbidden: [{ id: 'Bad_ID', targets: ['src/'], contains: ['Foo'], message: 'm' }] });
  expectConfigError(dir, /「id」缺失或不符合/);
});

// 同一 id 出现在两个分节：投影后会同 id 互相顶掉，文件内必须唯一。
test('architecture: duplicate id across sections', () => {
  const dir = fixture();
  writeJson(dir, ARCH, {
    forbidden: [{ id: 'dup', targets: ['src/'], contains: ['Foo'], message: 'm' }],
    noNavigationProperties: [{ id: 'dup', dir: 'src', message: 'm' }],
  });
  expectConfigError(dir, /重复（要求全文件唯一）/);
});

// 条目里的拼写错误（allow / optinal）曾被旧脚本静默忽略——这里必须点名。
test('architecture: unknown entry key is named', () => {
  for (const [key, value] of [['allow', [{ glob: 'src/**', pattern: 'Foo' }]], ['optinal', true]]) {
    const dir = fixture();
    writeJson(dir, ARCH, { forbidden: [{ id: 'a', targets: ['src/'], contains: ['Foo'], message: 'm', [key]: value }] });
    expectConfigError(dir, new RegExp(`未知字段「${key}」`));
  }
});

// 分节写成对象（而非数组）曾是「不报错也不生效」的静默失守。
test('architecture: section must be an array', () => {
  const dir = fixture();
  writeJson(dir, ARCH, { forbidden: {} });
  expectConfigError(dir, /必须是数组/);
});

// 顶层拼错的键会让整节规则消失，必须点名。
test('architecture: unknown top-level key', () => {
  const dir = fixture();
  writeJson(dir, ARCH, { forbiddden: [] });
  expectConfigError(dir, /顶层未知字段「forbiddden」/);
});

// `_note` 在任意层级都是放行的注释键，且不影响规则生效。
test('architecture: _note is accepted at every level', () => {
  const dir = fixture();
  write(dir, 'src/a.cs', 'class A {}\n');
  writeJson(dir, ARCH, {
    _note: '顶层注释',
    forbidden: [{ _note: '条目注释', id: 'no-foo', targets: ['src/**/*.cs'], contains: ['Foo'], message: 'no Foo' }],
  });
  const r = check(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).passed.map((p) => p.ruleId), ['arch.no-foo']);
});

// 文件在但 scan 为空 = 配置错误（未配置 = 没有这个文件），不得当作「无需守卫」。
test('delete-guard: present file with empty scan', () => {
  const dir = fixture();
  writeJson(dir, '.agents/hooks/delete-guard.json', { scan: [] });
  expectConfigError(dir, /scan 缺失或为空/);
});

// 旧 scan 条目没有 optional 键，写了就是拼错——不得静默忽略。
test('delete-guard: scan entry rejects unknown optional key', () => {
  const dir = fixture();
  writeJson(dir, '.agents/hooks/delete-guard.json', { scan: [{ dir: 'src', optional: true }] });
  expectConfigError(dir, /未知字段「optional」/);
});

// 顶层拼错的键会让审计字段守卫整条消失。
test('audit-fields: unknown top-level key', () => {
  const dir = fixture();
  writeJson(dir, '.agents/hooks/audit-fields.json', { fields: ['X'], allowFile: ['a.cs'] });
  expectConfigError(dir, /顶层未知字段「allowFile」/);
});

// fields 为空曾等于「无守卫」的假绿。
test('audit-fields: empty fields', () => {
  const dir = fixture();
  writeJson(dir, '.agents/hooks/audit-fields.json', { fields: [] });
  expectConfigError(dir, /fields 缺失或为空/);
});

// 字段名会被拼进正则：非标识符必须报错，否则守卫静默变形。
test('audit-fields: field name must be an identifier', () => {
  const dir = fixture();
  writeJson(dir, '.agents/hooks/audit-fields.json', { fields: ['a-b'] });
  expectConfigError(dir, /fields\[0\]: 必须是合法字段名/);
});

// ext 原值透传 schema：字符串形式必须报「ext 必须是字符串数组」。
test('audit-fields: ext must be a string array', () => {
  const dir = fixture();
  writeJson(dir, '.agents/hooks/audit-fields.json', { fields: ['X'], ext: '.cs' });
  expectConfigError(dir, /ext 必须是字符串数组/);
});

// testDb 段只认 env / forbiddenDatabases，拼错的键必须点名。
test('local-gates: testDb rejects unknown key', () => {
  const dir = fixture();
  writeJson(dir, '.agents/config/local-gates.json', { testDb: { env: 'PATH', forbiddenDatabase: ['X'] } });
  expectConfigError(dir, /testDb: 未知字段「forbiddenDatabase」/);
});

// env 是 testDb 的必填项；缺失曾让规则拿 undefined 去读环境变量。
test('local-gates: testDb requires env', () => {
  const dir = fixture();
  writeJson(dir, '.agents/config/local-gates.json', { testDb: { forbiddenDatabases: ['X'] } });
  expectConfigError(dir, /缺必填字段「env」/);
});

// local-gates.json 还被别的脚本读：除 testDb 外的顶层键（含 _note）不归适配器管。
test('local-gates: unrelated top-level keys are tolerated', () => {
  const dir = fixture();
  writeJson(dir, '.agents/config/local-gates.json', {
    _note: '注释',
    unrelated: { whatever: true },
    testDb: { env: 'PATH', _note: 'testDb 注释' },
  });
  const r = check(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).passed.map((p) => p.ruleId), ['local.test-db-env']);
});

// 顶层拼错的组名会让整组提交门消失。
test('commit-check: unknown top-level key', () => {
  const dir = fixture();
  writeJson(dir, CC, { build: [], builds: [] });
  expectConfigError(dir, /顶层未知字段「build」/);
});

// 条目里的 timeout（应为 timeoutMs）曾被静默忽略 = 时限悄悄回落到默认值。
test('commit-check: entry rejects unknown timeout key', () => {
  const dir = fixture();
  writeJson(dir, CC, { builds: [{ command: 'node -e "process.exit(0)"', timeout: 5 }] });
  expectConfigError(dir, /未知字段「timeout」/);
});

// ext 字符串形式旧脚本同样忽略 = 触发面变成全量；这里必须点名。
test('commit-check: entry ext must be an array', () => {
  const dir = fixture();
  writeJson(dir, CC, { builds: [{ command: 'node -e "process.exit(0)"', ext: '.js' }] });
  expectConfigError(dir, /「ext」必须是非空字符串数组/);
});

// when 字符串形式必须被当单一谓词（归一成数组），且只有文件存在时规则才跑。
test('commit-check: when as a plain string is honoured', () => {
  const dir = fixture();
  writeJson(dir, CC, { builds: [{ command: 'node -e "process.exit(0)"', ext: ['.js'], when: 'flags/on.txt' }] });
  write(dir, 'src/a.js', 'const x = 1;\n');
  spawnSync('git', ['add', 'src/a.js'], { cwd: dir });

  let out = JSON.parse(check(dir, ['--staged', '--with-commands']).stdout);
  const skip = out.skipped.find((s) => s.ruleId === 'commit.build.0');
  assert.equal(skip?.reason, 'when', JSON.stringify(out.skipped));
  assert.deepEqual(skip.when, ['flags/on.txt']);

  write(dir, 'flags/on.txt', 'on\n');
  const r = check(dir, ['--staged', '--with-commands']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  out = JSON.parse(r.stdout);
  assert.ok(out.passed.some((p) => p.ruleId === 'commit.build.0'), JSON.stringify(out.passed));
  assert.ok(!out.skipped.some((s) => s.ruleId === 'commit.build.0'), JSON.stringify(out.skipped));
});

// when 空数组在旧脚本里是「永不启用」，schema 要求非空——必须点名报错而不是静默不跑。
test('commit-check: empty when array is rejected', () => {
  const dir = fixture();
  writeJson(dir, CC, { builds: [{ command: 'node -e "process.exit(0)"', when: [] }] });
  expectConfigError(dir, /when 必须是非空字符串数组/);
});

// 产品门的键闭集：whenEnv 是提交门的键，写进产品门必须点名。
test('product gates: unknown key whenEnv', () => {
  const dir = fixture();
  writeJson(dir, GATES, { gates: [{ id: 'g1', name: 'G1', cmd: 'node -e "process.exit(0)"', whenEnv: 'X' }] });
  expectConfigError(dir, /未知字段「whenEnv」/);
});

// deps 必须是 id 数组；字符串形式曾让依赖关系悄悄消失。
test('product gates: deps must be an id array', () => {
  const dir = fixture();
  writeJson(dir, GATES, { gates: [{ id: 'g1', name: 'G1', cmd: 'node -e "process.exit(0)"', deps: 'b' }] });
  expectConfigError(dir, /「deps」须为 id 数组/);
});

// env 值只能是标量（schema 口径）；对象值让子进程环境注入失效。
test('product gates: env values must be scalars', () => {
  const dir = fixture();
  writeJson(dir, GATES, { gates: [{ id: 'g1', name: 'G1', cmd: 'node -e "process.exit(0)"', env: { A: {} } }] });
  expectConfigError(dir, /assert\.args\.env 必须是对象/);
});

// 产品门缺省不限时（null），声明正整数才封顶——explain 必须原值透出。
test('product gates: timeoutMs 30000 vs default null', () => {
  const dir = fixture();
  writeJson(dir, GATES, {
    gates: [
      { id: 'capped', name: 'Capped', cmd: 'node -e "process.exit(0)"', timeoutMs: 30000 },
      { id: 'free', name: 'Free', cmd: 'node -e "process.exit(0)"' },
    ],
  });
  let r = explain(dir, 'product.capped');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).timeoutMs, 30000);

  r = explain(dir, 'product.free');
  assert.equal(r.status, 0, r.stderr);
  const free = JSON.parse(r.stdout);
  assert.ok(Object.hasOwn(free, 'timeoutMs'), r.stdout);
  assert.equal(free.timeoutMs, null);
});

// timeoutMs 数字：超过上限的命令必须被终止，violation detail 以 [超时] 开头。
test('command rule: timeoutMs aborts a long command', () => {
  const dir = fixture();
  writeJson(dir, '.agents/rules/project.json', {
    version: 1,
    rules: [{
      id: 't.timeout',
      face: 'any',
      phase: 'always',
      severity: 'block',
      timeoutMs: 300,
      assert: { kind: 'command', args: { run: 'node -e "setTimeout(()=>{},1500)"' } },
      message: { zh: '命令超时', en: 'command timed out' },
    }],
  });
  const r = check(dir, ['--with-commands']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const violations = JSON.parse(r.stdout).violations;
  assert.equal(violations.length, 1, r.stdout);
  assert.match(violations[0].detail, /^\[超时\]/);
});

// timeoutMs null：显式不限时——同样 1.5s 的命令必须通过。
test('command rule: timeoutMs null means no limit', () => {
  const dir = fixture();
  writeJson(dir, '.agents/rules/project.json', {
    version: 1,
    rules: [{
      id: 't.timeout',
      face: 'any',
      phase: 'always',
      severity: 'block',
      timeoutMs: null,
      assert: { kind: 'command', args: { run: 'node -e "setTimeout(()=>{},1500)"' } },
      message: { zh: '命令超时', en: 'command timed out' },
    }],
  });
  const r = check(dir, ['--with-commands']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).violations, []);
});

// timeoutMs 缺省：不写键 = 用原语默认上限，explain 里该键必须整个缺席（区别于 null）。
test('commit-check: absent timeoutMs keeps the primitive default', () => {
  const dir = fixture();
  writeJson(dir, CC, { builds: [{ command: 'node -e "process.exit(0)"' }] });
  const r = explain(dir, 'commit.build.0');
  assert.equal(r.status, 0, r.stderr);
  const rule = JSON.parse(r.stdout);
  assert.ok(!Object.hasOwn(rule, 'timeoutMs'), r.stdout);
});

// require 的目录目标按 ext 过滤（缺省 .cs）：缺省 .cs 下 .ts 不被扫描；目录里只有其它类型文件而零匹配时判违例，不静默通过。
test('require: ext filters directory targets', () => {
  const dir = fixture();
  write(dir, 'src/a.ts', 'try {\n  doWork();\n}\n');
  const rule = (args) => ({
    version: 1,
    rules: [{
      id: 'req.ext',
      face: 'code',
      phase: 'always',
      severity: 'block',
      assert: { kind: 'require', args: { files: ['src/'], trigger: 'try', require: 'FIXME', ...args } },
      message: { zh: '缺 FIXME', en: 'missing FIXME' },
    }],
  });

  writeJson(dir, '.agents/rules/project.json', rule({ ext: ['.ts'] }));
  const hit = check(dir);
  assert.equal(hit.status, 1, hit.stdout + hit.stderr);
  assert.deepEqual(JSON.parse(hit.stdout).violations.map((v) => v.ruleId), ['req.ext']);

  writeJson(dir, '.agents/rules/project.json', rule({}));
  const miss = check(dir);
  assert.equal(miss.status, 1, miss.stdout + miss.stderr);
  const missViolations = JSON.parse(miss.stdout).violations;
  assert.equal(missViolations.length, 1);
  assert.equal(missViolations[0].ruleId, 'req.ext');
  assert.match(missViolations[0].detail, /请显式声明 ext/);

  // 补一个 .cs 后缺省过滤有命中，原逻辑照常求值：.ts 仍不被扫描，keep.cs 无 trigger 故零违例。
  write(dir, 'src/keep.cs', 'class Keep {}\n');
  const kept = check(dir);
  assert.equal(kept.status, 0, kept.stdout + kept.stderr);
  assert.deepEqual(JSON.parse(kept.stdout).violations, []);
});
