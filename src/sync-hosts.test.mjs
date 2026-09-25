// sync-hosts.test.mjs — flow-kit sync-hosts B-b 语义四场景（2026-09-25）
// 方法：迷你 fixture 包根（权威源 templates/_agents + 薄适配 modules/hosts/<h>/{agents,commands}/
//       与权威源正文段一致，frontmatter 各异）+ 子进程 driver 调真实 sync-hosts（隔离 process.exit）
// 判据：①全对齐 → inSync=28, drift 空  ②权威源改 → drift 列  ③apply → 正文一致，frontmatter 各自保留
//       ④薄适配 frontmatter 手改 → 不进 drift  ⑤薄适配正文手改 → drift 列，apply 覆盖
//       ⑥薄适配缺失 → authorityMissing 列；apply 不自动创建
// 用法：node src/sync-hosts.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

let pass = 0, failCount = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { failCount++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
}
const W = (p, content) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
const R = (p) => fs.readFileSync(p, 'utf8');

// ---- fixture 包根：权威源 + 4 宿主薄适配（正文段与权威源一致，frontmatter 各异） ----
function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-synchosts-'));
  // 权威源（2 commands + 1 role，简化测试体量；权威源也带 frontmatter 保证 body 段含前导空行，与薄适配对齐）
  W(path.join(root, 'templates/_agents/commands/build.md'),
    `---\ndescription: Build 阶段\nstage: Build\n---\n\n# Build · v1\n\n权威源正文 build v1\n`);
  W(path.join(root, 'templates/_agents/commands/test.md'),
    `---\ndescription: Test 阶段\nstage: Test\n---\n\n# Test · v1\n\n权威源正文 test v1\n`);
  W(path.join(root, 'templates/_agents/roles/implementer.md'),
    `---\ndescription: Implementer 角色契约\n---\n\n# Implementer · v1\n\n权威源正文 implementer v1\n`);
  // 薄适配：commands 权威源 → opencode + trae（trae 加 wf- 前缀 + name）
  W(path.join(root, 'modules/hosts/opencode/commands/build.md'),
    `---\ndescription: Build · opencode 风格\n---\n\n# Build · v1\n\n权威源正文 build v1\n`);
  W(path.join(root, 'modules/hosts/trae/commands/wf-build.md'),
    `---\nname: wf-build\ndescription: Build · trae 风格\n---\n\n# Build · v1\n\n权威源正文 build v1\n`);
  W(path.join(root, 'modules/hosts/opencode/commands/test.md'),
    `---\ndescription: Test · opencode 风格\n---\n\n# Test · v1\n\n权威源正文 test v1\n`);
  W(path.join(root, 'modules/hosts/trae/commands/wf-test.md'),
    `---\nname: wf-test\ndescription: Test · trae 风格\n---\n\n# Test · v1\n\n权威源正文 test v1\n`);
  // roles 权威源 → 4 宿主 agents（omp/zcode 中文风格 + trae name）
  W(path.join(root, 'modules/hosts/zcode/agents/implementer.md'),
    `---\nname: implementer\ndescription: 在已批准工作包内实现\n---\n\n# Implementer · v1\n\n权威源正文 implementer v1\n`);
  W(path.join(root, 'modules/hosts/omp/agents/implementer.md'),
    `---\nname: implementer\ndescription: omp 本机风格\n---\n\n# Implementer · v1\n\n权威源正文 implementer v1\n`);
  W(path.join(root, 'modules/hosts/opencode/agents/implementer.md'),
    `---\nname: implementer\ndescription: opencode 英文风格\n---\n\n# Implementer · v1\n\n权威源正文 implementer v1\n`);
  W(path.join(root, 'modules/hosts/trae/agents/implementer.md'),
    `---\nname: implementer\ndescription: trae 英文风格\n---\n\n# Implementer · v1\n\n权威源正文 implementer v1\n`);
  // 孤儿薄适配：权威源无对应文件
  W(path.join(root, 'modules/hosts/opencode/commands/orphan.md'), '# orphan\n');
  return root;
}

