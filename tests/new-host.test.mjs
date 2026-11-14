import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-newhost-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

test('new-host generates a plugin that installs and passes doctor', () => {
  const dir = tmpRepo();
  const gen = run(['new-host', 'demo', '--out', dir, '--hooks', '--permissions', '--mcp', 'claude', '--skills', 'native'], dir);
  assert.equal(gen.status, 0, gen.stderr);

  const json = path.join(dir, '.flow-kit/hosts/demo.json');
  const definition = JSON.parse(fs.readFileSync(json, 'utf8'));
  assert.equal(definition.name, 'demo');
  assert.equal(definition.dir, '.demo');
  assert.equal(definition.hooks.events.command.form, 'cli');
  assert.equal(definition.mcp.format, 'claude');
  for (const rel of [
    '.flow-kit/hosts/demo/commands/wf-new-task.md',
    '.flow-kit/hosts/demo/agents/implementer.md',
    '.flow-kit/hosts/host-meta/demo/skill-pointer.md',
  ]) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `missing ${rel}`);
  }

  const install = run(['install', '--agent', 'demo', '--stack', 'node', '--target', dir], dir);
  assert.equal(install.status, 0, install.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.demo/commands/wf-new-task.md')));
  assert.ok(fs.existsSync(path.join(dir, '.demo/agents/implementer.md')));
  assert.ok(fs.existsSync(path.join(dir, '.demo/skills/why/SKILL.md')));
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.demo/settings.json'), 'utf8'));
  assert.ok(Array.isArray(settings.hooks?.PreToolUse) || Array.isArray(settings.hooks));
  assert.ok(Array.isArray(settings.permissions.allow) && settings.permissions.allow.includes('Bash(npm run:*)'));
  const mcp = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
  assert.ok(mcp.mcpServers['flow-kit-wiki']);

  const doctor = run(['doctor', '--target', dir, '--json'], dir);
  assert.equal(doctor.status, 0, doctor.stdout);
  const out = JSON.parse(doctor.stdout);
  assert.equal(out.summary.failed, 0);
  assert.ok(out.checks.some((check) => check.name === 'hooks demo' && check.ok));
  assert.ok(out.checks.some((check) => check.name === 'permissions demo' && check.ok));
});

test('new-host honours --model-field and --inherit', () => {
  const dir = tmpRepo();
  const gen = run([
    'new-host', 'demo', '--out', dir,
    '--model-field', 'model', '--inherit', 'inherit', '--skills', 'native',
  ], dir);
  assert.equal(gen.status, 0, gen.stderr);
  const agent = fs.readFileSync(path.join(dir, '.flow-kit/hosts/demo/agents/implementer.md'), 'utf8');
  assert.match(agent, /^model: inherit$/m);
  assert.ok(fs.existsSync(path.join(dir, '.flow-kit/hosts/host-meta/demo/skill-pointer.md')));
});

test('new-host rejects collisions and missing names', () => {
  const dir = tmpRepo();
  const missing = run(['new-host'], dir);
  assert.equal(missing.status, 2);
  const collision = run(['new-host', 'claude', '--out', dir], dir);
  assert.equal(collision.status, 2);
  assert.match(collision.stderr, /已注册|already registered/);

  assert.equal(run(['new-host', 'demo', '--out', dir], dir).status, 0);
  const again = run(['new-host', 'demo', '--out', dir], dir);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /已注册|已存在|already/);
  assert.equal(run(['new-host', 'demo', '--out', dir, '--force'], dir).status, 0);
});
