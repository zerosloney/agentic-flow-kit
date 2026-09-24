// run-tests.mjs — 全套测试入口（npm test）：CLI 单测（sync/add-host/add-gate）+ 引擎 *.test.mjs + check-loop bash 套件。
// 顺序执行、任一非零整体失败（exit 1）；无 sh 环境（极简 Windows）跳过 bash 套件并显著提示。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const nodeSuites = [
  'src/sync.test.mjs',
  'src/init.test.mjs',
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

const shSuite = 'templates/_agents/scripts/check-loop.test.sh';
if (spawnSync('sh', ['-c', 'true']).status === 0) {
  console.log(`\n===== ${shSuite}（bash 套件） =====`);
  const r = spawnSync('sh', [path.join(ROOT, shSuite)], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) failed++;
} else {
  console.warn(`\n⚠️ 环境无 sh——跳过 ${shSuite}（装 Git Bash / 在 WSL 里补跑，勿静默当作通过）`);
}

console.log(`\n${failed ? `❌ ${failed} 个套件失败` : '✅ 全部套件通过'}`);
process.exit(failed ? 1 : 0);
