// stack-registry.test.mjs — 技术栈单一来源：注册表 = STACKS = TUI 菜单 = schema 枚举；
// 探测标记、渲染默认、宿主权限、devcontainer 映射全部由注册表派生。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STACK_ORDER,
  STACK_REGISTRY,
  stackDefaults,
  stackMarkers,
  stackNames,
  stackShell,
  devcontainerMaps,
} from '../src/install/stack-registry.mjs';
import { STACKS } from '../src/install/profiles.mjs';
import { STACK_SHELL } from '../src/render/tokens.mjs';
import { matchStack, stackMarkerLabel } from '../src/commands/install.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(KIT, rel), 'utf8'));

test('registry keys, STACKS and STACK_ORDER agree', () => {
  assert.deepEqual(stackNames(), STACK_ORDER);
  assert.deepEqual(STACKS, STACK_ORDER);
  assert.deepEqual(Object.keys(STACK_REGISTRY), STACK_ORDER);
});

test('schema enums track the registry (manifest stack/stacks and project profile)', () => {
  const manifest = readJson('schemas/install-manifest.schema.json');
  assert.deepEqual([...manifest.properties.stack.enum].sort(), [...STACK_ORDER].sort());
  assert.deepEqual([...manifest.properties.stacks.items.enum].sort(), [...STACK_ORDER].sort());
  const profile = readJson('schemas/project-profile.schema.json');
  assert.deepEqual([...profile.properties.stack.enum].sort(), [...STACK_ORDER].sort());
});

test('defaults and shell allowlists are derived from the registry', () => {
  const defaults = stackDefaults();
  assert.equal(defaults.dotnet.apiPort, 5000);
  assert.equal(defaults.dotnet.webPort, 5173);
  assert.equal(defaults.python.apiPort, 8000);
  assert.deepEqual(Object.keys(defaults), STACK_ORDER);
  assert.deepEqual(STACK_SHELL, stackShell());
  assert.deepEqual(stackShell().rust, ['cargo build', 'cargo run', 'cargo test', 'cargo check']);
});

test('markers keep priority order and match real files', () => {
  const markers = stackMarkers();
  assert.equal(markers[0].stack, 'dotnet');
  assert.equal(markers[markers.length - 1].stack, 'node');
  assert.deepEqual(matchStack(['App.sln', 'package.json']), { stack: 'dotnet', file: 'App.sln' });
  assert.deepEqual(matchStack(['Cargo.toml', 'tsconfig.json']), { stack: 'rust', file: 'Cargo.toml' });
  assert.deepEqual(matchStack(['tsconfig.json', 'package.json']), { stack: 'typescript', file: 'tsconfig.json' });
  assert.deepEqual(matchStack(['package.json']), { stack: 'node', file: 'package.json' });
  assert.deepEqual(matchStack(['unknown.txt']), { stack: 'empty', file: null });
  assert.equal(stackMarkerLabel('python'), 'pyproject.toml / requirements.txt');
});

test('devcontainer maps cover every stack with image/user/node/extensions', () => {
  const { images, users, provisionsNode, extensions } = devcontainerMaps();
  for (const stack of STACK_ORDER) {
    assert.ok(images[stack], `image for ${stack}`);
    assert.ok(users[stack], `user for ${stack}`);
    assert.equal(typeof provisionsNode[stack], 'boolean', `provisionsNode for ${stack}`);
    assert.ok(Array.isArray(extensions[stack]), `extensions for ${stack}`);
  }
  assert.equal(users.node, 'node');
  assert.equal(users.dotnet, 'vscode');
  assert.equal(provisionsNode.node, false);
  assert.equal(provisionsNode.rust, true);
});
