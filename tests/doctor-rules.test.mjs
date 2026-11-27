// doctor 规则体检：rules 汇总（layers / block·warn / 插件 / 豁免）、gate coverage（按生效规则归族）、
// 栈层漂移与插件模块缺失的 advisory。fixture = 临时 git 仓库里真实 install --stack dotnet。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadModel } from '../src/rules/load.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-doctor-rules-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, dir) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function install(dir) {
  const r = run(['install', '--agent', 'trae', '--stack', 'dotnet', '--lang', 'zh-CN', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
}

function doctor(dir, lang = 'zh-CN') {
  const r = run(['doctor', '--target', '.', '--lang', lang, '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function row(doc, name) {
  return doc.checks.find((c) => c.name === name);
}

function writeProject(dir, data) {
  fs.mkdirSync(path.join(dir, '.agents', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'rules', 'project.json'), JSON.stringify(data, null, 2));
}

const ARCH_RULE = {
  id: 'arch.no-x',
  face: 'code',
  phase: 'pre-commit',
  severity: 'block',
  assert: { kind: 'content', args: { targets: ['src/**/*.cs'], contains: ['X'] } },
  message: { zh: 'x', en: 'x' },
};

test('fresh dotnet install: rules row names legacy + stack layer, gate coverage lists unconfigured families', () => {
  const dir = tmpRepo();
  install(dir);
  const doc = doctor(dir);

  const rules = row(doc, 'rules');
  assert.ok(rules, 'rules row must exist');
  assert.match(rules.detail, /层 legacy ← stack\.dotnet/);
  assert.match(rules.detail, /条生效（共 \d+；block \d+ \/ warn \d+）/);

  const coverage = row(doc, 'gate coverage');
  assert.ok(coverage, 'gate coverage row must exist');
  assert.equal(coverage.ok, true);
  const unconfigured = coverage.detail.split('未配置（SKIP）')[1].split('·')[0];
  for (const family of ['architecture-redlines', 'delete-guard', 'audit-fields', 'local-gates']) {
    assert.ok(unconfigured.includes(family), `${family} must be listed as unconfigured: ${coverage.detail}`);
  }

  assert.equal(row(doc, 'rules stack drift'), undefined);
  assert.equal(row(doc, 'rules plugins'), undefined);

  const en = doctor(dir, 'en');
  assert.match(row(en, 'rules').detail, /^rules: \d+ active of \d+/);
  assert.match(row(en, 'gate coverage').detail, /^gate families:/);
});

test('doctor accepts _note on architecture-redlines', () => {
  const dir = tmpRepo();
  install(dir);
  fs.mkdirSync(path.join(dir, '.agents', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'hooks', 'architecture-redlines.json'), '{ "_note": "注释" }\n');
  const doc = doctor(dir);
  const gate = row(doc, 'gate architecture-redlines');
  assert.ok(gate, 'architecture-redlines row must exist');
  assert.equal(gate.ok, true);
  assert.doesNotMatch(gate.detail, /_note/);
});

test('project layer arch. rule counts as configured architecture gate and increments enabled block count', () => {
  const dir = tmpRepo();
  install(dir);
  const before = loadModel(dir).model.rules.filter((r) => r.enabled !== false && r.severity === 'block').length;

  writeProject(dir, { version: 1, rules: [ARCH_RULE] });
  const doc = doctor(dir);

  const coverage = row(doc, 'gate coverage');
  assert.match(coverage.detail.split('·')[0], /architecture-redlines/);
  const rules = row(doc, 'rules');
  assert.match(rules.detail, new RegExp(`block ${before + 1} \\/ warn`));
  assert.match(rules.detail, /层 legacy ← stack\.dotnet ← project/);
});

test('editing a kit-managed stack layer raises rules stack drift', () => {
  const dir = tmpRepo();
  install(dir);
  assert.equal(row(doctor(dir), 'rules stack drift'), undefined);

  fs.appendFileSync(path.join(dir, '.agents', 'rules', 'stack.dotnet.json'), '\n// local tweak\n', 'utf8');
  const drift = row(doctor(dir), 'rules stack drift');
  assert.ok(drift, 'rules stack drift row must exist');
  assert.equal(drift.ok, true);
  assert.equal(drift.warn, true);
  assert.match(drift.detail, /stack\.dotnet\.json/);
  assert.match(drift.detail, /project\.json/);
});

test('plugin whitelist entry without module file raises rules plugins warning', () => {
  const dir = tmpRepo();
  install(dir);
  writeProject(dir, {
    version: 1,
    rules: [],
    plugins: [{ id: 'ghost-plugin', module: 'ghost', face: 'code', phase: 'pre-commit' }],
  });

  const plugins = row(doctor(dir), 'rules plugins');
  assert.ok(plugins, 'rules plugins row must exist');
  assert.equal(plugins.ok, true);
  assert.equal(plugins.warn, true);
  assert.match(plugins.detail, /ghost-plugin/);

  fs.mkdirSync(path.join(dir, '.agents', 'rules', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'rules', 'plugins', 'ghost.mjs'), 'export default {};\n', 'utf8');
  assert.equal(row(doctor(dir), 'rules plugins'), undefined);
});

// 回归：rules check 留下的插件运行期异常由 doctor 以 advisory warn 行呈现（中英双语）。
test('recorded plugin runtime anomaly surfaces as a rules plugin runtime warn row', () => {
  const dir = tmpRepo();
  install(dir);
  assert.equal(row(doctor(dir), 'rules plugin runtime'), undefined);

  const statusPath = path.join(dir, '.agents', 'cache', 'rules-plugins.json');
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify({
    version: 1,
    results: { 'proj.x': { at: '2026-11-24T12:00:00.000Z', detail: '插件退出码 3：boom' } },
  }, null, 2));

  const zh = row(doctor(dir), 'rules plugin runtime');
  assert.ok(zh, 'rules plugin runtime row must exist');
  assert.equal(zh.ok, true);
  assert.equal(zh.warn, true);
  assert.match(zh.detail, /proj\.x/);
  assert.match(zh.detail, /boom/);

  assert.match(row(doctor(dir, 'en'), 'rules plugin runtime').detail, /^plugins failed their last evaluation/);
});
