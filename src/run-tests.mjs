// run-tests.mjs — 全套测试入口（npm test）：lint 首步 + CLI 单测（sync/add-host/add-gate）+ 引擎 *.test.mjs 套件。
// 顺序执行、任一非零整体失败（exit 1）。check-loop 套件自 2026-09-26 check-loop-node 起为 node 实现
// （check-loop.test.mjs 由下方 glob 自动发现——旧 bash 特判与「无 sh 跳过」提示随迁移退役）。
// lint 首步（2026-10-08 engine-quality-batch）：eslint 仅 devDependency（包源仓）——检测到未安装时
// 显式打印 skip 后继续（裸 checkout 未 npm install 场景的可诊断性；装户仓无本编排器不涉及），
// 已安装但报错则 fail-closed 计入失败。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// src/ 侧按盘面枚举，不硬编码清单（2026-10-09 审查 P0-1）——此前硬编码 8 项，`src/sync-hosts.test.mjs`
// 漏挂：npm test 不跑它，CI 也盖不住（ci.yml shipped 步骤只 glob `.agents/scripts/*.test.mjs`），
// 而 `templates/_agents/commands/sync-hosts.md:62`「npm test 含 sync-hosts.test.mjs 8 场景」随模板
// 下发 5 个装户宿主。检查 20 只扫 `templates/_agents/scripts/` 面，结构上抓不到 src/ 漏挂。
// 改 glob 后：新增 src 测试文件不可能再被静默漏跑（枚举漂移由盘面兜住，不靠人记得补）。
// 含宿主门禁模块回归（2026-09-27 host-gates-p1：dotnet-ca BRE 豁免/fail-closed + trae 强推 token 化）。
const nodeSuites = [
  ...fs.readdirSync(path.join(ROOT, 'src'))
    .filter((f) => f.endsWith('.test.mjs'))
    .sort()
    .map((f) => `src/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'templates/_agents/scripts'))
    .filter((f) => f.endsWith('.test.mjs'))
    .sort()
    .map((f) => `templates/_agents/scripts/${f}`),
];

let failed = 0;

// lint 首步：eslint 可用性探测 = require.resolve 于包源仓 node_modules（裸 checkout 解析失败 → 显式跳过）
console.log('\n===== lint（eslint .）=====');
const eslintEntry = spawnSync(process.execPath, ['-e', "require.resolve('eslint')"], { cwd: ROOT, encoding: 'utf8' });
if (eslintEntry.status !== 0) {
  console.log('[lint] skipped: eslint not installed（npm install 后启用；仅包源仓场景）');
} else {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/eslint/bin/eslint.js'), '.'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

for (const rel of nodeSuites) {
  console.log(`\n===== ${rel} =====`);
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log(`\n${failed ? `❌ ${failed} 个套件失败` : '✅ 全部套件通过'}`);
// 机器可读汇总行（2026-10-09 审查 P0-2）：verify.mjs 的凭证计数**只认这一行**。
// 此前它 pop 通配「合计: PASS n / FAIL n」，而 45+ 套件每个都打印自己那行同形文本——
// 取到的是字母序最后一个套件的场景数（本仓实况：workflows-check.test.mjs 的 15），
// 于是「一行机器事实」的 passed 字段落成了错的事实。独立前缀 + 套件口径，嵌套同形行不再被误取。
// 口径：SUITES = 本编排器实际执行的套件数（lint 不计入；lint 红照样 exit 1，凭证不落）。
console.log(`[run-tests] 合计: SUITES ${nodeSuites.length} / FAILED ${failed}`);
process.exit(failed ? 1 : 0);
