import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findUserHookEntry, mergeUserHookEntry, removeUserHookEntry,
} from '../src/install/user-hooks.mjs';

const SPEC = {
  config: '~/.codex/hooks.json',
  event: 'PreToolUse',
  matcher: '^(exec_command|apply_patch)$',
  command: 'flow-kit hook codex-gate',
  timeout: 60,
};

function managedItem() {
  return { matcher: SPEC.matcher, hooks: [{ type: 'command', command: SPEC.command, timeout: SPEC.timeout }] };
}

// command 里出现 flow-kit 不等于本工具接线：只认 `flow-kit hook <id>` 形态。
test('a user hook that merely mentions flow-kit is not managed', () => {
  const userItem = {
    matcher: 'shell',
    hooks: [{ type: 'command', command: 'cd /e/other-project && npm run flow-kit-check' }],
  };
  const config = { hooks: { PreToolUse: [structuredClone(userItem)] } };

  assert.equal(mergeUserHookEntry(config, SPEC).changed, true);
  assert.deepEqual(config.hooks.PreToolUse, [managedItem(), userItem], 'user entry must survive wiring byte-identical');

  assert.equal(removeUserHookEntry(config, SPEC), true);
  assert.deepEqual(config.hooks.PreToolUse, [userItem], 'user entry must survive unwiring byte-identical');
});

test('an exact managed command is rewired in place', () => {
  const stale = { matcher: '.*', hooks: [{ type: 'command', command: SPEC.command, timeout: 1 }] };
  const config = { hooks: { PreToolUse: [stale] } };

  assert.equal(mergeUserHookEntry(config, SPEC).changed, true);
  assert.deepEqual(config.hooks.PreToolUse, [managedItem()]);
  assert.equal(findUserHookEntry(config, SPEC).matcher, SPEC.matcher);
  assert.equal(removeUserHookEntry(config, SPEC), true);
  assert.equal('hooks' in config, false);
});

test('a drifted flow-kit hook id is taken over as managed', () => {
  const drifted = { matcher: '.*', hooks: [{ type: 'command', command: 'flow-kit hook codex-guard', timeout: 60 }] };
  const config = { hooks: { PreToolUse: [drifted] } };

  assert.equal(mergeUserHookEntry(config, SPEC).changed, true);
  assert.deepEqual(config.hooks.PreToolUse, [managedItem()]);
});

test('near-miss commands are left alone', () => {
  const commands = ['flow-kit', 'flow-kit hook', 'flow-kit hookx codex-gate', 'node flow-kit hook codex-gate'];
  const items = commands.map((command) => ({ matcher: 'shell', hooks: [{ type: 'command', command }] }));
  const config = { hooks: { PreToolUse: items.map((item) => structuredClone(item)) } };

  mergeUserHookEntry(config, SPEC);
  assert.deepEqual(config.hooks.PreToolUse, [managedItem(), ...items]);
  removeUserHookEntry(config, SPEC);
  assert.deepEqual(config.hooks.PreToolUse, items);
});
