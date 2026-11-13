import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compilePermissions, parsePermissionSpec } from '../src/install/permissions.mjs';
import { HOSTS } from '../src/hosts/registry.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-perm-'));
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

function json(r) {
  assert.equal(r.stdout.trim().startsWith('{'), true, `expected JSON, got: ${r.stdout.slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

function install(dir, host, extra = []) {
  return run(['install', '--agent', host, '--stack', 'node', '--target', '.', '--json', ...extra], dir);
}

function spec() {
  return parsePermissionSpec(fs.readFileSync(path.join(KIT, 'templates/engine/.agents/hooks/gates.json'), 'utf8'));
}

function settingsRel(host) {
  return `${HOSTS[host].dir}/${HOSTS[host].hooks.file}`;
}

function readPermissions(host, dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, settingsRel(host)), 'utf8')).permissions;
}

test('golden: gates.json compiles to the verified host permission syntax', () => {
  const parsed = spec();
  const claude = compilePermissions(parsed, HOSTS.claude.permissions, { stack: 'dotnet' });
  assert.deepEqual(claude.unsupported, []);
  assert.deepEqual(claude.allow, [
    'Bash(dotnet build:*)',
    'Bash(dotnet run:*)',
    'Bash(npm run:*)',
    'Bash(npm install:*)',
    'Bash(npm ci:*)',
    'Bash(node:*)',
    'Bash(git status:*)',
    'Bash(git diff:*)',
    'Bash(git add:*)',
    'Bash(git commit:*)',
    'Bash(git log:*)',
    'Bash(git push:*)',
    'Bash(chrome:*)',
  ]);
  assert.deepEqual(claude.deny, [
    'Bash(dotnet ef:*)',
    'Bash(git reset --hard:*)',
    'Bash(git push --force:*)',
    'Bash(git push -f:*)',
    'Bash(drop database:*)',
    'Bash(* --no-verify*)',
  ]);
  assert.deepEqual(claude.ask, [
    'Bash(git checkout:*)',
    'Bash(git clean:*)',
    'Bash(git branch -D:*)',
    'Bash(rm -rf:*)',
  ]);
  // 与 gates.json 对账：每条 deny / ask 都在编译结果里。
  for (const entry of [...parsed.deny, ...parsed.ask]) {
    const compiled = entry.tool === 'shell' ? `Bash(${entry.pat.includes('*') ? entry.pat : `${entry.pat}:*`})` : null;
    if (compiled) assert.ok([...claude.deny, ...claude.ask].includes(compiled), entry.pat);
  }

  const qwen = compilePermissions(parsed, HOSTS.qwen.permissions, { stack: 'dotnet' });
  assert.equal(qwen.deny[0], 'Bash(dotnet ef *)');
  assert.ok(qwen.allow.includes('Bash(dotnet build *)'));
  assert.ok(qwen.allow.includes('Bash(dir *)'));

  const commandcode = compilePermissions(parsed, HOSTS.commandcode.permissions, { stack: 'rust' });
  assert.ok(commandcode.allow.includes('Shell(cargo build *)'));
  assert.equal(commandcode.deny[1], 'Shell(git reset --hard *)');
});

test('installed permissions exactly match the compiled spec and stay idempotent', () => {
  const dir = tmpRepo();
  for (const host of ['claude', 'qwen', 'qoder', 'commandcode']) {
    const r = install(dir, host);
    assert.equal(r.status, 0, `${host}: ${r.stderr}`);
  }
  const parsed = spec();
  for (const host of ['claude', 'qwen', 'qoder', 'commandcode']) {
    const compiled = compilePermissions(parsed, HOSTS[host].permissions, { stack: 'node' });
    const actual = readPermissions(host, dir);
    assert.deepEqual(actual.allow, compiled.allow, `${host} allow`);
    assert.deepEqual(actual.deny, compiled.deny, `${host} deny`);
    assert.deepEqual(actual.ask, compiled.ask, `${host} ask`);
  }

  const files = ['claude', 'qwen'].map((host) => path.join(dir, settingsRel(host)));
  const before = files.map((file) => fs.readFileSync(file, 'utf8'));
  assert.equal(run(['upgrade', '--target', '.', '--json'], dir).status, 0);
  files.forEach((file, index) => assert.equal(fs.readFileSync(file, 'utf8'), before[index]));

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.summary.failed, 0, JSON.stringify(doctor.checks.filter((c) => !c.ok)));
  for (const host of ['claude', 'qwen', 'qoder', 'commandcode']) {
    assert.equal(doctor.checks.find((c) => c.name === `permissions ${host}`).ok, true, host);
  }
});

test('hardened uses the same compiler and keeps Claude managed-only keys', () => {
  const dir = tmpRepo();
  const r = install(dir, 'claude', ['--hardened']);
  assert.equal(r.status, 0, r.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(dir, settingsRel('claude')), 'utf8'));
  const compiled = compilePermissions(spec(), HOSTS.claude.permissions, { stack: 'node', hardened: true });
  assert.deepEqual(config.permissions.deny, compiled.deny);
  assert.ok(config.permissions.deny.includes('Read(.env*)'));
  assert.ok(config.permissions.deny.includes('WebFetch'));
  assert.ok(config.permissions.deny.includes('Bash(curl *)'));
  assert.equal(config.permissions.disableBypassPermissionsMode, 'disable');
  assert.equal(config.allowManagedPermissionRulesOnly, true);
  assert.equal(config.sandbox.enabled, true);

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.summary.failed, 0);
  assert.equal(doctor.checks.find((c) => c.name === 'permissions claude').ok, true);
});

test('unsupported tool classes degrade with an advisory instead of disappearing silently', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'qwen', ['--hardened']).status, 0);
  assert.equal(install(dir, 'codebuddy', ['--hardened']).status, 0);

  const qwen = readPermissions('qwen', dir);
  assert.ok(qwen.deny.includes('Bash(curl *)'));
  assert.equal(qwen.deny.some((item) => item.startsWith('Read(')), false);

  const doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.summary.failed, 0);
  const unsupported = doctor.checks.find((c) => c.name === 'permissions qwen unsupported');
  assert.ok(unsupported);
  assert.equal(unsupported.warn, true);
  assert.match(unsupported.detail, /read:\.env\*/);
  assert.match(unsupported.detail, /web:WebFetch/);

  const gap = doctor.checks.find((c) => c.name === 'guarantee codebuddy'
    && c.detail.includes('permissions'));
  assert.ok(gap);
  assert.equal(gap.warn, true);
});

test('user permissions survive; doctor flags missing managed rules and stale wiring', () => {
  const dir = tmpRepo();
  assert.equal(install(dir, 'claude').status, 0);
  const rel = settingsRel('claude');
  const file = path.join(dir, rel);

  // 用户自建条目保留，且不计为漂移。
  let config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.permissions.allow.push('Bash(custom:*)');
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  assert.equal(run(['upgrade', '--target', '.', '--json'], dir).status, 0);
  config = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(config.permissions.allow.includes('Bash(custom:*)'));
  let doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  assert.equal(doctor.checks.find((c) => c.name === 'permissions claude').ok, true);

  // 托管项缺失 → doctor 失败，upgrade 对齐。
  config.permissions.deny = config.permissions.deny.filter((item) => item !== 'Bash(drop database:*)');
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  let check = doctor.checks.find((c) => c.name === 'permissions claude');
  assert.equal(check.ok, false);
  assert.match(check.detail, /missing/);
  assert.match(check.detail, /drop database/);

  // 上次托管但本次不再编译的条目 → stale。
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.agents/install-manifest.json'), 'utf8'));
  manifest.managedPermissions[rel].deny.push('Bash(stale:*)');
  fs.writeFileSync(path.join(dir, '.agents/install-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const withStale = JSON.parse(fs.readFileSync(file, 'utf8'));
  withStale.permissions.deny.push('Bash(stale:*)');
  fs.writeFileSync(file, `${JSON.stringify(withStale, null, 2)}\n`, 'utf8');
  doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  check = doctor.checks.find((c) => c.name === 'permissions claude');
  assert.equal(check.ok, false);
  assert.match(check.detail, /stale/);

  assert.equal(run(['upgrade', '--target', '.', '--json'], dir).status, 0);
  doctor = json(run(['doctor', '--target', '.', '--json'], dir));
  check = doctor.checks.find((c) => c.name === 'permissions claude');
  assert.equal(check.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).permissions.deny.includes('Bash(stale:*)'), false);
});
