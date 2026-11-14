import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSpdx, judgeLicense, packagesFromLockfile, packagesFromNpmLs } from '../templates/engine/.agents/scripts/sbom-license.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const SCRIPT = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'sbom-license.mjs');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-sbom-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

// 带策略配置的目标仓库：直接从包模板复制 license-policy.json（与安装落盘内容一致）。
function seededRepo() {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.agents', 'config'), { recursive: true });
  fs.copyFileSync(
    path.join(KIT, 'templates', 'engine', '.agents', 'config', 'license-policy.json'),
    path.join(dir, '.agents', 'config', 'license-policy.json'),
  );
  return dir;
}

function run(args, cwd, extraEnv = {}) {
  // runtime 入口：脚本名之后的参数经 opts.rest 原样透传；--report <dir> 用 -- 分隔避免入口误读。
  const scriptArgs = args.length ? ['--', ...args] : [];
  return spawnSync(process.execPath, [BIN, 'run', 'sbom-license', ...scriptArgs], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1', FLOW_KIT_PROJECT_ROOT: cwd, ...extraEnv },
  });
}

function writeLock(dir, packages) {
  const lock = { name: 'demo-app', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'demo-app', version: '1.0.0' } } };
  for (const [name, info] of Object.entries(packages)) {
    lock.packages[`node_modules/${name}`] = { ...info };
  }
  fs.writeFileSync(path.join(dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

test('packagesFromLockfile parses v3 flat entries and v1 nested trees', () => {
  const v3 = {
    packages: {
      '': { name: 'root', version: '1.0.0' },
      'node_modules/a': { version: '1.0.0', license: 'MIT', integrity: 'sha256-AAAA' },
      'node_modules/b': { version: '2.0.0', license: 'ISC' },
    },
  };
  const flat = packagesFromLockfile(v3);
  assert.deepEqual(flat.map((p) => `${p.name}@${p.version}`), ['a@1.0.0', 'b@2.0.0']);
  assert.equal(flat[0].license, 'MIT');

  const v1 = {
    dependencies: {
      a: { version: '1.0.0', license: 'MIT', dependencies: { nested: { version: '0.1.0', license: 'Apache-2.0' } } },
    },
  };
  const nested = packagesFromLockfile(v1);
  assert.deepEqual(nested.map((p) => p.name).sort(), ['a', 'nested']);
});

test('packagesFromNpmLs flattens the dependency tree without integrity', () => {
  const tree = { dependencies: { a: { version: '1.0.0', dependencies: { b: { version: '2.0.0' } } } } };
  const pkgs = packagesFromNpmLs(tree);
  assert.deepEqual(pkgs.map((p) => `${p.name}@${p.version}`).sort(), ['a@1.0.0', 'b@2.0.0']);
  assert.equal(pkgs[0].integrity, null);
});

test('judgeLicense: allow/deny closures, OR branches, unknown and exceptions', () => {
  const policy = {
    exceptions: { 'waived@1.0.0': '评审记录' },
    allow: ['MIT', 'ISC', 'Apache-2.0', 'CC-BY-4.0'],
    deny: ['GPL-3.0', 'AGPL-3.0-or-later'],
  };
  const cases = [
    [{ name: 'x', version: '1', license: 'MIT' }, 'allow'],
    [{ name: 'x', version: '1', license: '(MIT OR Apache-2.0)' }, 'allow'],
    [{ name: 'x', version: '1', license: '(GPL-3.0-only OR MIT)' }, 'deny'],
    [{ name: 'x', version: '1', license: 'GPL-3.0-only' }, 'deny'],
    [{ name: 'x', version: '1', license: 'AGPL-3.0-or-later' }, 'deny'],
    [{ name: 'x', version: '1', license: 'Artistic-2.0' }, 'unknown'],
    [{ name: 'x', version: '1', license: null }, 'unknown'],
    [{ name: 'x', version: '1', license: 'UNLICENSED' }, 'unknown'],
    // AND+OR 混用无法可靠平铺 → 保守 unknown，不误放行
    [{ name: 'x', version: '1', license: 'MIT AND (CC-BY-4.0 OR WTFPL)' }, 'unknown'],
    [{ name: 'waived', version: '1.0.0', license: 'GPL-3.0-only' }, 'allow'],
    [{ name: 'waived', version: '2.0.0', license: 'GPL-3.0-only' }, 'deny'],
  ];
  for (const [pkg, want] of cases) {
    assert.equal(judgeLicense(pkg, policy), want, `${pkg.name}@${pkg.version} ${pkg.license}`);
  }
});

test('buildSpdx emits SPDX-2.3 with deterministic ids and checksums', () => {
  const spdx = buildSpdx({
    rootName: 'demo-app',
    rootVersion: '1.0.0',
    packages: [{ name: 'a', version: '1.0.0', license: 'MIT', integrity: null }],
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(spdx.spdxVersion, 'SPDX-2.3');
  assert.equal(spdx.dataLicense, 'CC0-1.0');
  assert.equal(spdx.packages[0].SPDXID, 'SPDXRef-Root');
  assert.equal(spdx.packages[1].licenseConcluded, 'MIT');
  assert.equal(spdx.relationships.length, 2);
  const again = buildSpdx({ rootName: 'demo-app', rootVersion: '1.0.0', packages: [{ name: 'a', version: '1.0.0', license: 'MIT', integrity: null }], generatedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(JSON.stringify(again), JSON.stringify(spdx), 'same inputs must render identically');
});

test('missing lockfile fails closed with exit 2', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"demo-app","version":"1.0.0"}\n', 'utf8');
  const r = run([], dir);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /fail-closed/);
});

test('deny violation fails, exception waives, allow-list change heals', () => {
  const dir = seededRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"demo-app","version":"1.0.0"}\n', 'utf8');
  writeLock(dir, { 'left-pad': { version: '1.3.0', license: 'WTFPL' } });

  const bad = run([], dir);
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /left-pad@1\.3\.0/);

  const policyPath = path.join(dir, '.agents/config/license-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  policy.allow.push('WTFPL');
  fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
  const ok = run([], dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /许可证策略通过/);

  // 豁免路径：换回违规许可证 + 登记 exception
  policy.allow = policy.allow.filter((l) => l !== 'WTFPL');
  policy.exceptions = { 'left-pad@1.3.0': 'demo 豁免' };
  fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
  const waived = run([], dir);
  assert.equal(waived.status, 0, waived.stderr);

  // 豁免版本不匹配 → 仍违规
  policy.exceptions = { 'left-pad@9.9.9': '版本不匹配' };
  fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
  const notWaived = run([], dir);
  assert.equal(notWaived.status, 1, notWaived.stderr);
});

test('sbom is written, refreshed on rerun, and --check reports drift without writing', () => {
  const dir = seededRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"demo-app","version":"1.0.0"}\n', 'utf8');
  writeLock(dir, { a: { version: '1.0.0', license: 'MIT', integrity: 'sha512-AAAA' } });
  const sbomRel = path.join(dir, '.agents', 'sbom', 'spdx.json');

  const first = run([], dir);
  assert.equal(first.status, 0, first.stderr);
  const original = fs.readFileSync(sbomRel, 'utf8');
  const spdx = JSON.parse(original);
  assert.equal(spdx.spdxVersion, 'SPDX-2.3');
  assert.equal(spdx.packages.length, 2);
  assert.equal(spdx.packages[1].name, 'a');
  assert.equal(spdx.packages[1].checksums[0].algorithm, 'SHA512');

  // lockfile 变更 → --check 报漂移且不写盘
  writeLock(dir, { a: { version: '1.1.0', license: 'MIT', integrity: 'sha512-AAAA' } });
  const check = run(['--check'], dir);
  assert.equal(check.status, 1, check.stderr);
  assert.match(check.stderr, /不一致/);
  assert.equal(fs.readFileSync(sbomRel, 'utf8'), original, '--check must not rewrite the SBOM');

  // 重新生成 → --check 恢复绿
  const regen = run([], dir);
  assert.equal(regen.status, 0, regen.stderr);
  const green = run(['--check'], dir);
  assert.equal(green.status, 0, green.stderr);
  const refreshed = JSON.parse(fs.readFileSync(sbomRel, 'utf8'));
  assert.equal(refreshed.packages[1].versionInfo, '1.1.0');
});

test('unknownAction=warn with failOn=any escalates warnings to failure', () => {
  const dir = seededRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"demo-app","version":"1.0.0"}\n', 'utf8');
  writeLock(dir, { mystery: { version: '2.0.0', license: 'UNKNOWN' } });
  const policyPath = path.join(dir, '.agents/config/license-policy.json');
  const edit = (edit2) => {
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    edit2(policy);
    fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
  };

  edit((p) => { p.unknownAction = 'warn'; });
  assert.equal(run([], dir).status, 0, 'warn mode alone must pass');

  edit((p) => { p.failOn = 'any'; });
  assert.equal(run([], dir).status, 1, 'failOn=any escalates unknown to failure');
});

