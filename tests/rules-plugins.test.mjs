// rules-plugins.test.mjs — 插件扩展点（Phase 4）：project.json 白名单登记 → 子进程执行 →
// stdin/stdout JSON 契约；超时/崩溃/缺件按登记 severity 记为违例。
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
  const dir = makeTmp('rules-plugin-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const json = (obj) => `${JSON.stringify(obj, null, 2)}\n`;
const rules = (root, args = []) => spawnSync(process.execPath, [BIN, 'rules', 'check', '--target', root, ...args], { encoding: 'utf8' });

const PLUGIN_NO_TODO = `import fs from 'node:fs';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = [];
for (const f of input.files || []) {
  let text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (text.includes('TODO')) out.push({ file: f, message: 'TODO found' });
}
process.stdout.write(JSON.stringify({ violations: out }));
`;

const PLUGIN_OK = 'process.stdout.write(JSON.stringify({ violations: [] }));\n';

test('whitelisted plugin runs and blocks on violation', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    plugins: [{ id: 'proj.no-todo', module: 'no-todo', face: 'code', phase: 'pre-commit', severity: 'block' }],
  }));
  write(dir, '.agents/rules/plugins/no-todo.mjs', PLUGIN_NO_TODO);
  write(dir, 'src/a.cs', '// TODO: fix\n');

  const bad = rules(dir, ['--files', 'src/a.cs']);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /proj\.no-todo/);

  write(dir, 'src/a.cs', '// done\n');
  const ok = rules(dir, ['--files', 'src/a.cs']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test('missing plugin module is a violation (block)', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    plugins: [{ id: 'proj.missing', module: 'nope', face: 'code', phase: 'pre-commit', severity: 'block' }],
  }));
  const r = rules(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /插件不存在/);
});

test('plugin crash is reported; warn severity does not block', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    plugins: [{ id: 'proj.boom', module: 'boom', face: 'code', phase: 'pre-commit', severity: 'warn' }],
  }));
  write(dir, '.agents/rules/plugins/boom.mjs', 'throw new Error("boom");\n');
  const r = rules(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /插件退出码/);
});

test('plugin timeout is enforced by the registered timeoutMs', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    plugins: [{ id: 'proj.slow', module: 'slow', face: 'code', phase: 'pre-commit', severity: 'block', timeoutMs: 300 }],
  }));
  write(dir, '.agents/rules/plugins/slow.mjs', 'setTimeout(() => {}, 5000);\n');
  const r = rules(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /插件执行失败/);
});

test('plugin stdin payload carries merged faces and the plugin config', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    faces: { ui: ['src/ui/**'], code: ['src/**'] },
    plugins: [{
      id: 'proj.ctx', module: 'ctx', face: 'code', phase: 'pre-commit', severity: 'block',
      config: { allow: ['src/a.cs'] },
    }],
  }));
  write(dir, '.agents/rules/plugins/ctx.mjs', `import fs from 'node:fs';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.writeFileSync('plugin-context.json', JSON.stringify(input));
process.stdout.write(JSON.stringify({ violations: [] }));
`);
  const r = rules(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const payload = JSON.parse(fs.readFileSync(path.join(dir, 'plugin-context.json'), 'utf8'));
  assert.equal(payload.version, 1);
  assert.equal(payload.face, 'code');
  assert.deepEqual(payload.faces, { ui: ['src/ui/**'], code: ['src/**'] });
  assert.deepEqual(payload.config, { allow: ['src/a.cs'] });
});

test('plugin stdin payload config defaults to an empty object', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    plugins: [{ id: 'proj.ctx', module: 'ctx', face: 'code', phase: 'pre-commit', severity: 'block' }],
  }));
  write(dir, '.agents/rules/plugins/ctx.mjs', `import fs from 'node:fs';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.writeFileSync('plugin-context.json', JSON.stringify(input));
process.stdout.write(JSON.stringify({ violations: [] }));
`);
  const r = rules(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const payload = JSON.parse(fs.readFileSync(path.join(dir, 'plugin-context.json'), 'utf8'));
  assert.deepEqual(payload.faces, {});
  assert.deepEqual(payload.config, {});
});

