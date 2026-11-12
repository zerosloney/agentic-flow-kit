import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOSTS,
  HOST_NAMES,
  hostTargetRel,
  isAgentTemplate,
  modelRoleForAgent,
} from '../src/hosts/registry.mjs';
import { buildVars, render } from '../src/render/tokens.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('registry covers all 10 hosts with complete, valid capabilities', () => {
  assert.equal(HOST_NAMES.length, 10);
  assert.deepEqual([...HOST_NAMES].sort(), [
    'claude', 'cline', 'codebuddy', 'commandcode', 'opencode',
    'pi', 'qoder', 'qwen', 'trae', 'zcode',
  ]);

  for (const name of HOST_NAMES) {
    const h = HOSTS[name];
    assert.ok(h.dir.startsWith('.'), `${name} dir`);
    assert.ok(h.label, `${name} label`);
    assert.ok(['native', 'shared', 'index'].includes(h.skills.mode), `${name} skills.mode`);
    if (h.skills.mode === 'native') {
      assert.ok(h.skills.dir && h.skills.file, `${name} native skill layout`);
    }
    if (h.agents.modelField) {
      assert.equal(typeof h.agents.modelField, 'string');
      assert.ok('inheritValue' in h.agents);
    }
    assert.ok(h.modelProbe, `${name} modelProbe`);
    assert.ok(Array.isArray(h.modelProbe.configs));
    assert.ok(Array.isArray(h.modelProbe.env));
    assert.ok(Array.isArray(h.modelProbe.cli));
  }

  // 已核实的 .agents 原生宿主
  assert.equal(HOSTS.qwen.skills.mode, 'shared');
  assert.equal(HOSTS.commandcode.skills.mode, 'shared');
  // 已核实的宿主原生 skills 目录
  for (const name of ['claude', 'codebuddy', 'opencode']) {
    assert.equal(HOSTS[name].skills.mode, 'native');
  }
});

test('hostTargetRel puts root memory at project root and everything else in the host dir', () => {
  assert.equal(hostTargetRel('claude', 'CLAUDE.md'), 'CLAUDE.md');
  assert.equal(hostTargetRel('claude', 'agents/implementer.md'), '.claude/agents/implementer.md');
  assert.equal(hostTargetRel('trae', 'commands/wf-new-task.md'), '.trae/commands/wf-new-task.md');
  assert.throws(() => hostTargetRel('nope', 'x'), /unknown host/);
});

test('agent templates map to model roles and respect each host extension', () => {
  assert.equal(modelRoleForAgent('agents/implementer.md'), 'code');
  assert.equal(modelRoleForAgent('agents/independent-reviewer.md'), 'review');
  assert.equal(modelRoleForAgent('agents/pr-verifier.md'), 'review');
  assert.equal(modelRoleForAgent('agents/ui-verifier.md'), 'judgment');
  assert.equal(modelRoleForAgent('agents/wiki-compiler.yml'), 'judgment');

  assert.ok(isAgentTemplate('claude', 'agents/implementer.md'));
  assert.ok(isAgentTemplate('cline', 'agents/implementer.yml'));
  assert.ok(!isAgentTemplate('cline', 'agents/implementer.md'));
  assert.ok(!isAgentTemplate('pi', 'settings.json'));
});

test('every static host agent template exists and maps to a known role', () => {
  for (const name of HOST_NAMES) {
    const h = HOSTS[name];
    if (!h.agents) continue;
    const dir = path.join(KIT, 'templates', 'hosts', name, h.agents.dir);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      assert.ok(h.agents.ext === path.extname(file), `${name}/${file} should end with ${h.agents.ext}`);
      assert.ok(['code', 'judgment', 'review'].includes(modelRoleForAgent(file)), `${name}/${file} role`);
    }
  }
});

function renderHostSettings(rel, stack) {
  const raw = fs.readFileSync(path.join(KIT, 'templates', 'hosts', rel), 'utf8');
  const vars = buildVars({
    target: 'demo',
    projectName: 'demo',
    stack,
    language: 'zh-CN',
    hosts: ['claude'],
    kitVersion: '0.0.0',
    installedAt: '2026-01-01T00:00:00.000Z',
  });
  return JSON.parse(render(raw, vars));
}

test('host allow lists follow the selected stack', () => {
  const claudeRust = renderHostSettings('claude/settings.json', 'rust').permissions.allow;
  assert.ok(claudeRust.includes('Bash(cargo build:*)'));
  assert.ok(claudeRust.includes('Bash(cargo test:*)'));
  assert.ok(claudeRust.includes('Bash(npm run:*)'));
  assert.ok(!claudeRust.some((rule) => rule.includes('dotnet')));

  const qwenGo = renderHostSettings('qwen/settings.json', 'go').permissions.allow;
  assert.ok(qwenGo.includes('Bash(go test *)'));
  assert.ok(qwenGo.includes('Bash(go build *)'));
  assert.ok(!qwenGo.some((rule) => rule.includes('dotnet')));

  const commandJava = renderHostSettings('commandcode/settings.json', 'java').permissions.allow;
  assert.ok(commandJava.includes('Shell(mvn -q test *)'));
  assert.ok(commandJava.includes('Shell(./gradlew test *)'));
  assert.ok(commandJava.includes('Shell(npm run *)'));
  assert.ok(!commandJava.some((rule) => rule.includes('dotnet')));

  const qoderNode = renderHostSettings('qoder/settings.json', 'node').permissions.allow;
  assert.ok(qoderNode.includes('Bash(npm run:*)'));
  assert.ok(!qoderNode.some((rule) => rule.includes('dotnet') || rule.includes('cargo') || rule.includes('mvn')));

  const dotnet = renderHostSettings('claude/settings.json', 'dotnet').permissions.allow;
  assert.ok(dotnet.includes('Bash(dotnet build:*)'));
  assert.ok(dotnet.includes('Bash(dotnet run:*)'));
  assert.ok(!dotnet.some((rule) => rule.includes('cargo')));

  const typescript = renderHostSettings('qoder/settings.json', 'typescript').permissions.allow;
  assert.ok(typescript.includes('Bash(npm run:*)'));
  assert.ok(!typescript.some((rule) => rule.includes('dotnet') || rule.includes('cargo')));
});
