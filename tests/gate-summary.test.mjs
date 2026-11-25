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
  // 规则族门按规则层判定（与 doctor 同口径）：六族各写一条启用规则。
  const rule = (id) => ({
    id,
    face: 'code',
    phase: 'verify',
    severity: 'block',
    when: ['pkg:scripts.test'],
    assert: { kind: 'command', args: { run: 'true' } },
    message: { zh: '未通过', en: 'failed' },
  });
  const rulesAbs = path.join(dir, '.agents/rules/project.json');
  fs.mkdirSync(path.dirname(rulesAbs), { recursive: true });
  fs.writeFileSync(rulesAbs, `${JSON.stringify({
    version: 1,
    rules: ['arch.x', 'delete.x', 'audit.x', 'commit.x', 'product.x', 'local.x'].map(rule),
  }, null, 2)}\n`);

  // 非规则族门仍按文件存在性判定。
  const files = {
    '.agents/config/test-impact-map.json': { namespace: '', areas: {}, always: [], paths: [] },
    '.agents/config/project-faces.json': { code: ['src/'] },
  };
  for (const [rel, data] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`);
  }
}

function writeCommitCheck(dir, data) {
  const abs = path.join(dir, '.agents/hooks/commit-check.config.json');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`);
}

function writeNodeStackWithProductRule(dir) {
  const rel = '.agents/rules/stack.node.json';
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify({
    version: 1,
    rules: [{
      id: 'product.x',
      name: 'x',
      phase: 'verify',
      face: 'code',
      severity: 'block',
      when: ['pkg:scripts.test'],
      assert: { kind: 'command', args: { run: 'npm test' } },
      message: { zh: '未通过', en: 'failed' },
    }],
  }, null, 2)}\n`);
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
  const brokenFile = path.join(dir, '.agents/hooks/delete-guard.json');
  fs.mkdirSync(path.dirname(brokenFile), { recursive: true });
  fs.writeFileSync(brokenFile, '{');
  const broken = scanGateConfigs(dir);
  assert.deepEqual(broken.invalid, ['delete-guard']);
});

test('fresh install reports unconfigured gates (node stack ships commit-check + test-impact)', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--lang', 'zh-CN', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = `${r.stdout}${r.stderr}`;
  // node 栈规则层自带生效的 product.* 命令门 → product-gates 算已配置；
  // 随装带的 commit-check.config.json 是空清单（builds/checks 皆空）→ 与 doctor 同口径算未配置。
  assert.match(out, /门禁配置：未配置 6 项/);
  assert.match(out, /门禁配置：未配置 6 项[^\n]*commit-check/);
  assert.doesNotMatch(out, /门禁配置：未配置[^\n]*product-gates/);
  assert.match(out, /architecture-redlines/);
  assert.match(out, /配置指引：\.agents\/notes\/project-configs\.md/);
});

test('规则层有生效 product.* 命令门时 product-gates 算已配置', () => {
  const dir = makeTmp('flow-kit-gate-rule-');
  writeNodeStackWithProductRule(dir);
  const scan = scanGateConfigs(dir);
  assert.ok(scan.configured.includes('product-gates'));
  assert.equal(scan.missing.includes('product-gates'), false);
  assert.equal(scan.missing.length, 7);
});

test('project 层禁用 product.* 规则时 product-gates 仍算未配置', () => {
  const dir = makeTmp('flow-kit-gate-rule-off-');
  writeNodeStackWithProductRule(dir);
  fs.writeFileSync(
    path.join(dir, '.agents/rules/project.json'),
    `${JSON.stringify({ version: 1, rules: [{ id: 'product.x', enabled: false }] }, null, 2)}\n`,
  );
  const scan = scanGateConfigs(dir);
  assert.ok(scan.missing.includes('product-gates'));
  assert.equal(scan.configured.includes('product-gates'), false);
});

test('规则层读不了时不抛错，规则族门回退文件存在性', () => {
  const dir = makeTmp('flow-kit-gate-rule-broken-');
  fs.mkdirSync(path.join(dir, '.agents/rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents/rules/stack.node.json'), '{');
  writeCommitCheck(dir, { builds: [] });
  const scan = scanGateConfigs(dir);
  // 空清单在规则层可用时算未配置；规则层抛错时回退文件存在性 → 已配置
  assert.ok(scan.configured.includes('commit-check'));
  assert.ok(scan.missing.includes('product-gates'));
  assert.equal(scan.missing.length, 7);
});

test('commit-check：文件存在但为空清单算未配置（与 doctor 同口径）', () => {
  const dir = makeTmp('flow-kit-gate-commit-empty-');
  writeCommitCheck(dir, { builds: [], checks: [] });
  const scan = scanGateConfigs(dir);
  assert.ok(scan.missing.includes('commit-check'));
  assert.equal(scan.configured.includes('commit-check'), false);
});

test('commit-check：文件存在且清单非空算已配置', () => {
  const dir = makeTmp('flow-kit-gate-commit-full-');
  writeCommitCheck(dir, { builds: [{ command: 'npm run build' }] });
  const scan = scanGateConfigs(dir);
  assert.ok(scan.configured.includes('commit-check'));
  assert.equal(scan.missing.includes('commit-check'), false);
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
