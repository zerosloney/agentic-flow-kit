import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import {
  matchGlob,
  stripComments,
  extractImports,
  resolveImportPath,
  detectCircularDependencies,
  checkLayerBoundaries,
  checkPrivateImports,
  generateArchitectureMermaid,
  evaluateArchitecture,
  initArchConfig,
  ARCH_CONFIG_REL,
  ARCH_PRESETS,
} from '../src/install/arch-guard.mjs';
import { runGovernanceProbes } from '../src/governance/probes.mjs';

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

test('architecture guard integrates with doctor probe', () => {
  const tmp = makeTmp();

  // No config -> probe skipped
  const pNone = runGovernanceProbes({ target: tmp, probes: ['arch'] });
  assert.equal(pNone.probes[0].status, 'skipped');
  assert.equal(pNone.checks.length, 0);

  // Init clean preset
  initArchConfig(tmp, { preset: 'clean' });

  // Clean setup -> returns ok
  const pOk = runGovernanceProbes({ target: tmp, probes: ['arch'] });
  assert.equal(pOk.probes[0].status, 'passed');
  assert.equal(pOk.checks[0].ok, true);

  // Create violation
  fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'infra'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src', 'infra', 'db.mjs'), 'export const db = 1;', 'utf8');
  fs.writeFileSync(
    path.join(tmp, 'src', 'domain', 'order.mjs'),
    'import { db } from "../infra/db.mjs";',
    'utf8',
  );

  const pFail = runGovernanceProbes({ target: tmp, probes: ['arch'] });
  assert.equal(pFail.probes[0].status, 'failed');
  assert.equal(pFail.checks[0].ok, false);
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

test('CLI arch init exits 2 on unknown preset', () => {
  const tmp = makeTmp();

  const bad = run(['arch', 'init', '--preset', 'clen', '--target', tmp], KIT);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /未知的架构预设/);
  assert.equal(fs.existsSync(path.join(tmp, ARCH_CONFIG_REL)), false);
});

test('matchGlob handles mid-path ** across nested directories and invalid architecture.json exits 2', () => {
  assert.equal(matchGlob('packages/**/domain/*.mjs', 'packages/a/b/domain/order.mjs'), true);
  assert.equal(matchGlob('packages/**/domain/*.mjs', 'packages/order/domain/order.mjs'), true);
  assert.equal(matchGlob('packages/**/domain/*.mjs', 'packages/domain/order.mjs'), true);
  assert.equal(matchGlob('packages/**/domain/*.mjs', 'packages/a/b/infra/db.mjs'), false);

  const tmp = makeTmp();
  fs.mkdirSync(path.join(tmp, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmp, ARCH_CONFIG_REL), '{invalid-json', 'utf8');
  const badCfg = run(['arch', 'check', '--target', tmp], KIT);
  assert.equal(badCfg.status, 2);
});
