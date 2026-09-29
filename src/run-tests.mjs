// run-tests.mjs — 全套测试入口（npm test）：CLI 单测（sync/add-host/add-gate）+ 引擎 *.test.mjs 套件。
// 顺序执行、任一非零整体失败（exit 1）。check-loop 套件自 2026-09-26 check-loop-node 起为 node 实现
// （check-loop.test.mjs 由下方 glob 自动发现——旧 bash 特判与「无 sh 跳过」提示随迁移退役）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const nodeSuites = [
  'src/sync.test.mjs',
  'src/init.test.mjs',
  'src/pack.test.mjs',
  'src/gates.test.mjs',
  'src/fresh-init.test.mjs',
  // 宿主门禁模块回归（2026-09-27 host-gates-p1：dotnet-ca BRE 豁免/fail-closed + trae 强推 token 化）
  'src/gate-dotnet-ca.test.mjs',
  'src/trae-hooks.test.mjs',
  ...fs.readdirSync(path.join(ROOT, 'templates/_agents/scripts'))
    .filter((f) => f.endsWith('.test.mjs'))
    .sort()
    .map((f) => `templates/_agents/scripts/${f}`),
];

let failed = 0;
for (const rel of nodeSuites) {
  console.log(`\n===== ${rel} =====`);
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log(`\n${failed ? `❌ ${failed} 个套件失败` : '✅ 全部套件通过'}`);
process.exit(failed ? 1 : 0);
