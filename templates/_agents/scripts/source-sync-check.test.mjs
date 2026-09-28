// source-sync-check.test.mjs — 装户面同步一致性检查工具测试（2026-09-25 source-sync-check）
// 方法：fixture mini 包源（templates/_agents/） + 装副本（.agents/），调 sourceSyncCheck() 拿三类差异
//       + 实际仓库扫描做 baseline
// 判据：①fixture 三类齐全  ②cache/ 排除  ③kit.json/settings.json 排除  ④sha 一致  ⑤baseline ≥ 100  ⑥JSON 可解析
// 用法：node .agents/scripts/source-sync-check.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceSyncCheck } from './source-sync-check.mjs';

let pass = 0, failCount = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { failCount++; console.log('FAIL ' + name + (detail ? '——' + detail : '')); }
}

// SRC_ROOT：自测试文件位置向上探测包源（templates/_agents）——包源路径（templates/_agents/scripts/）与
// 装副本路径（.agents/scripts/）直跑都解析到仓库根；无包源（装户环境）返回 null，S5/S9 baseline 记 SKIP
// 不算失败（2026-09-27 gate-hardening-p2-batch：旧 `../../..` 硬编码层级从装副本直跑必 FAIL）
const findSrcRoot = () => {
  let d = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(d, 'templates', '_agents'))) return d;
    d = path.dirname(d);
  }
  return null;
};
const SRC_ROOT = findSrcRoot();
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'source-sync-check.mjs');
const runGate = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

