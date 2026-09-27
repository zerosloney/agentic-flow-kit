// flow-kit source-sync-check：装户面同步一致性检查（包源 templates/_agents/ vs 装副本 .agents/）
// 目的：包源改了 templates/_agents/ 但 .agents/ 装副本没刷新——这种"真空地带"sync.mjs 不扫、doctor.mjs §6.6 不扫
//       本工具扫 templates/_agents/ 下所有 .md / .mjs / .json / .txt（排除 cache/）vs .agents/ 对应路径
//       输出三类差异：缺失（包源有装副本无）/ 孤儿（包源无装副本有）/ 漂移（两者都有 sha 不一致）
//       排除装副本独有文件：kit.json / settings.json / hooks/commit-check.config.json（init 渲染产物，不属双源）
// 用法：node .agents/scripts/source-sync-check.mjs --diff
//       node .agents/scripts/source-sync-check.mjs --json
//       node .agents/scripts/source-sync-check.mjs --gate（门禁模式：缺失/漂移 exit 1，孤儿只报告不计失败
//             ——pre-commit 双源一致性门禁用，2026-09-27 audit-gate-hardening；--diff/--json 仍恒 exit 0）
//       node .agents/scripts/source-sync-check.mjs --pkg-root <path> --target <path>
// 零依赖；B-b 决策「只报告不修复」（--gate 只加 exit 码裁决，不改默认行为）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

function fail(msg) { console.error('❌ ' + msg); process.exit(1); }

const VALID_EXTS = new Set(['.md', '.mjs', '.json', '.txt']);
// 装副本独有文件（init 渲染产物，不属双源结构）
const RENDER_OUTPUT_FILES = new Set(['kit.json', 'settings.json', 'hooks/commit-check.config.json']);
const TARGET_EXCLUDE = RENDER_OUTPUT_FILES;  // 向后兼容别名

function sha256(p) {
  try {
    // LF 归一（2026-09-27 closing-coverage）：CRLF 盘面与 LF 克隆同值，行尾不一致不误报缺失/漂移/孤儿外差异
    return createHash('sha256').update(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  } catch {
    return null;
  }
}

// walkMd：递归扫目录，列出所有 validExt 文件（排除 cache/）
function walkMd(root) {
  const out = [];
  function walk(dir, relBase) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relBase ? relBase + '/' + e.name : e.name;
      const abs = path.join(dir, e.name);
      // 排除 cache/ 目录（与 sync.mjs 既有约定一致）
      if (rel === 'cache' || rel.startsWith('cache/')) continue;
      if (e.isDirectory()) walk(abs, rel);
      else if (VALID_EXTS.has(path.extname(e.name))) out.push(rel);
    }
  }
  walk(root, '');
  return out;
}

export function sourceSyncCheck({ pkgRoot, target }) {
  const authorityRoot = path.join(pkgRoot, 'templates', '_agents');
  const adapterRoot = path.join(target, '.agents');
  const pkgFiles = walkMd(authorityRoot);
  const tgtFiles = walkMd(adapterRoot).filter((f) => !TARGET_EXCLUDE.has(f));
  const pkgSet = new Set(pkgFiles);
  const tgtSet = new Set(tgtFiles);
  const missing = []; // 包源有 / 装副本无
  const orphan = [];  // 包源无 / 装副本有
  const drift = [];   // 两者都有但 sha 不一致
  for (const f of pkgFiles) {
    if (!tgtSet.has(f)) { missing.push({ rel: f }); continue; }
    const pkgSha = sha256(path.join(authorityRoot, f));
    const tgtSha = sha256(path.join(adapterRoot, f));
    if (pkgSha !== null && tgtSha !== null && pkgSha !== tgtSha) {
      drift.push({ rel: f, pkgSha, tgtSha });
    }
  }
  for (const f of tgtFiles) {
    if (!pkgSet.has(f)) orphan.push({ rel: f });
  }
  return {
    pkgRoot, target,
    pkgCount: pkgFiles.length,
    tgtCount: tgtFiles.length,
    missing: missing.sort((a, b) => a.rel.localeCompare(b.rel)),
    orphan: orphan.sort((a, b) => a.rel.localeCompare(b.rel)),
    drift: drift.sort((a, b) => a.rel.localeCompare(b.rel)),
  };
}

