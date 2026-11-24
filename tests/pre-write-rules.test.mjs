// pre-write-rules.test.mjs — 写前门（宿主 PreToolUse）切到 rules check 后的判定：
// 快照-换入-恢复保留；违例按 rule id 拦下；配置坏 fail-closed；面→规则前缀映射不变（code=arch+delete, ui=notify）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(KIT, 'templates', 'engine', '.agents', 'hooks', 'pre-write-check.cjs');

function fixture() {
  const dir = makeTmp('pre-write-rules-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const json = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

function runHook(root, rel, content) {
  const payload = JSON.stringify({ tool_name: 'Write', cwd: root, tool_input: { file_path: rel, content } });
  return spawnSync(process.execPath, [HOOK], { cwd: root, input: payload, encoding: 'utf8' });
}

function denied(r) {
  if (!r.stdout.trim()) return false;
  try {
    return JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === 'deny';
  } catch {
    return false;
  }
}

test('architecture redline blocks the write and restores the snapshot', () => {
  const dir = fixture();
  write(dir, '.agents/hooks/architecture-redlines.json', json({
    forbidden: [{ id: 'no-foo', targets: ['src/**/*.cs'], contains: ['Foo'], message: 'no Foo' }],
  }));
  write(dir, 'src/a/B.cs', 'class B { }\n');

  const r = runHook(dir, 'src/a/B.cs', 'class B { /* Foo */ }\n');
  assert.equal(denied(r), true, r.stdout + r.stderr);
  assert.match(r.stdout, /arch\.no-foo/);
  assert.equal(fs.readFileSync(path.join(dir, 'src/a/B.cs'), 'utf8'), 'class B { }\n', 'snapshot must be restored');

  const ok = runHook(dir, 'src/a/B.cs', 'class B { /* Bar */ }\n');
  assert.equal(denied(ok), false, ok.stdout + ok.stderr);
});

test('broken rule config fails closed', () => {
  const dir = fixture();
  write(dir, '.agents/hooks/architecture-redlines.json', '{ not json');
  write(dir, 'src/a/B.cs', 'class B { }\n');
  const r = runHook(dir, 'src/a/B.cs', 'class B { /* Foo */ }\n');
  assert.equal(denied(r), true, r.stdout + r.stderr);
  assert.match(r.stdout, /配置错误|rules check exit 2/);
});

test('ui face routes to notify rules (and a clean write passes)', () => {
  const dir = fixture();
  write(dir, '.agents/config/project-faces.json', json({ ui: ['frontend/src/'], code: [], tests: [], data: [] }));
  write(dir, 'frontend/src/a.vue', 'const ok = 1;\n');

  const bad = runHook(dir, 'frontend/src/a.vue', "message.error('x');\n");
  assert.equal(denied(bad), true, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /notify\.message-guard/);

  const ok = runHook(dir, 'frontend/src/a.vue', 'const ok = 2;\n');
  assert.equal(denied(ok), false, ok.stdout + ok.stderr);
});
