#!/usr/bin/env node
/**
 * dynamic-test-impact.mjs - 动态测试影响图与增量选测决策引擎
 * 
 * 核心机制：
 * 1. 多语言源码依赖解析（JS/TS、Python、Go）：静态提取 import / export from / require / from...import。
 * 2. 拓扑依赖图构建：建立节点间依赖（dependencies）与反向影响（dependents）拓扑。
 * 3. 动态测试影响倒排：基于变更文件集（git diff / files），经 BFS 深度传导计算受影响测试子集。
 * 4. 核心安全兜底防线：触碰架构定义、全局策略、包清单或无法解析的未知引用时，自动回退全量回归。
 * 5. 零外部运行时依赖，纯 Node.js 标准库实现。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { t } from './lang.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.FLOW_KIT_PROJECT_ROOT
  || path.resolve(SCRIPT_DIR, '..', '..');

// ── 路径规范化与文件类型探测 ──────────────────────────────────────────────────

export function normalizePath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

const SUPPORTED_CODE_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx',
  '.py',
  '.go',
]);

const JS_TS_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx',
]);

// 裸内置（import fs from 'fs'）与 node: 前缀同等视为外部依赖，不算无法解析。
const NODE_BUILTIN_MODULES = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));

const TEST_FILE_PATTERNS = [
  /\.(test|spec)\.[mc]?[jt]sx?$/i,
  /_test\.go$/i,
  /(?:^|\/)test_[^/]+\.py$/i,
  /(?:^|\/)[^/]+_test\.py$/i,
];

const TEST_DIR_PATTERNS = [
  /(?:^|\/)(tests?|__tests__|test-fixtures)\//i,
];

// 测试目录下的辅助模块（helper / fixture / setup）不是测试本身：按源码节点处理，
// 否则「真实测试 -> 辅助模块 -> 变更源」的传导链会在辅助模块处被误判为测试而截断。
const TEST_AUX_SEGMENT_PATTERNS = [
  /(?:^|\/)(?:helpers?|fixtures?|support|__fixtures__|__helpers__|__support__)\//i,
];

export const MAX_SCAN_FILES = 5000;

const IGNORED_SCAN_DIRS = new Set([
  'node_modules',
  '.git',
  '.agents/ledger',
  '.agents/endorsements.d',
  '.agents/cache',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'vendor',
  'bin',
  'obj',
]);

const CORE_INFRA_PATTERNS = [
  /(?:^|\/)package\.json$/i,
  /(?:^|\/)pnpm-lock\.yaml$/i,
  /(?:^|\/)package-lock\.json$/i,
  /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/i,
  /(?:^|\/)go\.mod$/i,
  /(?:^|\/)go\.sum$/i,
  /(?:^|\/)requirements(?:\.[^/]+)?\.txt$/i,
  /(?:^|\/)pyproject\.toml$/i,
  /(?:^|\/)\.agents\/config\/policy\.json$/i,
  /(?:^|\/)\.agents\/config\/pipeline\.json$/i,
  /(?:^|\/)\.agents\/rules\/.*\.json$/i,
  /(?:^|\/)\.agents\/scripts\/verify\.mjs$/i,
  /(?:^|\/)\.agents\/scripts\/pipeline-run\.mjs$/i,
];

function isTestAuxiliaryPath(normPath) {
  if (TEST_AUX_SEGMENT_PATTERNS.some((re) => re.test(normPath))) return true;
  const base = normPath.split('/').pop() || '';
  if (/^conftest\.py$/i.test(base)) return true;
  if (/^setuptests\.[^/]+$/i.test(base)) return true;
  if (/^setup\.[^/]+$/i.test(base) && TEST_DIR_PATTERNS.some((re) => re.test(normPath))) return true;
  return false;
}

export function isTestFile(filePath) {
  const norm = normalizePath(filePath);
  if (!norm) return false;
  if (TEST_FILE_PATTERNS.some((re) => re.test(norm))) return true;
  if (TEST_DIR_PATTERNS.some((re) => re.test(norm))) {
    const ext = path.extname(norm).toLowerCase();
    if (SUPPORTED_CODE_EXTS.has(ext) && !isTestAuxiliaryPath(norm)) return true;
  }
  return false;
}

export function isCodeFile(filePath) {
  const norm = normalizePath(filePath);
  if (!norm) return false;
  const ext = path.extname(norm).toLowerCase();
  return SUPPORTED_CODE_EXTS.has(ext);
}

export function isCoreInfraFile(filePath) {
  const norm = normalizePath(filePath);
  if (!norm) return false;
  return CORE_INFRA_PATTERNS.some((re) => re.test(norm));
}

// ── 多语言源码依赖提取引擎 ────────────────────────────────────────────────────

/**
 * 剥除单行与多行注释，避免注释内伪 import 干扰静态依赖提取
 */
