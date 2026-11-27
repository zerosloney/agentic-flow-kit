import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'templates', 'engine', '.agents', 'scripts', 'trust-mode.mjs');

const run = (root, args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });

test('直接改写配置文件、没有审计行时 --verify 失败', () => {
  const root = makeTmp('trust-mode-direct-');
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.agents', 'trust-mode.json'),
    JSON.stringify({ enabled: true, level: 2, name: 'Trusted', enabledAt: null }, null, 2),
    'utf8',
  );

  const res = run(root, ['--verify']);
  assert.equal(res.status, 1, res.stdout || res.stderr);
  assert.match(res.stdout + res.stderr, /不一致|直接改写/);
});

test('未知配置且无审计台账时 --verify 通过', () => {
  const root = makeTmp('trust-mode-fresh-');
  const res = run(root, ['--verify']);
  assert.equal(res.status, 0, res.stdout || res.stderr);
});

test('--enable 后 --verify 通过；再手改配置则失败', () => {
  const root = makeTmp('trust-mode-chain-');
  const on = run(root, ['--enable', '--level', 'Trusted']);
  assert.equal(on.status, 0, on.stderr);
  assert.equal(run(root, ['--verify']).status, 0);

  const configPath = path.join(root, '.agents', 'trust-mode.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  fs.writeFileSync(configPath, JSON.stringify({ ...config, level: 1, name: 'Standard' }, null, 2), 'utf8');

  const bad = run(root, ['--verify']);
  assert.equal(bad.status, 1, bad.stdout || bad.stderr);
  assert.match(bad.stdout + bad.stderr, /不一致/);
});

test('审计链中间行被篡改仍报链断裂', () => {
  const root = makeTmp('trust-mode-tamper-');
  assert.equal(run(root, ['--enable', '--level', 'Standard']).status, 0);
  assert.equal(run(root, ['--enable', '--level', 'Trusted']).status, 0);

  const auditPath = path.join(root, '.agents', 'trust-mode-audit.jsonl');
  const lines = fs.readFileSync(auditPath, 'utf8').split(/\r?\n/).filter(Boolean);
  lines[0] = lines[0].replace('"level":1', '"level":2');
  fs.writeFileSync(auditPath, `${lines.join('\n')}\n`, 'utf8');

  const res = run(root, ['--verify']);
  assert.equal(res.status, 1);
  assert.match(res.stdout + res.stderr, /链断裂/);
});
