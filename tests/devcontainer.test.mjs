import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  checkDevcontainer,
  STACK_IMAGES,
  STACK_CONTAINER_USER,
  STACK_PROVISIONS_NODE,
} from '../src/install/devcontainer.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const JSON_REL = path.join('.devcontainer', 'devcontainer.json');
const DOCKERFILE_REL = path.join('.devcontainer', 'Dockerfile');
const CHECK_SCRIPT = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'check-devcontainer.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-dc-');
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

function install(dir, extra = []) {
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json', ...extra], dir);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function readDoc(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, JSON_REL), 'utf8'));
}

test('fresh install generates the devcontainer surface for the stack', () => {
  const dir = tmpRepo();
  const result = install(dir);
  assert.equal(result.devcontainer, true);
  assert.equal(fs.existsSync(path.join(dir, JSON_REL)), true);
  assert.equal(fs.existsSync(path.join(dir, DOCKERFILE_REL)), true);

  const doc = readDoc(dir);
  assert.equal(doc.build.dockerfile, 'Dockerfile');
  assert.equal(doc.build.context, '..');
  assert.deepEqual(doc.forwardPorts, [3000, 5173]);
  assert.ok(doc.name);

  const dockerfile = fs.readFileSync(path.join(dir, DOCKERFILE_REL), 'utf8');
  assert.match(dockerfile, /^FROM mcr\.microsoft\.com\/devcontainers\/typescript-node:22$/m);
  assert.match(dockerfile, /^ARG FLOW_KIT_VERSION=\d+\.\d+\.\d+$/m);
  assert.match(dockerfile, /agentic-flow-kit@\$\{FLOW_KIT_VERSION\}/);
  // 身份必须与镜像自带的非 root 用户一致：javascript-node 系镜像里是 node。
  assert.match(dockerfile, /^USER node$/m);
  assert.equal(readDoc(dir).remoteUser, 'node');

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.devcontainer, true);
  assert.ok(manifest.files[JSON_REL.split(path.sep).join('/')], 'devcontainer.json must be recorded in the manifest');
});

test('each stack picks its own base image', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'go', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const dockerfile = fs.readFileSync(path.join(dir, DOCKERFILE_REL), 'utf8');
  assert.match(dockerfile, /^FROM mcr\.microsoft\.com\/devcontainers\/go:1\.23$/m);
  assert.deepEqual(readDoc(dir).forwardPorts, [8080, 5173]);
});

test('every stack image ships the baked tooling its container needs', () => {
  // 镜像 tag 必须真实存在（上游没有 dotnet:8 这种短 tag），且容器身份/ node 供给要自洽。
  const expectations = {
    dotnet: { user: 'vscode', node: true },
    node: { user: 'node', node: false },
    typescript: { user: 'node', node: false },
    rust: { user: 'vscode', node: true },
    go: { user: 'vscode', node: true },
    java: { user: 'vscode', node: true },
    python: { user: 'vscode', node: true },
    cpp: { user: 'vscode', node: true },
    empty: { user: 'vscode', node: true },
  };
  for (const [stack, want] of Object.entries(expectations)) {
    const dir = tmpRepo();
    const r = run(['install', '--agent', 'claude', '--stack', stack, '--target', '.', '--json'], dir);
    assert.equal(r.status, 0, `${stack}: ${r.stderr}`);
    const dockerfile = fs.readFileSync(path.join(dir, DOCKERFILE_REL), 'utf8');
    assert.match(dockerfile, new RegExp(`^USER ${want.user}$`, 'm'), `${stack}: USER`);
    assert.equal(readDoc(dir).remoteUser, want.user, `${stack}: remoteUser`);
    // 镜像不烘焙 node 的栈必须补装，烘焙了的栈不该重复补装。
    assert.equal(/ARG NODE_VERSION=/.test(dockerfile), want.node, `${stack}: node provisioning`);
    if (want.node) {
      // node tarball 必须解到 /usr/local：解进子目录会让 npm 的 global bin 掉出 PATH。
      assert.match(dockerfile, /tar -xzf "\$tmp" -C \/usr\/local --strip-components=1/, `${stack}: extract to /usr/local`);
    }
    const state = checkDevcontainer({ target: dir, stack });
    assert.equal(state.ok, true, `${stack}: ${state.problems.join('; ')}`);
  }
});

