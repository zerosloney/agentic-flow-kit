#!/usr/bin/env node
// doctor 加 owned 漂移校验后的 fixture 驱动测试（2026-09-25 wf-runtime 复盘）
// 测试 src/doctor.mjs 导出的 checkOwnedDrift(target)：覆盖 4 场景——
//   ① owned 全对齐 → drift=0 gone=[] total>0 skipped=false
//   ② 手改装副本（盘面 sha 变） → drift=1 gone=[] total=1
//   ③ owned 文件缺失 → drift=0 gone=[rel] total=1
//   ④ kit.json 无 owned 字段 → skipped=true total=0
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
  console.error(`doctor.test.mjs：未找到 ${SRC}——仅在包源仓库（dogfooding）跑 npm test 时调用`);
  process.exit(1);
}
const { checkOwnedDrift } = await import(pathToFileURL(SRC).href);

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

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);