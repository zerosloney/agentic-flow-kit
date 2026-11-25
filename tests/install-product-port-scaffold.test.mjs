// install-product-port-scaffold.test.mjs — 项目形态 / 端口 / 脚手架档位（G5/G6/G12）：
// 显式参数写入 manifest 与 engine.json、渲染到 AGENTS.md（{{productNote}}）、升级重放；
// 非法值 usage 错误；--scaffold 裁剪脚手架面。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-shape-');
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

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const manifest = (dir) => JSON.parse(read(dir, '.agents/install-manifest.json'));

test('product / ports render into AGENTS.md and are recorded in manifest + engine.json', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--product', 'api', '--api-port', '9999', '--web-port', '8888', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);

  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /仅 API 服务（端口 9999）/);
  assert.match(agents, /9999/);
  assert.doesNotMatch(agents, /\{\{productNote\}\}/);

  const mf = manifest(dir);
  assert.equal(mf.product, 'api');
  assert.deepEqual(mf.ports, { api: 9999, web: 8888 });

  const engine = JSON.parse(read(dir, '.agents/config/engine.json'));
  assert.equal(engine.options.product, 'api');
  assert.deepEqual(engine.options.ports, { api: 9999, web: 8888 });
});

test('default product is web and default ports come from the stack registry', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], dir).status, 0);
  assert.match(read(dir, 'AGENTS.md'), /前端 dev 5173 连 API http:\/\/localhost:3000/);
  const mf = manifest(dir);
  assert.equal(mf.product, 'web');
  assert.equal('ports' in mf, false);
});

test('library / cli product notes replace the web topology line (zh + en)', () => {
  const zh = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'rust', '--product', 'library', '--target', '.'], zh).status, 0);
  const zhAgents = read(zh, 'AGENTS.md');
  assert.match(zhAgents, /库\/包项目/);
  assert.doesNotMatch(zhAgents, /前端 dev/);

  const en = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'rust', '--product', 'cli', '--lang', 'en', '--target', '.'], en).status, 0);
  const enAgents = read(en, 'AGENTS.md');
  assert.match(enAgents, /CLI tool project/);
  assert.doesNotMatch(enAgents, /Frontend dev server/);
});

test('upgrade replays product / ports / scaffold choices', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'python', '--product', 'library', '--api-port', '7777', '--scaffold', 'minimal', '--target', '.'], dir).status, 0);
  const agentsBefore = read(dir, 'AGENTS.md');
  const mfBefore = manifest(dir);

  const up = run(['upgrade', '--target', '.'], dir);
  assert.equal(up.status, 0, up.stderr);
  assert.equal(read(dir, 'AGENTS.md'), agentsBefore);
  const mf = manifest(dir);
  assert.equal(mf.product, mfBefore.product);
  assert.deepEqual(mf.ports, mfBefore.ports);
  assert.equal(mf.scaffold, 'minimal');
});

test('scaffold tiers: none drops scaffold, minimal keeps only wiki/INDEX.md', () => {
  const none = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--scaffold', 'none', '--target', '.'], none).status, 0);
  assert.equal(fs.existsSync(path.join(none, 'workflow')), false);
  assert.equal(fs.existsSync(path.join(none, 'wiki')), false);
  assert.equal(manifest(none).scaffold, 'none');

  const minimal = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--scaffold', 'minimal', '--target', '.'], minimal).status, 0);
  assert.ok(fs.existsSync(path.join(minimal, 'workflow')));
  assert.ok(fs.existsSync(path.join(minimal, 'wiki/INDEX.md')));
  assert.equal(fs.existsSync(path.join(minimal, 'wiki/产品需求')), false);

  const full = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], full).status, 0);
  assert.ok(fs.existsSync(path.join(full, 'wiki/产品需求')));
  assert.equal('scaffold' in manifest(full), false);
});

