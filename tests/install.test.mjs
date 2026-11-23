import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectStack, matchStack, rehashDerivedArtifacts, STACKS } from '../src/commands/install.mjs';
import { sha256Text } from '../src/install/manifest.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-');
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
    'workflow/glossary.md',
    'workflow/adr/_TEMPLATE.md',
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

test('wiki board en override keeps the scaffold DATA registry', () => {
  // zh DATA 是 JSON.stringify 风格（双引号、无尾逗号）：
  // 从 `const DATA = ` 后第一个 `{` 起做大括号深度计数截取 JSON 再 parse。
  const extractData = (html) => {
    const marker = html.indexOf('const DATA = ');
    assert.ok(marker >= 0, 'missing `const DATA = ` marker');
    const begin = html.indexOf('{', marker);
    assert.ok(begin > marker, 'missing DATA object');
    let depth = 0;
    for (let i = begin; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') {
        depth--;
        if (depth === 0) return JSON.parse(html.slice(begin, i + 1));
      }
    }
    assert.fail('unbalanced braces in DATA block');
  };

  const scaffold = extractData(read(KIT, 'templates/scaffold/wiki/知识沉淀总览.html'));
  const en = extractData(read(KIT, 'locales/en/overrides/wiki/知识沉淀总览.html'));

  assert.deepEqual(en.summary, scaffold.summary);
  const namesOf = (data) => data.topics.map((t) => t.name).sort();
  assert.deepEqual(namesOf(en), namesOf(scaffold));
  for (const topic of scaffold.topics) {
    const enTopic = en.topics.find((t) => t.name === topic.name);
    const filesOf = (t) => t.files.map((f) => f.file).sort();
    assert.deepEqual(filesOf(enTopic), filesOf(topic), `topic ${topic.name} file registry drifted`);
  }

  const diskTopics = fs.readdirSync(path.join(KIT, 'templates/scaffold/wiki'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'drafts-archive')
    .map((e) => e.name);
  const dataTopics = namesOf(scaffold);
  for (const dir of diskTopics) {
    assert.ok(dataTopics.includes(dir), `board DATA missing scaffold topic dir ${dir}`);
  }
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

// 回归锁：未安装目录（无 manifest）跑 doctor 不得崩——manifest 只能经可选链访问
test('doctor on an uninstalled target reports failures without crashing', () => {
  const dir = makeTmp('flow-kit-doctor-empty-');
  const r = run(['doctor', '--target', '.'], dir);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stderr.trim(), '', 'no TypeError stack traces expected');
  assert.ok(r.stdout.includes('install-manifest'), 'doctor should report the missing manifest');
  assert.ok(r.stdout.includes('doctor 失败'), 'doctor should print its summary line');
});

// 回归锁：技能 frontmatter name 不安全时回退目录名，不得原样拼进产物路径（路径逃逸）
test('install falls back to the dir name when a skill frontmatter name is unsafe', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.agents', 'skills', 'evil'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agents', 'skills', 'evil', 'SKILL.md'),
    '---\nname: ../../escape\ndescription: evil skill\n---\nbody\n',
  );
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!exists(dir, 'escape/SKILL.md'), 'the escaped path must not be written');
  assert.ok(exists(dir, '.claude/skills/evil/SKILL.md'), 'the pointer must land at the dir-name fallback');
});

// 回归锁：Windows 非法字符 name（a:b 无法成为目录）同样回退，安装不得半途 EINVAL
test('install survives Windows-illegal skill names by falling back to the dir name', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.agents', 'skills', 'colontest'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agents', 'skills', 'colontest', 'SKILL.md'),
    '---\nname: "a:b"\ndescription: colon skill\n---\nbody\n',
  );
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(exists(dir, '.claude/skills/colontest/SKILL.md'), 'the pointer must land at the dir-name fallback');
});

