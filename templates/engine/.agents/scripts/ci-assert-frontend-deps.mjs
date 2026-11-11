#!/usr/bin/env node
// ci-assert-frontend-deps — CI「npm install 后 devDependencies 是否真落地」的前置断言（2026-10-29）
// 动机：CI build 实跑红在三条门（frontend-lint / frontend-unit-test）都报
//   `'vitest' is not recognized as an internal or external command` / `'eslint' is not ...`——
//   npm install 退出码 0 却少装 devDependencies（agent 侧 NODE_ENV=production 或 omit=dev 常见）。
//   让它在安装后一步当场失败，错误信息直指原因，而不是三条门各自重复报「命令不存在」。
// 判据：frontend/node_modules/.bin 下 vitest 与 eslint 的可执行入口存在（跨平台判据看包目录）。
// 退出码：0 齐全；1 缺失（打印可操作的修法）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const FE = path.join(ROOT, 'frontend');
const REQUIRED = [
  { pkg: 'vitest', cmd: 'vitest', why: 'frontend-unit-test（vitest run）' },
  { pkg: 'eslint', cmd: 'eslint', why: 'frontend-lint（eslint .）' },
  { pkg: 'vue-tsc', cmd: 'vue-tsc', why: 'frontend-build（vue-tsc -b）' },
];

const binDir = path.join(FE, 'node_modules', '.bin');
if (!fs.existsSync(path.join(FE, 'node_modules'))) {
  console.error(`[ci-assert-frontend-deps] ❌ frontend/node_modules 不存在——npm install 未执行或工作目录不对（${FE}）`);
  process.exit(1);
}

const missing = [];
for (const r of REQUIRED) {
  const pkgJson = path.join(FE, 'node_modules', r.pkg, 'package.json');
  const bin = path.join(binDir, process.platform === 'win32' ? `${r.cmd}.cmd` : r.cmd);
  if (!fs.existsSync(pkgJson) || !fs.existsSync(bin)) missing.push(r);
}

if (missing.length) {
  console.error('[ci-assert-frontend-deps] ❌ devDependencies 未落地（npm install 退出码 0 也可能少装）：');
  for (const m of missing) console.error(`  · ${m.pkg}（${m.why}）：缺 node_modules/${m.pkg} 或 node_modules/.bin/${m.cmd}`);
  console.error('[ci-assert-frontend-deps] 常见原因：agent 侧 NODE_ENV=production / npm config omit=dev / 私有源 .npmrc 认证失败导致整包跳过。');
  console.error('[ci-assert-frontend-deps] 修法：npm install --legacy-peer-deps --include=dev（并确认 NODE_ENV=development、npm_config_omit 为空）。');
  process.exit(1);
}

console.log(`[ci-assert-frontend-deps] ✅ devDependencies 齐全：${REQUIRED.map((r) => r.pkg).join(' / ')}（${path.relative(ROOT, binDir)}）`);
