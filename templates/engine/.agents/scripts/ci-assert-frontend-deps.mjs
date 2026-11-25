#!/usr/bin/env node
// ci-assert-frontend-deps — CI「npm install 后 devDependencies 是否真落地」的前置断言（通用泛化）
// 动机：CI build 实跑在测试/代码检查门（lint / unit-test / build）容易因
//   `'vitest' / 'eslint' / 'tsc' is not recognized as an internal or external command` 报错——
//   npm install 退出码 0 却少装 devDependencies（NODE_ENV=production 或 omit=dev 常见）。
//   让它在安装后一步当场断言，错误信息直指原因，避免后续各门重复报命令缺失。
// 判据：动态根据目标目录下 package.json 声明的工具依赖检查 node_modules 与 node_modules/.bin 入口。
// 退出码：0 齐全或无须检查；1 缺失（打印可操作的修法）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let ROOT = process.cwd();
try {
  ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
} catch {
  // 非 git 目录回退 cwd
}

const targetArg = process.argv[2];
const FE = targetArg
  ? path.resolve(ROOT, targetArg)
  : (fs.existsSync(path.join(ROOT, 'frontend')) ? path.join(ROOT, 'frontend') : ROOT);

const pkgPath = path.join(FE, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.log(`[ci-assert-frontend-deps] ℹ 跳过：${path.relative(ROOT, FE) || '.'} 下不存在 package.json`);
  process.exit(0);
}

let pkgJson = {};
try {
  pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
} catch (e) {
  console.error(`[ci-assert-frontend-deps] ❌ package.json 解析失败: ${e.message}`);
  process.exit(1);
}

const allDeps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
if (Object.keys(allDeps).length === 0) {
  console.log(`[ci-assert-frontend-deps] ℹ 跳过：${path.relative(ROOT, FE) || '.'} 无依赖声明`);
  process.exit(0);
}

const binDir = path.join(FE, 'node_modules', '.bin');
if (!fs.existsSync(path.join(FE, 'node_modules'))) {
  console.error(`[ci-assert-frontend-deps] ❌ ${path.relative(ROOT, FE) || '.'}/node_modules 不存在——npm install 未执行或工作目录不对（${FE}）`);
  process.exit(1);
}

const CANDIDATES = [
  { pkg: 'vitest', cmd: 'vitest', why: 'unit-test (vitest run)' },
  { pkg: 'jest', cmd: 'jest', why: 'unit-test (jest)' },
  { pkg: 'mocha', cmd: 'mocha', why: 'unit-test (mocha)' },
  { pkg: 'eslint', cmd: 'eslint', why: 'lint (eslint)' },
  { pkg: 'biome', cmd: 'biome', why: 'lint/format (biome)' },
  { pkg: 'vue-tsc', cmd: 'vue-tsc', why: 'typecheck (vue-tsc)' },
  { pkg: 'typescript', cmd: 'tsc', why: 'typecheck (tsc)' },
  { pkg: 'vite', cmd: 'vite', why: 'build (vite)' },
];

const REQUIRED = CANDIDATES.filter((c) => c.pkg in allDeps);
const missing = [];

for (const r of REQUIRED) {
  const depPkgJson = path.join(FE, 'node_modules', r.pkg, 'package.json');
  const bin = path.join(binDir, process.platform === 'win32' ? `${r.cmd}.cmd` : r.cmd);
  if (!fs.existsSync(depPkgJson) || !fs.existsSync(bin)) missing.push(r);
}

if (missing.length) {
  console.error('[ci-assert-frontend-deps] ❌ devDependencies 未落地（npm install 退出码 0 也可能少装）：');
  for (const m of missing) console.error(`  · ${m.pkg}（${m.why}）：缺 node_modules/${m.pkg} 或 node_modules/.bin/${m.cmd}`);
  console.error('[ci-assert-frontend-deps] 常见原因：agent 侧 NODE_ENV=production / npm config omit=dev / 私有源 .npmrc 认证失败导致整包跳过。');
  console.error('[ci-assert-frontend-deps] 修法：npm install --include=dev（并确认 NODE_ENV=development、npm_config_omit 为空）。');
  process.exit(1);
}

const summary = REQUIRED.length > 0 ? REQUIRED.map((r) => r.pkg).join(' / ') : 'node_modules 已就绪';
console.log(`[ci-assert-frontend-deps] ✅ devDependencies 齐全：${summary}（${path.relative(ROOT, binDir)}）`);
