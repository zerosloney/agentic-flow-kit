import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildVars, render } from '../src/render/tokens.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-stacks-');
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

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function jsonFile(dir, rel) {
  return JSON.parse(read(dir, rel));
}

function manifest(dir) {
  return jsonFile(dir, '.agents/install-manifest.json');
}

function writePackageFixture(dir) {
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 'stacks-fixture',
    scripts: { test: 'node -e 0' },
  }, null, 2)}\n`);
}

test('multi-stack install stacks profiles in order and records stacks with the primary stack', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'dotnet,typescript', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.stack, 'dotnet');
  assert.deepEqual(out.stacks, ['dotnet', 'typescript']);

  const mf = manifest(dir);
  assert.equal(mf.stack, 'dotnet');
  assert.deepEqual(mf.stacks, ['dotnet', 'typescript']);

  const engine = jsonFile(dir, '.agents/config/engine.json');
  assert.equal(engine.options.stack, 'dotnet');
  assert.deepEqual(engine.options.stacks, ['dotnet', 'typescript']);

  // typescript profile 只有 AGENTS.md；dotnet 另有独有文件，多栈安装后应全部在位。
  assert.deepEqual(fs.readdirSync(path.join(KIT, 'templates', 'profiles', 'typescript')), ['AGENTS.md']);
  assert.ok(fs.existsSync(path.join(dir, '.agents/hooks/commit-check.config.json')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/lane-surfaces.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/test-impact-map.json')));
  const vars = buildVars({
    target: dir,
    projectName: mf.projectName,
    stack: mf.stack,
    stacks: mf.stacks,
    language: mf.language,
    hosts: mf.hosts,
    kitVersion: mf.version,
    installedAt: mf.installedAt,
    trackHosts: mf.trackHosts === true,
  });
  const tsTemplate = fs.readFileSync(path.join(KIT, 'templates', 'profiles', 'typescript', 'AGENTS.md'), 'utf8');
  assert.equal(read(dir, 'AGENTS.md'), render(tsTemplate, vars));

  const profile = jsonFile(dir, '.agents/config/profile.json');
  assert.equal(profile.stack, 'dotnet');
  assert.deepEqual(profile.stacks, ['dotnet', 'typescript']);
  assert.deepEqual(profile.profiles, ['dotnet', 'typescript']);

  const diff = JSON.parse(run(['diff', '--target', '.', '--json'], dir).stdout);
  assert.equal(diff.summary.unchanged, diff.summary.total);
});

test('repeated --stack flags and comma-separated values record the same stacks', () => {
  const comma = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'dotnet,typescript', '--target', '.'], comma).status, 0);
  const repeat = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'dotnet', '--stack', 'typescript', '--target', '.'], repeat).status, 0);
  assert.deepEqual(manifest(repeat).stacks, manifest(comma).stacks);
  assert.deepEqual(manifest(repeat).stacks, ['dotnet', 'typescript']);
});

test('multi-stack permissions compile the union of the stack commands', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'dotnet,rust', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  const settings = read(dir, '.claude/settings.json');
  assert.match(settings, /Bash\(dotnet build/);
  assert.match(settings, /Bash\(cargo build/);
});

test('unknown stacks fail with usage exit and write nothing', () => {
  const dir = tmpRepo();
  const single = run(['install', '--agent', 'claude', '--stack', 'bogus', '--target', '.'], dir);
  assert.equal(single.status, 2);
  assert.match(single.stderr, /--stack/);
  assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false);

  const multi = run(['install', '--agent', 'claude', '--stack', 'dotnet,bogus', '--target', '.'], dir);
  assert.equal(multi.status, 2);
  assert.match(multi.stderr, /--stack/);
  assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false);
});

test('upgrade replays the recorded stacks and a single --stack overrides them', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'dotnet,typescript', '--target', '.'], dir).status, 0);
  const agentsBefore = read(dir, 'AGENTS.md');
  const stacksBefore = manifest(dir).stacks;

  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  const mf = manifest(dir);
  assert.deepEqual(mf.stacks, stacksBefore);
  assert.equal(mf.stack, 'dotnet');
  assert.equal(read(dir, 'AGENTS.md'), agentsBefore);

  const override = run(['upgrade', '--stack', 'rust', '--target', '.'], dir);
  assert.equal(override.status, 0, override.stderr);
  const mf2 = manifest(dir);
  assert.equal(mf2.stack, 'rust');
  assert.equal('stacks' in mf2, false);
  assert.match(read(dir, 'AGENTS.md'), /Rust 项目（Cargo）/);
});

test('doctor validates the multi-stack composition record', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'dotnet,typescript', '--target', '.'], dir).status, 0);
  const doctor = run(['doctor', '--target', '.'], dir);
  assert.equal(doctor.status, 0, `${doctor.stdout}${doctor.stderr}`);
  assert.match(doctor.stdout, /dotnet\+typescript/);
});

test('verify gates follow the union of the declared stacks', () => {
  const multi = tmpRepo();
  writePackageFixture(multi);
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'dotnet,node', '--target', '.'], multi).status, 0);
  const gates = run(['run', 'verify', '--list'], multi);
  assert.equal(gates.status, 0, gates.stderr);
  assert.match(gates.stdout, /backend-build/);
  assert.match(gates.stdout, /node-test/);

  const single = tmpRepo();
  writePackageFixture(single);
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'typescript', '--target', '.'], single).status, 0);
  const tsGates = run(['run', 'verify', '--list'], single);
  assert.equal(tsGates.status, 0, tsGates.stderr);
  assert.match(tsGates.stdout, /node-test/);
  assert.doesNotMatch(tsGates.stdout, /backend-/);
});

test('python profile installs governance configs and activates pytest gate', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[tool.pytest]\n');
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'python', '--target', '.'], dir).status, 0);

  assert.ok(fs.existsSync(path.join(dir, '.agents/config/lane-surfaces.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/rule-budgets.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/test-impact-map.json')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/workflow-modules.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/hooks/commit-check.config.json')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/hooks/delete-guard-allowlist.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/notes/runtime-env.md')));

  const env = read(dir, '.agents/notes/runtime-env.md');
  assert.match(env, /8000/);
  assert.match(env, /uvicorn|pytest/);

  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /8000/);
  assert.match(agents, /Python 项目/);

  const gates = run(['run', 'verify', '--list'], dir);
  assert.equal(gates.status, 0, gates.stderr);
  assert.match(gates.stdout, /pytest/);
});

test('go profile installs governance configs and activates go-test gate', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/test\n\ngo 1.23\n');
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'go', '--target', '.'], dir).status, 0);

  assert.ok(fs.existsSync(path.join(dir, '.agents/config/lane-surfaces.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/rule-budgets.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/test-impact-map.json')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/workflow-modules.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/hooks/commit-check.config.json')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/hooks/delete-guard-allowlist.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/notes/runtime-env.md')));

  const env = read(dir, '.agents/notes/runtime-env.md');
  assert.match(env, /8080/);
  assert.match(env, /go run/);

  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /8080/);
  assert.match(agents, /Go 项目/);

  const gates = run(['run', 'verify', '--list'], dir);
  assert.equal(gates.status, 0, gates.stderr);
  assert.match(gates.stdout, /go-test/);
});

test('java profile installs governance configs and activates maven/gradle gates', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'pom.xml'), '<project></project>\n');
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'java', '--target', '.'], dir).status, 0);

  assert.ok(fs.existsSync(path.join(dir, '.agents/config/lane-surfaces.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/rule-budgets.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/test-impact-map.json')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/workflow-modules.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/hooks/commit-check.config.json')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/hooks/delete-guard-allowlist.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/notes/runtime-env.md')));

  const env = read(dir, '.agents/notes/runtime-env.md');
  assert.match(env, /8080/);
  assert.match(env, /mvn|gradle/);

  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /8080/);
  assert.match(agents, /Java 项目/);

  const gates = run(['run', 'verify', '--list'], dir);
  assert.equal(gates.status, 0, gates.stderr);
  assert.match(gates.stdout, /maven-test/);
});

test('cpp profile installs governance configs and activates ctest gate', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.10)\n');
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'cpp', '--target', '.'], dir).status, 0);

  assert.ok(fs.existsSync(path.join(dir, '.agents/config/lane-surfaces.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/rule-budgets.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/test-impact-map.json')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/config/workflow-modules.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/hooks/commit-check.config.json')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/hooks/delete-guard-allowlist.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.agents/notes/runtime-env.md')));

  const env = read(dir, '.agents/notes/runtime-env.md');
  assert.match(env, /8080/);
  assert.match(env, /cmake|ctest/);

  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /8080/);
  assert.match(agents, /C \/ C\+\+ 项目/);

  const gates = run(['run', 'verify', '--list'], dir);
  assert.equal(gates.status, 0, gates.stderr);
  assert.match(gates.stdout, /ctest/);
});

test('cpp profile auto-detection and make-test fallback', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'Makefile'), 'test:\n\t@echo ok\n');
  const r = run(['install', '--agent', 'claude', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.stack, 'cpp');

  const gates = run(['run', 'verify', '--list'], dir);
  assert.equal(gates.status, 0, gates.stderr);
  assert.match(gates.stdout, /make-test/);
});
