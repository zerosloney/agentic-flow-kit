import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectStack, matchStack, STACKS } from '../src/commands/install.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-'));
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

function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel));
}

test('fresh install creates engine, host, scaffold and manifest', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);

  for (const rel of [
    '.agents/install-manifest.json',
    '.agents/commands/new-task.md',
    '.agents/config/engine.json',
    '.githooks/pre-commit',
    '.githooks/pre-push',
    '.trae/commands/wf-new-task.md',
    '.trae/agents/implementer.md',
    'AGENTS.md',
    'wiki/INDEX.md',
    'wiki/知识沉淀总览.html',
    'workflow/INDEX.md',
    'workflow/intents/_TEMPLATE.md',
    '.gitattributes',
    '.gitignore',
    'wiki/产品需求/.gitkeep',
    'wiki/项目规范/.gitkeep',
    'workflow/evidence/.gitkeep',
    'workflow/reviews.d/.gitkeep',
  ]) {
    assert.ok(exists(dir, rel), `missing ${rel}`);
  }
  assert.equal(exists(dir, '.agents/scripts'), false);
  assert.equal(exists(dir, '.agents/hooks/pre-write-check.cjs'), false);
  assert.equal(exists(dir, '.agents/hooks/gates.json'), true);

  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  assert.equal(manifest.kit, 'agentic-flow-kit');
  assert.deepEqual(manifest.hosts, ['trae']);
  assert.equal(manifest.stack, 'node');
  assert.equal(manifest.language, 'zh-CN');
  assert.ok(manifest.files['.agents/commands/new-task.md']);

  const engine = JSON.parse(read(dir, '.agents/config/engine.json'));
  assert.deepEqual(engine.options.hosts, ['trae']);
  assert.equal(engine.options.stack, 'node');
  assert.equal(engine.options.language, 'zh-CN');
});

test('add-host accepts a positional host and adds the memory file', () => {
  const dir = tmpRepo();
  const r1 = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = run(['add-host', 'claude', '--target', '.'], dir);
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(exists(dir, '.claude/settings.json'));
  assert.ok(exists(dir, '.claude/commands/wf-stages.md'));
  assert.ok(exists(dir, 'CLAUDE.md'));
  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  assert.deepEqual(manifest.hosts.sort(), ['claude', 'trae'].sort());
  assert.equal(manifest.stack, 'node', 'add-host must preserve the installed stack');
});

test('upgrade conflicts on a modified managed file and --force overwrites', () => {
  const dir = tmpRepo();
  const r1 = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r1.status, 0, r1.stderr);
  const file = path.join(dir, '.agents/commands/new-task.md');
  const original = fs.readFileSync(file, 'utf8');
  fs.appendFileSync(file, '\n<!-- user edit -->\n');

  const r2 = run(['upgrade', '--target', '.'], dir);
  assert.equal(r2.status, 0, r2.stderr);
  // 模板侧未变：升级保留用户修改，不再整文件报冲突。
  assert.match(r2.stdout, /保留用户修改/);
  assert.ok(fs.readFileSync(file, 'utf8').includes('<!-- user edit -->'));
  assert.equal(JSON.parse(read(dir, '.agents/install-manifest.json')).stack, 'node', 'upgrade must preserve the installed stack');

  const r3 = run(['upgrade', '--target', '.', '--force'], dir);
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('upgrade --stack replaces the recorded stack', () => {
  const dir = tmpRepo();
  const r1 = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = run(['upgrade', '--stack', 'rust', '--target', '.'], dir);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(JSON.parse(read(dir, '.agents/install-manifest.json')).stack, 'rust');
  assert.equal(JSON.parse(read(dir, '.agents/config/engine.json')).options.stack, 'rust');
  assert.match(read(dir, 'AGENTS.md'), /Rust 项目（Cargo）/);
});

test('dry-run writes nothing', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'trae', '--stack', 'node', '--dry-run', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!exists(dir, '.agents'));
  assert.ok(!exists(dir, 'AGENTS.md'));
});