function printDiff(result) {
  console.log('▶ flow-kit source-sync-check --diff');
  console.log('  包源 (templates/_agents/) ' + result.pkgCount + ' 份  |  装副本 (.agents/) ' + result.tgtCount + ' 份');
  if (!result.missing.length && !result.orphan.length && !result.drift.length) {
    console.log('  无差异 ✅');
    return;
  }
  if (result.missing.length) {
    console.log('  缺失（包源有 / 装副本无）' + result.missing.length + '：');
    for (const m of result.missing) console.log('    - ' + m.rel);
  }
  if (result.orphan.length) {
    console.log('  孤儿（包源无 / 装副本有）' + result.orphan.length + '：');
    for (const o of result.orphan) console.log('    - ' + o.rel);
  }
  if (result.drift.length) {
    console.log('  漂移（包源装副本都有但 sha 不一致）' + result.drift.length + '：');
    for (const d of result.drift) console.log('    - ' + d.rel + '  pkg=' + d.pkgSha.slice(0, 8) + '…  tgt=' + d.tgtSha.slice(0, 8) + '…');
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('source-sync-check.mjs');
if (isMain) {
  let jsonMode = false, diffMode = false, gateMode = false;
  let pkgRoot = null, target = null;
  for (let i = 0; i < process.argv.length - 2; i++) {
    const a = process.argv[2 + i];
    if (a === '--json') jsonMode = true;
    else if (a === '--diff') diffMode = true;
    else if (a === '--gate') gateMode = true;
    else if (a === '--pkg-root') pkgRoot = process.argv[2 + i + 1];
    else if (a === '--target') target = process.argv[2 + i + 1];
  }
  if (!pkgRoot) pkgRoot = process.cwd();
  if (!target) target = process.cwd();
  const authorityRoot = path.join(pkgRoot, 'templates', '_agents');
  const adapterRoot = path.join(target, '.agents');
  if (!fs.existsSync(authorityRoot)) fail('找不到包源：' + authorityRoot);
  if (!fs.existsSync(adapterRoot)) fail('找不到装副本：' + adapterRoot);
  const result = sourceSyncCheck({ pkgRoot, target });
  if (jsonMode) {
    process.stdout.write(JSON.stringify({
      pkgCount: result.pkgCount,
      tgtCount: result.tgtCount,
      missing: result.missing.map((m) => m.rel),
      orphan: result.orphan.map((o) => o.rel),
      drift: result.drift.map((d) => ({ rel: d.rel, pkgSha: d.pkgSha.slice(0, 8), tgtSha: d.tgtSha.slice(0, 8) })),
    }, null, 2) + '\n');
  } else {
    printDiff(result);
  }
  if (gateMode) {
    // 门禁模式（pre-commit 双源一致性用）：缺失/漂移非零阻断——正是「包源改了装副本没跟」的故障模式
    // （doctor §4 台账 sha 对此静默：盘面=台账即 PASS；§4.5 只抓未登记）。孤儿只报告不计失败：
    // 孤儿 = 装副本独有（装户自持内容如本地 skills），删留由人拍板，不入机器门。
    if (result.missing.length || result.drift.length) {
      console.error('❌ 双源不一致（缺失 ' + result.missing.length + ' / 漂移 ' + result.drift.length + '）——包源与装副本须同提交成对（双源纪律）；跑 node bin/flow-kit.mjs sync 后原路重试（孤儿只报告不计失败）');
      process.exit(1);
    }
    process.exit(0);
  }
  // diff/json 模式总 exit 0；差异存在不视作错误（人类阅读用；B-b 决策「只报告不修复」）
  process.exit(0);
}
export default sourceSyncCheck;