// 回归：插件自身崩溃时 --json 违例带 anomaly=true（doctor 留痕靠它区分「插件没跑成」与「插件报违例」）。
test('crashed plugin marks the violation as anomaly in --json output', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    plugins: [{ id: 'proj.boom', module: 'boom', face: 'code', phase: 'pre-commit', severity: 'warn' }],
  }));
  write(dir, '.agents/rules/plugins/boom.mjs', 'throw new Error("boom");\n');
  const r = rules(dir, ['--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const v = JSON.parse(r.stdout).violations.find((x) => x.ruleId === 'proj.boom');
  assert.ok(v, 'crash must produce a violation');
  assert.equal(v.anomaly, true);
});

// 回归：插件正常报出的违例不带 anomaly（留痕只针对插件运行期异常）。
test('ordinary plugin violation carries no anomaly flag', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    plugins: [{ id: 'proj.no-todo', module: 'no-todo', face: 'code', phase: 'pre-commit', severity: 'block' }],
  }));
  write(dir, '.agents/rules/plugins/no-todo.mjs', PLUGIN_NO_TODO);
  write(dir, 'src/a.cs', '// TODO: fix\n');
  const r = rules(dir, ['--json', '--files', 'src/a.cs']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const v = JSON.parse(r.stdout).violations.find((x) => x.ruleId === 'proj.no-todo');
  assert.ok(v, 'plugin violation must be reported');
  assert.equal(v.anomaly, undefined);
});

// 回归：异常留痕落盘；同一插件恢复正常后条目被清除；插件一直正常则不建文件。
test('plugin status file records anomalies, clears on recovery, and stays absent when clean', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    plugins: [{ id: 'proj.boom', module: 'boom', face: 'code', phase: 'pre-commit', severity: 'warn' }],
  }));
  write(dir, '.agents/rules/plugins/boom.mjs', 'throw new Error("boom");\n');
  const statusPath = path.join(dir, '.agents', 'cache', 'rules-plugins.json');

  const bad = rules(dir, ['--json']);
  assert.equal(bad.status, 0, bad.stdout + bad.stderr);
  assert.equal(fs.existsSync(statusPath), true, 'anomaly must be recorded');
  const recorded = JSON.parse(fs.readFileSync(statusPath, 'utf8')).results['proj.boom'];
  assert.equal(typeof recorded.at, 'string');
  assert.match(recorded.detail, /插件退出码/);

  write(dir, '.agents/rules/plugins/boom.mjs', PLUGIN_OK);
  const ok = rules(dir, ['--json']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const after = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  assert.equal(after.results['proj.boom'], undefined, 'recovered plugin must clear its entry');

  const clean = fixture();
  write(clean, '.agents/rules/project.json', json({
    version: 1,
    plugins: [{ id: 'proj.clean', module: 'clean', face: 'code', phase: 'pre-commit', severity: 'warn' }],
  }));
  write(clean, '.agents/rules/plugins/clean.mjs', PLUGIN_OK);
  const cleanRun = rules(clean, ['--json']);
  assert.equal(cleanRun.status, 0, cleanRun.stdout + cleanRun.stderr);
  assert.equal(fs.existsSync(path.join(clean, '.agents', 'cache', 'rules-plugins.json')), false);
});

// 回归：本次未求值的插件规则（按 phase 跳过）不能清掉已有留痕。
test('phase-skipped plugin rule leaves its recorded anomaly untouched', () => {
  const dir = fixture();
  write(dir, '.agents/rules/project.json', json({
    version: 1,
    plugins: [{ id: 'proj.boom', module: 'boom', face: 'code', phase: 'pre-commit', severity: 'warn' }],
  }));
  write(dir, '.agents/rules/plugins/boom.mjs', 'throw new Error("boom");\n');
  const statusPath = path.join(dir, '.agents', 'cache', 'rules-plugins.json');
  const first = rules(dir, ['--json']);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const recorded = JSON.parse(fs.readFileSync(statusPath, 'utf8')).results['proj.boom'];
  assert.equal(typeof recorded.at, 'string');

  const skipped = rules(dir, ['--json', '--phase', 'verify']);
  assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr);
  const after = JSON.parse(fs.readFileSync(statusPath, 'utf8')).results['proj.boom'];
  assert.equal(typeof after.at, 'string', 'skipped rule must keep its entry');
});