// 回归锁：派生重哈希遇非 ENOENT 读错误（如 Windows EBUSY/EPERM，此处以 EISDIR 目录占位为确定性替身）
// 必须保留 manifest 记录并告警——静默除名会让升级永久 skip、uninstall 不清理。
test('rehashDerivedArtifacts keeps the manifest record and warns on non-ENOENT read errors', () => {
  const dir = makeTmp('flow-kit-rehash-');
  fs.mkdirSync(path.join(dir, '.agents', 'skills', 'occupied'), { recursive: true });
  const rel = '.agents/skills/occupied';
  const result = { written: [rel], skipRehash: [], files: { [rel]: 'hash-from-apply' } };
  const derived = new Set();
  const warns = [];
  rehashDerivedArtifacts({
    target: dir,
    result,
    derived,
    beforeDerived: { [rel]: 'hash-from-apply' },
    baselineEnabled: false,
    warn: (msg) => warns.push(msg),
  });
  assert.equal(result.files[rel], 'hash-from-apply', 'a non-ENOENT read error must not drop the manifest record');
  assert.equal(warns.length, 1, 'exactly one warning should be emitted');
  assert.ok(warns[0].includes(rel), 'the warning must name the file');
  assert.ok(warns[0].includes('EISDIR'), 'the warning must carry the error code');
  assert.equal(derived.size, 0, 'derived state must stay untouched');
});

// 锁语义：ENOENT = 生成器删了文件，manifest 记录随之删除、不告警
test('rehashDerivedArtifacts drops the record when the generator deleted the file', () => {
  const dir = makeTmp('flow-kit-rehash-');
  const rel = '.agents/workflow/INDEX.md';
  const result = { written: [rel], skipRehash: [], files: { [rel]: 'hash' } };
  const derived = new Set([rel]);
  rehashDerivedArtifacts({
    target: dir,
    result,
    derived,
    beforeDerived: { [rel]: 'hash' },
    baselineEnabled: false,
    warn: () => assert.fail('ENOENT must not warn'),
  });
  assert.ok(!(rel in result.files), 'the record must be dropped on ENOENT');
  assert.equal(derived.size, 0, 'the file must leave the derived set');
});

// 锁语义：文件在且被生成器改写 → 哈希按最终文本重算、登记 derived
test('rehashDerivedArtifacts recomputes hashes and registers generator-rewritten files', () => {
  const dir = makeTmp('flow-kit-rehash-');
  const rel = '.agents/workflow/INDEX.md';
  fs.mkdirSync(path.join(dir, '.agents', 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), 'generator-final-text');
  const result = { written: [rel], skipRehash: [], files: { [rel]: 'hash-before-generator' } };
  const derived = new Set();
  rehashDerivedArtifacts({
    target: dir,
    result,
    derived,
    beforeDerived: { [rel]: 'hash-before-generator' },
    baselineEnabled: false,
    warn: () => assert.fail('a clean read must not warn'),
  });
  assert.equal(result.files[rel], sha256Text('generator-final-text'), 'the hash must reflect the final text');
  assert.ok(derived.has(rel), 'a rewritten file must be registered as derived');
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
  // §1c 阶段装载表绑定的技能必须随包落盘，并生成宿主指针壳（BACKLOG #15 / #20）。
  const manifestFiles = JSON.parse(read(dir, '.agents/install-manifest.json')).files;
  for (const name of ['grilling', 'codebase-design', 'domain-modeling', 'wayfinder']) {
    assert.ok(exists(dir, `.agents/skills/${name}/SKILL.md`), `missing engine skill ${name}`);
    const shell = read(dir, `.claude/skills/${name}/SKILL.md`);
    assert.match(shell, new RegExp(`\\.agents/skills/${name}/SKILL\\.md`));
    assert.ok(manifestFiles[`.claude/skills/${name}/SKILL.md`], `${name} shell must be manifest-managed`);
  }
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
  const dir = makeTmp('flow-kit-stack-');
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
  write('pyproject.toml');
  assert.equal(detectStack(dir), 'python');
  reset();
  write('requirements.txt');
  assert.equal(detectStack(dir), 'python');
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
  for (const stack of ['typescript', 'rust', 'go', 'java', 'python']) {
    assert.ok(STACKS.includes(stack), stack);
  }
  assert.deepEqual(matchStack(['pyproject.toml', 'package.json']), { stack: 'python', file: 'pyproject.toml' });
  assert.deepEqual(matchStack(['requirements.txt']), { stack: 'python', file: 'requirements.txt' });
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

// issue #69：已有确认台账而未声明历史基线 → advisory warn；写入声明文件后该项消失。
test('doctor warns when the confirmation ledger exists without a history baseline declaration', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'trae', '--stack', 'node', '--target', '.'], dir).status, 0);
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents/confirmations.jsonl'), '{"ts":"2026-11-20T00:00:00.000Z"}\n', 'utf8');

  const before = run(['doctor', '--target', '.', '--json'], dir);
  assert.equal(before.status, 0, before.stderr);
  const item = JSON.parse(before.stdout).checks.find((c) => c.name === 'ledger baseline');
  assert.ok(item, 'doctor should report the missing ledger baseline declaration');
  assert.equal(item.ok, true);
  assert.equal(item.warn, true);
  assert.match(item.fix, /ledger-history-baseline\.md/);

  fs.mkdirSync(path.join(dir, '.agents/notes'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents/notes/ledger-history-baseline.md'),
    'LEDGER_HISTORY_BASELINE=0123456789abcdef0123456789abcdef01234567\n', 'utf8');
  const after = run(['doctor', '--target', '.', '--json'], dir);
  assert.equal(after.status, 0, after.stderr);
  assert.ok(!JSON.parse(after.stdout).checks.some((c) => c.name === 'ledger baseline'),
    'declared baseline must clear the advisory');
});

