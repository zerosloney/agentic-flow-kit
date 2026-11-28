import fs from 'node:fs';
import path from 'node:path';
import { makeT } from '../i18n.mjs';
import { globToRegExp } from '../rules/glob.mjs';

export const ARCH_CONFIG_REL = path.join('.agents', 'config', 'architecture.json');

export const ARCH_PRESETS = {
  clean: {
    $schema: 'https://agentic-flow-kit.org/schemas/architecture.v1.json',
    version: 1,
    description: 'Clean Architecture / 洋葱架构分层约束',
    layers: {
      domain: {
        path: 'src/domain/**',
        disallow: ['infra', 'web', 'app', 'controllers'],
        description: '纯业务实体与核心模型，禁止反向依赖外部层',
      },
      app: {
        path: 'src/app/**',
        disallow: ['infra', 'web', 'controllers'],
        description: '用例与编排层，禁止依赖外层基础设施与表现层',
      },
      infra: {
        path: 'src/infra/**',
        disallow: ['web', 'controllers'],
        description: '基础设施层（持久化、外部适配器）',
      },
      web: {
        path: 'src/web/**',
        disallow: [],
        description: '控制层、API 路由与外部接入点',
      },
    },
    rules: {
      noCircularDependencies: true,
      noPrivateImports: true,
    },
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/tests/**', '**/.agents/**', '**/.git/**'],
  },
  ddd: {
    $schema: 'https://agentic-flow-kit.org/schemas/architecture.v1.json',
    version: 1,
    description: 'Domain-Driven Design (DDD) 领域驱动设计分层约束',
    layers: {
      domain: {
        path: 'src/domain/**',
        disallow: ['infrastructure', 'interfaces', 'application'],
        description: '领域核心模型、仓储接口与领域服务',
      },
      application: {
        path: 'src/application/**',
        disallow: ['infrastructure', 'interfaces'],
        description: '应用服务与 DTO 转换',
      },
      infrastructure: {
        path: 'src/infrastructure/**',
        disallow: ['interfaces'],
        description: '仓储实现、三方 SDK 接入',
      },
      interfaces: {
        path: 'src/interfaces/**',
        disallow: [],
        description: '用户接口与 HTTP/RPC 入口',
      },
    },
    rules: {
      noCircularDependencies: true,
      noPrivateImports: true,
    },
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/tests/**', '**/.agents/**', '**/.git/**'],
  },
  layered: {
    $schema: 'https://agentic-flow-kit.org/schemas/architecture.v1.json',
    version: 1,
    description: '标准三层 Web 架构分层约束',
    layers: {
      models: {
        path: 'src/models/**',
        disallow: ['services', 'controllers', 'routes'],
        description: '基础数据实体与持久化模型',
      },
      services: {
        path: 'src/services/**',
        disallow: ['controllers', 'routes'],
        description: '业务服务处理逻辑',
      },
      controllers: {
        path: 'src/controllers/**',
        disallow: [],
        description: '请求接入与控制器',
      },
    },
    rules: {
      noCircularDependencies: true,
      noPrivateImports: true,
    },
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/tests/**', '**/.agents/**', '**/.git/**'],
  },
};

export function matchGlob(pattern, filePath) {
  const p = String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const pat = String(pattern || '').replace(/\\/g, '/').replace(/^\.\//, '');
  return globToRegExp(pat).test(p);
}

export function stripComments(source, ext) {
  if (ext === '.py') {
    return source.replace(/#.*$/gm, '');
  }
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

export function extractImports(source, ext) {
  const clean = stripComments(source, ext);
  const specifiers = new Set();

  if (['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx'].includes(ext)) {
    const importExportFrom = /(?:import|export)\s+(?:[\w*\s{},$]+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importExportFrom.exec(clean)) !== null) {
      specifiers.add(match[1]);
    }
    const dynamicOrRequire = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicOrRequire.exec(clean)) !== null) {
      specifiers.add(match[1]);
    }
  } else if (ext === '.py') {
    const fromImport = /^\s*from\s+([.\w]+)\s+import/gm;
    let match;
    while ((match = fromImport.exec(clean)) !== null) {
      specifiers.add(match[1]);
    }
    const importStmt = /^\s*import\s+([^\n\r]+)/gm;
    while ((match = importStmt.exec(clean)) !== null) {
      for (const part of match[1].split(',')) {
        const cleanPart = part.trim().replace(/\s+as\s+\w+/, '').trim();
        if (cleanPart) specifiers.add(cleanPart);
      }
    }
  } else if (ext === '.go') {
    const singleImport = /import\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = singleImport.exec(clean)) !== null) {
      specifiers.add(match[1]);
    }
    const blockImport = /import\s*\(\s*([\s\S]*?)\s*\)/g;
    while ((match = blockImport.exec(clean)) !== null) {
      const lines = match[1].match(/['"]([^'"]+)['"]/g) || [];
      for (const l of lines) {
        specifiers.add(l.replace(/['"]/g, ''));
      }
    }
  }

  return [...specifiers];
}

const CANDIDATE_EXTS = ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.py', '.go'];

export function resolveImportPath(fromFileRel, specifier, root) {
  // 过滤内置模块与网络路径
  if (/^(node:|https?:|bun:)/.test(specifier)) return null;

  let candidateBase = null;
  if (specifier.startsWith('.')) {
    candidateBase = path.normalize(path.join(path.dirname(fromFileRel), specifier));
  } else if (specifier.startsWith('/') || specifier.startsWith('src/') || specifier.startsWith('@/')) {
    const cleanSpec = specifier.replace(/^[@/]+/, '');
    candidateBase = path.normalize(cleanSpec);
  } else {
    // 相对项目根目录探测（Python module 或根相对 import）
    const pyPath = specifier.replace(/\./g, '/');
    candidateBase = path.normalize(pyPath);
  }

  const normBase = candidateBase.replace(/\\/g, '/');
  const fullBase = path.join(root, normBase);

  // 1. 直接匹配存在的文件
  if (fs.existsSync(fullBase) && fs.statSync(fullBase).isFile()) {
    return normBase;
  }

  // 2. 补齐扩展名
  for (const ext of CANDIDATE_EXTS) {
    const fullWithExt = `${fullBase}${ext}`;
    if (fs.existsSync(fullWithExt) && fs.statSync(fullWithExt).isFile()) {
      return `${normBase}${ext}`;
    }
  }

  // 3. index 索引文件
  for (const ext of CANDIDATE_EXTS) {
    const fullIndex = path.join(fullBase, `index${ext}`);
    if (fs.existsSync(fullIndex) && fs.statSync(fullIndex).isFile()) {
      return `${normBase}/index${ext}`.replace(/\\/g, '/');
    }
  }

  return null;
}

export function listProjectSourceFiles(root, excludePatterns = []) {
  const result = [];
  const defaultExcludes = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/.agents/**'];
  const allExcludes = [...defaultExcludes, ...excludePatterns];

  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');

      let isExcluded = false;
      for (const pat of allExcludes) {
        if (matchGlob(pat, rel)) {
          isExcluded = true;
          break;
        }
      }
      if (isExcluded) continue;

      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name);
        if (CANDIDATE_EXTS.includes(ext)) {
          result.push(rel);
        }
      }
    }
  }

  walk(root);
  return result.sort();
}

export function buildDependencyGraph(root, config = {}) {
  const exclude = config.exclude || [];
  const files = listProjectSourceFiles(root, exclude);
  const graph = new Map();

  for (const fileRel of files) {
    const ext = path.extname(fileRel);
    const fullPath = path.join(root, fileRel);
    let content = '';
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    const rawImports = extractImports(content, ext);
    const resolvedDeps = new Set();

    for (const spec of rawImports) {
      const resolved = resolveImportPath(fileRel, spec, root);
      if (resolved && resolved !== fileRel) {
        resolvedDeps.add(resolved);
      }
    }

    graph.set(fileRel, resolvedDeps);
  }

  return graph;
}

export function detectCircularDependencies(graph) {
  const visited = new Set();
  const stack = [];
  const inStack = new Set();
  const cycles = [];
  const reportedCycleKeys = new Set();

  function dfs(node) {
    visited.add(node);
    stack.push(node);
    inStack.add(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (inStack.has(neighbor)) {
        const cycleStartIndex = stack.indexOf(neighbor);
        const cyclePath = stack.slice(cycleStartIndex).concat(neighbor);
        const minNode = cyclePath.slice(0, -1).reduce((min, cur) => (cur < min ? cur : min));
        const minIdx = cyclePath.indexOf(minNode);
        const normalized = cyclePath.slice(minIdx, -1).concat(cyclePath.slice(0, minIdx)).concat(minNode);
        const cycleKey = normalized.join(' -> ');
        if (!reportedCycleKeys.has(cycleKey)) {
          reportedCycleKeys.add(cycleKey);
          cycles.push(cyclePath);
        }
      }
    }

    stack.pop();
    inStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

export function checkLayerBoundaries(graph, config) {
  const layers = config.layers || {};
  const violations = [];

  function getFileLayer(fileRel) {
    for (const [layerName, layerDef] of Object.entries(layers)) {
      if (layerDef.path && matchGlob(layerDef.path, fileRel)) {
        return layerName;
      }
    }
    return null;
  }

  for (const [fromFile, targets] of graph.entries()) {
    const fromLayer = getFileLayer(fromFile);
    if (!fromLayer) continue;

    const layerDef = layers[fromLayer];
    const disallow = Array.isArray(layerDef.disallow) ? layerDef.disallow : [];
    if (!disallow.length) continue;

    for (const targetFile of targets) {
      const targetLayer = getFileLayer(targetFile);
      if (targetLayer && disallow.includes(targetLayer)) {
        violations.push({
          fromFile,
          fromLayer,
          targetFile,
          targetLayer,
          reason: `Layer '${fromLayer}' (${layerDef.path}) is disallowed from importing Layer '${targetLayer}' (${layers[targetLayer]?.path || targetLayer})`,
        });
      }
    }
  }

  return violations;
}

export function checkPrivateImports(graph, config) {
  if (!config.rules?.noPrivateImports) return [];
  const violations = [];

  for (const [fromFile, targets] of graph.entries()) {
    for (const targetFile of targets) {
      const match = /(?:^|\/)(modules\/[^/]+|[^/]+)\/internal\//.exec(targetFile);
      if (match) {
        const allowedPrefix = targetFile.slice(0, targetFile.indexOf('/internal/') + 1);
        if (!fromFile.startsWith(allowedPrefix)) {
          violations.push({
            fromFile,
            targetFile,
            reason: `Private internal module '${targetFile}' cannot be imported from outside '${allowedPrefix}'`,
          });
        }
      }
    }
  }

  return violations;
}

export function loadArchConfig(root) {
  const file = path.join(root, ARCH_CONFIG_REL);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (cause) {
    const err = new Error(`invalid architecture.json: ${cause.message}`);
    err.code = 'BAD_ARCH_CONFIG';
    throw err;
  }
}

export function initArchConfig(root, options = {}) {
  const presetKey = options.preset || 'clean';
  const preset = ARCH_PRESETS[presetKey];
  if (!preset) {
    const t = options.t || makeT('zh-CN');
    const err = new Error(t('error.archPresetUnknown', {
      value: presetKey,
      presets: Object.keys(ARCH_PRESETS).join(' / '),
    }));
    err.code = 'BAD_ARGS';
    throw err;
  }
  const file = path.join(root, ARCH_CONFIG_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(preset, null, 2)}\n`, 'utf8');
  return preset;
}

export function evaluateArchitecture(root, customConfig = null) {
  const config = customConfig || loadArchConfig(root);
  if (!config) {
    return {
      hasConfig: false,
      ok: true,
      totalFiles: 0,
      cycles: [],
      boundaryViolations: [],
      privateViolations: [],
      graph: new Map(),
    };
  }

  const graph = buildDependencyGraph(root, config);
  const cycles = config.rules?.noCircularDependencies !== false
    ? detectCircularDependencies(graph)
    : [];
  const boundaryViolations = checkLayerBoundaries(graph, config);
  const privateViolations = checkPrivateImports(graph, config);

  const ok = cycles.length === 0 && boundaryViolations.length === 0 && privateViolations.length === 0;

  return {
    hasConfig: true,
    ok,
    config,
    totalFiles: graph.size,
    cycles,
    boundaryViolations,
    privateViolations,
    graph,
  };
}

export function generateArchitectureMermaid(graph, config, violations = []) {
  const lines = ['flowchart TD'];
  const layers = config?.layers || {};

  const layerFiles = {};
  const ungrouped = [];

  function getFileLayer(fileRel) {
    for (const [layerName, layerDef] of Object.entries(layers)) {
      if (layerDef.path && matchGlob(layerDef.path, fileRel)) {
        return layerName;
      }
    }
    return null;
  }

  const allFiles = new Set([
    ...graph.keys(),
    ...[...graph.values()].flatMap((s) => [...s]),
  ]);

  for (const file of allFiles) {
    const layer = getFileLayer(file);
    if (layer) {
      if (!layerFiles[layer]) layerFiles[layer] = [];
      layerFiles[layer].push(file);
    } else {
      ungrouped.push(file);
    }
  }

  let nodeId = 1;
  const fileToId = new Map();

  for (const [layerName, files] of Object.entries(layerFiles)) {
    lines.push(`  subgraph ${layerName}["Layer: ${layerName}"]`);
    for (const file of files) {
      const id = `node_${nodeId++}`;
      fileToId.set(file, id);
      const label = path.basename(file);
      lines.push(`    ${id}["${label}"]`);
    }
    lines.push('  end');
  }

  if (ungrouped.length > 0) {
    lines.push('  subgraph other["Other Files"]');
    for (const file of ungrouped) {
      const id = `node_${nodeId++}`;
      fileToId.set(file, id);
      const label = path.basename(file);
      lines.push(`    ${id}["${label}"]`);
    }
    lines.push('  end');
  }

  const violationEdges = new Set(
    violations.map((v) => `${v.fromFile}-->${v.targetFile}`),
  );

  for (const [fromFile, targets] of graph.entries()) {
    const fromId = fileToId.get(fromFile);
    if (!fromId) continue;
    for (const targetFile of targets) {
      const targetId = fileToId.get(targetFile);
      if (!targetId) continue;
      const key = `${fromFile}-->${targetFile}`;
      if (violationEdges.has(key)) {
        lines.push(`  ${fromId} -.->|VIOLATION| ${targetId}`);
      } else {
        lines.push(`  ${fromId} --> ${targetId}`);
      }
    }
  }

  return lines.join('\n');
}