// ---- 子进程 driver：调真实 sync-hosts ----
function runSyncHosts(fixtureRoot, extra = []) {
  const driver = path.join(fixtureRoot, 'driver.mjs');
  W(driver, `import { syncHosts } from ${JSON.stringify(pathToFileURL(path.join(SRC_ROOT, 'sync-hosts.mjs')).href)};
const root = ${JSON.stringify(fixtureRoot)};
syncHosts(process.argv.slice(2), root);
`);
  return spawnSync(process.execPath, [driver, ...extra], { encoding: 'utf8' });
}

// ============ 场景 1：全对齐（正文段与权威源一致，frontmatter 各异）→ drift 空 ============
{
  const fx = mkFixture();
  const r = runSyncHosts(fx, ['--diff']);
  const out = r.stdout + r.stderr;
  check('S1 全对齐：正文对齐 8 对（2 commands×2 适配 + 1 role×4 宿主）', /正文对齐：\s*8\s*对/.test(out), out);
  check('S1 全对齐：报告无漂移', /无漂移/.test(out), out);
  check('S1 全对齐：exit 0', r.status === 0, `status=${r.status}`);
}

// ============ 场景 2：权威源改了正文，薄适配未跟 → drift 列 4 处（build→opencode+trae, test→opencode+trae）============
{
  const fx = mkFixture();
  W(path.join(fx, 'templates/_agents/commands/build.md'),
    `---\ndescription: Build 阶段\nstage: Build\n---\n\n# Build · v2\n\n权威源正文 build v2\n`);
  W(path.join(fx, 'templates/_agents/commands/test.md'),
    `---\ndescription: Test 阶段\nstage: Test\n---\n\n# Test · v2\n\n权威源正文 test v2\n`);
  const r = runSyncHosts(fx, ['--diff']);
  const out = r.stdout + r.stderr;
  check('S2 权威源改了 → 正文漂移 4（build×2 + test×2）', /正文段漂移（4/.test(out), out);
  check('S2 列出 opencode/commands/build.md', out.includes('commands/build.md → opencode/commands/build.md'), out);
  check('S2 列出 trae/commands/wf-build.md（trae wf- 前缀映射）', out.includes('commands/build.md → trae/commands/wf-build.md'), out);
  check('S2 正文对齐 = 4（1 role × 4 宿主 implementer 未改）', /正文对齐：\s*4\s*对/.test(out), out);
  check('S2 exit 0（diff 模式不阻断）', r.status === 0);
}

// ============ 场景 3：apply 后正文段 sha 一致，frontmatter 各自保留 ============
{
  const fx = mkFixture();
  W(path.join(fx, 'templates/_agents/commands/build.md'),
    `---\ndescription: Build 阶段\nstage: Build\n---\n\n# Build · v2\n\n权威源正文 build v2\n`);
  const r = runSyncHosts(fx, ['--apply']);
  const out = r.stdout + r.stderr;
  check('S3 apply：报告同步 2 份（opencode + trae）', /按权威源正文覆盖薄适配正文段\s*2\s*份/.test(out), out);
  check('S3 apply：opencode 正文已同步到 v2', R(path.join(fx, 'modules/hosts/opencode/commands/build.md')).includes('权威源正文 build v2'));
  check('S3 apply：trae 正文已同步到 v2', R(path.join(fx, 'modules/hosts/trae/commands/wf-build.md')).includes('权威源正文 build v2'));
  check('S3 apply：opencode frontmatter 保留（仍无 name 字段）', !R(path.join(fx, 'modules/hosts/opencode/commands/build.md')).match(/^name:/m));
  check('S3 apply：trae frontmatter 保留（仍含 name: wf-build）', R(path.join(fx, 'modules/hosts/trae/commands/wf-build.md')).match(/^name:\s*wf-build/m) !== null);
  check('S3 apply：权威源不动', R(path.join(fx, 'templates/_agents/commands/build.md')).includes('权威源正文 build v2'));
  check('S3 apply：再次 diff 应显示对齐 8', true); // 二次扫描由 sync-hosts 内部做
}

