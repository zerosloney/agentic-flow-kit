import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveRuntimeHook, resolveRuntimeRoot, resolveRuntimeScript } from '../src/commands/runtime.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-runtime-'));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
  return dir;
}

function installTarget() {
  const dir = tmpRepo();
  const r = spawnSync(process.execPath, [BIN, 'install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

function cli(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    input,
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

test('runtime root walks up to the nearest .agents project', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  const nested = path.join(dir, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(resolveRuntimeRoot({ cwd: nested, env: {} }), dir);
  assert.equal(resolveRuntimeRoot({ root: dir, env: {} }), dir);
  assert.throws(
    () => resolveRuntimeRoot({ root: path.join(dir, 'missing'), env: {} }),
    (error) => error.code === 'TARGET_MISSING',
  );
});

test('runtime script resolution rejects traversal and unknown names', () => {
  assert.match(resolveRuntimeScript('check-loop'), /check-loop\.mjs$/);
  assert.match(resolveRuntimeHook('pre-shell-check'), /pre-shell-check\.cjs$/);
  assert.throws(() => resolveRuntimeScript('../package'), (error) => error.code === 'UNKNOWN_SCRIPT');
  assert.throws(() => resolveRuntimeScript('no-such-script'), (error) => error.code === 'UNKNOWN_SCRIPT');
  assert.throws(() => resolveRuntimeHook('no-such-hook'), (error) => error.code === 'UNKNOWN_HOOK');
});

test('run and hook --list expose package runtime entries', () => {
  const run = cli(KIT, ['run', '--list']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^check-loop$/m);
  assert.match(run.stdout, /^gen-engine-map$/m);

  const hook = cli(KIT, ['hook', '--list']);
  assert.equal(hook.status, 0, hook.stderr);
  assert.match(hook.stdout, /^pre-write-check$/m);
  assert.match(hook.stdout, /^pre-shell-check$/m);
});

test('run executes from the package against the project root found from cwd', () => {
  const dir = installTarget();
  const nested = path.join(dir, 'nested', 'deeper');
  fs.mkdirSync(nested, { recursive: true });

  const r = cli(nested, ['run', 'gen-engine-map']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.agents', 'notes', 'engine-map.md')), true);
  // 不得在包目录里生成项目工件。
  assert.equal(fs.existsSync(path.join(KIT, '.agents', 'notes', 'engine-map.md')), false);
});

test('hook dispatch reads the project gates and honors stdin', () => {
  const dir = installTarget();
  const input = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'git reset --hard HEAD' },
    cwd: dir,
  });
  const r = cli(dir, ['hook', '--root', dir, 'pre-shell-check'], input);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('unknown or missing runtime entries fail with usage exit code', () => {
  assert.equal(cli(KIT, ['run']).status, 2);
  assert.equal(cli(KIT, ['run', 'no-such-script']).status, 2);
  assert.equal(cli(KIT, ['hook', 'no-such-hook']).status, 2);
  const bad = cli(KIT, ['run', 'no-such-script']);
  assert.match(bad.stderr, /unknown runtime script/);
});
