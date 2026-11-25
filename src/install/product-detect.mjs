import fs from 'node:fs';
import path from 'node:path';

/**
 * 启发式感知项目的产品形态（Product Mode）：
 * - 'monorepo': 多包/多应用工作区 (pnpm-workspace, lerna, turbo, nx, Cargo workspace, packages/apps 目录含子包)
 * - 'cli': 命令行工具 (package.json bin, cmd/ 目录, src/bin/ 目录, Cargo [[bin]])
 * - 'library': 库/包项目 (package.json main/exports 且无前端/服务, src/lib.rs 且无 main.rs)
 * - 'api': 纯后端服务 (Program.cs, app.py, server.js, main.go 等且无前端特征)
 * - 'web': 前后端一体或纯前端 (index.html, vite/next/nuxt 配置, 前端依赖, frontend/client 目录,
 *   服务端渲染界面：ASP.NET ClientApp/Views/wwwroot/Pages、Spring MVC 模板、Django 非 DRF)
 * - null: 无法识别形态（例如空目录、未知结构，调用方通常回退到默认值 'web'）
 *
 * detectProductModeDetailed 额外返回一句判定依据（reason），供安装输出解释自动探测结果。
 */
export function detectProductModeDetailed(target) {
  if (!target) return { mode: null, reason: null };
  const abs = path.resolve(target);
  try {
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) return { mode: null, reason: null };
  } catch {
    return { mode: null, reason: null };
  }

  const exists = (rel) => fs.existsSync(path.join(abs, rel));
  const isDir = (rel) => {
    try {
      return fs.statSync(path.join(abs, rel)).isDirectory();
    } catch {
      return false;
    }
  };
  const readFile = (rel) => {
    try {
      return fs.readFileSync(path.join(abs, rel), 'utf8');
    } catch {
      return null;
    }
  };
  const readJson = (rel) => {
    try {
      return JSON.parse(readFile(rel));
    } catch {
      return null;
    }
  };
  // packages/ apps/ 目录本身不代表 monorepo：至少一个直接子目录含 package.json 才算。
  const hasChildPackageJson = (rel) => {
    if (!isDir(rel)) return false;
    try {
      return fs.readdirSync(path.join(abs, rel)).some((name) => {
        try {
          return fs.statSync(path.join(abs, rel, name)).isDirectory()
            && fs.existsSync(path.join(abs, rel, name, 'package.json'));
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  };

  // 1. Monorepo 检查 (最高优先级，因为 monorepo 内可能包含多种形态)
  const workspaceFile = ['pnpm-workspace.yaml', 'pnpm-workspace.yml', 'lerna.json', 'turbo.json', 'nx.json']
    .find((f) => exists(f));
  if (workspaceFile) {
    return { mode: 'monorepo', reason: workspaceFile };
  }

  const pkg = readJson('package.json');
  if (pkg) {
    if (pkg.workspaces && (Array.isArray(pkg.workspaces) || Array.isArray(pkg.workspaces.packages))) {
      return { mode: 'monorepo', reason: 'package.json workspaces' };
    }
  }

  const cargo = readFile('Cargo.toml');
  if (cargo && cargo.includes('[workspace]')) {
    return { mode: 'monorepo', reason: 'Cargo.toml [workspace]' };
  }

  for (const rel of ['packages', 'apps']) {
    if (exists('package.json') && hasChildPackageJson(rel)) {
      return { mode: 'monorepo', reason: `${rel}/*/package.json` };
    }
  }

  // 辅助检测：前端特征（含服务端渲染界面的框架约定）
  const FRONTEND_FILES = [
    'index.html',
    'vite.config.js', 'vite.config.ts', 'vite.config.mjs',
    'next.config.js', 'next.config.mjs', 'next.config.ts',
    'nuxt.config.js', 'nuxt.config.ts',
    'webpack.config.js', 'webpack.config.ts',
    'svelte.config.js', 'astro.config.mjs',
  ];
  const frontendEvidence = [];
  const frontendFile = FRONTEND_FILES.find((f) => exists(f));
  if (frontendFile) frontendEvidence.push(frontendFile);
  const frontendDir = ['frontend', 'client', 'web', 'ui', 'ClientApp'].find((d) => isDir(d));
  if (frontendDir) frontendEvidence.push(`${frontendDir}/`);

  let hasCsproj = false;
  try {
    hasCsproj = fs.readdirSync(abs).some((name) => {
      try {
        return name.endsWith('.csproj') && fs.statSync(path.join(abs, name)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    // ignore
  }
  if (isDir('Views') && isDir('wwwroot')) {
    frontendEvidence.push('Views/ + wwwroot/');
  } else if (isDir('Pages') && hasCsproj) {
    frontendEvidence.push('Pages/ + .csproj');
  }
  const springView = ['src/main/resources/templates', 'src/main/webapp'].find((d) => isDir(d));
  if (springView) frontendEvidence.push(`${springView}/`);

  // Django：默认有服务端渲染界面；仅当依赖里有 DRF 时才按纯后端处理。
  const django = exists('manage.py');
  let drf = false;
  if (django) {
    const pythonManifests = [];
    try {
      for (const name of fs.readdirSync(abs)) {
        if (/^requirements.*\.txt$/i.test(name) || name === 'pyproject.toml' || name === 'Pipfile') {
          pythonManifests.push(name);
        }
      }
    } catch {
      // ignore
    }
    drf = pythonManifests.some((name) => {
      const text = readFile(name);
      return text !== null && (text.includes('djangorestframework') || text.includes('drf'));
    });
    if (!drf) frontendEvidence.push('manage.py');
  }

  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const fePackages = ['vue', 'react', 'react-dom', 'next', 'nuxt', 'svelte', 'solid-js', '@angular/core', 'vite'];
    const feDep = fePackages.find((p) => p in deps);
    if (feDep) frontendEvidence.push(`package.json: ${feDep}`);
  }
  const hasFrontend = frontendEvidence.length > 0;

  // Go 服务惯例放在 cmd/<名字>/ 下：仅当 cmd/*/ 里的 .go 导入 net/http 才按后端处理，不落入 CLI 分支。
  let goServer = false;
  if (exists('go.mod') && isDir('cmd')) {
    try {
      for (const entry of fs.readdirSync(path.join(abs, 'cmd'))) {
        const entryPath = path.join(abs, 'cmd', entry);
        if (!fs.statSync(entryPath).isDirectory()) continue;
        for (const file of fs.readdirSync(entryPath)) {
          if (!file.endsWith('.go')) continue;
          const src = readFile(path.join('cmd', entry, file));
          if (src && src.includes('"net/http"')) {
            goServer = true;
            break;
          }
        }
        if (goServer) break;
      }
    } catch {
      // ignore
    }
  }

  // 2. CLI 检查
  if (pkg && pkg.bin && (typeof pkg.bin === 'string' || (typeof pkg.bin === 'object' && Object.keys(pkg.bin).length > 0))) {
    return { mode: 'cli', reason: 'package.json bin' };
  }
  if (isDir('cmd') && !goServer) {
    return { mode: 'cli', reason: 'cmd/' };
  }
  if (isDir('src/bin')) {
    return { mode: 'cli', reason: 'src/bin/' };
  }
  if (cargo && cargo.includes('[[bin]]')) {
    return { mode: 'cli', reason: 'Cargo.toml [[bin]]' };
  }
  if (cargo && exists('src/main.rs') && !exists('src/lib.rs') && !hasFrontend) {
    return { mode: 'cli', reason: 'src/main.rs' };
  }

  // 3. API 检查 (后端特征且无前端特征)
  const backendEvidence = ['Program.cs', 'main.go', 'manage.py', 'app.py', 'server.js', 'server.ts']
    .filter((f) => exists(f));
  if (isDir('src/main/java')) backendEvidence.push('src/main/java/');
  if (goServer) backendEvidence.push('go.mod + cmd/*/ net/http');
  if (drf) backendEvidence.push('djangorestframework');

  if (backendEvidence.length && !hasFrontend) {
    return { mode: 'api', reason: backendEvidence.join(' + ') };
  }

  // 4. Web 检查 (有明确前端特征)
  if (hasFrontend) {
    return { mode: 'web', reason: [...new Set([...backendEvidence, ...frontendEvidence])].join(' + ') };
  }

  // 5. Library 检查（高置信度：Rust 纯 lib、或具备 exports/types 分发契约且无 server/start 的 npm 包）
  if (exists('src/lib.rs') && !exists('src/main.rs')) {
    return { mode: 'library', reason: 'src/lib.rs' };
  }
  if (pkg && !pkg.bin && (pkg.exports || (pkg.types && !pkg.scripts?.start)) && !hasFrontend && !backendEvidence.length) {
    return { mode: 'library', reason: 'package.json exports/types' };
  }

  // 未能明确识别
  return { mode: null, reason: null };
}

export function detectProductMode(target) {
  return detectProductModeDetailed(target).mode;
}
