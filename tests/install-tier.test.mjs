import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-tier-');
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

function manifest(dir) {
  return JSON.parse(read(dir, '.agents/install-manifest.json'));
}

test('standard tier installs CI but not hardened settings', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'azure-pipelines.yml')));
  assert.ok(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')));
  assert.equal(manifest(dir).tier, 'standard');
  assert.equal(manifest(dir).hardened, false);
  assert.doesNotMatch(read(dir, '.claude/settings.json'), /allowManagedPermissionRulesOnly/);
});

test('lean tier skips CI', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--tier', 'lean', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'azure-pipelines.yml')), false);
  assert.equal(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')), false);
  assert.equal(manifest(dir).tier, 'lean');
});

test('enterprise tier installs hardened settings with sandbox', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--tier', 'enterprise', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  const settings = read(dir, '.claude/settings.json');
  assert.match(settings, /allowManagedPermissionRulesOnly/);
  assert.match(settings, /sandbox/);
  assert.match(settings, /credentials/);
  assert.equal(manifest(dir).tier, 'enterprise');
  assert.equal(manifest(dir).hardened, true);
  assert.equal(fs.existsSync(path.join(dir, '.claude/settings.hardened.json')), false);
});

test('--hardened implies enterprise', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--hardened', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(manifest(dir).tier, 'enterprise');
  assert.equal(manifest(dir).hardened, true);
});

test('doctor reports the tier and does not fail on advisory gaps', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'trae', '--stack', 'node', '--target', '.'], dir).status, 0);
  const r = run(['doctor', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /tier/);
  assert.match(r.stdout, /! guarantee trae/);
});

test('enterprise tier blocks hardening:none hosts: single host hard-fails, mixed installs the rest', () => {
  // 单宿主全拒：exit 非零 + 不落 manifest
  const d1 = tmpRepo();
  const r1 = run(['install', '--agent', 'opencode', '--stack', 'node', '--tier', 'enterprise', '--target', '.'], d1);
  assert.notEqual(r1.status, 0);
  assert.match(r1.stderr, /hardening/);
  assert.equal(fs.existsSync(path.join(d1, '.agents/install-manifest.json')), false, '拒装不得落盘');
  // 混合：其余照装 + 输出列明被拒者（不静默降级）
  const d2 = tmpRepo();
  const r2 = run(['install', '--agent', 'opencode', '--agent', 'claude', '--stack', 'node', '--tier', 'enterprise', '--target', '.'], d2);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout + r2.stderr, /opencode/);
  assert.deepEqual(manifest(d2).hosts, ['claude']);
  // 常规档不受阻断
  const d3 = tmpRepo();
  assert.equal(run(['install', '--agent', 'opencode', '--stack', 'node', '--target', '.'], d3).status, 0);
});

test('enterprise blocking reads hardening levels from the registry, not host names', () => {
  const src = fs.readFileSync(path.join(KIT, 'src/commands/install.mjs'), 'utf8');
  for (const name of ['opencode', 'pi', 'cline', 'claude', 'qwen']) {
    assert.doesNotMatch(src, new RegExp(`['"]${name}['"]`), `install.mjs 不得硬编码宿主名 ${name}`);
  }
});

test('doctor warns on model drift between local config and installed agents', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--model', 'claude:code=haiku', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  const local = JSON.parse(read(dir, '.agents/config/model-roles.local.json'));
  local.roles = { ...(local.roles || {}), code: { model: 'opus' } };
  local.hosts = { ...(local.hosts || {}), claude: { ...(local.hosts?.claude || {}), code: 'opus' } };
  fs.writeFileSync(path.join(dir, '.agents/config/model-roles.local.json'), JSON.stringify(local, null, 2));
  const d = run(['doctor', '--target', '.'], dir);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /drift claude\/code/);
});

test('invalid tier fails the install', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--tier', 'huge', '--target', '.'], dir);
  assert.notEqual(r.status, 0);
  assert.match(`${r.stdout}${r.stderr}`, /tier|档位/i);
});

// issue #49：--deep 曾直读 args.deep（parseArgs 收进 flags Set），旗标从未生效——测试面与缺陷同源，此前无法区分。
test('doctor --deep actually runs check-local-gates and --fix is passed through', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'trae', '--stack', 'node', '--target', '.'], dir).status, 0);
  const plain = run(['doctor', '--target', '.'], dir);
  assert.doesNotMatch(plain.stdout, /check-local-gates/);
  const deep = run(['doctor', '--deep', '--target', '.'], dir);
  assert.match(deep.stdout, /\$ flow-kit run check-local-gates$/m);
  const fix = run(['doctor', '--deep', '--fix', '--target', '.'], dir);
  assert.match(fix.stdout, /\$ flow-kit run check-local-gates --fix$/m);
});
