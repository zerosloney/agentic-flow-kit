// gate-summary.test.mjs — 安装/升级后的门禁配置一览：
// 未配置必须显式说出（升级老装户尤其如此），--json 模式 stdout 不得被人类文案污染。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { scanGateConfigs } from '../src/install/gate-summary.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-gate-summary-');
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

function writeAllConfigs(dir) {
  const files = {
    '.agents/hooks/architecture-redlines.json': { forbidden: [] },
    '.agents/hooks/delete-guard.json': { scan: [] },
    '.agents/hooks/audit-fields.json': { fields: [] },
    '.agents/hooks/commit-check.config.json': { builds: [] },
    '.agents/config/product-gates.json': { gates: [] },
    '.agents/config/test-impact-map.json': { namespace: '', areas: {}, always: [], paths: [] },
    '.agents/config/local-gates.json': {},
    '.agents/config/project-faces.json': { code: ['src/'] },
  };
  for (const [rel, data] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`);
  }
}

test('scanGateConfigs classifies configured / missing / invalid', () => {
  const dir = makeTmp('flow-kit-gate-scan-');
  const empty = scanGateConfigs(dir);
  assert.deepEqual(empty.configured, []);
  assert.equal(empty.missing.length, 8);
  writeAllConfigs(dir);
  const full = scanGateConfigs(dir);
  assert.equal(full.missing.length, 0);
  assert.equal(full.configured.length, 8);
  fs.writeFileSync(path.join(dir, '.agents/hooks/delete-guard.json'), '{');
  const broken = scanGateConfigs(dir);
  assert.deepEqual(broken.invalid, ['delete-guard']);
});

test('fresh install reports unconfigured gates (node stack ships commit-check + test-impact)', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--lang', 'zh-CN', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /门禁配置：未配置 6 项/);
  assert.match(out, /architecture-redlines/);
  assert.match(out, /配置指引：\.agents\/notes\/project-configs\.md/);
});

test('dotnet profile ships faces/product-gates/commit-check/test-impact, so four are unconfigured', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'dotnet', '--lang', 'zh-CN', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /门禁配置：未配置 4 项/);
  assert.doesNotMatch(out, /未配置 4 项[^\n]*project-faces/);
});

test('upgrade reports "all configured" once configs are present, and --json stdout stays pure', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--lang', 'zh-CN', '--target', '.'], dir).status, 0);
  writeAllConfigs(dir);
  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.match(`${up.stdout}${up.stderr}`, /门禁配置：全部已配置/);

  const json = run(['upgrade', '--target', '.', '--json'], dir);
  assert.equal(json.status, 0, json.stderr);
  assert.doesNotThrow(() => JSON.parse(json.stdout), json.stdout.slice(0, 200));
  assert.match(json.stderr, /门禁配置：全部已配置/);
});