export function stripComments(content, ext) {
  const code = String(content || '');
  if (ext === '.py') {
    return code.replace(/(?<=^|[^"']*)#.*$/gm, '');
  }
  // JS/TS/Go 风格：// 与 /* */
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<=^|[^"':])\/\/.*$/gm, '');
}

/**
 * 从单一代码文件中提取所有模块引用说明符
 */
export function extractImportSpecifiers(content, ext) {
  const code = stripComments(content, ext);
  const specifiers = new Set();

  if (ext === '.py') {
    // Python 语法：
    // from . import foo / from ..bar import baz / from module import symbol
    const fromRe = /^\s*from\s+([.\w]+)\s+import/gm;
    for (const m of code.matchAll(fromRe)) {
      if (m[1]) specifiers.add(m[1]);
    }
    // import foo, bar / import foo.bar
    const importRe = /^\s*import\s+([a-zA-Z0-9_., \t]+)/gm;
    for (const m of code.matchAll(importRe)) {
      const parts = m[1].split(',').map((p) => p.trim().split(/\s+as\s+/)[0].trim());
      for (const p of parts) {
        if (p) specifiers.add(p);
      }
    }
    return [...specifiers];
  }

  if (ext === '.go') {
    // Go 语法：
    // import "foo/bar"
    // import ( "foo" \n "bar" )
    const singleRe = /^\s*import\s+"([^"]+)"/gm;
    for (const m of code.matchAll(singleRe)) {
      if (m[1]) specifiers.add(m[1]);
    }
    const blockRe = /import\s*\(\s*([\s\S]*?)\s*\)/g;
    for (const block of code.matchAll(blockRe)) {
      const lineRe = /"([^"]+)"/g;
      for (const m of block[1].matchAll(lineRe)) {
        if (m[1]) specifiers.add(m[1]);
      }
    }
    return [...specifiers];
  }

  // JS / TS / JSX / TSX
  // import ... from '...'
  const importFromRe = /(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(importFromRe)) {
    if (m[1]) specifiers.add(m[1]);
  }

  // dynamic import: import('...')
  const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of code.matchAll(dynamicImportRe)) {
    if (m[1]) specifiers.add(m[1]);
  }

  // CommonJS: require('...')
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of code.matchAll(requireRe)) {
    if (m[1]) specifiers.add(m[1]);
  }

  return [...specifiers];
}

/**
 * 读取根目录 go.mod 的 module 行（按 root 缓存，避免逐条 import 重复读盘）
 */