test('invalid product / port / scaffold fail with usage errors and write nothing', () => {
  const dir = tmpRepo();
  const badProduct = run(['install', '--agent', 'claude', '--stack', 'node', '--product', 'bogus', '--target', '.'], dir);
  assert.equal(badProduct.status, 2);
  assert.match(badProduct.stderr, /--product/);
  assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false);

  const badPort = run(['install', '--agent', 'claude', '--stack', 'node', '--api-port', '0', '--target', '.'], dir);
  assert.equal(badPort.status, 2);
  assert.match(badPort.stderr, /--api-port/);

  const badScaffold = run(['install', '--agent', 'claude', '--stack', 'node', '--scaffold', 'bogus', '--target', '.'], dir);
  assert.equal(badScaffold.status, 2);
  assert.match(badScaffold.stderr, /--scaffold/);
  assert.equal(fs.existsSync(path.join(dir, '.agents/install-manifest.json')), false);
});

test('monorepo product renders into AGENTS.md and is recorded in manifest + engine.json (zh + en)', () => {
  const zh = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--product', 'monorepo', '--target', '.'], zh).status, 0);
  const zhAgents = read(zh, 'AGENTS.md');
  assert.match(zhAgents, /Monorepo 工作区：多包\/多应用项目/);
  assert.doesNotMatch(zhAgents, /前端 dev/);
  const zhMf = manifest(zh);
  assert.equal(zhMf.product, 'monorepo');
  const zhEngine = JSON.parse(read(zh, '.agents/config/engine.json'));
  assert.equal(zhEngine.options.product, 'monorepo');

  const en = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--product', 'monorepo', '--lang', 'en', '--target', '.'], en).status, 0);
  const enAgents = read(en, 'AGENTS.md');
  assert.match(enAgents, /Monorepo workspace: multi-package\/multi-app project/);
  assert.doesNotMatch(enAgents, /Frontend dev server/);

  // upgrade replays monorepo
  const up = run(['upgrade', '--target', '.'], zh);
  assert.equal(up.status, 0, up.stderr);
  assert.equal(manifest(zh).product, 'monorepo');
});

test('product-detect automatically detects product mode on install when --product omitted', () => {
  const monoDir = tmpRepo();
  fs.writeFileSync(path.join(monoDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], monoDir).status, 0);
  assert.equal(manifest(monoDir).product, 'monorepo');

  const cliDir = tmpRepo();
  fs.writeFileSync(path.join(cliDir, 'package.json'), JSON.stringify({ name: 'my-cli', bin: './cli.mjs' }));
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], cliDir).status, 0);
  assert.equal(manifest(cliDir).product, 'cli');
});

test('auto-detected product mode is announced unless --product is explicit', () => {
  const detectDir = tmpRepo();
  fs.writeFileSync(path.join(detectDir, 'package.json'), JSON.stringify({ name: 'web-app', dependencies: { react: '^18.0.0' } }));
  const auto = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], detectDir);
  assert.equal(auto.status, 0, auto.stderr);
  assert.match(auto.stdout, /产品形态：web（自动探测，依据：/);
  assert.equal(manifest(detectDir).product, 'web');

  const explicitDir = tmpRepo();
  fs.writeFileSync(path.join(explicitDir, 'package.json'), JSON.stringify({ name: 'web-app', dependencies: { react: '^18.0.0' } }));
  const forced = run(['install', '--agent', 'claude', '--stack', 'node', '--product', 'api', '--target', '.'], explicitDir);
  assert.equal(forced.status, 0, forced.stderr);
  assert.doesNotMatch(forced.stdout, /自动探测/);
  assert.equal(manifest(explicitDir).product, 'api');

  // 空项目探测不到任何特征：回退缺省 web 也必须出声；之后升级走清单重放，不再探测。
  const emptyDir = tmpRepo();
  const fallback = run(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], emptyDir);
  assert.equal(fallback.status, 0, fallback.stderr);
  assert.match(fallback.stdout, /产品形态：web（自动探测无结果，回退缺省/);
  assert.equal(manifest(emptyDir).product, 'web');
  const upgrade = run(['upgrade', '--target', '.'], emptyDir);
  assert.equal(upgrade.status, 0, upgrade.stderr);
  assert.doesNotMatch(upgrade.stdout, /自动探测/);
});

