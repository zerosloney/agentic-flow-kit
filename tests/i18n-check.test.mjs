import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(KIT, 'tools', 'make-en-host-overrides.mjs');

// 复制成最小 KIT 形状：工具以自身所在目录的上级为根，避免测试改动真实仓库。
function tmpKit() {
  const dir = makeTmp('flow-kit-i18n-');
  fs.cpSync(path.join(KIT, 'templates', 'hosts'), path.join(dir, 'templates', 'hosts'), { recursive: true });
  fs.cpSync(path.join(KIT, 'locales', 'en', 'overrides'), path.join(dir, 'locales', 'en', 'overrides'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.copyFileSync(TOOL, path.join(dir, 'tools', 'make-en-host-overrides.mjs'));
  return dir;
}

function run(dir, args = []) {
  return spawnSync(process.execPath, [path.join(dir, 'tools', 'make-en-host-overrides.mjs'), ...args], {
    cwd: dir, encoding: 'utf8',
  });
}

function override(dir, rel) {
  return path.join(dir, 'locales', 'en', 'overrides', rel);
}

test('check passes when overrides match the host templates', () => {
  const dir = tmpKit();
  const r = run(dir, ['--check']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /overrides are up to date \(\d+ files\)/);
});

test('check reports missing, stale and orphan overrides', () => {
  const dir = tmpKit();
  fs.rmSync(override(dir, '.claude/commands/wf-new-task.md'));
  fs.appendFileSync(override(dir, '.claude/commands/wf-review.md'), '\nstale\n', 'utf8');
  fs.writeFileSync(override(dir, '.claude/legacy-command.md'), '# gone\n', 'utf8');

  const r = run(dir, ['--check']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /missing \.claude\/commands\/wf-new-task\.md/);
  assert.match(r.stdout, /stale   \.claude\/commands\/wf-review\.md/);
  assert.match(r.stdout, /orphan  \.claude\/legacy-command\.md/);
  assert.match(r.stdout, /1 missing \/ 1 stale \/ 1 orphan/);

  const json = run(dir, ['--check', '--json']);
  assert.equal(json.status, 1);
  const out = JSON.parse(json.stdout);
  assert.equal(out.ok, false);
  assert.deepEqual(out.missing, ['.claude/commands/wf-new-task.md']);
  assert.deepEqual(out.stale, ['.claude/commands/wf-review.md']);
  assert.deepEqual(out.orphan, ['.claude/legacy-command.md']);
});

test('generation repairs drift and is idempotent', () => {
  const dir = tmpKit();
  fs.rmSync(override(dir, '.claude/commands/wf-new-task.md'));
  assert.equal(run(dir, ['--check']).status, 1);

  const gen = run(dir);
  assert.equal(gen.status, 0, gen.stdout + gen.stderr);
  assert.match(gen.stdout, /generated \d+ host override files/);
  assert.equal(run(dir, ['--check']).status, 0);

  const again = run(dir);
  assert.equal(again.status, 0);
  assert.equal(run(dir, ['--check']).status, 0);
});