const goModulePathCache = new Map();
function readGoModulePath(root) {
  if (goModulePathCache.has(root)) return goModulePathCache.get(root);
  let modulePath = null;
  try {
    const content = fs.readFileSync(path.join(root, 'go.mod'), 'utf8');
    const m = content.match(/^\s*module\s+(\S+)/m);
    if (m) modulePath = m[1].replace(/^["']|["']$/g, '');
  } catch {
    /* 无 go.mod：不做模块前缀解析 */
  }
  goModulePathCache.set(root, modulePath);
  return modulePath;
}

/**
 * 将模块引用说明符解析为相对于仓库根目录的规范化文件路径
 */
export function resolveModulePath(fromFilePath, specifier, root, existsSyncFn = fs.existsSync) {
  const normFrom = normalizePath(fromFilePath);
  const ext = path.extname(normFrom).toLowerCase();
  const fromDir = path.dirname(normFrom);

  // 1. Python 导入解析
  if (ext === '.py') {
    if (specifier.startsWith('.')) {
      // 相对导入：.module 或 ..module
      const dotsMatch = specifier.match(/^\.+/);
      const dotsCount = dotsMatch ? dotsMatch[0].length : 1;
      const modPart = specifier.slice(dotsCount);
      let targetDir = fromDir;
      for (let i = 1; i < dotsCount; i++) {
        targetDir = path.dirname(targetDir);
      }
      const relPath = modPart ? path.join(targetDir, modPart.replace(/\./g, '/')) : targetDir;
      const candidates = [
        `${relPath}.py`,
        path.join(relPath, '__init__.py'),
      ];
      for (const cand of candidates) {
        const normCand = normalizePath(cand);
        if (existsSyncFn(path.join(root, normCand))) return normCand;
      }
    } else {
      // 顶级模块或相对当前目录模块（含 src-layout: src/<包>/__init__.py、src/<模块>.py）
      const relPath = specifier.replace(/\./g, '/');
      const candidates = [
        path.join(fromDir, `${relPath}.py`),
        path.join(fromDir, relPath, '__init__.py'),
        `${relPath}.py`,
        path.join(relPath, '__init__.py'),
        path.join('src', `${relPath}.py`),
        path.join('src', relPath, '__init__.py'),
      ];
      for (const cand of candidates) {
        const normCand = normalizePath(cand);
        if (existsSyncFn(path.join(root, normCand))) return normCand;
      }
    }
    return null;
  }

  // 2. Go 导入解析（跳过标准库；模块路径前缀按仓库根相对解析）
  if (ext === '.go') {
    if (!specifier.includes('/') && !specifier.includes('.')) {
      // 标准库 fmt, os, net 等
      return null;
    }
    const candidates = [];
    const modulePath = readGoModulePath(root);
    if (modulePath && (specifier === modulePath || specifier.startsWith(`${modulePath}/`))) {
      const relSpec = specifier.slice(modulePath.length).replace(/^\//, '');
      if (relSpec) candidates.push(relSpec);
    }
    candidates.push(path.join(fromDir, specifier), specifier);
    for (const cand of candidates) {
      const normCand = normalizePath(cand);
      const absCand = path.join(root, normCand);
      if (existsSyncFn(absCand)) {
        return normCand;
      }
    }
    return null;
  }

  // 3. JS/TS 导入解析
  // 过滤内置库与裸包名（如 node:fs, fs, react, lodash）
  if (specifier.startsWith('node:') || (!specifier.startsWith('.') && !specifier.startsWith('/'))) {
    return null;
  }

  const baseRel = specifier.startsWith('/')
    ? specifier.slice(1)
    : path.join(fromDir, specifier);

  const normBase = normalizePath(baseRel);

  // 尝试直接匹配及补充常见扩展名
  const candidates = [
    normBase,
    `${normBase}.mjs`,
    `${normBase}.js`,
    `${normBase}.ts`,
    `${normBase}.jsx`,
    `${normBase}.tsx`,
    `${normBase}.cjs`,
    path.join(normBase, 'index.mjs'),
    path.join(normBase, 'index.js'),
    path.join(normBase, 'index.ts'),
  ];

  for (const cand of candidates) {
    const normCand = normalizePath(cand);
    const absPath = path.join(root, normCand);
    if (existsSyncFn(absPath)) {
      try {
        const stat = fs.statSync(absPath);
        if (stat.isFile()) return normCand;
      } catch {
        return normCand;
      }
    }
  }

  return null;
}

// ── 依赖图构建与反向拓扑倒排 ──────────────────────────────────────────────────

function readPackageDependencyNames(root) {
  const names = new Set();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const name of Object.keys(pkg[field] || {})) names.add(name);
    }
  } catch {
    /* 无 package.json 或解析失败：视为无已声明依赖 */
  }
  return names;
}

