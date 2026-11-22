import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { makeT } from '../src/i18n.mjs';
import { gatherHudState, renderHudView, hudWatchLoop } from '../src/tui/hud.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const t = makeT('zh-CN');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

test('gatherHudState collects 5-panel comprehensive data', () => {
  const dir = makeTmp('flow-kit-hud-state-');

  // 初始化基础配置
  fs.mkdirSync(path.join(dir, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agents', 'config', 'model-roles.json'),
    JSON.stringify({ primary: 'claude-3-7-sonnet', worker: 'deepseek-r1', fast: 'gpt-4o-mini' }),
    'utf8'
  );

  const state = gatherHudState(dir, t);

  // 1. Engine
  assert.ok(state.engine);
  assert.equal(state.engine.models.primary, 'claude-3-7-sonnet');
  assert.equal(state.engine.models.worker, 'deepseek-r1');
  assert.equal(state.engine.models.fast, 'gpt-4o-mini');

  // 2. Gate
  assert.ok(state.gate);
  assert.equal(state.gate.passed, true);
  assert.equal(state.gate.verdict, 'APPROVED');

  // 3. Handoffs
  assert.ok(state.handoffs);
  assert.equal(state.handoffs.total, 0);
  assert.equal(state.handoffs.clean, true);

  // 4. Skills
  assert.ok(state.skills);
  assert.equal(state.skills.installedSkillsCount, 0);

  // 5. Dora
  assert.ok(state.dora);
});

test('renderHudView formats ANSI boxed panels without errors', () => {
  const dir = makeTmp('flow-kit-hud-render-');
  const state = gatherHudState(dir, t);
  const view = renderHudView(state, t);

  assert.match(view, /LIVE MULTI-AGENT & SHIELD HUD/);
  assert.match(view, /AI Engine & Model Mesh/);
  assert.match(view, /Zero-Trust Guard Rails/);
  assert.match(view, /Multi-Agent Task Mesh & Handoffs/);
  assert.match(view, /Skills Benchmark & Eval Suite/);
  assert.match(view, /AI-DORA Telemetry & Resilience/);
});

test('hudWatchLoop degrades gracefully in non-TTY mode', async () => {
  const dir = makeTmp('flow-kit-hud-watch-');
  let output = '';
  const mockOutput = {
    isTTY: false,
    write: (chunk) => {
      output += chunk;
    },
  };
  const mockInput = { isTTY: false };

  const code = await hudWatchLoop({
    target: dir,
    t,
    inputStream: mockInput,
    outputStream: mockOutput,
  });

  assert.equal(code, 0);
  assert.match(output, /LIVE MULTI-AGENT & SHIELD HUD/);
});

test('CLI flow-kit hud and status --hud integration', () => {
  const dir = makeTmp('flow-kit-hud-cli-');

  // 1. flow-kit hud snapshot
  const r1 = run(['hud', '--target', dir], dir);
  assert.equal(r1.status, 0);
  assert.match(r1.stdout, /LIVE MULTI-AGENT & SHIELD HUD/);
  assert.match(r1.stdout, /Zero-Trust Guard Rails/);

  // 2. flow-kit hud --json structured output
  const r2 = run(['hud', '--target', dir, '--json'], dir);
  assert.equal(r2.status, 0);
  const json = JSON.parse(r2.stdout);
  assert.ok(json.engine);
  assert.ok(json.gate);
  assert.ok(json.handoffs);
  assert.ok(json.skills);
  assert.ok(json.dora);
  assert.equal(json.gate.verdict, 'APPROVED');

  // 3. flow-kit status --hud delegates to HUD
  const r3 = run(['status', '--hud', '--target', dir], dir);
  assert.equal(r3.status, 0);
  assert.match(r3.stdout, /LIVE MULTI-AGENT & SHIELD HUD/);
});
