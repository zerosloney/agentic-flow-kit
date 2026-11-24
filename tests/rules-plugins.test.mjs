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
