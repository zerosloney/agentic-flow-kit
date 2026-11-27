import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { makeT } from '../src/i18n.mjs';
import {
  matchGlob,
  stripComments,
  extractImports,
  resolveImportPath,
  buildDependencyGraph,
  detectCircularDependencies,
  checkLayerBoundaries,
  checkPrivateImports,
  generateArchitectureMermaid,
  checkArchHealth,
  evaluateArchitecture,
  initArchConfig,
  ARCH_CONFIG_REL,
  ARCH_PRESETS,
} from '../src/install/arch-guard.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

test('matchGlob matches directory and file globstar patterns', () => {
  assert.equal(matchGlob('src/domain/**', 'src/domain/entity.mjs'), true);
  assert.equal(matchGlob('src/domain/**', 'src/domain/sub/value-object.mjs'), true);
  assert.equal(matchGlob('src/domain/**', 'src/infra/repo.mjs'), false);
  assert.equal(matchGlob('**/node_modules/**', 'node_modules/pkg/index.js'), true);
  assert.equal(matchGlob('**/node_modules/**', 'sub/node_modules/pkg/index.js'), true);
  assert.equal(matchGlob('**/node_modules/**', 'src/app.mjs'), false);
});

test('extractImports extracts multi-language imports and ignores comments', () => {
  const jsSource = `
    // import 'commented';
    /*
      import { bad } from './bad';
    */
    import { User } from './models/user.mjs';
    import './side-effect.mjs';
    export { Helper } from '../utils/helper.mjs';
    const dyn = await import('./lazy.mjs');
    const old = require('./legacy.cjs');
  `;
  const jsImports = extractImports(jsSource, '.mjs');
  assert.ok(jsImports.includes('./models/user.mjs'));
  assert.ok(jsImports.includes('./side-effect.mjs'));
  assert.ok(jsImports.includes('../utils/helper.mjs'));
  assert.ok(jsImports.includes('./lazy.mjs'));
  assert.ok(jsImports.includes('./legacy.cjs'));
  assert.ok(!jsImports.includes('commented'));
  assert.ok(!jsImports.includes('./bad'));

  const pySource = `
    # from bad import bad
    from .domain.models import Order
    import os, sys
    import src.infra.db as db
  `;
  const pyImports = extractImports(pySource, '.py');
  assert.ok(pyImports.includes('.domain.models'));
  assert.ok(pyImports.includes('src.infra.db'));
  assert.ok(!pyImports.includes('bad'));

  const goSource = `
    import "fmt"
    import (
      "net/http"
      "myproject/domain"
    )
  `;
  const goImports = extractImports(goSource, '.go');
  assert.ok(goImports.includes('fmt'));
  assert.ok(goImports.includes('net/http'));
  assert.ok(goImports.includes('myproject/domain'));
});

test('resolveImportPath resolves relative and index paths accurately', () => {
  const tmp = makeTmp();
  fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'infra'), { recursive: true });

  fs.writeFileSync(path.join(tmp, 'src', 'domain', 'order.mjs'), 'export const Order = 1;', 'utf8');
  fs.writeFileSync(path.join(tmp, 'src', 'infra', 'index.mjs'), 'export const DB = 1;', 'utf8');

  // Relative extension probe
  const r1 = resolveImportPath('src/infra/repo.mjs', '../domain/order', tmp);
  assert.equal(r1, 'src/domain/order.mjs');

  // Relative index probe
  const r2 = resolveImportPath('src/app.mjs', './infra', tmp);
  assert.equal(r2, 'src/infra/index.mjs');

  // Ignore built-ins
  const rNode = resolveImportPath('src/app.mjs', 'node:fs', tmp);
  assert.equal(rNode, null);
});

test('detectCircularDependencies detects cycles and ignores DAGs', () => {
  // DAG: A -> B -> C (no cycle)
  const dag = new Map([
    ['A', new Set(['B'])],
    ['B', new Set(['C'])],
    ['C', new Set()],
  ]);
  const dagCycles = detectCircularDependencies(dag);
  assert.equal(dagCycles.length, 0);

  // Cycle: A -> B -> C -> A
  const cyclic = new Map([
    ['A', new Set(['B'])],
    ['B', new Set(['C'])],
    ['C', new Set(['A'])],
  ]);
  const cycles = detectCircularDependencies(cyclic);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ['A', 'B', 'C', 'A']);
});

test('checkLayerBoundaries and checkPrivateImports enforce encapsulation', () => {
  const config = {
    layers: {
      domain: {
        path: 'src/domain/**',
        disallow: ['infra', 'web'],
      },
      infra: {
        path: 'src/infra/**',
        disallow: ['web'],
      },
      web: {
        path: 'src/web/**',
        disallow: [],
      },
    },
    rules: {
      noCircularDependencies: true,
      noPrivateImports: true,
    },
  };

  const graph = new Map([
    // Illegal: domain imports infra
    ['src/domain/order.mjs', new Set(['src/infra/db.mjs'])],
    // Illegal: web imports private internal module from order
    ['src/web/controller.mjs', new Set(['src/modules/order/internal/secret.mjs'])],
    // Legal: order module internal access
    ['src/modules/order/index.mjs', new Set(['src/modules/order/internal/secret.mjs'])],
  ]);

  const layerViolations = checkLayerBoundaries(graph, config);
  assert.equal(layerViolations.length, 1);
  assert.equal(layerViolations[0].fromFile, 'src/domain/order.mjs');
  assert.equal(layerViolations[0].fromLayer, 'domain');
  assert.equal(layerViolations[0].targetLayer, 'infra');

  const privateViolations = checkPrivateImports(graph, config);
  assert.equal(privateViolations.length, 1);
  assert.equal(privateViolations[0].fromFile, 'src/web/controller.mjs');
  assert.equal(privateViolations[0].targetFile, 'src/modules/order/internal/secret.mjs');
});

