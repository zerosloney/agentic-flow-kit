import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'templates',
  'engine',
  '.agents',
  'scripts',
  'check-devcontainer.mjs',
);

// 铺一个已启用容器的项目：安装 manifest 给出 stack，门禁按 FLOW_KIT_PROJECT_ROOT 读声明。
function repo(dockerfile) {
  const dir = makeTmp('flow-kit-dc-gate-');
  fs.mkdirSync(path.join(dir, '.devcontainer'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'install-manifest.json'), JSON.stringify({ stack: 'typescript' }));
  fs.writeFileSync(
    path.join(dir, '.devcontainer', 'devcontainer.json'),
    JSON.stringify({ name: 'x', build: { dockerfile: 'Dockerfile' }, forwardPorts: [3000] }),
  );
  fs.writeFileSync(path.join(dir, '.devcontainer', 'Dockerfile'), dockerfile);
  return dir;
}

function gate(dir) {
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: dir },
  });
  return { status: r.status, summary: JSON.parse(r.stdout || '{}'), stderr: r.stderr };
}

test('the runtime gate checks every stage image and rejects a root runtime stage', () => {
  const dir = repo([
    'FROM mcr.microsoft.com/devcontainers/typescript-node:22 AS build',
    'USER node',
    'ARG FLOW_KIT_VERSION=2.1.0',
    'FROM ghcr.io/evil/image:latest AS runtime',
    'USER root',
    '',
  ].join('\n'));
  const { status, summary } = gate(dir);
  assert.equal(status, 1, summary.problems?.join('; '));
  assert.equal(summary.ok, false);
  const text = summary.problems.join('; ');
  assert.match(text, /白名单[^;]*ghcr\.io\/evil\/image:latest/, text);
  assert.match(text, /浮动 tag「latest」[^;]*ghcr\.io\/evil\/image:latest/, text);
  assert.match(text, /USER root/, text);
});

test('the runtime gate compares the kit pin across stages', () => {
  const dir = repo([
    'FROM mcr.microsoft.com/devcontainers/typescript-node:22',
    'ARG FLOW_KIT_VERSION=2.1.0',
    'USER node',
    'FROM mcr.microsoft.com/devcontainers/typescript-node:22 AS runtime',
    'USER node',
    'RUN npm install -g agentic-flow-kit@9.9.9',
    '',
  ].join('\n'));
  const { status, summary } = gate(dir);
  assert.equal(status, 1, summary.problems?.join('; '));
  assert.match(summary.problems.join('; '), /版本声明不一致[^;]*2\.1\.0[^;]*9\.9\.9/);
});

test('the runtime gate keeps accepting a compliant multi-stage Dockerfile', () => {
  const dir = repo([
    'FROM mcr.microsoft.com/devcontainers/typescript-node:22 AS build',
    'ARG FLOW_KIT_VERSION=2.1.0',
    'USER node',
    'FROM build AS runtime',
    'USER node',
    '',
  ].join('\n'));
  const { status, summary } = gate(dir);
  assert.equal(status, 0, summary.problems?.join('; '));
  assert.equal(summary.ok, true);
  assert.equal(summary.kitVersion, '2.1.0');
});

// Docker 语义：FROM 引用先前 stage 时，没写 USER 的 stage 继承该 stage 的用户。
test('the runtime gate accepts a stage that inherits a non-root user', () => {
  const dir = repo([
    'FROM mcr.microsoft.com/devcontainers/typescript-node:22 AS build',
    'ARG FLOW_KIT_VERSION=2.1.0',
    'USER node',
    'FROM build AS runtime',
    '',
  ].join('\n'));
  const { status, summary } = gate(dir);
  assert.equal(status, 0, summary.problems?.join('; '));
  assert.equal(summary.ok, true);
  assert.equal(summary.kitVersion, '2.1.0');
});

test('the runtime gate rejects a stage that inherits root or switches back to it', () => {
  const explicitRoot = repo([
    'FROM mcr.microsoft.com/devcontainers/typescript-node:22 AS build',
    'ARG FLOW_KIT_VERSION=2.1.0',
    'USER node',
    'FROM build AS runtime',
    'USER root',
    '',
  ].join('\n'));
  const switched = gate(explicitRoot);
  assert.equal(switched.status, 1, switched.summary.problems?.join('; '));
  assert.match(switched.summary.problems.join('; '), /USER root/);

  const inheritedRoot = repo([
    'FROM mcr.microsoft.com/devcontainers/typescript-node:22 AS build',
    'ARG FLOW_KIT_VERSION=2.1.0',
    'USER root',
    'FROM build AS runtime',
    '',
  ].join('\n'));
  const inherited = gate(inheritedRoot);
  assert.equal(inherited.status, 1, inherited.summary.problems?.join('; '));
  assert.match(inherited.summary.problems.join('; '), /第 2 个 stage 以 root 运行/);
});

// 外部镜像的运行用户静态不可知：没有显式 USER 仍按不安全处理，不能被继承逻辑放行。
test('the runtime gate keeps rejecting external images without an explicit user', () => {
  const dir = repo([
    'FROM mcr.microsoft.com/devcontainers/typescript-node:22 AS build',
    'ARG FLOW_KIT_VERSION=2.1.0',
    'FROM mcr.microsoft.com/devcontainers/typescript-node:22 AS runtime',
    '',
  ].join('\n'));
  const { status, summary } = gate(dir);
  assert.equal(status, 1, summary.problems?.join('; '));
  const text = summary.problems.join('; ');
  assert.match(text, /第 1 个 stage 缺少 USER 指令/, text);
  assert.match(text, /第 2 个 stage 缺少 USER 指令/, text);
});