/**
 * 裸说明符（非相对路径、非 node: / 裸内置）无法解析的判定：
 * node_modules/<首段> 不存在且首段未在根 package.json 依赖中声明。
 */
function isUnresolvedBareSpecifier(specifier, root, dependencyNames) {
  if (!specifier) return false;
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return false;
  }
  const first = specifier.split('/')[0];
  if (!first) return false;
  if (NODE_BUILTIN_MODULES.has(first)) return false;
  if (dependencyNames.has(first)) return false;
  return !fs.existsSync(path.join(root, 'node_modules', first));
}

/**
 * 递归扫描仓库目录，收集全部支持的代码文件
 */
export function scanRepositoryFiles(root, scanDirs = null, maxFiles = MAX_SCAN_FILES) {
  const results = [];
  const dirsToScan = scanDirs || ['.'];
  let stopped = false;

  function walk(currentDir) {
    if (stopped) return;
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (stopped) break;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = normalizePath(path.relative(root, fullPath));

      if (entry.isDirectory()) {
        const baseName = entry.name;
        if (IGNORED_SCAN_DIRS.has(baseName) || IGNORED_SCAN_DIRS.has(relPath)) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        if (isCodeFile(relPath)) {
          results.push(relPath);
          // 多收 1 个即可判定超限，停止继续扫描
          if (results.length > maxFiles) {
            stopped = true;
            break;
          }
        }
      }
    }
  }

  for (const dir of dirsToScan) {
    if (stopped) break;
    walk(path.join(root, dir));
  }

  return results.sort();
}

/**
 * 构建完整的正向依赖与反向影响拓扑图
 */
export function buildDependencyGraph(root, options = {}) {
  const { files = null, scanDirs = null } = options;
  const targetFiles = files || scanRepositoryFiles(root, scanDirs);

  const nodes = new Map();
  const testFiles = new Set();
  const sourceFiles = new Set();
  const unresolvedImports = new Map();
  const dependencyNames = readPackageDependencyNames(root);

  // 初始化节点
  for (const file of targetFiles) {
    const isTest = isTestFile(file);
    if (isTest) {
      testFiles.add(file);
    } else {
      sourceFiles.add(file);
    }
    nodes.set(file, {
      file,
      isTest,
      dependencies: new Set(),
      dependents: new Set(),
    });
  }

  // Go 包目录 -> 目录内 .go 文件（按需建索引，避免每条 import 全量扫节点）
  let goDirIndex = null;
  const goFilesInDir = (dir) => {
    if (!goDirIndex) {
      goDirIndex = new Map();
      for (const candidate of nodes.keys()) {
        if (!candidate.endsWith('.go')) continue;
        const key = path.posix.dirname(candidate);
        const list = goDirIndex.get(key) || [];
        list.push(candidate);
        goDirIndex.set(key, list);
      }
    }
    return goDirIndex.get(dir) || [];
  };

  // 解析并链接引用
  for (const file of targetFiles) {
    const absPath = path.join(root, file);
    let content = '';
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }

    const ext = path.extname(file).toLowerCase();
    const specifiers = extractImportSpecifiers(content, ext);
    const node = nodes.get(file);

    for (const spec of specifiers) {
      const resolved = resolveModulePath(file, spec, root);
      if (resolved && nodes.has(resolved)) {
        node.dependencies.add(resolved);
        nodes.get(resolved).dependents.add(file);
        continue;
      }

      // Go 导入解析到包目录：链接到目录内全部 .go 文件，使包级变更可向上传导
      if (resolved && ext === '.go') {
        const packageFiles = goFilesInDir(resolved);
        for (const candidate of packageFiles) {
          node.dependencies.add(candidate);
          nodes.get(candidate).dependents.add(file);
        }
        if (packageFiles.length) continue;
      }

      if (JS_TS_EXTS.has(ext) && isUnresolvedBareSpecifier(spec, root, dependencyNames)) {
        const list = unresolvedImports.get(file) || [];
        list.push(spec);
        unresolvedImports.set(file, list);
      }
    }
  }

  return {
    nodes,
    testFiles,
    sourceFiles,
    unresolvedImports,
    root,
  };
}