test('generateArchitectureMermaid outputs valid Mermaid flowchart', () => {
  const config = {
    layers: {
      domain: { path: 'src/domain/**' },
      infra: { path: 'src/infra/**' },
    },
  };
  const graph = new Map([
    ['src/domain/order.mjs', new Set(['src/infra/db.mjs'])],
  ]);
  const violations = [
    { fromFile: 'src/domain/order.mjs', targetFile: 'src/infra/db.mjs' },
  ];

  const mermaid = generateArchitectureMermaid(graph, config, violations);
  assert.match(mermaid, /^flowchart TD/);
  assert.match(mermaid, /subgraph domain/);
  assert.match(mermaid, /subgraph infra/);
  assert.match(mermaid, /-\.->\|VIOLATION\|/);
});

test('checkArchHealth integrates with doctor', () => {
  const tmp = makeTmp();

  // No config -> returns null
  assert.equal(checkArchHealth(tmp, (k) => k), null);

  // Init clean preset
  initArchConfig(tmp, { preset: 'clean' });

  // Clean setup -> returns ok
  const hOk = checkArchHealth(tmp, (k) => k);
  assert.equal(hOk.ok, true);

  // Create violation
  fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'infra'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src', 'infra', 'db.mjs'), 'export const db = 1;', 'utf8');
  fs.writeFileSync(
    path.join(tmp, 'src', 'domain', 'order.mjs'),
    'import { db } from "../infra/db.mjs";',
    'utf8',
  );

  const hFail = checkArchHealth(tmp, (k) => k);
  assert.equal(hFail.ok, false);
});

test('CLI flow-kit arch init, check, and graph integration', () => {
  const tmp = makeTmp();

  // 1. arch check before init -> reports no config
  const rCheckNone = run(['arch', 'check', '--target', tmp], KIT);
  assert.equal(rCheckNone.status, 0);
  assert.match(rCheckNone.stdout, /flow-kit arch init/);

  // 2. arch init
  const rInit = run(['arch', 'init', '--preset', 'clean', '--target', tmp], KIT);
  assert.equal(rInit.status, 0);
  assert.ok(fs.existsSync(path.join(tmp, ARCH_CONFIG_REL)));

  // 3. create compliant source files
  fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'app'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src', 'domain', 'user.mjs'), 'export const User = {};\n', 'utf8');
  fs.writeFileSync(
    path.join(tmp, 'src', 'app', 'user-service.mjs'),
    'import { User } from "../domain/user.mjs";\n',
    'utf8',
  );

  // 4. check passes
  const rCheckPass = run(['arch', 'check', '--target', tmp, '--strict', '--json'], KIT);
  assert.equal(rCheckPass.status, 0);
  const parsedPass = JSON.parse(rCheckPass.stdout);
  assert.equal(parsedPass.ok, true);
  assert.equal(parsedPass.boundaryViolations.length, 0);

  // 5. graph exports mermaid diagram
  const rGraph = run(['arch', 'graph', '--target', tmp, '--out', 'arch.mmd'], KIT);
  assert.equal(rGraph.status, 0);
  assert.ok(fs.existsSync(path.join(tmp, 'arch.mmd')));

  // 6. introduce reverse boundary violation (domain -> app)
  fs.writeFileSync(
    path.join(tmp, 'src', 'domain', 'user.mjs'),
    'import { UserService } from "../app/user-service.mjs";\n',
    'utf8',
  );

  const rCheckFail = run(['arch', 'check', '--target', tmp, '--strict'], KIT);
  assert.equal(rCheckFail.status, 1);
  assert.match(rCheckFail.stderr, /架构契约检查失败/);
  assert.match(rCheckFail.stderr, /Boundary Violation/);
});

test('initArchConfig rejects unknown presets with BAD_ARGS and writes nothing', () => {
  const tmp = makeTmp();

  assert.throws(
    () => initArchConfig(tmp, { preset: 'clen' }),
    (err) => {
      assert.equal(err.code, 'BAD_ARGS');
      assert.match(err.message, /未知的架构预设/);
      assert.match(err.message, /clean/);
      assert.match(err.message, /ddd/);
      assert.match(err.message, /layered/);
      return true;
    },
  );
  assert.equal(fs.existsSync(path.join(tmp, ARCH_CONFIG_REL)), false);
});