test('report flag archives an extra copy without changing the verdict', () => {
  const dir = seededRepo();
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"demo-app","version":"1.0.0"}\n', 'utf8');
  writeLock(dir, { a: { version: '1.0.0', license: 'MIT' } });
  const outDir = path.join(dir, 'tmp', 'sbom-artifact');
  const r = run(['--report', 'tmp/sbom-artifact'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(outDir, 'spdx.json')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, 'spdx.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'sbom', 'spdx.json'), 'utf8')));
});

test('fresh install ships the policy and the gate is wired into verify security cohort', () => {
  const dir = tmpRepo();
  const install = spawnSync(process.execPath, [BIN, 'install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(install.status, 0, install.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.agents/config/license-policy.json')), true);

  const gates = spawnSync(process.execPath, [BIN, 'run', 'verify', '--list'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(gates.status, 0, gates.stderr);
  assert.match(gates.stdout, /sbom-license/);

  const verifySrc = fs.readFileSync(path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'verify.mjs'), 'utf8');
  assert.match(verifySrc, /id: 'sbom-license', cohort: 'security'/);

  const policySrc = JSON.parse(fs.readFileSync(path.join(KIT, 'templates', 'engine', '.agents', 'config', 'policy.json'), 'utf8'));
  assert.equal(policySrc.mechanisms.required.includes('SBOM 与许可证门'), true);
});
