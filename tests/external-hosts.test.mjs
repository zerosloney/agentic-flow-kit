import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpDir(prefix = 'flow-kit-ext-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function tmpRepo() {
  const dir = tmpDir();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1', ...env },
  });
}

function json(r) {
  assert.equal(r.stdout.trim().startsWith('{'), true, `expected JSON, got: ${r.stdout.slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

function jsonArray(r) {
  assert.equal(r.stdout.trim().startsWith('['), true, `expected JSON array, got: ${r.stdout.slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

function writeHost(dir, name, def) {
  const hostsDir = path.join(dir, '.flow-kit', 'hosts');
  fs.mkdirSync(hostsDir, { recursive: true });
  const file = path.join(hostsDir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(def, null, 2), 'utf8');
  return file;
}

function writeTemplates(dir, name, files) {
  const root = path.join(dir, '.flow-kit', 'hosts', name);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
  }
  return root;
}

const DEMO = {
  name: 'demo',
  dir: '.demo',
  label: 'Demo Host',
  commands: { dir: 'commands', ext: '.md' },
  agents: { dir: 'agents', ext: '.md' },
  skills: { mode: 'index' },
  hooks: null,
};

function installDemo(dir, extra = [], env = {}) {
  return run(['install', '--agent', 'demo', '--stack', 'node', '--lang', 'zh-CN', '--target', '.', '--json', ...extra], dir, env);
}

test('external host installs commands, agents and skill index; diff/upgrade/adopt stay clean', () => {
  const dir = tmpRepo();
  writeHost(dir, 'demo', DEMO);
  writeTemplates(dir, 'demo', {
    'commands/greet.md': '# greet\n\nSay hello.\n',
    'agents/helper.md': '---\nname: helper\n---\n\nHelp out.\n',
  });

  const r = installDemo(dir);
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.deepEqual(out.hosts, ['demo']);
  assert.ok(fs.existsSync(path.join(dir, '.demo/commands/greet.md')));
  assert.ok(fs.existsSync(path.join(dir, '.demo/agents/helper.md')));
  assert.ok(fs.existsSync(path.join(dir, '.demo/commands/wf-skills.md')));

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.hosts, ['demo']);

  const hosts = jsonArray(run(['list-hosts', '--target', '.', '--json'], dir));
  const demo = hosts.find((h) => h.name === 'demo');
  assert.equal(demo.source, 'project');
  assert.equal(demo.dir, '.demo');
  assert.equal(hosts.filter((h) => h.source === 'builtin').length, 10);

  const diff = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(diff.summary.unchanged, diff.summary.total);

  const upgrade = json(run(['upgrade', '--target', '.', '--json'], dir));
  assert.deepEqual(upgrade.conflicts, []);
  assert.equal(upgrade.stats.conflict, 0);

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.summary.failed, 0, JSON.stringify(doctor.checks.filter((c) => !c.ok)));
  const source = doctor.checks.find((c) => c.name === 'host demo source');
  assert.ok(source);
  assert.match(source.detail, /project/);

  fs.rmSync(path.join(dir, '.agents/install-manifest.json'));
  const adopt = json(run(['adopt', '--target', '.', '--json'], dir));
  assert.deepEqual(adopt.hosts, ['demo']);
  assert.deepEqual(adopt.modified, []);
  const after = json(run(['diff', '--target', '.', '--json'], dir));
  assert.equal(after.summary.unchanged, after.summary.total);
});

test('priority is builtin < user < project < --host-manifest', () => {
  const project = tmpRepo();
  const home = tmpDir('flow-kit-home-');
  const env = { HOME: home, USERPROFILE: home };
  const userHosts = path.join(home, '.flow-kit', 'hosts');
  fs.mkdirSync(userHosts, { recursive: true });

  const trae = (label) => ({ name: 'trae', dir: '.trae', label, skills: { mode: 'index' } });
  fs.writeFileSync(path.join(userHosts, 'trae.json'), JSON.stringify(trae('User Trae')), 'utf8');
  writeHost(project, 'trae', trae('Project Trae'));

  const cliFile = path.join(project, 'cli-trae.json');
  fs.writeFileSync(cliFile, JSON.stringify(trae('CLI Trae')), 'utf8');

  const lookup = (args = []) => {
    const r = run(['list-hosts', '--target', '.', '--json', ...args], project, env);
    assert.equal(r.status, 0, r.stderr);
    return jsonArray(r).find((h) => h.name === 'trae');
  };

  assert.equal(lookup().label, 'Project Trae');
  assert.equal(lookup().source, 'project');

  fs.rmSync(path.join(project, '.flow-kit', 'hosts', 'trae.json'));
  assert.equal(lookup().label, 'User Trae');
  assert.equal(lookup().source, 'user');

  assert.equal(lookup(['--host-manifest', 'cli-trae.json']).label, 'CLI Trae');
  assert.equal(lookup(['--host-manifest', 'cli-trae.json']).source, 'cli');

  fs.rmSync(path.join(userHosts, 'trae.json'));
  assert.equal(lookup(['--host-manifest', 'cli-trae.json']).label, 'CLI Trae');
  assert.equal(lookup(['--host-manifest', 'cli-trae.json']).source, 'cli');

  fs.rmSync(cliFile);
  assert.equal(lookup().label, 'Trae');
  assert.equal(lookup().source, 'builtin');
});

test('--host-manifest loads a standalone definition with a sibling template tree', () => {
  const dir = tmpRepo();
  const kitDir = tmpDir('flow-kit-hosts-');
  const file = path.join(kitDir, 'acme.json');
  fs.writeFileSync(file, JSON.stringify({
    name: 'acme', dir: '.acme', commands: { dir: 'commands' }, agents: null, skills: { mode: 'index' },
  }), 'utf8');
  const tpl = path.join(kitDir, 'acme', 'commands');
  fs.mkdirSync(tpl, { recursive: true });
  fs.writeFileSync(path.join(tpl, 'run.md'), '# run\n', 'utf8');

  const r = run(['install', '--agent', 'acme', '--stack', 'node', '--target', '.', '--json', '--host-manifest', file], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.acme/commands/run.md')));
  assert.ok(fs.existsSync(path.join(dir, '.acme/commands/wf-skills.md')));
});

test('invalid host definitions fail with usage exit and a field-level detail', () => {
  const cases = [
    ['missing dir', { name: 'demo' }, /`dir`/],
    ['bad name', { name: 'Demo', dir: '.demo' }, /`name`/],
    ['unknown key', { name: 'demo', dir: '.demo', skils: { mode: 'index' } }, /unknown key `skils`/],
    ['bad skill mode', { name: 'demo', dir: '.demo', skills: { mode: 'auto' } }, /`skills.mode`/],
    ['modelField without inheritValue', { name: 'demo', dir: '.demo', agents: { dir: 'agents', modelField: 'model' } }, /inheritValue/],
    ['missing templates dir', { name: 'demo', dir: '.demo', templates: './nowhere' }, /templates/],
  ];
  for (const [label, def, pattern] of cases) {
    const dir = tmpRepo();
    writeHost(dir, 'demo', def);
    const r = installDemo(dir);
    assert.equal(r.status, 2, `${label}: ${r.stderr}`);
    assert.match(r.stderr, pattern, label);
    assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false, label);
  }

  const dir = tmpRepo();
  writeHost(dir, 'demo', DEMO);
  const file = path.join(dir, '.flow-kit', 'hosts', 'demo.json');
  fs.writeFileSync(file, '{ not json', 'utf8');
  const r = installDemo(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /invalid JSON/);
});
