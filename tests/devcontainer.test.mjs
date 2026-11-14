import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkDevcontainer } from '../src/install/devcontainer.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const JSON_REL = path.join('.devcontainer', 'devcontainer.json');
const DOCKERFILE_REL = path.join('.devcontainer', 'Dockerfile');

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
    const state = checkDevcontainer({ target: dir, stack });
    assert.equal(state.ok, true, `${stack}: ${state.problems.join('; ')}`);
  }
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

test('the CI evidence tool statically validates every stack', () => {
  const r = spawnSync(process.execPath, [path.join(KIT, 'tools', 'devcontainer-build.mjs'), '--dry-run', '--json'], {
    cwd: KIT,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.stacks, ['dotnet', 'node', 'typescript', 'rust', 'go', 'java', 'empty']);
  assert.equal(payload.results.length, 7);
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
