// 特性地图维护腿（BACKLOG #17）：两腿复用既有脚本，本文件只锁「漂移」「缺地图」两态与 dream E3 接线。
// 覆盖腿 = verify-ui/scripts/gen-verify-feature.mjs --check（路由有、地图无）；
// 悬空腿 = scripts/check-regression-consistency.mjs（地图有、路由/资产无）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { scanFeatureMapRefs } from '../templates/engine/.agents/scripts/check-regression-consistency.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(HERE, '..', 'templates', 'engine', '.agents');
const GEN = path.join(ENGINE, 'skills', 'verify-ui', 'scripts', 'gen-verify-feature.mjs');
const REGR = path.join(ENGINE, 'scripts', 'check-regression-consistency.mjs');
const DREAM = path.join(ENGINE, 'scripts', 'dream-run.mjs');
const ROUTER_REL = path.join('frontend', 'src', 'router', 'index.ts');
const FEATURES_REL = path.join('.agents', 'skills', 'verify-ui', 'features');
const GEN_REL = path.join('.agents', 'skills', 'verify-ui', 'scripts', 'gen-verify-feature.mjs');

function repo({ routes = null, map = null } = {}) {
  const root = makeTmp('feature-map-');
  spawnSync('git', ['init', '-q'], { cwd: root });
  if (routes) {
    const file = path.join(root, ROUTER_REL);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `export default [\n${routes.map((r) => `  { path: '${r}' },`).join('\n')}\n]\n`);
  }
  if (map) {
    fs.mkdirSync(path.join(root, FEATURES_REL), { recursive: true });
    for (const [name, body] of Object.entries(map)) fs.writeFileSync(path.join(root, FEATURES_REL, name), body);
  }
  return root;
}

const mapEntry = (route) => `# 特性：${route}\n\nhash 路由 \`#${route}\`。\n`;

function gen(root, args) {
  return spawnSync(process.execPath, [GEN, ...args], { cwd: root, encoding: 'utf8' });
}

function regr(root) {
  return spawnSync(process.execPath, [REGR, '--root', root], { cwd: root, encoding: 'utf8' });
}

function dream(root) {
  const r = spawnSync(process.execPath, [DREAM, '--no-judge', '--report', 'tmp/dream-e3.md'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root, FLOW_KIT_RUNTIME_SCRIPTS: path.join(ENGINE, 'scripts') },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return fs.readFileSync(path.join(root, 'tmp', 'dream-e3.md'), 'utf8');
}

test('coverage leg loud-skips green when there is no router or no feature map', () => {
  const bare = repo();
  const noRouter = gen(bare, ['--check']);
  assert.equal(noRouter.status, 0, noRouter.stderr);
  assert.match(noRouter.stdout, /loud-skip/);
  assert.match(noRouter.stdout, /未找到 frontend\/src\/router\/index\.ts/);
  const asJson = JSON.parse(gen(bare, ['--json']).stdout);
  assert.equal(asJson.skipped, true);
  assert.deepEqual(asJson.uncovered, []);

  const noMap = repo({ routes: ['/orders', '/suppliers'] });
  const r = gen(noMap, ['--check']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /features\/ 无特性地图/);
  // loud-skip 不是「假装覆盖」：不建目录、不写骨架。
  assert.equal(fs.existsSync(path.join(noMap, FEATURES_REL)), false);

  // 生成腿仍严格失败：没有路由表就无从生成骨架。
  const strict = gen(bare, ['--route', '/orders']);
  assert.equal(strict.status, 2);
  assert.match(strict.stderr, /未找到 frontend\/src\/router\/index\.ts/);
});

test('coverage leg flags a route the map misses and turns green once covered', () => {
  const root = repo({ routes: ['/orders', '/suppliers'], map: { 'orders.md': mapEntry('/orders') } });
  const gap = gen(root, ['--check']);
  assert.equal(gap.status, 1);
  assert.match(gap.stderr, /- \/suppliers/);
  assert.ok(!gap.stderr.includes('- /orders'), 'covered route must not be listed as a gap');
  // --json 单独只列举（exit 0）；入 CI 须配 --check 才以退出码表达缺口。
  const json = gen(root, ['--json', '--check']);
  assert.equal(json.status, 1);
  assert.deepEqual(JSON.parse(json.stdout).uncovered, ['/suppliers']);
  assert.deepEqual(fs.readdirSync(path.join(root, FEATURES_REL)), ['orders.md'], '--check must not write');

  fs.writeFileSync(path.join(root, FEATURES_REL, 'suppliers.md'), mapEntry('/suppliers'));
  const green = gen(root, ['--check']);
  assert.equal(green.status, 0, green.stderr);
  assert.match(green.stdout, /覆盖全部 2 个顶层路由/);
});

test('dangling leg flags a map route the router lost and stays green with no map', () => {
  const root = repo({ routes: ['/orders'], map: { 'ghost.md': mapEntry('/ghost') } });
  assert.deepEqual(scanFeatureMapRefs(root).danglingRoutes, ['/ghost']);
  const drift = regr(root);
  assert.equal(drift.status, 1);
  assert.match(drift.stderr, /特性地图悬空路由：\/ghost/);

  const empty = repo({ routes: ['/orders'] });
  const scan = scanFeatureMapRefs(empty);
  assert.equal(scan.files, 0);
  assert.deepEqual(scan.danglingRoutes, []);
  assert.equal(regr(empty).status, 0, 'no map is not drift');

  // 修地图即转绿：证明这是真漂移信号，不是恒红。
  fs.writeFileSync(path.join(root, FEATURES_REL, 'ghost.md'), mapEntry('/orders'));
  assert.equal(regr(root).status, 0);
});

test('dream-run E3 reports both drift legs as candidates and writes nothing', () => {
  const root = repo({
    routes: ['/orders', '/suppliers'],
    map: { 'orders.md': mapEntry('/orders'), 'ghost.md': mapEntry('/ghost') },
  });
  fs.mkdirSync(path.dirname(path.join(root, GEN_REL)), { recursive: true });
  fs.copyFileSync(GEN, path.join(root, GEN_REL));

  const report = dream(root);
  assert.match(report, /## E3\. 验证特性地图漂移/);
  assert.match(report, /覆盖缺口（候选，不改文件）/);
  assert.match(report, /- \/suppliers/);
  assert.match(report, /地图\/清单悬空引用（候选，不改文件）/);
  assert.match(report, /特性地图悬空路由：\/ghost/);
  assert.deepEqual(
    fs.readdirSync(path.join(root, FEATURES_REL)).sort(),
    ['ghost.md', 'orders.md'],
    'E3 must not add or rewrite map files',
  );
});

test('dream-run E3 loud-skips when the project has no verify-ui generator', () => {
  const root = repo();
  const report = dream(root);
  assert.match(report, /## E3\. 验证特性地图漂移/);
  assert.match(report, /loud-skip：项目侧无 verify-ui 生成器/);
  assert.equal(fs.existsSync(path.join(root, FEATURES_REL)), false);
});