// ── 影响面传导与增量选测决策 ──────────────────────────────────────────────────

/**
 * 计算变更文件集合的测试影响面（支持多跳传导与环路防护）
 */
export function computeTestImpact(graph, changedFiles) {
  const normChanged = (changedFiles || []).map(normalizePath).filter(Boolean);
  const directImpactedTests = new Set();
  const transitiveImpactedTests = new Set();
  const visited = new Set();
  const impactedSources = new Set();
  const unmappedFiles = [];

  for (const change of normChanged) {
    if (!graph.nodes.has(change)) {
      unmappedFiles.push(change);
      continue;
    }

    const changeNode = graph.nodes.get(change);
    if (changeNode.isTest) {
      directImpactedTests.add(change);
      continue;
    }

    // BFS 遍历依赖传导链
    const queue = [{ file: change, depth: 0 }];
    const localVisited = new Set([change]);

    while (queue.length > 0) {
      const { file: currentFile, depth } = queue.shift();
      const node = graph.nodes.get(currentFile);
      if (!node) continue;

      for (const dependent of node.dependents) {
        if (localVisited.has(dependent)) continue;
        localVisited.add(dependent);
        visited.add(dependent);

        const depNode = graph.nodes.get(dependent);
        if (!depNode) continue;

        if (depNode.isTest) {
          if (depth === 0) {
            directImpactedTests.add(dependent);
          } else {
            transitiveImpactedTests.add(dependent);
          }
          // 测试节点同样继续向上遍历：经由测试文件再被引用的链路不应在此截断
          queue.push({ file: dependent, depth: depth + 1 });
        } else {
          impactedSources.add(dependent);
          queue.push({ file: dependent, depth: depth + 1 });
        }
      }
    }
  }

  // 并集测试集合（确保去重且有序）
  const allImpactedTests = new Set([
    ...directImpactedTests,
    ...transitiveImpactedTests,
  ]);

  return {
    directImpactedTests: [...directImpactedTests].sort(),
    transitiveImpactedTests: [...transitiveImpactedTests].filter((t) => !directImpactedTests.has(t)).sort(),
    impactedTests: [...allImpactedTests].sort(),
    impactedSources: [...impactedSources].sort(),
    unmappedFiles: unmappedFiles.sort(),
  };
}

/**
 * 构建依赖图；扫描前先设上限，超限则不建图（避免无界全仓扫描）。
 * @returns {object|null} 依赖图；null 表示仓库代码文件超过扫描上限
 */
function buildGraphWithScanLimit(root, options, warnings) {
  if (options.graph) return options.graph;
  const maxScanFiles = options.maxScanFiles || MAX_SCAN_FILES;
  if (Array.isArray(options.files)) return buildDependencyGraph(root, options);
  const scanned = scanRepositoryFiles(root, options.scanDirs, maxScanFiles);
  if (scanned.length > maxScanFiles) {
    warnings.push(t(
      `仓库代码文件超过 ${maxScanFiles} 个，未构建依赖图，回退全量`,
      `More than ${maxScanFiles} code files, dependency graph not built, falling back to the full suite`,
    ));
    return null;
  }
  return buildDependencyGraph(root, { ...options, files: scanned });
}