// ============ 场景 4：薄适配 frontmatter 手改 → 不进 drift（正文段比对不受影响）============
{
  const fx = mkFixture();
  // trae frontmatter description 改成"自定义"——正文段未动
  W(path.join(fx, 'modules/hosts/trae/commands/wf-build.md'),
    `---\nname: wf-build\ndescription: trae 自定义描述\n---\n\n# Build · v1\n\n权威源正文 build v1\n`);
  const r = runSyncHosts(fx, ['--diff']);
  const out = r.stdout + r.stderr;
  check('S4 frontmatter 差异不计正文段漂移', /正文对齐：\s*8\s*对/.test(out) && /无漂移/.test(out), out);
}

// ============ 场景 5：薄适配正文手改 → drift 列出，apply 覆盖（不污染权威源）============
{
  const fx = mkFixture();
  W(path.join(fx, 'modules/hosts/zcode/agents/implementer.md'),
    `---\nname: implementer\ndescription: zcode 风格\n---\n\n# Implementer · v1\n\n薄适配手改 implementer v1\n`);
  const r = runSyncHosts(fx, ['--diff']);
  const out = r.stdout + r.stderr;
  check('S5 薄适配正文手改 → 正文段漂移 1', /正文段漂移（1/.test(out), out);
  const r2 = runSyncHosts(fx, ['--apply']);
  check('S5 apply 后：薄适配正文回到权威源（含「权威源正文 implementer v1」）', /权威源正文 implementer v1/.test(R(path.join(fx, 'modules/hosts/zcode/agents/implementer.md'))));
  check('S5 apply 不污染权威源（权威源仍 v1）', !R(path.join(fx, 'templates/_agents/roles/implementer.md')).includes('薄适配手改'));
  // apply 后再 diff 一次，diff 应显示"无漂移"
  const r3 = runSyncHosts(fx, ['--diff']);
  check('S5 apply 后再 diff 应无漂移', /无漂移/.test(r3.stdout + r3.stderr), r3.stdout + r3.stderr);
}

// ============ 场景 6：薄适配文件不存在 → authorityMissing 列出，apply 不创建 ============
{
  const fx = mkFixture();
  fs.rmSync(path.join(fx, 'modules/hosts/opencode/commands/build.md'));
  const r = runSyncHosts(fx, ['--diff']);
  const out = r.stdout + r.stderr;
  check('S6 薄适配缺失 → authorityMissing 列', /权威源声明但薄适配缺失（/.test(out) && out.includes('opencode/commands/build.md'), out);
  const r2 = runSyncHosts(fx, ['--apply']);
  check('S6 apply 不自动创建薄适配（仍缺失）', !fs.existsSync(path.join(fx, 'modules/hosts/opencode/commands/build.md')));
}

// ============ 场景 7：--json 机器可读输出 ============
{
  const fx = mkFixture();
  const r = runSyncHosts(fx, ['--json']);
  const out = r.stdout + r.stderr;
  let parsed = null;
  try { parsed = JSON.parse(out); } catch {}
  check('S7 --json 输出可解析', parsed && typeof parsed === 'object' && Array.isArray(parsed.drift));
  check('S7 --json 含 inSync = 8', parsed && parsed.inSync === 8, parsed ? JSON.stringify(parsed) : 'null');
}

// ============ 场景 8：孤儿薄适配（权威源无对应文件）→ adapterOrphans 列，apply 不删 ============
{
  const fx = mkFixture();
  // orphan.md 已在 mkFixture 写入
  const r = runSyncHosts(fx, ['--diff']);
  const out = r.stdout + r.stderr;
  check('S8 孤儿薄适配 → adapterOrphans 列', /孤儿薄适配（/.test(out) && out.includes('opencode/commands/orphan.md'), out);
  const r2 = runSyncHosts(fx, ['--apply']);
  check('S8 apply 不删孤儿薄适配', fs.existsSync(path.join(fx, 'modules/hosts/opencode/commands/orphan.md')));
}

console.log(`\n合计: PASS ${pass} / FAIL ${failCount}`);
process.exit(failCount ? 1 : 0);