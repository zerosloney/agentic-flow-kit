#!/usr/bin/env node
// doctor 加 owned 漂移校验后的 fixture 驱动测试（2026-09-25 wf-runtime 复盘）
// 测试 src/doctor.mjs 导出的 checkOwnedDrift(target)：覆盖 4 场景——
//   ① owned 全对齐 → drift=0 gone=[] total>0 skipped=false
//   ② 手改装副本（盘面 sha 变） → drift=1 gone=[] total=1
//   ③ owned 文件缺失 → drift=0 gone=[rel] total=1
//   ④ kit.json 无 owned 字段 → skipped=true total=0
// 另测 checkAdapterDrift(target)（场景 5-14）与 checkLedgerCoverage(target, pkgRoot)（场景 15-18，
//   2026-09-26 managed-ledger-adopt：补「盘上有、台账无」一侧）。
// 另测 checkDelegationSnapshotFreshness(target)（场景 19-23，2026-09-29 p0-gate-noise-batch）与
//   checkGateAnchors(target)（场景 24-30，2026-10-11 P3-1 gate 防改锚：add-gate 写下的 srcSha256 锚让
//   .agents/hooks/ 门禁脚本手改永久可见；local-pre-commit 模板语义锚须排除出比对面）。
// 另测 checkTemplateDrift(target, pkgRoot)（场景 31-36，2026-10-11 模板感知直测补齐——此前唯一无直测的
//   导出 check：三态判定 + 排除面 + 无模板跳过）。
// 用法：node .agents/scripts/doctor.test.mjs（在仓库根执行，需 src/doctor.mjs 存在——dogfooding 模式）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// 上溯三级：templates/_agents/scripts/ → 仓库根
const ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const SRC = path.join(ROOT, 'src', 'doctor.mjs');
if (!fs.existsSync(SRC)) {
  // **环境不适用 ≠ 失败**（2026-09-28 修正）：本套件测的是包源 `src/doctor.mjs` 的内部函数，
  // 装户环境没有 `src/`（那是包源）——故此处应 **SKIP 并以 0 退出**，与 check-loop.test.mjs 的
  // 「无 sh 环境打印 SKIP 不算失败」同一口径（既有先例）。
  // 首版 exit(1) 的代价是实测出来的：CI 新增「shipped 套件」步骤后，装户径下逐套件批量跑会把
  // 这条 SKIP 当成真失败（doctor.test 单独 exit 1），使批量结果不可用。
  console.error(`doctor.test.mjs：SKIP——未找到 ${SRC}（装户环境无包源 src/；本套件仅在包源仓库/dogfooding 跑 npm test 时有意义）`);
  process.exit(0);
}
const { checkOwnedDrift, checkAdapterDrift, checkLedgerCoverage, checkDelegationSnapshotFreshness, checkGateAnchors, checkTemplateDrift, checkLevelHints, gateTrustOf, GATE_TRUST_LEVELS, GATE_TRUST_DEFAULT } = await import(pathToFileURL(SRC).href);

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const sha256Of = (s) => createHash('sha256').update(s).digest('hex');

const mkfix = ({ kitContent, files }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-owned-test-'));
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'kit.json'), JSON.stringify(kitContent, null, 2));
  for (const [rel, content] of Object.entries(files || {})) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
};

const mkKit = (owned) => ({
  kit: 'agentic-flow-kit',
  version: '0.4.0',
  options: { hosts: [], stack: 'none', boardPort: '8933' },
  managed: [],
  owned,
});

