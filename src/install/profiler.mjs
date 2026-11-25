import fs from 'node:fs';
import path from 'node:path';

/**
 * 启发式感知项目的产品形态（Product Mode）：
 * - 'monorepo': 多包/多应用工作区 (pnpm-workspace, lerna, turbo, nx, Cargo workspace, packages/apps 目录)
 * - 'cli': 命令行工具 (package.json bin, cmd/ 目录, src/bin/ 目录, Cargo [[bin]])
 * - 'library': 库/包项目 (package.json main/exports 且无前端/服务, src/lib.rs 且无 main.rs)
 * - 'api': 纯后端服务 (Program.cs, app.py, server.js, main.go 等且无前端特征)
 * - 'web': 前后端一体或纯前端 (index.html, vite/next/nuxt 配置, 前端依赖, frontend/client 目录)
 * - null: 无法识别形态（例如空目录、未知结构，调用方通常回退到默认值 'web'）
 */
export function detectProductMode(target) {
  if (!target) return null;
  const abs = path.resolve(target);
  try {
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
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

  // 1. Monorepo 检查 (最高优先级，因为 monorepo 内可能包含多种形态)
  if (
    exists('pnpm-workspace.yaml') ||
    exists('pnpm-workspace.yml') ||
    exists('lerna.json') ||
    exists('turbo.json') ||
    exists('nx.json')
  ) {
    return 'monorepo';
  }

  const pkg = readJson('package.json');
  if (pkg) {
    if (pkg.workspaces && (Array.isArray(pkg.workspaces) || Array.isArray(pkg.workspaces.packages))) {
      return 'monorepo';
    }
  }

  const cargo = readFile('Cargo.toml');
  if (cargo && cargo.includes('[workspace]')) {
    return 'monorepo';
  }

  if ((isDir('packages') || isDir('apps')) && exists('package.json')) {
    try {
      const p1 = isDir('packages') ? fs.readdirSync(path.join(abs, 'packages')) : [];
      const p2 = isDir('apps') ? fs.readdirSync(path.join(abs, 'apps')) : [];
      if (p1.length > 0 || p2.length > 0) {
        return 'monorepo';
      }
    } catch {
      // ignore
    }
  }

  // 辅助检测：前端特征
  const FRONTEND_FILES = [
    'index.html',
    'vite.config.js', 'vite.config.ts', 'vite.config.mjs',
    'next.config.js', 'next.config.mjs', 'next.config.ts',
    'nuxt.config.js', 'nuxt.config.ts',
    'webpack.config.js', 'webpack.config.ts',
    'svelte.config.js', 'astro.config.mjs',
  ];
  const hasFrontendFiles = FRONTEND_FILES.some((f) => exists(f));
  const hasFrontendDir = isDir('frontend') || isDir('client') || isDir('web') || isDir('ui');
  let hasFrontendDeps = false;
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const fePackages = ['vue', 'react', 'react-dom', 'next', 'nuxt', 'svelte', 'solid-js', '@angular/core', 'vite'];
    hasFrontendDeps = fePackages.some((p) => p in deps);
  }
  const hasFrontend = hasFrontendFiles || hasFrontendDir || hasFrontendDeps;

  // 2. CLI 检查
  if (pkg && pkg.bin && (typeof pkg.bin === 'string' || (typeof pkg.bin === 'object' && Object.keys(pkg.bin).length > 0))) {
    return 'cli';
  }
  if (isDir('cmd') || isDir('src/bin')) {
    return 'cli';
  }
  if (cargo && (cargo.includes('[[bin]]') || (exists('src/main.rs') && !exists('src/lib.rs') && !hasFrontend))) {
    return 'cli';
  }

  // 3. API 检查 (后端特征且无前端特征)
  const hasBackendFiles =
    exists('Program.cs') ||
    exists('main.go') ||
    exists('manage.py') ||
    exists('app.py') ||
    exists('server.js') ||
    exists('server.ts') ||
    isDir('src/main/java');

  if (hasBackendFiles && !hasFrontend) {
    return 'api';
  }

  // 4. Web 检查 (有明确前端特征)
  if (hasFrontend) {
    return 'web';
  }

  // 5. Library 检查（高置信度：Rust 纯 lib、或具备 exports/types 分发契约且无 server/start 的 npm 包）
  if (exists('src/lib.rs') && !exists('src/main.rs')) {
    return 'library';
  }
  if (pkg && !pkg.bin && (pkg.exports || (pkg.types && !pkg.scripts?.start)) && !hasFrontend && !hasBackendFiles) {
    return 'library';
  }

  // 未能明确识别
  return null;
}