/**
 * 动态选测核心决策器（含全量兜底状态机）
 */
export function selectDynamicTestImpact(root, changedFiles, options = {}) {
  const {
    forceFull = false,
    fallbackOnUntested = true,
    graph = null,
  } = options;

  const files = (changedFiles || []).map(normalizePath).filter(Boolean);
  const warnings = [];

  // 1. 显式强制全量
  if (forceFull) {
    const depGraph = buildGraphWithScanLimit(root, options, warnings);
    return createDecision(
      'full',
      t('显式指定全量测试', 'Full run requested'),
      depGraph ? [...depGraph.testFiles].sort() : [],
      files,
      depGraph,
      warnings
    );
  }

  // 2. 变更集合为空
  if (files.length === 0) {
    return createDecision('none', t('变更文件集合为空', 'No changed files'), [], files, graph, warnings);
  }

  // 3. 核心基础设施或全局策略触碰兜底
  const coreTouched = files.filter(isCoreInfraFile);
  if (coreTouched.length > 0) {
    warnings.push(t(
      `核心文件变更触碰安全兜底: ${coreTouched.join(', ')}`,
      `Core file change hit the safety fallback: ${coreTouched.join(', ')}`,
    ));
    return createDecision('full', t(
      `触碰核心基础设施文件 (${coreTouched.length} 个)，回退全量回归`,
      `Touched ${coreTouched.length} core infrastructure file(s), falling back to the full suite`,
    ), [], files, graph, warnings);
  }

  // 4. 变更集合不含代码/测试文件：无需建图（绝不为此扫描全仓）
  if (!files.some((f) => isCodeFile(f) || isTestFile(f))) {
    return createDecision('none', t('变更文件不涉及源码与测试', 'Changed files are not source or tests'), [], files, null, warnings);
  }

  // 5. 构建或复用依赖图（超限时回退全量）
  const depGraph = buildGraphWithScanLimit(root, options, warnings);
  if (!depGraph) {
    return createDecision('full', t('仓库代码文件超过扫描上限，回退全量', 'Code file count exceeded the scan limit, falling back to the full suite'), [], files, null, warnings);
  }
  const totalKnownTests = depGraph.testFiles.size;

  if (totalKnownTests === 0) {
    return createDecision('none', t('项目中未探测到有效测试文件', 'No test files detected'), [], files, depGraph, warnings);
  }

  // 6. 传导计算
  const impact = computeTestImpact(depGraph, files);

  // 6.1 含无法解析导入（如路径别名）的测试文件保守纳入受影响集
  const unresolvedTestFiles = [...(depGraph.unresolvedImports || new Map()).keys()]
    .filter((f) => depGraph.testFiles.has(f))
    .sort();
  if (unresolvedTestFiles.length > 0) {
    warnings.push(t(
      `存在 ${unresolvedTestFiles.length} 个测试文件包含无法解析的导入，已保守纳入受影响集`,
      `${unresolvedTestFiles.length} test file(s) have unresolvable imports and were included conservatively`,
    ));
    const impacted = new Set(impact.impactedTests);
    for (const f of unresolvedTestFiles) impacted.add(f);
    impact.impactedTests = [...impacted].sort();
  }

  // 7. 检查是否存在未映射的代码文件变更
  const codeChanges = files.filter(isCodeFile);
  const unmappedCode = impact.unmappedFiles.filter(isCodeFile);

  if (unmappedCode.length > 0) {
    warnings.push(t(
      `存在未纳入依赖图的源码变更: ${unmappedCode.join(', ')}`,
      `Source changes missing from the dependency graph: ${unmappedCode.join(', ')}`,
    ));
    if (fallbackOnUntested) {
      return createDecision('full', t('存在未知或未映射源码变更，安全回退全量', 'Unknown or unmapped source changes, falling back to the full suite'), [], files, depGraph, warnings, impact);
    }
  }

  // 8. 若修改了源码但受影响测试集为空
  if (codeChanges.length > 0 && impact.impactedTests.length === 0) {
    if (fallbackOnUntested) {
      warnings.push(t(
        `变更的源码未被任何测试引用: ${codeChanges.join(', ')}`,
        `Changed source is not imported by any test: ${codeChanges.join(', ')}`,
      ));
      return createDecision('full', t('变更源码缺乏测试拓扑覆盖，安全回退全量', 'Changed source has no test coverage in the graph, falling back to the full suite'), [], files, depGraph, warnings, impact);
    }
  }

  // 9. 仅修改非代码文件（如 markdown / 文档 / 静态图片）
  if (codeChanges.length === 0 && impact.impactedTests.length === 0) {
    return createDecision('none', t('变更文件不涉及源码与测试', 'Changed files are not source or tests'), [], files, depGraph, warnings, impact);
  }

  // 10. 选中用例覆盖全部测试
  if (impact.impactedTests.length >= totalKnownTests) {
    return createDecision('full', t('动态拓扑选测覆盖全量测试集', 'Dynamic selection covers the full test set'), impact.impactedTests, files, depGraph, warnings, impact);
  }

  // 11. 精准增量子集
  return createDecision(
    'incremental',
    t(
      `动态拓扑选测覆盖 ${impact.impactedTests.length}/${totalKnownTests} 个测试用例`,
      `Dynamic selection covers ${impact.impactedTests.length}/${totalKnownTests} test file(s)`,
    ),
    impact.impactedTests,
    files,
    depGraph,
    warnings,
    impact
  );
}