// 运行时门禁脚本出于零依赖直接执行，不导出表；从源码文本解析后与生成器导出逐项对账。
function checkScriptTables() {
  const src = fs.readFileSync(CHECK_SCRIPT, 'utf8');
  const grab = (name) => {
    const m = new RegExp(`const ${name} = (\\{[\\s\\S]*?\\});`).exec(src);
    assert.ok(m, `check-devcontainer.mjs 缺少 ${name}`);
    return new Function(`"use strict"; return (${m[1]});`)();
  };
  return { images: grab('STACK_IMAGES'), users: grab('STACK_USER'), needsNode: grab('STACK_NEEDS_NODE') };
}

test('the runtime gate stack tables stay in lockstep with the generator', () => {
  const gate = checkScriptTables();
  // 镜像与容器身份必须与生成器键集合、取值逐一相同（新增栈漏配会让测试失败）。
  assert.deepEqual(gate.images, STACK_IMAGES);
  assert.deepEqual(gate.users, STACK_CONTAINER_USER);
  // 门禁把「不补装 node」表示为缺省键，因此按布尔语义对账，并禁止多出未知栈。
  for (const [stack, needs] of Object.entries(STACK_PROVISIONS_NODE)) {
    assert.equal(Boolean(gate.needsNode[stack]), needs, `${stack}: STACK_NEEDS_NODE 与生成器不一致`);
  }
  for (const stack of Object.keys(gate.needsNode)) {
    assert.ok(stack in STACK_PROVISIONS_NODE, `STACK_NEEDS_NODE 多出生成器没有的栈：${stack}`);
  }
});

test('the gate enforces the python stack image instead of silently skipping it', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'python', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);

  const ok = run(['run', 'check-devcontainer.mjs'], dir);
  assert.equal(ok.status, 0, ok.stderr);

  const dockerAbs = path.join(dir, DOCKERFILE_REL);
  const good = fs.readFileSync(dockerAbs, 'utf8');
  assert.match(good, /^FROM mcr\.microsoft\.com\/devcontainers\/python:3\.12$/m);
  // 换成同在白名单、同钉 tag 的错误镜像：只有「镜像与栈不符」能判红，
  // 证明门禁确实识别 python 栈，而不是因表缺失跳过该检查。
  fs.writeFileSync(dockerAbs, good.replace(/^FROM .+$/m, 'FROM mcr.microsoft.com/devcontainers/typescript-node:22'), 'utf8');
  const gate = run(['run', 'check-devcontainer.mjs', '--json'], dir);
  assert.equal(gate.status, 1, gate.stderr);
  const summary = JSON.parse(gate.stdout);
  assert.equal(summary.ok, false);
  assert.match(summary.problems.join('; '), /镜像与栈不符[^;]*python/);
});

test('the gate rejects a node tarball extracted outside /usr/local', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'dotnet', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const dockerAbs = path.join(dir, DOCKERFILE_REL);
  const good = fs.readFileSync(dockerAbs, 'utf8');
  const bad = good.replace('-C /usr/local --strip', '-C /usr/local/lib/nodejs/node-v22 --strip');
  fs.writeFileSync(dockerAbs, bad, 'utf8');
  const state = checkDevcontainer({ target: dir, stack: 'dotnet' });
  assert.equal(state.ok, false);
  assert.match(state.problems.join('; '), /必须解到 \/usr\/local/);
});

test('--no-devcontainer suppresses the surface and upgrade replays the choice', () => {
  const dir = tmpRepo();
  install(dir, ['--no-devcontainer']);
  assert.equal(fs.existsSync(path.join(dir, '.devcontainer')), false);
  let manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.devcontainer, false);

  const up = run(['upgrade', '--target', '.', '--json'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.devcontainer')), false, 'upgrade must not silently re-enable the container');
  manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.devcontainer, false);
});

