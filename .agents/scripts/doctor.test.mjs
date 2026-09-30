#!/usr/bin/env node
// doctor 加 owned 漂移校验后的 fixture 驱动测试（2026-09-25 wf-runtime 复盘）
// 测试 src/doctor.mjs 导出的 checkOwnedDrift(target)：覆盖 4 场景——
//   ① owned 全对齐 → drift=0 gone=[] total>0 skipped=false
//   ② 手改装副本（盘面 sha 变） → drift=1 gone=[] total=1
//   ③ owned 文件缺失 → drift=0 gone=[rel] total=1
//   ④ kit.json 无 owned 字段 → skipped=true total=0
// 另测 checkAdapterDrift(target)（场景 5-14）与 checkLedgerCoverage(target, pkgRoot)（场景 15-18，
//   2026-09-26 managed-ledger-adopt：补「盘上有、台账无」一侧）。
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
const { checkOwnedDrift, checkAdapterDrift, checkLedgerCoverage, checkDelegationSnapshotFreshness } = await import(pathToFileURL(SRC).href);

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

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);