function createDecision(mode, reason, impactedTests, changedFiles, graph, warnings = [], impactDetail = null) {
  const totalKnownTests = graph ? graph.testFiles.size : 0;
  const selectedTests = mode === 'full'
    ? (graph ? [...graph.testFiles].sort() : impactedTests)
    : (mode === 'none' ? [] : impactedTests);

  const skipped = totalKnownTests > 0 ? Math.max(0, totalKnownTests - selectedTests.length) : 0;
  const ratio = totalKnownTests > 0 ? Number((skipped / totalKnownTests).toFixed(4)) : 0;

  let edgeCount = 0;
  if (graph) {
    for (const node of graph.nodes.values()) {
      edgeCount += node.dependencies.size;
    }
  }

  return {
    mode,
    reason,
    impactedTests: selectedTests,
    directImpactedTests: impactDetail ? impactDetail.directImpactedTests : [],
    transitiveImpactedTests: impactDetail ? impactDetail.transitiveImpactedTests : [],
    changedFiles,
    unmappedFiles: impactDetail ? impactDetail.unmappedFiles : [],
    totalKnownTests,
    skippedTestsCount: skipped,
    accelerationRatio: ratio,
    warnings,
    graphStats: {
      nodeCount: graph ? graph.nodes.size : 0,
      edgeCount,
      testCount: totalKnownTests,
    },
  };
}

// ── Git 变更区间探测与 CLI 入口 ──────────────────────────────────────────────