test('initArchConfig accepts a known preset', () => {
  const tmp = makeTmp();

  const preset = initArchConfig(tmp, { preset: 'ddd' });
  assert.deepEqual(preset, ARCH_PRESETS.ddd);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, ARCH_CONFIG_REL), 'utf8')), ARCH_PRESETS.ddd);
});

test('architecture guard scans cjs/mts/cts, template-literal imports, and reports unresolved dynamic imports', () => {
  const root = makeTmp();
  for (const dir of ['src/domain', 'src/infra', 'src/web']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  initArchConfig(root, { preset: 'clean' });

  fs.writeFileSync(path.join(root, 'src/infra/db.mjs'), 'export const db = 1;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/domain/legacy.cjs'),
    "const db = require('../infra/db');\nmodule.exports = db;\n", 'utf8');
  fs.writeFileSync(path.join(root, 'src/domain/typed.mts'),
    "import { db } from '../infra/db.mjs';\nexport const value = db;\n", 'utf8');
  fs.writeFileSync(path.join(root, 'src/domain/compiled.cts'),
    "const db = require('../infra/db');\nexport = db;\n", 'utf8');
  fs.writeFileSync(path.join(root, 'src/domain/lazy.mjs'),
    'export async function load() {\n  return import(`../infra/db.mjs`);\n}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src/web/dynamic.mjs'),
    'export async function load(name) {\n  return import(name);\n}\n', 'utf8');

  const graph = buildDependencyGraph(root, { exclude: ['**/node_modules/**'] });
  assert.ok(graph.get('src/domain/legacy.cjs')?.has('src/infra/db.mjs'), 'cjs require edge');
  assert.ok(graph.get('src/domain/typed.mts')?.has('src/infra/db.mjs'), 'mts import edge');
  assert.ok(graph.get('src/domain/compiled.cts')?.has('src/infra/db.mjs'), 'cts require edge');
  assert.ok(graph.get('src/domain/lazy.mjs')?.has('src/infra/db.mjs'), 'template-literal import edge');

  const res = evaluateArchitecture(root);
  assert.ok(res.boundaryViolations.some(
    (v) => v.fromFile === 'src/domain/legacy.cjs' && v.targetFile === 'src/infra/db.mjs',
  ));
  assert.ok(res.boundaryViolations.some(
    (v) => v.fromFile === 'src/domain/lazy.mjs' && v.targetFile === 'src/infra/db.mjs',
  ));
  assert.equal(res.unresolvedImports.length, 1);
  assert.equal(res.unresolvedImports[0].fromFile, 'src/web/dynamic.mjs');
  assert.equal(res.ok, false);

  // An unresolved dynamic import is an advisory: counted, listed, and not a failed check.
  const cleanRoot = makeTmp();
  fs.mkdirSync(path.join(cleanRoot, 'src/web'), { recursive: true });
  initArchConfig(cleanRoot, { preset: 'clean' });
  fs.writeFileSync(path.join(cleanRoot, 'src/web/dynamic.mjs'),
    'export const load = (p) => import(p);\n', 'utf8');
  const pure = evaluateArchitecture(cleanRoot);
  assert.equal(pure.cycles.length + pure.boundaryViolations.length + pure.privateViolations.length, 0);
  assert.equal(pure.unresolvedImports.length, 1);
  assert.equal(pure.unresolvedImports[0].specifier, 'p');
  assert.equal(pure.ok, true);

  const health = checkArchHealth(cleanRoot, makeT('en'));
  assert.equal(health.ok, true);
  assert.equal(health.warn, true);
  assert.match(health.detail, /could not statically resolve 1 dynamic import/);
  assert.match(health.detail, /src\/web\/dynamic\.mjs -> p/);

  const healthZh = checkArchHealth(cleanRoot, makeT('zh-CN'));
  assert.match(healthZh.detail, /无法静态解析/);
  assert.match(healthZh.detail, /src\/web\/dynamic\.mjs -> p/);
});

test('CLI arch check lists unresolved dynamic imports as advisory in text and JSON', () => {
  const tmp = makeTmp();
  fs.mkdirSync(path.join(tmp, 'src', 'web'), { recursive: true });
  initArchConfig(tmp, { preset: 'clean' });
  fs.writeFileSync(path.join(tmp, 'src', 'web', 'dynamic.mjs'),
    'export const load = (p) => import(p);\n', 'utf8');

  const text = run(['arch', 'check', '--target', tmp], KIT);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /src\/web\/dynamic\.mjs -> p/);

  const json = run(['arch', 'check', '--json', '--target', tmp], KIT);
  assert.equal(json.status, 0, json.stderr);
  const data = JSON.parse(json.stdout);
  assert.equal(data.ok, true);
  assert.deepEqual(data.unresolvedImports?.length, 1);
  assert.deepEqual(data.unresolvedImports[0], { fromFile: 'src/web/dynamic.mjs', specifier: 'p' });
});

test('CLI arch init exits 2 on unknown preset', () => {
  const tmp = makeTmp();

  const bad = run(['arch', 'init', '--preset', 'clen', '--target', tmp], KIT);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /未知的架构预设/);
  assert.equal(fs.existsSync(path.join(tmp, ARCH_CONFIG_REL)), false);
});