test('upgrade keeps the generated container and refreshes the pinned kit version', () => {
  const dir = tmpRepo();
  install(dir);
  const before = fs.readFileSync(path.join(dir, DOCKERFILE_REL), 'utf8');
  const up = run(['upgrade', '--target', '.', '--json'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.equal(fs.existsSync(path.join(dir, DOCKERFILE_REL)), true);
  assert.equal(fs.readFileSync(path.join(dir, DOCKERFILE_REL), 'utf8'), before, 'same kit version must render identical bytes');
});

test('the gate enforces image allowlist, tag pinning and kit pinning', () => {
  const dir = tmpRepo();
  install(dir);
  const gate = () => run(['run', 'check-devcontainer.mjs'], dir);

  const ok = gate();
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /开发容器声明通过/);

  // 镜像越白名单 → 红
  const dockerAbs = path.join(dir, DOCKERFILE_REL);
  const original = fs.readFileSync(dockerAbs, 'utf8');
  fs.writeFileSync(dockerAbs, original.replace(/^FROM .*$/m, 'FROM evil.example.com/anything:latest'), 'utf8');
  const bad = gate();
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /白名单/);
  assert.match(bad.stderr, /浮动 tag/);
  fs.writeFileSync(dockerAbs, original, 'utf8');

  // flow-kit 未钉版本 → 红
  fs.writeFileSync(dockerAbs, original.replace(/^ARG FLOW_KIT_VERSION=.*$/m, 'ARG FLOW_KIT_VERSION=latest'), 'utf8');
  const unpinned = gate();
  assert.equal(unpinned.status, 1, unpinned.stderr);
  assert.match(unpinned.stderr, /未钉定 flow-kit 版本/);
  fs.writeFileSync(dockerAbs, original, 'utf8');

  // 容器身份写错 → 红（镜像里没这个用户，docker build 会直接失败）
  fs.writeFileSync(dockerAbs, original.replace(/^USER node$/m, 'USER vscode'), 'utf8');
  const wrongUser = gate();
  assert.equal(wrongUser.status, 1, wrongUser.stderr);
  assert.match(wrongUser.stderr, /USER 与镜像不符/);
  fs.writeFileSync(dockerAbs, original, 'utf8');

  const jsonAbs = path.join(dir, JSON_REL);
  fs.writeFileSync(jsonAbs, JSON.stringify({ ...readDoc(dir), remoteUser: 'vscode' }, null, 2));
  const wrongRemote = gate();
  assert.equal(wrongRemote.status, 1, wrongRemote.stderr);
  assert.match(wrongRemote.stderr, /remoteUser 与镜像不符/);
  fs.writeFileSync(jsonAbs, JSON.stringify(readDoc(dir), null, 2));

  // 项目未启用容器 → 大声跳过，不判红
  fs.rmSync(path.join(dir, '.devcontainer'), { recursive: true, force: true });
  const skipped = gate();
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /跳过/);
});

test('doctor reconciles the devcontainer surface', () => {
  const dir = tmpRepo();
  install(dir);
  const doctor = () => JSON.parse(run(['doctor', '--json'], dir).stdout);

  const clean = doctor();
  const dc = clean.checks.find((c) => c.name === 'devcontainer');
  assert.ok(dc, 'doctor must report a devcontainer check');
  assert.equal(dc.ok, true, JSON.stringify(dc));

  fs.rmSync(path.join(dir, DOCKERFILE_REL), { force: true });
  const broken = doctor();
  const bad = broken.checks.find((c) => c.name === 'devcontainer');
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /Dockerfile/);
});