export function changedFilesFromGit(range = null, root = ROOT) {
  const args = ['-c', 'core.quotepath=off', 'diff', '--name-only', '--no-renames'];
  if (range && range.oldSha && range.newSha) {
    args.push(`${range.oldSha}..${range.newSha}`);
  } else {
    args.push('HEAD');
  }

  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });

  if (r.status !== 0) {
    return {
      files: [],
      error: t(
        `git diff 失败: ${(r.stderr || '').trim()}`,
        `git diff failed: ${(r.stderr || '').trim()}`,
      ),
    };
  }

  const files = (r.stdout || '')
    .split(/\r?\n/)
    .map(normalizePath)
    .filter(Boolean);

  // git diff HEAD 不列出未跟踪文件。新建且尚未 git add 的源码也是这次改动。
  // core.quotepath=off 必须显式关：Linux/macOS 默认 true 会把非 ASCII 文件名引号转义成
  // `"src/\346\226\260…"`，按拼写比对即漏判「不涉及源码与测试」（同函数上方 git diff 一致）。
  const untracked = spawnSync('git', ['-c', 'core.quotepath=off', 'ls-files', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (untracked.status === 0) {
    for (const line of (untracked.stdout || '').split(/\r?\n/)) {
      const rel = normalizePath(line);
      if (rel && !files.includes(rel)) files.push(rel);
    }
  }

  return { files, error: null };
}

// ── 格式化输出 ────────────────────────────────────────────────────────────────

export function formatDynamicDecision(decision) {
  const lines = [];
  lines.push(t(
    `模式: ${decision.mode} (${decision.reason})`,
    `Mode: ${decision.mode} (${decision.reason})`,
  ));
  lines.push(t(
    `变更文件: ${decision.changedFiles.length} 个`,
    `Changed files: ${decision.changedFiles.length}`,
  ));
  lines.push(t(
    `命中测试: ${decision.impactedTests.length}/${decision.totalKnownTests} 个`,
    `Selected tests: ${decision.impactedTests.length}/${decision.totalKnownTests}`,
  ));
  lines.push(t(
    `跳过测试: ${decision.skippedTestsCount} 个 (加速比 ${(decision.accelerationRatio * 100).toFixed(1)}%)`,
    `Skipped tests: ${decision.skippedTestsCount} (speedup ${(decision.accelerationRatio * 100).toFixed(1)}%)`,
  ));
  if (decision.directImpactedTests.length) {
    lines.push(t(
      `直接影响测试: ${decision.directImpactedTests.length} 个`,
      `Directly impacted tests: ${decision.directImpactedTests.length}`,
    ));
  }
  if (decision.transitiveImpactedTests.length) {
    lines.push(t(
      `间接传导测试: ${decision.transitiveImpactedTests.length} 个`,
      `Transitively impacted tests: ${decision.transitiveImpactedTests.length}`,
    ));
  }
  for (const w of decision.warnings) {
    lines.push(t(`警告: ${w}`, `Warning: ${w}`));
  }
  return lines.join('\n');
}

// CLI 执行入口
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(t(
      [
        '用法: node dynamic-test-impact.mjs [--files a,b] [--range <old> <new>] [--json]',
        '',
        '选项:',
        '  --files <list>       逗号分隔的变更文件。缺省时用 git diff HEAD 加未跟踪文件',
        '  --range <old> <new>  用 git diff old..new 作为变更集合',
        '  --json               输出 JSON',
      ].join('\n'),
      [
        'Usage: node dynamic-test-impact.mjs [--files a,b] [--range <old> <new>] [--json]',
        '',
        'Options:',
        '  --files <list>       Comma-separated changed files. Default is git diff HEAD plus untracked files',
        '  --range <old> <new>  Use git diff old..new as the change set',
        '  --json               Print JSON',
      ].join('\n'),
    ));
    process.exit(0);
  }
  const jsonMode = args.includes('--json');
  let files = [];
  let range = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--files') {
      files = (args[i + 1] || '').split(',').map(normalizePath).filter(Boolean);
      i++;
    } else if (a === '--range') {
      range = { oldSha: args[i + 1], newSha: args[i + 2] };
      i += 2;
    }
  }

  if (files.length === 0 && !range) {
    const gitRes = changedFilesFromGit(null, ROOT);
    files = gitRes.files;
  } else if (range) {
    const gitRes = changedFilesFromGit(range, ROOT);
    files = gitRes.files;
  }

  const decision = selectDynamicTestImpact(ROOT, files);

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  } else {
    console.log(formatDynamicDecision(decision));
  }
}