test('doctor passes after install', () => {
  const dir = tmpRepo();
  const r1 = run(['install', '--agent', 'trae', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = run(['doctor', '--target', '.'], dir);
  assert.equal(r2.status, 0, r2.stdout);
});

test('unknown host fails with a helpful message', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'nope', '--target', '.'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown host|未知宿主/i);
});

test('invalid --model fails with a localized message and no stack trace', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--target', '.', '--model', 'bogus=x'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /无效的 --model|Invalid --model/);
  assert.ok(!r.stderr.includes('\n    at '), 'expected user error should not print a stack trace');
});

test('--track-hosts suppresses local host ignores', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'qwen', '--track-hosts', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(exists(dir, '.qwen/settings.json'));
  assert.ok(!read(dir, '.gitignore').includes('.qwen/'));
});

test('claude install writes native skills and role models', () => {
  const dir = tmpRepo();
  const r = run([
    'install', '--agent', 'claude', '--stack', 'node', '--target', '.',
    '--model', 'claude:code=haiku', '--model', 'claude:review=opus',
  ], dir);
  assert.equal(r.status, 0, r.stderr);

  const skill = read(dir, '.claude/skills/verify-ui/SKILL.md');
  assert.match(skill, /\.agents\/skills\/verify-ui\/SKILL\.md/);
  assert.match(skill, /指针壳/);
  assert.match(read(dir, '.claude/agents/implementer.md'), /^model: haiku$/m);
  assert.match(read(dir, '.claude/agents/independent-reviewer.md'), /^model: opus$/m);

  const local = JSON.parse(read(dir, '.agents/config/model-roles.local.json'));
  assert.equal(local.hosts.claude.code, 'haiku');
  assert.equal(local.hosts.claude.review, 'opus');

  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  assert.ok(manifest.files['.claude/skills/verify-ui/SKILL.md'], 'generated skill must be manifest-managed');
  assert.ok(!manifest.files['.agents/config/model-roles.local.json'], 'local model config must stay user-owned');

  const allow = JSON.parse(read(dir, '.claude/settings.json')).permissions.allow;
  assert.ok(allow.includes('Bash(npm run:*)'));
  assert.ok(!allow.some((rule) => rule.includes('dotnet') || rule.includes('cargo')));
});

test('qwen uses shared .agents skills; trae gets a skill index command', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'qwen', '--agent', 'trae', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);

  assert.ok(!exists(dir, '.qwen/skills'), 'qwen natively reads .agents/skills; do not duplicate');
  assert.ok(read(dir, '.qwen/commands/wf-skills.md').includes('.agents/skills/verify-ui/SKILL.md'));
  assert.ok(read(dir, '.trae/commands/wf-skills.md').includes('.agents/skills/verify-ui/SKILL.md'));
});

test('host order does not drop explicit models from local config', () => {
  const dir = tmpRepo();
  const r = run([
    'install', '--agent', 'trae', '--agent', 'claude', '--stack', 'node', '--target', '.',
    '--model', 'claude:code=haiku', '--model', 'claude:review=opus',
  ], dir);
  assert.equal(r.status, 0, r.stderr);
  const local = JSON.parse(read(dir, '.agents/config/model-roles.local.json'));
  assert.equal(local.roles.code.model, 'haiku');
  assert.equal(local.roles.review.model, 'opus');
  assert.equal(local.hosts.claude.code, 'haiku');
});

test('upgrade recovers models when local config is missing', () => {
  const dir = tmpRepo();
  const r1 = run([
    'install', '--agent', 'claude', '--stack', 'node', '--target', '.',
    '--model', 'claude:code=haiku', '--model', 'claude:review=opus',
  ], dir);
  assert.equal(r1.status, 0, r1.stderr);
  fs.rmSync(path.join(dir, '.agents/config/model-roles.local.json'));

  const r2 = run(['upgrade', '--target', '.'], dir);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(read(dir, '.claude/agents/implementer.md'), /^model: haiku$/m);
  assert.match(read(dir, '.claude/agents/independent-reviewer.md'), /^model: opus$/m);
});

test('--no-model-config keeps inherit and writes no local model file', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--no-model-config'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!exists(dir, '.agents/config/model-roles.local.json'));
  assert.match(read(dir, '.claude/agents/implementer.md'), /^model: inherit$/m);
});