test('flow-kit devcontainer check reports drift and build needs docker', () => {
  const dir = tmpRepo();
  install(dir);

  const ok = run(['devcontainer', 'check'], dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /开发容器声明通过/);

  const dockerAbs = path.join(dir, DOCKERFILE_REL);
  const original = fs.readFileSync(dockerAbs, 'utf8');
  fs.writeFileSync(dockerAbs, original.replace(/^FROM .*$/m, 'FROM evil.example.com/x:1'), 'utf8');
  const drift = run(['devcontainer', 'check'], dir);
  assert.equal(drift.status, 1, drift.stderr);
  assert.match(drift.stderr, /白名单/);
  fs.writeFileSync(dockerAbs, original, 'utf8');

  const asJson = run(['devcontainer', 'check', '--json'], dir);
  assert.equal(asJson.status, 0, asJson.stderr);
  const payload = JSON.parse(asJson.stdout);
  assert.equal(payload.ok, true);
  assert.match(payload.image, /^mcr\.microsoft\.com\/devcontainers\//);

  // build：docker 不在 PATH → 退出 2（环境失守，不假装构建过）
  const docker = spawnSync('docker', ['--version'], { encoding: 'utf8' });
  if (docker.error || docker.status !== 0) {
    const build = run(['devcontainer', 'build'], dir);
    assert.equal(build.status, 2, build.stderr);
    assert.match(build.stderr, /docker/);
  }
});

test('upgrade can turn the container off and on explicitly', () => {
  const dir = tmpRepo();
  install(dir);

  const off = run(['upgrade', '--target', '.', '--no-devcontainer', '--json'], dir);
  assert.equal(off.status, 0, off.stderr);
  let manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.devcontainer, false);

  const on = run(['upgrade', '--target', '.', '--devcontainer', '--json'], dir);
  assert.equal(on.status, 0, on.stderr);
  manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.devcontainer, true);
  assert.equal(fs.existsSync(path.join(dir, DOCKERFILE_REL)), true);
});

// 审查遗留批 2026-11-23：cpp 栈此前在四张表全缺失，容器内无 Node、flow-kit 全挂；这里钉死镜像、
// 身份（vscode）与 node tar 补装分支的硬断言。
test('cpp stack renders the official image with node tarball provisioning', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'cpp', '--target', '.', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const dockerfile = fs.readFileSync(path.join(dir, DOCKERFILE_REL), 'utf8');
  assert.match(dockerfile, /^FROM mcr\.microsoft\.com\/devcontainers\/cpp:1$/m);
  assert.match(dockerfile, /^USER vscode$/m);
  assert.equal(readDoc(dir).remoteUser, 'vscode');
  // 官方 cpp 镜像不烘焙 node：必须钉版本补装（ARG NODE_VERSION + nodejs.org 官方 tar + sha256 校验）。
  assert.match(dockerfile, /^ARG NODE_VERSION=\d+\.\d+\.\d+$/m);
  assert.match(dockerfile, /https:\/\/nodejs\.org\/dist\/v\d+\.\d+\.\d+\/node-v\d+\.\d+\.\d+-linux-(x64|arm64)\.tar\.gz/);
  assert.match(dockerfile, /curl -fsSL -o "\$tmp" "\$url"/);
  assert.match(dockerfile, /sha256sum -c/);
  assert.match(dockerfile, /tar -xzf "\$tmp" -C \/usr\/local --strip-components=1/);
  const state = checkDevcontainer({ target: dir, stack: 'cpp' });
  assert.equal(state.ok, true, state.problems.join('; '));
});

test('the CI evidence tool statically validates every stack', () => {
  const r = spawnSync(process.execPath, [path.join(KIT, 'tools', 'devcontainer-build.mjs'), '--dry-run', '--json'], {
    cwd: KIT,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.stacks, ['dotnet', 'node', 'typescript', 'rust', 'go', 'java', 'python', 'cpp', 'empty']);
  assert.equal(payload.results.length, 9);
  assert.equal(payload.results.every((x) => x.ok), true, JSON.stringify(payload.results));
});

test('the gate is registered in verify, policy and the mechanism registry', () => {
  const dir = tmpRepo();
  install(dir);
  const gates = run(['run', 'verify', '--list'], dir);
  assert.equal(gates.status, 0, gates.stderr);
  assert.match(gates.stdout, /devcontainer/);

  const policySrc = JSON.parse(fs.readFileSync(path.join(KIT, 'templates', 'engine', '.agents', 'config', 'policy.json'), 'utf8'));
  assert.equal(policySrc.mechanisms.required.includes('开发容器声明门'), true);

  const registry = fs.readFileSync(path.join(KIT, 'templates', 'engine', '.agents', 'config', 'mechanism-registry.md'), 'utf8');
  assert.match(registry, /开发容器声明门/);
});
