#!/usr/bin/env node
// 项目门禁挂载点（.githooks/pre-commit 在通用门禁之后执行本文件；返回非零即阻断提交）
// 回流迁移（2026-09-24）：原 pre-commit 直连的 4 个项目门禁改经本挂载点接线，行为等价
// 任一门禁非零即透传其退出码（沿 sh 版 set -e 语义）——不要在末尾无条件 exit 0
// 自 local-pre-commit(sh) 移植 node（2026-10-08 门禁去 sh 化第二批）
// gate-diet 轻量化：四门并行起跑（实测串行 0.71s → 并行 ≈最慢一门），输出管道捕获后
//   按原顺序重放——四门均为只读扫描器、无共享写状态，并行安全；退出码语义不变（首个非零即透传）
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const HERE = path.dirname(process.argv[1]);
const GATES = ['check-architecture.mjs', 'check-audit-fields.mjs', 'check-delete-guard.mjs', 'check-notify-guard.mjs'];
const results = await Promise.all(GATES.map((gate) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(HERE, gate)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('error', (err) => resolve({ status: 1, out: `${gate} 启动失败: ${err}` }));
  child.on('close', (code) => resolve({ status: code === null ? 1 : code, out }));
})));
let rc = 0;
for (const r of results) {
  if (r.out) process.stdout.write(r.out);
  if (r.status !== 0 && rc === 0) rc = r.status;
}
process.exit(rc);