test('--model-mode inherit resolves supported hosts to inherit', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--model-mode', 'inherit'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(dir, '.claude/agents/implementer.md'), /^model: inherit$/m);
  assert.match(read(dir, '.claude/agents/independent-reviewer.md'), /^model: inherit$/m);
});

test('detectStack reads rust, go, java and typescript markers before package.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-stack-'));
  assert.equal(detectStack(dir), 'empty');
  const write = (name) => fs.writeFileSync(path.join(dir, name), '');
  const reset = () => {
    for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true });
  };
  write('Cargo.toml');
  assert.equal(detectStack(dir), 'rust');
  reset();
  write('go.mod');
  assert.equal(detectStack(dir), 'go');
  reset();
  write('pom.xml');
  assert.equal(detectStack(dir), 'java');
  reset();
  write('build.gradle.kts');
  assert.equal(detectStack(dir), 'java');
  reset();
  write('tsconfig.json');
  write('package.json');
  assert.equal(detectStack(dir), 'typescript');
  reset();
  write('package.json');
  assert.equal(detectStack(dir), 'node');
  reset();
  write('App.csproj');
  write('Cargo.toml');
  assert.equal(detectStack(dir), 'dotnet');
  for (const stack of ['typescript', 'rust', 'go', 'java']) {
    assert.ok(STACKS.includes(stack), stack);
  }
  assert.deepEqual(matchStack(['tsconfig.json', 'package.json']), { stack: 'typescript', file: 'tsconfig.json' });
  assert.deepEqual(matchStack(['Cargo.toml', 'package.json']), { stack: 'rust', file: 'Cargo.toml' });
  assert.deepEqual(matchStack(['App.sln', 'App.csproj']), { stack: 'dotnet', file: 'App.sln' });
  assert.deepEqual(matchStack(['build.gradle.kts']), { stack: 'java', file: 'build.gradle.kts' });
  assert.deepEqual(matchStack([]), { stack: 'empty', file: null });
});

test('Cargo.toml installs the rust profile without --stack', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n');
  const r = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(read(dir, '.agents/install-manifest.json')).stack, 'rust');
  assert.equal(JSON.parse(read(dir, '.agents/config/engine.json')).options.stack, 'rust');
  assert.match(read(dir, 'AGENTS.md'), /Rust 项目（Cargo）/);
  // verify 脚本随包分发；栈差异由 runtime 读取 engine.json 决定，不再安装渲染后的副本。
  assert.equal(exists(dir, '.agents/scripts/verify.mjs'), false);
  assert.match(fs.readFileSync(path.join(KIT, 'templates/engine/.agents/scripts/verify.mjs'), 'utf8'), /cargo test/);
});

test('dry-run with --model writes no local model config', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--dry-run', '--model', 'code=haiku'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!exists(dir, '.agents'));
  assert.ok(!exists(dir, '.claude'));
});

test('git hooks parse as CommonJS inside a type: module project', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'trae', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  // 目标项目若声明 "type": "module"，无扩展名 hook 会被 Node 按 ESM 解析，require 直接崩。
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}\n');
  assert.equal(JSON.parse(read(dir, '.githooks/package.json')).type, 'commonjs');
  const check = spawnSync(process.execPath, ['--check', path.join(dir, '.githooks', 'pre-commit')], {
    cwd: dir, encoding: 'utf8',
  });
  assert.equal(check.status, 0, check.stderr);
});

test('doctor reports leftover runtime files as advisory only', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'trae', '--stack', 'node', '--target', '.'], dir).status, 0);
  fs.mkdirSync(path.join(dir, '.agents/scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents/scripts/verify.mjs'), '// legacy\n');
  const doctor = run(['doctor', '--target', '.', '--json'], dir);
  assert.equal(doctor.status, 0, doctor.stderr);
  const out = JSON.parse(doctor.stdout);
  assert.equal(out.summary.failed, 0);
  const legacy = out.checks.find((c) => c.name === 'runtime legacy');
  assert.ok(legacy);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.warn, true);
});