// ---- 场景 1：owned 全对齐 → drift=0 gone=[] total=1 skipped=false ----
{
  const AGENTS_BODY = '# test AGENTS.md\n';
  const root = mkfix({
    kitContent: mkKit([{ rel: 'AGENTS.md', sha256: sha256Of(AGENTS_BODY) }]),
    files: { 'AGENTS.md': AGENTS_BODY },
  });
  const r = checkOwnedDrift(root);
  check('场景 1：owned 全对齐 → drift=0 gone=[] total=1 skipped=false',
    r.drift === 0 && r.gone.length === 0 && r.total === 1 && r.skipped === false,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 2：手改装副本（盘面 sha 变）→ drift=1 ----
{
  const OLD_BODY = '# old version\n';
  const NEW_BODY = '# new version — hand-edited\n';
  const root = mkfix({
    kitContent: mkKit([{ rel: 'AGENTS.md', sha256: sha256Of(OLD_BODY) }]), // 台账是旧 sha
    files: { 'AGENTS.md': NEW_BODY },                                       // 盘面是新 sha
  });
  const r = checkOwnedDrift(root);
  check('场景 2：手改装副本 → drift=1 gone=[] total=1 skipped=false',
    r.drift === 1 && r.gone.length === 0 && r.total === 1 && r.skipped === false,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 3：owned 文件缺失 → drift=0 gone=['AGENTS.md'] ----
{
  const root = mkfix({
    kitContent: mkKit([{ rel: 'AGENTS.md', sha256: 'a'.repeat(64) }]),
    files: {}, // 不写 AGENTS.md
  });
  const r = checkOwnedDrift(root);
  check('场景 3：owned 文件缺失 → drift=0 gone=["AGENTS.md"] total=1 skipped=false',
    r.drift === 0 && r.gone.length === 1 && r.gone[0] === 'AGENTS.md' && r.total === 1 && r.skipped === false,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 4：kit.json 无 owned 字段 → skipped=true total=0 ----
{
  const kit = { kit: 'agentic-flow-kit', version: '0.4.0', options: {}, managed: [] };
  const root = mkfix({ kitContent: kit, files: { 'AGENTS.md': '# any\n' } });
  const r = checkOwnedDrift(root);
  check('场景 4：kit.json 无 owned 字段 → skipped=true total=0',
    r.skipped === true && r.total === 0,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 5：kit.json 不存在 → skipped=true ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-owned-test-'));
  const r = checkOwnedDrift(root);
  check('场景 5：kit.json 不存在 → skipped=true total=0',
    r.skipped === true && r.total === 0,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 6：kit.json 解析失败 → skipped=true 含 error ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-owned-test-'));
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'kit.json'), '{ broken json');
  const r = checkOwnedDrift(root);
  check('场景 6：kit.json 解析失败 → skipped=true 含 error',
    r.skipped === true && typeof r.error === 'string' && r.error.length > 0,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 7：多个 owned 文件，部分漂移 → drift=1 gone=[other] ----
{
  const root = mkfix({
    kitContent: mkKit([
      { rel: 'AGENTS.md', sha256: sha256Of('# a\n') },
      { rel: 'workflow/incidents/_TEMPLATE.md', sha256: sha256Of('# tpl\n') },
      { rel: 'wiki/INDEX.md', sha256: sha256Of('# w\n') },
    ]),
    files: {
      'AGENTS.md': '# a\n',                                   // 对齐
      'wiki/INDEX.md': '# w\n',                                // 对齐
      // workflow/incidents/_TEMPLATE.md 不写 → 缺失
    },
  });
  const r = checkOwnedDrift(root);
  check('场景 7：多个 owned 一个缺失 → drift=0 gone=1项 total=3 skipped=false',
    r.drift === 0 && r.gone.length === 1 && r.gone[0] === 'workflow/incidents/_TEMPLATE.md' && r.total === 3 && r.skipped === false,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 8：owned 漂移 WARN 已严化为 FAIL（2026-09-25 doctor-owned-drift-strict 复盘）----
// 源码层断言：src/doctor.mjs 第 6.6 节主流程输出必须用 add('FAIL', …) 而非 add('WARN', …)；
// 这是规则严度参数化的最小防回归——不依赖运行时执行 doctor（避免造完整 fixture）。
{
  const doctorSrc = fs.readFileSync(SRC, 'utf8');
  // 断言：owned 漂移分支必须用 'FAIL'
  const failDrift = /ownedRes\.drift\)\s*add\('FAIL'/.test(doctorSrc);
  check('场景 8a：src/doctor.mjs 第 6.6 节 owned 漂移分支已用 add(\'FAIL\', …)',
    failDrift,
    `src/doctor.mjs 第 6.6 节应为 add('FAIL', ...) 而非 add('WARN', ...)`);
  // 断言：owned gone 分支必须用 'FAIL'
  const failGone = /ownedRes\.gone\.length\)\s*add\('FAIL'/.test(doctorSrc);
  check('场景 8b：src/doctor.mjs 第 6.6 节 owned gone 分支已用 add(\'FAIL\', …)',
    failGone,
    `src/doctor.mjs 第 6.6 节 gone 分支应为 add('FAIL', ...)`);
  // 断言：doctor 主流程 results 含 FAIL 时 process.exit(1)（fail-loud）
  const failLoud = /results\.some\(\(r\)\s*=>\s*r\.level\s*===\s*'FAIL'\)\s*\?\s*1\s*:\s*0/.test(doctorSrc);
  check('场景 8c：doctor 主流程 results 含 FAIL 时 exit 1（fail-loud）',
    failLoud,
    `src/doctor.mjs 应保留 process.exit(1) fail-loud 行为`);
}

// ---- 场景 9-14：checkAdapterDrift（2026-09-25 cross-host-sync）—— 装户侧跨宿主薄适配正文段漂移 ----
const mkfixAdapter = ({ authority, adapters, pkgMarker }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-adapter-test-'));
  // authorityRoot：.agents/{commands,roles}
  if (authority) {
    for (const [rel, content] of Object.entries(authority)) {
      const abs = path.join(root, '.agents', rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  // adapters：<HOST_DIR>/<sub>/<file>
  if (adapters) {
    for (const [rel, content] of Object.entries(adapters)) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  // pkgMarker：模拟包源（templates/_agents + modules/hosts）
  if (pkgMarker) {
    fs.mkdirSync(path.join(root, 'templates/_agents'), { recursive: true });
    fs.mkdirSync(path.join(root, 'modules/hosts'), { recursive: true });
  }
  return root;
};

const ROLE_BODY = '# Implementer\n\n正文 role v1\n';
const CMD_BODY = '# Build\n\n正文 build v1\n';

// ---- 场景 9：装户侧薄适配全对齐 → drift=0 ----
{
  const root = mkfixAdapter({
    authority: {
      'commands/build.md': `---\ndesc: x\n---\n\n${CMD_BODY}`,
      'roles/implementer.md': `---\ndesc: r\n---\n\n${ROLE_BODY}`,
    },
    adapters: {
      '.opencode/commands/wf-build.md': `---\ndesc: oc\n---\n\n${CMD_BODY}`,
      '.trae/commands/wf-build.md': `---\nname: wf-build\ndesc: trae\n---\n\n${CMD_BODY}`,
      '.zcode/agents/implementer.md': `---\nname: impl\ndesc: zcode\n---\n\n${ROLE_BODY}`,
      '.opencode/agents/implementer.md': `---\nname: impl\ndesc: oc\n---\n\n${ROLE_BODY}`,
    },
  });
  const r = checkAdapterDrift(root);
  check('场景 9：装户全对齐 → drift=0 total=4 skipped=false（1 cmd×2 适配 + 1 role×2 适配 .zcode+.opencode）',
    r.drift === 0 && r.total === 4 && r.skipped === false,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 10：薄适配正文漂移 → drift > 0 ----
{
  const root = mkfixAdapter({
    authority: {
      'roles/implementer.md': `---\ndesc: r\n---\n\n${ROLE_BODY}`,
    },
    adapters: {
      '.zcode/agents/implementer.md': `---\nname: impl\ndesc: zcode\n---\n\n# Implementer\n\n漂移正文 role v1\n`,
    },
  });
  const r = checkAdapterDrift(root);
  check('场景 10：薄适配正文漂移 → drift=1 total=1',
    r.drift === 1 && r.total === 1 && r.skipped === false,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 11：包源环境 → skipped=true（不参与装户比对） ----
{
  const root = mkfixAdapter({
    pkgMarker: true,
    authority: { 'commands/build.md': `---\ndesc: x\n---\n\n${CMD_BODY}` },
    adapters: { '.opencode/commands/wf-build.md': `---\ndesc: oc\n---\n\n漂移` },
  });
  const r = checkAdapterDrift(root);
  check('场景 11：包源环境（templates/ + modules/ 同时存在）→ skipped=true',
    r.skipped === true && typeof r.note === 'string' && r.note.includes('包源'),
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 12：.agents 目录不存在 → skipped=true ----
{
  const root = mkfixAdapter({});
  const r = checkAdapterDrift(root);
  check('场景 12：权威源目录不存在 → skipped=true 含 note',
    r.skipped === true && typeof r.note === 'string' && r.note.includes('.agents'),
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 13：frontmatter 差异不计漂移（B-b 语义：仅正文段比对） ----
{
  const root = mkfixAdapter({
    authority: { 'roles/implementer.md': `---\ndesc: r\n---\n\n${ROLE_BODY}` },
    adapters: {
      '.zcode/agents/implementer.md': `---\nname: impl\ndesc: 自定义 zcode 风格\n---\n\n${ROLE_BODY}`,
    },
  });
  const r = checkAdapterDrift(root);
  check('场景 13：frontmatter 差异不算正文漂移 → drift=0 total=1',
    r.drift === 0 && r.total === 1 && r.skipped === false,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 14：薄适配缺失不在 drift 统计（apply 不自动创建） ----
{
  const root = mkfixAdapter({
    authority: {
      'commands/build.md': `---\ndesc: x\n---\n\n${CMD_BODY}`,
      'roles/implementer.md': `---\ndesc: r\n---\n\n${ROLE_BODY}`,
    },
    adapters: {
      '.opencode/commands/wf-build.md': `---\ndesc: oc\n---\n\n${CMD_BODY}`,
    },
  });
  const r = checkAdapterDrift(root);
  check('场景 14：薄适配缺失不在 drift 统计 → drift=0 total=1',
    r.drift === 0 && r.total === 1 && r.skipped === false,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 15：盘上（包源）有 managed 类文件但台账无 → 差集非空（本 incident 的目标形态）----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cov-'));
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cov-pkg-'));
  // 包源模板树：一份 managed 类（.agents/scripts/a.mjs）+ 一份 owned 类（workflow/README.md，须被排除）
  const w = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
  w(path.join(pkg, 'templates/_agents/scripts/a.mjs'), '// a\n');
  w(path.join(pkg, 'templates/_agents/commands/b.md'), '// b\n');
  w(path.join(pkg, 'templates/workflow/README.md'), '// owned\n');
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'kit.json'), JSON.stringify({
    kit: 'agentic-flow-kit', version: '0.5.0', options: { hosts: [], stack: 'none', boardPort: '8933' },
    managed: [], owned: [],
  }, null, 2));
  const r = checkLedgerCoverage(root, pkg);
  check('场景 15：盘上有 managed 类文件台账无 → 差集含两者',
    r.skipped === false && r.missing.includes('.agents/scripts/a.mjs') && r.missing.includes('.agents/commands/b.md') && r.missing.length === 2,
    JSON.stringify(r));
  check('场景 15：owned 类（workflow/）不入差集',
    !r.missing.some((m) => m.startsWith('workflow/')), JSON.stringify(r.missing));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(pkg, { recursive: true, force: true });
}

// ---- 场景 16：台账登记齐全 → 差集空 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cov-'));
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cov-pkg-'));
  const w = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
  w(path.join(pkg, 'templates/_agents/scripts/a.mjs'), '// a\n');
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'kit.json'), JSON.stringify({
    kit: 'agentic-flow-kit', version: '0.5.0', options: { hosts: [], stack: 'none', boardPort: '8933' },
    managed: [{ rel: '.agents/scripts/a.mjs', sha256: 'x' }], owned: [],
  }, null, 2));
  const r = checkLedgerCoverage(root, pkg);
  check('场景 16：登记齐全 → missing=[] skipped=false',
    r.skipped === false && r.missing.length === 0, JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(pkg, { recursive: true, force: true });
}

// ---- 场景 17：无包源 templates/（装户环境）→ skipped ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cov-'));
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cov-pkg-')); // 空包根，无 templates/
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'kit.json'), JSON.stringify({
    kit: 'agentic-flow-kit', version: '0.5.0', options: { hosts: [], stack: 'none', boardPort: '8933' },
    managed: [], owned: [],
  }, null, 2));
  const r = checkLedgerCoverage(root, pkg);
  check('场景 17：无包源模板 → skipped=true missing=[]',
    r.skipped === true && r.missing.length === 0, JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(pkg, { recursive: true, force: true });
}

// ---- 场景 18：无 kit.json → skipped ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cov-'));
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cov-pkg-'));
  fs.mkdirSync(path.join(pkg, 'templates/_agents/scripts'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'templates/_agents/scripts/a.mjs'), '// a\n');
  const r = checkLedgerCoverage(root, pkg);
  check('场景 18：无 kit.json → skipped=true missing=[]',
    r.skipped === true && r.missing.length === 0, JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(pkg, { recursive: true, force: true });
}

// ---- 场景 19：快照最新（snapshotMonth >= ledgerMonth）→ stale=false ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-snap-'));
  fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'delegations.md'), [
    '## 委派结果',
    '',
    '| 日期 | 被委派方 | 任务一句话 | 结果 | 备注 |',
    '|------|----------|------------|------|------|',
    '| 2026-09-20 | x | y | 一次通过 | z |',
    '| 2026-09-26 | x | y | 一次通过 | z |',
    '',
    '## 月度聚合快照',
    '',
    '| 月份 | 有效任务 | 一次通过率 | 返工次数 |',
    '|------|----------|------------|----------|',
    '| 2026-09 | 2 | 100% | 0 |',
    '',
  ].join('\n'));
  const r = checkDelegationSnapshotFreshness(root);
  check('场景 19：快照最新 → stale=false skipped=false',
    r.stale === false && r.skipped === false && r.ledgerMonth === '2026-09' && r.snapshotMonth === '2026-09',
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 20：快照陈旧（snapshotMonth < ledgerMonth）→ stale=true ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-snap-'));
  fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'delegations.md'), [
    '## 委派结果',
    '',
    '| 日期 | 被委派方 | 任务一句话 | 结果 | 备注 |',
    '|------|----------|------------|------|------|',
    '| 2026-09-10 | x | y | 一次通过 | z |',
    '',
    '## 月度聚合快照',
    '',
    '| 月份 | 有效任务 | 一次通过率 | 返工次数 |',
    '|------|----------|------------|----------|',
    '| 2026-08 | 1 | 100% | 0 |',
    '',
  ].join('\n'));
  const r = checkDelegationSnapshotFreshness(root);
  check('场景 20：快照陈旧（08 < 09）→ stale=true',
    r.stale === true && r.skipped === false && r.ledgerMonth === '2026-09' && r.snapshotMonth === '2026-08',
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 21：有数据行但无快照行 → stale=true snapshotMonth=null ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-snap-'));
  fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'delegations.md'), [
    '## 委派结果',
    '',
    '| 日期 | 被委派方 | 任务一句话 | 结果 | 备注 |',
    '|------|----------|------------|------|------|',
    '| 2026-09-25 | x | y | 一次通过 | z |',
    '',
  ].join('\n'));
  const r = checkDelegationSnapshotFreshness(root);
  check('场景 21：无快照行 → stale=true snapshotMonth=null',
    r.stale === true && r.skipped === false && r.snapshotMonth === null,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 22：无台账数据行 → skipped=true ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-snap-'));
  fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'delegations.md'), [
    '# delegations',
    '',
    '## 月度聚合快照',
    '',
    '| 月份 | 有效任务 |',
    '|------|----------|',
    '| 2026-09 | 0 |',
    '',
  ].join('\n'));
  const r = checkDelegationSnapshotFreshness(root);
  check('场景 22：无数据行 → skipped=true',
    r.skipped === true && r.stale === false,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 23：delegations.md 不存在 → skipped=true ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-snap-'));
  const r = checkDelegationSnapshotFreshness(root);
  check('场景 23：文件不存在 → skipped=true',
    r.skipped === true && r.stale === false,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 24-30：checkGateAnchors（2026-10-11 P3-1 gate 防改锚）—— .agents/hooks/ 门禁脚本安装锚 ----
// 锚语义（见 src/add-gate.mjs 头注）：add-gate 逐字拷贝安装时写 srcSha256＝安装时刻包源 LF 归一 sha；
// sync 自愈 sha256 但从不按盘面刷新 gate 条目的 srcSha256（srcTemplatePath 解析不到包源模板提前 return）
// → 盘面 sha ≠ 锚即「装后手改」，doctor 出 WARN 留痕（不阻断——装户对门有最终所有权，锚只提供可见性）。
const GATE_A = '.agents/hooks/check-test-protect.mjs';
const GATE_B = '.agents/hooks/check-node-layer.mjs';
const GATE_BODY = '// gate v1\n';

// ---- 场景 24：锚完好 → PASS 语义（skipped=false mismatch=[] gone=[] total=带锚数）----
{
  const root = mkfix({
    kitContent: mkKit([{ rel: GATE_A, sha256: sha256Of(GATE_BODY), srcSha256: sha256Of(GATE_BODY) }]),
    files: { [GATE_A]: GATE_BODY },
  });
  const r = checkGateAnchors(root);
  check('场景 24：gate 锚完好 → mismatch=0 gone=0 total=1 skipped=false',
    r.skipped === false && r.mismatch.length === 0 && r.gone.length === 0 && r.total === 1,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 25：篡改带锚 gate 文件 → mismatch=[rel]（手改永久留痕——本单的目标形态）----
{
  const root = mkfix({
    kitContent: mkKit([{ rel: GATE_A, sha256: sha256Of(GATE_BODY), srcSha256: sha256Of(GATE_BODY) }]),
    files: { [GATE_A]: '// gate v1 本地手改：放宽红线\n' }, // 盘面 ≠ 安装时刻包源
  });
  const r = checkGateAnchors(root);
  check('场景 25：手改带锚 gate → mismatch 含该件 skipped=false',
    r.skipped === false && r.mismatch.length === 1 && r.mismatch[0] === GATE_A,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 26：混合面——完好 / 失配 / 缺失并存 → mismatch 与 gone 各归各位，total＝带锚条目数 ----
{
  const root = mkfix({
    kitContent: mkKit([
      { rel: GATE_A, sha256: sha256Of(GATE_BODY), srcSha256: sha256Of(GATE_BODY) },  // 完好
      { rel: GATE_B, sha256: sha256Of(GATE_BODY), srcSha256: sha256Of(GATE_BODY) },  // 缺失（不落盘）
    ]),
    files: { [GATE_A]: GATE_BODY },
  });
  const r = checkGateAnchors(root);
  check('场景 26：完好+缺失并存 → gone=[GATE_B] mismatch=[] total=2',
    r.skipped === false && r.gone.length === 1 && r.gone[0] === GATE_B && r.mismatch.length === 0 && r.total === 2,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 27：无带锚条目（旧装户 owned 无 srcSha256 / 非 hooks 条目）→ skipped=true 静默 ----
{
  const root = mkfix({
    kitContent: mkKit([
      { rel: GATE_A, sha256: sha256Of(GATE_BODY) }, // 旧装户：无锚
      { rel: 'AGENTS.md', sha256: sha256Of('# a\n') }, // 非 hooks 条目不参与
    ]),
    files: { [GATE_A]: GATE_BODY, 'AGENTS.md': '# a\n' },
  });
  const r = checkGateAnchors(root);
  check('场景 27：无带锚 gate 条目 → skipped=true（旧装户重装 add-gate 后生效）',
    r.skipped === true && r.total === 0,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 28：local-pre-commit 模板语义锚不参与比对（防恒失配误报）----
// 它的 srcSha256 由 init/sync 按「模板语义」写（锚＝templates/_agents/hooks/local-pre-commit），
// 盘面含各门挂载行 ≠ 模板——纳入比对面必恒失配，须排除（见 checkGateAnchors 注释）。
{
  const LP_WIRED = '#!/bin/sh\nset -e\nnode .agents/hooks/check-test-protect.mjs\n'; // 接线后盘面
  const root = mkfix({
    kitContent: mkKit([
      { rel: '.agents/hooks/local-pre-commit', sha256: sha256Of(LP_WIRED), srcSha256: sha256Of('#!/bin/sh\nset -e\n') },
    ]),
    files: { '.agents/hooks/local-pre-commit': LP_WIRED },
  });
  const r = checkGateAnchors(root);
  check('场景 28：local-pre-commit（模板锚+接线盘面）不纳入 → skipped=true 不误报',
    r.skipped === true && r.total === 0,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 29：kit.json 解析失败 → skipped=true 含 error（沿用 §6.6 同款跳过语义）----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-gateanchor-'));
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'kit.json'), '{ broken json');
  const r = checkGateAnchors(root);
  check('场景 29：kit.json 解析失败 → skipped=true 含 error',
    r.skipped === true && typeof r.error === 'string' && r.error.length > 0,
    JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 30：主流程渐进路径源断言（同场景 8 手法）——§6.6b 失配分支按信任档分级 ----
// 默认档（gateTrust=project）= WARN（「先 WARN 升级 FAIL」渐进路径）：装户可改门禁，锚只提供可见性。
// org 档（2026-10-12 gate-trust-level）= FAIL —— 组织级强制位。断言的是**分级存在**，不是写死某档。
{
  const doctorSrc = fs.readFileSync(SRC, 'utf8');
  const lvMatch = /gateRes\.mismatch\.length\)\s*add\((lv)/.test(doctorSrc);
  const lvDef = /const lv = orgMode \? 'FAIL' : 'WARN'/.test(doctorSrc);
  check('场景 30a：§6.6b gate 锚失配分支按信任档分级（lv 常量，不写死单档）',
    lvMatch && lvDef,
    `src/doctor.mjs §6.6b 失配分支应为 add(lv, ...) 且 lv = orgMode ? 'FAIL' : 'WARN'`);
  check('场景 30b：失配出账含「gate 安装锚失配」字样（含重装重锚/恢复原版指引）',
    doctorSrc.includes('gate 安装锚失配') && doctorSrc.includes('add-gate <门名> --force'),
    'src/doctor.mjs §6.6b 文案缺失');
  check('场景 30c：无带锚条目 → PASS 跳过语义（旧装户静默）',
    doctorSrc.includes('无带锚 gate 条目'),
    'src/doctor.mjs §6.6b 应有无锚跳过 PASS 分支');
  // 函数体切取：checkGateAnchors 声明行起、下一个 export function 止（JSDoc 不参与断言）
  const fnStart = doctorSrc.indexOf('export function checkGateAnchors');
  const fnEnd = doctorSrc.indexOf('export function', fnStart + 10);
  check('场景 30d：local-pre-commit 排除在比对面外（防模板锚恒失配误报）',
    fnStart >= 0 && fnEnd > fnStart && doctorSrc.slice(fnStart, fnEnd).includes("'.agents/hooks/local-pre-commit'"),
    'checkGateAnchors 应排除 .agents/hooks/local-pre-commit');
}

// ---- 场景 37-42：gateTrustOf 信任档（2026-10-12 gate-trust-level）----
// 反例钉子核心：**非法值 / 缺键必须回退 project（零行为变化），绝不因非法配置变严**
// ——把默认升 org 是另一个决定；让「写错一个字符串」自动升到组织级强制则是配置事故。
{
  check('场景 37：显式 project / org 均如实返回',
    gateTrustOf({ gateTrust: 'project' }) === 'project' && gateTrustOf({ gateTrust: 'org' }) === 'org');
  check('场景 38：缺键（旧台账）/ null / undefined / 无 kit → 回退 project（零行为变化）',
    gateTrustOf({}) === 'project' && gateTrustOf({ gateTrust: undefined }) === 'project'
      && gateTrustOf(null) === 'project' && gateTrustOf(undefined) === 'project');
  check('场景 39：非法值全部回退 project（大小写错、自造档、数字、数组皆同）',
    gateTrustOf({ gateTrust: 'ORG' }) === 'project' && gateTrustOf({ gateTrust: 'organization' }) === 'project'
      && gateTrustOf({ gateTrust: 1 }) === 'project' && gateTrustOf({ gateTrust: ['org'] }) === 'project');
  check('场景 40：默认值常量与档位表同源一致（init 写 kit.json 用的就是它）',
    GATE_TRUST_DEFAULT === 'project' && GATE_TRUST_LEVELS.join(',') === 'project,org');

  // 端到端：kit.json 带 gateTrust → checkGateAnchors 回读该档（判据确实消费了它）
  const mkTrustKit = (gateTrust) => ({
    ...mkKit([{ rel: GATE_A, sha256: sha256Of(GATE_BODY), srcSha256: sha256Of(GATE_BODY) }]),
    ...(gateTrust === undefined ? {} : { gateTrust }),
  });
  for (const [label, gt, want] of [
    ['显式 org → 回读 org', 'org', 'org'],
    ['显式 project → 回读 project', 'project', 'project'],
    ['缺键（旧装户）→ 回读 project', undefined, 'project'],
    ['非法值 → 回读 project', 'ORG', 'project'],
  ]) {
    const root = mkfix({ kitContent: mkTrustKit(gt), files: { [GATE_A]: '// 手改\n' } });
    const r = checkGateAnchors(root);
    check(`场景 41 ${label}（且失配仍照常检出）`, r.trust === want && r.mismatch.length === 1,
      JSON.stringify({ want, got: r.trust, mismatch: r.mismatch }));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---- 场景 31-36：checkTemplateDrift（2026-10-11 模板感知直测补齐——此前唯一无直测的导出 check）----
// 三态判定单源 profiles.templateDriftOf：synced（盘==当前源）/ stale-drift（源演进盘未跟，唯一出账）/
// custom-synced（盘定制、源==锚，永不告警）/ no-anchor（旧装户静默）；TEMPLATE_DRIFT_EXCLUDE 与
// 无对应模板 rel 均不入比对面。fixture 双根：target（.agents/kit.json + 盘面）+ pkgRoot（templates/）。
{
  const OLD_BODY = '# tpl v1\n';
  const NEW_BODY = '# tpl v2 — source evolved\n';
  const CUSTOM_BODY = '# hand-customized\n';
  const mkpkg = (tplContent) => {
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-tpl-pkg-'));
    fs.mkdirSync(path.join(pkg, 'templates'), { recursive: true });
    if (tplContent !== null) fs.writeFileSync(path.join(pkg, 'templates', 'AGENTS.md'), tplContent);
    return pkg;
  };
  // 31 盘面 == 当前源 → synced，零 stale
  {
    const pkg = mkpkg(OLD_BODY);
    const root = mkfix({
      kitContent: mkKit([{ rel: 'AGENTS.md', sha256: sha256Of(OLD_BODY), srcSha256: sha256Of(OLD_BODY) }]),
      files: { 'AGENTS.md': OLD_BODY },
    });
    const r = checkTemplateDrift(root, pkg);
    check('场景 31：盘面==当前源 → synced（skipped=false stale=[] total=1）',
      r.skipped === false && r.total === 1 && r.stale.length === 0, JSON.stringify(r));
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(pkg, { recursive: true, force: true });
  }
  // 32 源演进 + 盘面未跟 → stale-drift（唯一出账形态）
  {
    const pkg = mkpkg(NEW_BODY);                       // 包源已演进
    const root = mkfix({
      kitContent: mkKit([{ rel: 'AGENTS.md', sha256: sha256Of(OLD_BODY), srcSha256: sha256Of(OLD_BODY) }]),
      files: { 'AGENTS.md': OLD_BODY },                // 盘面还停在锚版本
    });
    const r = checkTemplateDrift(root, pkg);
    check('场景 32：源演进盘未跟 → stale-drift（stale=[AGENTS.md]）',
      r.skipped === false && r.stale.length === 1 && r.stale[0] === 'AGENTS.md', JSON.stringify(r));
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(pkg, { recursive: true, force: true });
  }
  // 33 盘面定制（源==锚）→ custom-synced，永不告警
  {
    const pkg = mkpkg(OLD_BODY);
    const root = mkfix({
      kitContent: mkKit([{ rel: 'AGENTS.md', sha256: sha256Of(CUSTOM_BODY), srcSha256: sha256Of(OLD_BODY) }]),
      files: { 'AGENTS.md': CUSTOM_BODY },
    });
    const r = checkTemplateDrift(root, pkg);
    check('场景 33：盘面定制源==锚 → custom-synced（stale=[] 不出账）',
      r.skipped === false && r.total === 1 && r.stale.length === 0, JSON.stringify(r));
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(pkg, { recursive: true, force: true });
  }
  // 34 无 srcSha256 锚（旧装户）→ skipped 静默不追溯
  {
    const pkg = mkpkg(OLD_BODY);
    const root = mkfix({
      kitContent: mkKit([{ rel: 'AGENTS.md', sha256: sha256Of(OLD_BODY) }]),
      files: { 'AGENTS.md': OLD_BODY },
    });
    const r = checkTemplateDrift(root, pkg);
    check('场景 34：无锚 → skipped=true（旧装户静默，下次 sync 写锚生效）',
      r.skipped === true && r.total === 0 && r.stale.length === 0, JSON.stringify(r));
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(pkg, { recursive: true, force: true });
  }
  // 35 生成器目标（TEMPLATE_DRIFT_EXCLUDE）排除出比对面——混合条目只计 AGENTS.md
  {
    const pkg = mkpkg(OLD_BODY);
    const root = mkfix({
      kitContent: mkKit([
        { rel: 'workflow/INDEX.md', sha256: sha256Of('# idx\n'), srcSha256: sha256Of('# idx\n') },
        { rel: 'AGENTS.md', sha256: sha256Of(OLD_BODY), srcSha256: sha256Of(OLD_BODY) },
      ]),
      files: { 'AGENTS.md': OLD_BODY },
    });
    const r = checkTemplateDrift(root, pkg);
    check('场景 35：生成器目标排除 → total=1 只计 AGENTS.md',
      r.skipped === false && r.total === 1 && r.stale.length === 0, JSON.stringify(r));
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(pkg, { recursive: true, force: true });
  }
  // 36 rel 无对应模板（srcTemplatePath null）→ 不入比对面
  {
    const pkg = mkpkg(OLD_BODY);
    const root = mkfix({
      kitContent: mkKit([{ rel: 'wiki/自定文档.md', sha256: sha256Of('# x\n'), srcSha256: sha256Of('# x\n') }]),
      files: {},
    });
    const r = checkTemplateDrift(root, pkg);
    check('场景 36：无对应模板 rel → 不计数（skipped=true）',
      r.skipped === true && r.total === 0, JSON.stringify(r));
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(pkg, { recursive: true, force: true });
  }
}

// --- 场景 37-40：checkLevelHints（2026-10-13 hint-doctor）---
// level-hints 配置此前**只**在 flow-kit route 时才校验，而 route 是可选调用 → 写错的清单能静默存活。
// 本组直测三态：旧装户无判据单源 → skipped；配置合法（含默认空）→ ok；非法档位/ERE → ok=false。
{
  const mkHintsRoot = (hintsText) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-hints-'));
    fs.mkdirSync(path.join(root, '.agents', 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'templates/_agents/scripts/level-criteria.mjs'),
      path.join(root, '.agents/scripts/level-criteria.mjs'));
    // 2026-10-19：level-criteria.mjs 起 import workflow-enums.mjs（LEVELS 从单源派生），而后者启动即读
    //   `.agents/workflow-enums.txt`——漏拷任一个，spawn 都会以 fail-loud 崩栈作结（detail 是崩栈而非
    //   校验结论），三个场景全部假红。装户盘面这两件本就跟 level-criteria.mjs 同包下发，一起拷才构得成真盘。
    fs.copyFileSync(path.join(ROOT, 'templates/_agents/scripts/workflow-enums.mjs'),
      path.join(root, '.agents/scripts/workflow-enums.mjs'));
    fs.copyFileSync(path.join(ROOT, 'templates/_agents/workflow-enums.txt'),
      path.join(root, '.agents/workflow-enums.txt'));
    if (hintsText !== null) fs.writeFileSync(path.join(root, '.agents/level-hints.txt'), hintsText);
    return root;
  };

  {
    const r = mkHintsRoot('L2 ^src/contracts/\nL3 ^src/db/migrations/.*\\.sql$\n');
    const out = checkLevelHints(r);
    check('场景 37：合法 hints → ok 且报条数与档位',
      out.skipped === false && out.ok === true && /2 条有效/.test(out.note) && /L2/.test(out.note) && /L3/.test(out.note),
      JSON.stringify(out));
    fs.rmSync(r, { recursive: true, force: true });
  }
  {
    const r = mkHintsRoot(null); // 缺文件＝默认空＝纯语义定级
    const out = checkLevelHints(r);
    check('场景 38：清单缺失（默认空）→ ok 且明示未配置', out.ok === true && out.skipped === false && out.note.length > 0, JSON.stringify(out));
    fs.rmSync(r, { recursive: true, force: true });
  }
  {
    const r = mkHintsRoot('L3 ^src/db/[bad(\n'); // 非法 ERE
    const out = checkLevelHints(r);
    check('场景 39：非法 ERE → ok=false 且带清单路径与行号',
      out.ok === false && out.skipped === false && /level-hints/.test(out.detail) && /第 \d+ 行/.test(out.detail), JSON.stringify(out));
    fs.rmSync(r, { recursive: true, force: true });
  }
  {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-hints-old-')); // 无判据单源＝旧装户
    fs.mkdirSync(path.join(r, '.agents'), { recursive: true });
    const out = checkLevelHints(r);
    check('场景 40：无 level-criteria.mjs（1.7.15 前旧装户）→ skipped 不产出告警', out.skipped === true, JSON.stringify(out));
    fs.rmSync(r, { recursive: true, force: true });
  }
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);