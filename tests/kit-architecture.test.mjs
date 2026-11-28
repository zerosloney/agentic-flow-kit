import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDependencyGraph,
  detectCircularDependencies,
} from '../src/install/arch-guard.mjs';
import { resolveTarget } from '../src/install/target.mjs';
import { requireManifest } from '../src/install/manifest.mjs';
import { readKitVersion } from '../src/install/version.mjs';
import { sha256, canonical } from '../src/install/notary.mjs';
import { generateDerivedArtifacts, rehashDerivedArtifacts } from '../src/install/derived.mjs';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 只守卫 src/**：全仓扫描会把 tmp/、docs/、.zcode/、migrations/ 等未跟踪或随机器
// 状态变化的目录带进图里，导致 CI 与本地扫描文件集不一致；按 src/ 前缀白名单收口。
function buildSrcGraph() {
  const full = buildDependencyGraph(KIT_ROOT, {
    exclude: ['**/templates/**', '**/tests/**', '**/bin/**', '**/tools/**'],
  });
  const graph = new Map();
  for (const [file, deps] of full) {
    if (!file.startsWith('src/')) continue;
    graph.set(file, new Set([...deps].filter((dep) => dep.startsWith('src/'))));
  }
  return graph;
}

test('repository architecture: src/ contains zero circular dependencies', () => {
  const graph = buildSrcGraph();

  const cycles = detectCircularDependencies(graph);
  assert.equal(
    cycles.length,
    0,
    `Detected circular dependencies in src/:\n${cycles.map((c) => c.join(' -> ')).join('\n')}`,
  );
});

test('repository architecture: strict layer boundaries and downward dependency flow', () => {
  const graph = buildSrcGraph();

  const layerOf = (file) => {
    const rel = file.replace(/\\/g, '/');
    if (rel.startsWith('src/kernel/')) return 'kernel';
    if (rel.startsWith('src/i18n.mjs')) return 'i18n';
    if (rel.startsWith('src/git/')) return 'git';
    if (rel.startsWith('src/hosts/')) return 'hosts';
    if (rel.startsWith('src/models/')) return 'models';
    if (rel.startsWith('src/rules/')) return 'rules';
    if (rel.startsWith('src/skills/')) return 'skills';
    if (rel.startsWith('src/ci/')) return 'ci';
    if (rel.startsWith('src/render/')) return 'render';
    if (rel.startsWith('src/install/')) return 'install';
    if (rel.startsWith('src/commands/')) return 'commands';
    if (rel.startsWith('src/tui/')) return 'tui';
    if (rel.startsWith('src/cli/')) return 'cli';
    return 'other';
  };

  const violations = [];
  for (const [file, deps] of graph.entries()) {
    const fromLayer = layerOf(file);
    // src 内每个文件都必须归入某一层：落入 other 意味着新目录逃逸出分层守卫。
    if (fromLayer === 'other') {
      violations.push(`${file} is not assigned to any layer`);
    }
    for (const dep of deps) {
      const toLayer = layerOf(dep);

      // kernel must be purely self-contained leaf
      if (fromLayer === 'kernel' && toLayer !== 'kernel') {
        violations.push(`${file} (${fromLayer}) -> ${dep} (${toLayer})`);
      }

      // domain layers (install, rules, models, hosts, skills, ci, render) must never depend on upper layers (commands, tui, cli)
      if (['install', 'rules', 'models', 'hosts', 'skills', 'ci', 'render'].includes(fromLayer)
          && ['commands', 'cli', 'tui'].includes(toLayer)) {
        violations.push(`${file} (${fromLayer}) -> ${dep} (${toLayer})`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Architectural layer boundary violations detected:\n${violations.join('\n')}`,
  );
});

test('repository architecture: canonical exports single source of truth invariants', () => {
  assert.equal(typeof resolveTarget, 'function', 'resolveTarget must be exported from target.mjs');
  assert.equal(typeof requireManifest, 'function', 'requireManifest must be exported from manifest.mjs');
  assert.equal(typeof readKitVersion, 'function', 'readKitVersion must be exported from version.mjs');
  assert.equal(typeof sha256, 'function', 'sha256 must be exported from notary.mjs');
  assert.equal(typeof canonical, 'function', 'canonical must be exported from notary.mjs');
  assert.equal(typeof generateDerivedArtifacts, 'function', 'generateDerivedArtifacts must be exported from derived.mjs');
  assert.equal(typeof rehashDerivedArtifacts, 'function', 'rehashDerivedArtifacts must be exported from derived.mjs');
});