// ---- fixture：mini 包源 + 装副本，3 类差异各造 1 个 ----
function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-ssc-'));
  const pkgRoot = path.join(root, 'pkg');
  const target = path.join(root, 'target');
  const pkgBase = path.join(pkgRoot, 'templates', '_agents');
  const tgtBase = path.join(target, '.agents');
  fs.mkdirSync(path.join(pkgBase, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(pkgBase, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(pkgBase, 'cache'), { recursive: true }); // 应排除
  fs.mkdirSync(path.join(tgtBase, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(tgtBase, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tgtBase, 'hooks'), { recursive: true }); // 孤儿
  fs.mkdirSync(path.join(tgtBase, 'cache'), { recursive: true }); // 装副本 cache 也应排除
  // 一致文件（cmdA.md）：包源 + 装副本 同内容
  fs.writeFileSync(path.join(pkgBase, 'commands', 'cmdA.md'), '# cmdA v1\n');
  fs.writeFileSync(path.join(tgtBase, 'commands', 'cmdA.md'), '# cmdA v1\n');
  // 缺失（cmdB.md）：包源有 / 装副本无
  fs.writeFileSync(path.join(pkgBase, 'commands', 'cmdB.md'), '# cmdB v1\n');
  // 孤儿（orphan-real.json）：装副本 hooks/ 有 / 包源无（普通孤儿，应被报告）
  fs.writeFileSync(path.join(tgtBase, 'hooks', 'orphan-real.json'), '{}\n');
  // 白名单孤儿（commit-check.config.json）：装副本 hooks/ 有 / 包源无，但 init 渲染产物不应报孤儿
  fs.writeFileSync(path.join(tgtBase, 'hooks', 'commit-check.config.json'), '{}\n');
  // 装副本独有（应排除）：kit.json / settings.json
  fs.writeFileSync(path.join(tgtBase, 'kit.json'), '{}\n');
  fs.writeFileSync(path.join(tgtBase, 'settings.json'), '{}\n');
  // 漂移（scriptX.mjs）：包源 v1 / 装副本 v2
  fs.writeFileSync(path.join(pkgBase, 'scripts', 'scriptX.mjs'), 'export const X = 1;\n');
  fs.writeFileSync(path.join(tgtBase, 'scripts', 'scriptX.mjs'), 'export const X = 2;\n');
  // cache/ 排除：包源 + 装副本 都有，但不应被计入
  fs.writeFileSync(path.join(pkgBase, 'cache', 'foo.md'), 'cache-pkg\n');
  fs.writeFileSync(path.join(tgtBase, 'cache', 'foo.md'), 'cache-tgt\n');
  return { pkgRoot, target };
}

// ---- 场景 1：fixture 三类差异齐全（缺失 1 / 孤儿 1 / 漂移 1）----
{
  const { pkgRoot, target } = mkFixture();
  const r = sourceSyncCheck({ pkgRoot, target });
  check('S1 fixture 缺失 1（cmdB.md）', r.missing.length === 1 && r.missing[0].rel === 'commands/cmdB.md', JSON.stringify(r.missing));
  check('S1 fixture 孤儿 1（orphan-real.json）', r.orphan.length === 1 && r.orphan[0].rel === 'hooks/orphan-real.json', JSON.stringify(r.orphan));
  check('S1 fixture 漂移 1（scriptX.mjs）', r.drift.length === 1 && r.drift[0].rel === 'scripts/scriptX.mjs', JSON.stringify(r.drift));
  check('S1 fixture 白名单项（commit-check.config.json）不在孤儿', !r.orphan.some((o) => o.rel === 'hooks/commit-check.config.json'));
}

// ---- 场景 2：cache/ 目录排除 ----
{
  const { pkgRoot, target } = mkFixture();
  const r = sourceSyncCheck({ pkgRoot, target });
  check('S2 cache/ 排除（缺失/孤儿/漂移不含 cache/foo.md）',
    !r.missing.some((m) => m.rel.includes('cache/')) &&
    !r.orphan.some((o) => o.rel.includes('cache/')) &&
    !r.drift.some((d) => d.rel.includes('cache/')));
}

// ---- 场景 3：装副本独有（kit.json / settings.json）排除 ----
{
  const { pkgRoot, target } = mkFixture();
  const r = sourceSyncCheck({ pkgRoot, target });
  check('S3 装副本独有（kit.json / settings.json）排除',
    !r.orphan.some((o) => o.rel === 'kit.json' || o.rel === 'settings.json'));
}

// ---- 场景 4：sha 一致文件不出现在漂移列表 ----
{
  const { pkgRoot, target } = mkFixture();
  const r = sourceSyncCheck({ pkgRoot, target });
  check('S4 一致文件 cmdA.md 不在漂移', !r.drift.some((d) => d.rel === 'commands/cmdA.md'));
}

// ---- 场景 5：实际仓库扫描 baseline（包源 ≥ 30 份 / 装副本 ≥ 30 份；装户环境无包源 → SKIP）----
if (!SRC_ROOT) {
  check('S5 baseline SKIP（未探测到包源 templates/_agents——装户环境直跑，不算失败）', true);
} else {
  const r = sourceSyncCheck({ pkgRoot: SRC_ROOT, target: SRC_ROOT });
  check('S5 实际仓库 包源 ≥ 30 份', r.pkgCount >= 30, '实际 ' + r.pkgCount);
  check('S5 实际仓库 装副本 ≥ 30 份', r.tgtCount >= 30, '实际 ' + r.tgtCount);
  // 装副本 kit.json / settings.json 不应在孤儿
  check('S5 实际仓库 装副本独有（kit.json / settings.json）排除',
    !r.orphan.some((o) => o.rel === 'kit.json' || o.rel === 'settings.json'));
}

// ---- 场景 6：--json 输出可解析（CLI 子流程）----
{
  const { pkgRoot, target } = mkFixture();
  // 直接调 sourceSyncCheck + 序列化模拟 --json 输出
  const r = sourceSyncCheck({ pkgRoot, target });
  const jsonOut = JSON.stringify({
    pkgCount: r.pkgCount, tgtCount: r.tgtCount,
    missing: r.missing.map((m) => m.rel),
    orphan: r.orphan.map((o) => o.rel),
    drift: r.drift.map((d) => ({ rel: d.rel, pkgSha: d.pkgSha.slice(0, 8), tgtSha: d.tgtSha.slice(0, 8) })),
  }, null, 2);
  let parsed = null;
  try { parsed = JSON.parse(jsonOut); } catch {}
  check('S6 --json 输出可解析', parsed && typeof parsed === 'object' && Array.isArray(parsed.missing));
}

// ---- 场景 8：白名单 RHO 文件过滤（hooks/commit-check.config.json + kit.json + settings.json 都不报孤儿）----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-ssc-rho-'));
  const pkgRoot = path.join(root, 'pkg');
  const target = path.join(root, 'target');
  const pkgBase = path.join(pkgRoot, 'templates', '_agents');
  const tgtBase = path.join(target, '.agents');
  fs.mkdirSync(pkgBase, { recursive: true });
  fs.mkdirSync(path.join(tgtBase, 'hooks'), { recursive: true });
  fs.mkdirSync(tgtBase, { recursive: true });
  // 3 个白名单项都装副本独有
  fs.writeFileSync(path.join(tgtBase, 'hooks', 'commit-check.config.json'), '{}\n');
  fs.writeFileSync(path.join(tgtBase, 'kit.json'), '{}\n');
  fs.writeFileSync(path.join(tgtBase, 'settings.json'), '{}\n');
  // 1 个非白名单孤儿作对照（应被报告）
  fs.writeFileSync(path.join(tgtBase, 'hooks', 'real-orphan.json'), '{}\n');
  const r = sourceSyncCheck({ pkgRoot, target });
  check('S8 白名单 3 项（commit-check.config.json / kit.json / settings.json）不报孤儿',
    !r.orphan.some((o) => o.rel === 'hooks/commit-check.config.json' || o.rel === 'kit.json' || o.rel === 'settings.json'));
  check('S8 非白名单孤儿（real-orphan.json）仍报孤儿',
    r.orphan.length === 1 && r.orphan[0].rel === 'hooks/real-orphan.json', JSON.stringify(r.orphan));
}

// ---- 场景 9：实际仓库 hooks/commit-check.config.json 不在孤儿（装户环境随 S5 一并 SKIP）----
if (!SRC_ROOT) {
  check('S9 baseline SKIP（装户环境，随 S5）', true);
} else {
  const r = sourceSyncCheck({ pkgRoot: SRC_ROOT, target: SRC_ROOT });
  check('S9 实际仓库 hooks/commit-check.config.json 不在孤儿',
    !r.orphan.some((o) => o.rel === 'hooks/commit-check.config.json'), JSON.stringify(r.orphan));
}

// ---- 场景 7：空目录 / 不存在的目录不崩 ----
{
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-ssc-empty-'));
  const r = sourceSyncCheck({ pkgRoot: empty, target: empty });
  check('S7 空目录 fixture 不崩（0/0）', r.pkgCount === 0 && r.tgtCount === 0);
}

// ---- 场景 10-12：--gate 门禁模式（2026-09-27 audit-gate-hardening，pre-commit 双源门禁用）----
{
  // S10 差异 fixture（缺失 1 / 漂移 1 / 孤儿 1）→ --gate exit 1（缺失/漂移阻断）
  const { pkgRoot, target } = mkFixture();
  const r = runGate(['--gate', '--pkg-root', pkgRoot, '--target', target]);
  check('S10 --gate 差异 fixture（缺失+漂移）→ exit 1', r.status === 1, `exit=${r.status}\n${r.stdout || ''}${r.stderr || ''}`);
}
{
  // S11 孤儿-only fixture → --gate exit 0（孤儿只报告不计失败——装户自持内容不入机器门）
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-ssc-gate-orphan-'));
  const pkgRoot = path.join(root, 'pkg');
  const target = path.join(root, 'target');
  const pkgBase = path.join(pkgRoot, 'templates', '_agents');
  const tgtBase = path.join(target, '.agents');
  fs.mkdirSync(path.join(pkgBase, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(tgtBase, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(pkgBase, 'commands', 'same.md'), '# v1\n');
  fs.writeFileSync(path.join(tgtBase, 'commands', 'same.md'), '# v1\n');
  fs.writeFileSync(path.join(tgtBase, 'local-only.md'), '# 装户自持\n');
  const r = runGate(['--gate', '--pkg-root', pkgRoot, '--target', target]);
  check('S11 --gate 孤儿-only → exit 0（孤儿不计失败）', r.status === 0, `exit=${r.status}\n${r.stdout || ''}${r.stderr || ''}`);
}
{
  // S12 干净 fixture --gate → exit 0；差异 fixture --diff → 仍 exit 0（B-b「只报告不修复」默认语义不变）
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-ssc-gate-clean-'));
  const pkgRoot = path.join(root, 'pkg');
  const target = path.join(root, 'target');
  const pkgBase = path.join(pkgRoot, 'templates', '_agents');
  const tgtBase = path.join(target, '.agents');
  fs.mkdirSync(path.join(pkgBase, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(tgtBase, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(pkgBase, 'commands', 'same.md'), '# v1\n');
  fs.writeFileSync(path.join(tgtBase, 'commands', 'same.md'), '# v1\n');
  const rClean = runGate(['--gate', '--pkg-root', pkgRoot, '--target', target]);
  check('S12 --gate 干净 fixture → exit 0', rClean.status === 0, `exit=${rClean.status}`);
  const { pkgRoot: dp, target: dt } = mkFixture();
  const rDiff = runGate(['--diff', '--pkg-root', dp, '--target', dt]);
  check('S12 --diff 差异 fixture 仍 exit 0（B-b 默认语义不变）', rDiff.status === 0, `exit=${rDiff.status}`);
}

// ---- 场景 13-14：sha LF 归一（2026-09-27 closing-coverage）——CRLF 等价不误报 / 内容差异照常抓 ----
{
  // S13 同内容不同行尾（包源 LF / 装副本 CRLF）→ 不报漂移
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-ssc-crlf-'));
  const pkgRoot = path.join(root, 'pkg');
  const target = path.join(root, 'target');
  const pkgBase = path.join(pkgRoot, 'templates', '_agents', 'commands');
  const tgtBase = path.join(target, '.agents', 'commands');
  fs.mkdirSync(pkgBase, { recursive: true });
  fs.mkdirSync(tgtBase, { recursive: true });
  fs.writeFileSync(path.join(pkgBase, 'a.md'), '# 标题\n\n正文行\n- 项目\n');
  fs.writeFileSync(path.join(tgtBase, 'a.md'), '# 标题\r\n\r\n正文行\r\n- 项目\r\n');
  fs.writeFileSync(path.join(pkgBase, 'b.md'), '# B\n');
  fs.writeFileSync(path.join(tgtBase, 'b.md'), '# B\n');
  const r = sourceSyncCheck({ pkgRoot, target });
  check('S13 同内容不同行尾（LF vs CRLF）→ 0 漂移（LF 归一口径）', r.drift.length === 0, JSON.stringify(r.drift));
}
{
  // S14 内容真实差异（即使行尾也不同）→ 照常报漂移（归一不掩盖内容差异）
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-ssc-crlf2-'));
  const pkgRoot = path.join(root, 'pkg');
  const target = path.join(root, 'target');
  const pkgBase = path.join(pkgRoot, 'templates', '_agents', 'commands');
  const tgtBase = path.join(target, '.agents', 'commands');
  fs.mkdirSync(pkgBase, { recursive: true });
  fs.mkdirSync(tgtBase, { recursive: true });
  fs.writeFileSync(path.join(pkgBase, 'a.md'), '# v1\n内容甲\n');
  fs.writeFileSync(path.join(tgtBase, 'a.md'), '# v1\r\n内容乙\r\n');
  const r = sourceSyncCheck({ pkgRoot, target });
  check('S14 内容差异（甲 vs 乙）→ 报漂移（归一只认 CRLF 不吞内容）', r.drift.length === 1 && r.drift[0].rel === 'commands/a.md', JSON.stringify(r.drift));
}

// ---- 场景 15-16：项目自持架子文件排除（2026-09-28 runtime-env 双源冲突）----
{
  // S15 notes/runtime-env.md **两侧都被排除**——包源只发骨架、装户填实况，两处本就该不同。
  // 回归：首版只过滤装副本一侧 → 排除件变成「包源有/装副本无」的**缺失**，--gate 仍 exit 1
  // （实测：漂移 1 → 缺失 1）。故断言 missing/drift 皆为空。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-ssc-owned-'));
  const pkgRoot = path.join(root, 'pkg');
  const target = path.join(root, 'target');
  const pkgBase = path.join(pkgRoot, 'templates', '_agents', 'notes');
  const tgtBase = path.join(target, '.agents', 'notes');
  fs.mkdirSync(pkgBase, { recursive: true });
  fs.mkdirSync(tgtBase, { recursive: true });
  fs.writeFileSync(path.join(pkgBase, 'runtime-env.md'), '# 骨架\n> 项目按实际填写\n');
  fs.writeFileSync(path.join(tgtBase, 'runtime-env.md'), '# 实况\n> 本机 sh 路径已接\n');
  const r = sourceSyncCheck({ pkgRoot, target });
  check('S15 项目自持 runtime-env.md 两侧内容不同 → 既不报缺失也不报漂移（双侧排除）',
    r.missing.length === 0 && r.drift.length === 0,
    JSON.stringify({ missing: r.missing, drift: r.drift }));
}
{
  // S16 排除**只针对该文件**——同目录其他 .md 仍受双源门禁约束（防排除范围被误放大）
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-ssc-owned2-'));
  const pkgRoot = path.join(root, 'pkg');
  const target = path.join(root, 'target');
  const pkgBase = path.join(pkgRoot, 'templates', '_agents', 'notes');
  const tgtBase = path.join(target, '.agents', 'notes');
  fs.mkdirSync(pkgBase, { recursive: true });
  fs.mkdirSync(tgtBase, { recursive: true });
  fs.writeFileSync(path.join(pkgBase, 'runtime-env.md'), '# 骨架\n');
  fs.writeFileSync(path.join(tgtBase, 'runtime-env.md'), '# 实况\n');
  fs.writeFileSync(path.join(pkgBase, 'other.md'), '# v1\n');
  fs.writeFileSync(path.join(tgtBase, 'other.md'), '# v2\n');
  const r = sourceSyncCheck({ pkgRoot, target });
  check('S16 排除不放大——同目录 other.md 内容不同仍报漂移',
    r.drift.length === 1 && r.drift[0].rel === 'notes/other.md', JSON.stringify(r.drift));
}

console.log('\n合计: PASS ' + pass + ' / FAIL ' + failCount);
process.exit(failCount ? 1 : 0);