// ---- P2-6：--target 指向普通文件时以语义化错误拒绝，不再落到 mkdir 的裸 ENOTDIR ----

test('install rejects a plain-file --target with a semantic error', () => {
  const dir = tmpRepo();
  const fileTarget = path.join(dir, 'not-a-dir.txt');
  fs.writeFileSync(fileTarget, 'x', 'utf8');

  const r = run(['install', '--agent', 'trae', '--stack', 'node', '--lang', 'zh-CN', '--target', fileTarget], dir);
  assert.equal(r.status, 3, `expect TARGET exit code, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /不是目录/);
  assert.match(r.stderr, /not-a-dir\.txt/);
  assert.doesNotMatch(r.stderr, /ENOTDIR/);
});

// ---- issue #68：合并块幂等——块外已有条目不重复写进块，块尾不累积空行 ----

test('install dedupes engine ignore entries already present outside the merge block', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\ntmp/\n');
  const r = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);

  const gitignore = read(dir, '.gitignore');
  const tmpLines = gitignore.split('\n').filter((line) => line.trim() === 'tmp/');
  assert.equal(tmpLines.length, 1, `tmp/ must appear exactly once:\n${gitignore}`);
  assert.match(gitignore, /# >>> agentic-flow-kit ignores/);
  assert.match(gitignore, /\.agents\/\.kit\//, 'block-only entries must stay in the block');
});

// 预置两份合并文件（LF 内容）：install 经 mergeBlock 归一化为 LF 后，
// 首次 upgrade 即应双报「已是最新」且字节不变（.gitattributes 模板在 Windows 检出为 CRLF，
// 不预置时首次 upgrade 会先做一次既有的 EOL 归一化重写）。
test('upgrade reports merge files as up to date and leaves their bytes untouched', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(dir, '.gitattributes'), '*.log text\n');
  const r1 = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r1.status, 0, r1.stderr);
  const beforeIg = fs.readFileSync(path.join(dir, '.gitignore'));
  const beforeGa = fs.readFileSync(path.join(dir, '.gitattributes'));

  const r2 = run(['upgrade', '--target', '.'], dir);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /\.gitignore（已是最新）/);
  assert.match(r2.stdout, /\.gitattributes（已是最新）/);
  assert.ok(fs.readFileSync(path.join(dir, '.gitignore')).equals(beforeIg), '.gitignore bytes must stay put');
  assert.ok(fs.readFileSync(path.join(dir, '.gitattributes')).equals(beforeGa), '.gitattributes bytes must stay put');
});

// 模拟旧版本产物：块尾多一个空行（end 标记后两个换行）→ upgrade 收敛为单尾换行且不再改动
test('upgrade converges legacy trailing blank lines after the merge block', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  const r1 = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r1.status, 0, r1.stderr);
  const abs = path.join(dir, '.gitignore');
  fs.writeFileSync(abs, `${fs.readFileSync(abs, 'utf8')}\n`, 'utf8');

  const r2 = run(['upgrade', '--target', '.'], dir);
  assert.equal(r2.status, 0, r2.stderr);
  const converged = fs.readFileSync(abs, 'utf8');
  assert.ok(converged.endsWith('# <<< agentic-flow-kit ignores\n'), 'must end with a single newline after the end marker');
  assert.ok(!converged.endsWith('\n\n'), 'legacy extra blank line must be gone');

  const r3 = run(['upgrade', '--target', '.'], dir);
  assert.equal(r3.status, 0, r3.stderr);
  assert.match(r3.stdout, /\.gitignore（已是最新）/);
  assert.ok(fs.readFileSync(abs, 'utf8') === converged, 'a converged file must not change again');
});

test('diff classifies .gitignore as unchanged when user entries overlap the block', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\ntmp/\n');
  const r = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);

  const d = JSON.parse(run(['diff', '--target', '.', '--json'], dir).stdout);
  const item = d.items.find((it) => it.targetRel === '.gitignore');
  assert.ok(item, '.gitignore must be part of the diff');
  assert.equal(item.kind, 'unchanged');
  assert.equal(d.summary.kitUpdated, 0);
  assert.equal(d.summary.userModified, 0);
});

// ---- 审查遗留批 2026-11-23：旧 manifest（无 ci 字段）且从未装过 CI 文件时，upgrade 不再无条件回退
// 'both'，而是复用全新安装的 origin 探测（认不出 → none；enterprise 保持 both）。----

// 模拟旧 manifest（≤2.10，无 ci 字段）：删掉 manifest 里的 ci 字段。
function stripLegacyCiField(dir) {
  const mf = path.join(dir, '.agents', 'install-manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  delete m.ci;
  fs.writeFileSync(mf, JSON.stringify(m, null, 2), 'utf8');
}

test('upgrade of a legacy standard install without CI files keeps CI off when no origin', () => {
  const dir = tmpRepo(); // 无 origin 远端
  const r = run(['install', '--agent', 'trae', '--tier', 'standard', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(exists(dir, '.github/workflows/ci.yml'), false, 'fresh install without origin must not emit CI');
  assert.equal(exists(dir, 'azure-pipelines.yml'), false);
  stripLegacyCiField(dir);

  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  // 修复前：非 lean 一律回退 'both'，从未有 CI 的旧装会被凭空补发双份 CI 文件。
  assert.equal(exists(dir, '.github/workflows/ci.yml'), false, 'no-origin legacy install must not gain github CI');
  assert.equal(exists(dir, 'azure-pipelines.yml'), false, 'no-origin legacy install must not gain azure CI');
  assert.equal(JSON.parse(read(dir, '.agents/install-manifest.json')).ci, 'none');
});

test('upgrade of a legacy standard install adopts github CI from the origin remote', () => {
  const dir = tmpRepo();
  const remote = spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/widgets.git'], { cwd: dir });
  assert.equal(remote.status, 0, remote.stderr);
  // --ci none：github 远端下也不装 CI 文件，制造「manifest.files 无 CI 记录」的 legacy 现场，
  // 迫使 upgrade 走 origin 探测而不是 manifest.files 推导。
  const r = run(['install', '--agent', 'trae', '--tier', 'standard', '--ci', 'none', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(exists(dir, '.github/workflows/ci.yml'), false);
  stripLegacyCiField(dir);

  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.equal(exists(dir, '.github/workflows/ci.yml'), true, 'github origin must provision github CI on legacy upgrade');
  assert.equal(exists(dir, 'azure-pipelines.yml'), false, 'github origin must not provision azure CI');
  assert.equal(JSON.parse(read(dir, '.agents/install-manifest.json')).ci, 'github');
});
