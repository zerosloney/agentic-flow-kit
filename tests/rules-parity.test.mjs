// rules-parity.test.mjs — v1 对拍：旧门禁（check-architecture / check-delete-guard / check-audit-fields）
// 与 flow-kit rules check（经 adapters 投影）在同一 fixture 上给出同一判定；另覆盖 env/command/分层覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const HOOKS = path.join(KIT, 'templates', 'engine', '.agents', 'hooks');

function fixture() {
  const dir = makeTmp('rules-parity-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const json = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

function gate(root, script, args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(HOOKS, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function rules(root, args = [], env = {}) {
  return spawnSync(process.execPath, [BIN, 'rules', 'check', '--target', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('parity: architecture forbidden (violation then clean)', () => {
  const dir = fixture();
  write(dir, '.agents/hooks/architecture-redlines.json', json({
    forbidden: [{ id: 'no-foo', targets: ['src/**/*.cs'], contains: ['Foo'], message: 'no Foo' }],
  }));
  write(dir, 'src/a/B.cs', 'class B { void M() { /* Foo */ } }\n');
  assert.equal(gate(dir, 'check-architecture.mjs').status, 1);
  assert.equal(rules(dir).status, 1);

  write(dir, 'src/a/B.cs', 'class B { void M() { /* Bar */ } }\n');
  assert.equal(gate(dir, 'check-architecture.mjs').status, 0);
  assert.equal(rules(dir).status, 0);
});

test('parity: architecture catchRequires (missing Log then satisfied)', () => {
  const dir = fixture();
  write(dir, 'src/a/C.cs', 'class C\n{\n  void M()\n  {\n    try { }\n    catch (Exception e)\n    {\n      throw;\n    }\n  }\n}\n');
  write(dir, '.agents/hooks/architecture-redlines.json', json({
    catchRequires: [{ id: 'catch-log', files: ['src/a/C.cs'], catch: 'catch (', require: 'Log', message: 'catch needs Log' }],
  }));
  assert.equal(gate(dir, 'check-architecture.mjs').status, 1);
  assert.equal(rules(dir).status, 1);

  write(dir, 'src/a/C.cs', 'class C\n{\n  void M()\n  {\n    try { }\n    catch (Exception e)\n    {\n      Log.Error(e);\n      throw;\n    }\n  }\n}\n');
  assert.equal(gate(dir, 'check-architecture.mjs').status, 0);
  assert.equal(rules(dir).status, 0);
});

test('parity: delete guard inventory vs allowlist', () => {
  const dir = fixture();
  write(dir, '.agents/hooks/delete-guard.json', json({ scan: [{ dir: 'src' }] }));
  write(dir, '.agents/hooks/delete-guard-allowlist.txt', '');
  write(dir, 'src/a/Repo.cs', 'class R { void M() { _db.Remove(x); } }\n');

  const env = { FLOW_KIT_PROJECT_ROOT: dir };
  assert.equal(gate(dir, 'check-delete-guard.mjs', [], env).status, 1);
  assert.equal(rules(dir).status, 1);

  write(dir, '.agents/hooks/delete-guard-allowlist.txt', 'src/a/Repo.cs 1\n');
  assert.equal(gate(dir, 'check-delete-guard.mjs', [], env).status, 0);
  assert.equal(rules(dir).status, 0);
});

test('parity: audit fields (staged diff, hand-written protected field)', () => {
  const dir = fixture();
  write(dir, '.agents/hooks/audit-fields.json', json({ ext: ['.cs'], fields: ['CreatedBy'] }));
  write(dir, 'src/a/A.cs', 'class A { void M() { CreatedBy = 1; } }\n');
  spawnSync('git', ['add', '-A'], { cwd: dir });

  assert.equal(gate(dir, 'check-audit-fields.mjs').status, 1);
  assert.equal(rules(dir, ['--staged']).status, 1);

  write(dir, 'src/a/A.cs', 'class A { void M() { var x = 1; } }\n');
  spawnSync('git', ['add', '-A'], { cwd: dir });
  assert.equal(gate(dir, 'check-audit-fields.mjs').status, 0);
  assert.equal(rules(dir, ['--staged']).status, 0);
});

test('env rule: unset fails, valid passes, forbidden database fails', () => {
  const dir = fixture();
  write(dir, '.agents/config/local-gates.json', json({ testDb: { env: 'RULES_TEST_DB', forbiddenDatabases: ['SHARED'] } }));
  const cleanEnv = { ...process.env };
  delete cleanEnv.RULES_TEST_DB;

  let r = rules(dir, [], cleanEnv);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  r = rules(dir, [], { ...cleanEnv, RULES_TEST_DB: 'Server=x;Database=OK' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  r = rules(dir, [], { ...cleanEnv, RULES_TEST_DB: 'Server=x;Database=SHARED' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

test('command rules only run with --with-commands and report failures', () => {
  const dir = fixture();
  write(dir, '.agents/hooks/commit-check.config.json', json({ builds: [{ name: 'ok', command: 'node -e "process.exit(0)"' }] }));
  assert.equal(rules(dir).status, 0);
  assert.equal(rules(dir, ['--with-commands']).status, 0);

  write(dir, '.agents/hooks/commit-check.config.json', json({ builds: [{ name: 'bad', command: 'node -e "process.exit(3)"' }] }));
  assert.equal(rules(dir, ['--with-commands']).status, 1);
});

test('project layer can disable a legacy rule (rules check only; legacy gate unchanged)', () => {
  const dir = fixture();
  write(dir, '.agents/hooks/architecture-redlines.json', json({
    forbidden: [{ id: 'no-foo', targets: ['src/**/*.cs'], contains: ['Foo'], message: 'no Foo' }],
  }));
  write(dir, 'src/a/B.cs', 'class B { void M() { /* Foo */ } }\n');
  assert.equal(rules(dir).status, 1);
  write(dir, '.agents/rules/project.json', `{
    // 只读禁用：不需要复制整条规则
    "version": 1,
    "rules": [{ "id": "arch.no-foo", "enabled": false }],
  }`);
  assert.equal(rules(dir).status, 0);
  assert.equal(gate(dir, 'check-architecture.mjs').status, 1);

  const validate = spawnSync(process.execPath, [BIN, 'rules', 'validate', '--target', dir], { encoding: 'utf8' });
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
  assert.match(validate.stdout, /project/);

  const explain = spawnSync(process.execPath, [BIN, 'rules', 'explain', 'arch.no-foo', '--target', dir], { encoding: 'utf8' });
  assert.equal(explain.status, 0);
  const parsed = JSON.parse(explain.stdout);
  assert.equal(parsed.enabled, false);
});

test('unconfigured project evaluates cleanly with zero rules', () => {
  const dir = fixture();
  const r = rules(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /0/);
});

test('parity: noNavigationProperties (type-graph assertion)', () => {
  const dir = fixture();
  write(dir, '.agents/hooks/architecture-redlines.json', json({
    noNavigationProperties: [{ id: 'nav', dir: 'src/domain', message: 'no nav props' }],
  }));
  write(dir, 'src/domain/Order.cs', 'public class Order\n{\n  public List<Order> Children { get; set; }\n}\n');
  assert.equal(gate(dir, 'check-architecture.mjs').status, 1);
  assert.equal(rules(dir).status, 1);

  write(dir, 'src/domain/Order.cs', 'public class Order\n{\n  public List<Guid> Lines { get; set; }\n}\n');
  assert.equal(gate(dir, 'check-architecture.mjs').status, 0);
  assert.equal(rules(dir).status, 0);
});

test('parity: notify guard defaults (violation, allowfile, comment line)', () => {
  const dir = fixture();
  write(dir, 'frontend/src/a.vue', "message.error('x');\n");
  assert.equal(gate(dir, 'check-notify-guard.mjs').status, 1);
  assert.equal(rules(dir).status, 1);

  write(dir, 'frontend/src/a.vue', 'const ok = 1;\n');
  write(dir, 'frontend/src/utils/notify.ts', "message.error('x');\n");
  assert.equal(gate(dir, 'check-notify-guard.mjs').status, 0);
  assert.equal(rules(dir).status, 0);

  write(dir, 'frontend/src/a.vue', '// message.error in comment\n');
  assert.equal(gate(dir, 'check-notify-guard.mjs').status, 0);
  assert.equal(rules(dir).status, 0);
});

test('parity: notify guard config override (targets/ext/pattern)', () => {
  const dir = fixture();
  write(dir, '.agents/hooks/notify-guard.json', json({
    targets: ['web/src'], ext: ['.ts'], pattern: 'alert\\(',
  }));
  write(dir, 'web/src/a.ts', 'alert(1);\n');
  write(dir, 'frontend/src/a.vue', "message.error('x');\n");
  assert.equal(gate(dir, 'check-notify-guard.mjs').status, 1);
  assert.equal(rules(dir).status, 1);

  write(dir, 'web/src/a.ts', 'const ok = 1;\n');
  assert.equal(gate(dir, 'check-notify-guard.mjs').status, 0);
  assert.equal(rules(dir).status, 0);
});

test('local-pre-commit runs the four gates through rules check (single path, env not in commit gate)', () => {
  const dir = fixture();
  const hook = () => spawnSync(process.execPath, [path.join(HOOKS, 'local-pre-commit.mjs')], { cwd: dir, encoding: 'utf8' });
  write(dir, '.agents/hooks/architecture-redlines.json', json({
    forbidden: [{ id: 'no-foo', targets: ['src/**/*.cs'], contains: ['Foo'], message: 'no Foo' }],
  }));
  write(dir, 'src/a/B.cs', 'class B { /* Foo */ }\n');
  assert.equal(hook().status, 1);

  write(dir, 'src/a/B.cs', 'class B { }\n');
  assert.equal(hook().status, 0);

  write(dir, '.agents/config/local-gates.json', json({ testDb: { env: 'RULES_LOCAL_DB' } }));
  const env = { ...process.env };
  delete env.RULES_LOCAL_DB;
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'local-pre-commit.mjs')], { cwd: dir, encoding: 'utf8', env });
  assert.equal(r.status, 0, 'env rule is phase=local and must not gate commits');
});

test('rules init projects legacy configs into project.json (and refuses to overwrite)', () => {
  const dir = fixture();
  write(dir, '.agents/hooks/architecture-redlines.json', json({
    forbidden: [{ id: 'no-foo', targets: ['src/**/*.cs'], contains: ['Foo'], message: 'no Foo' }],
  }));
  write(dir, 'src/a/B.cs', 'class B { }\n');
  const init = spawnSync(process.execPath, [BIN, 'rules', 'init', '--target', dir], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const file = path.join(dir, '.agents/rules/project.json');
  assert.ok(fs.existsSync(file));
  assert.match(fs.readFileSync(file, 'utf8'), /arch\.no-foo/);

  const again = spawnSync(process.execPath, [BIN, 'rules', 'init', '--target', dir], { encoding: 'utf8' });
  assert.equal(again.status, 1);
  const force = spawnSync(process.execPath, [BIN, 'rules', 'init', '--target', dir, '--force'], { encoding: 'utf8' });
  assert.equal(force.status, 0, force.stderr);

  const validate = spawnSync(process.execPath, [BIN, 'rules', 'validate', '--target', dir], { encoding: 'utf8' });
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
});
