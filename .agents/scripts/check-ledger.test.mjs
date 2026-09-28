// check-ledger.test.mjs — managed 台账快检测试（2026-09-28 ledger-precommit-gate）
// 方法：fixture 临时目录 .agents/kit.json + managed 件，调 ledgerDrift() + spawnSync CLI 出口码；
//       真实仓库 baseline（包源环境全对齐；装户环境 SKIP 不计失败，沿 source-sync-check 先例）
// 判据：S1 全对齐  S2 内容漂移逐份列出  S3 缺失  S4 CRLF×LF 归一不误报  S5 无 kit.json skip
//       S6 kit.json 解析失败 fatal  S7/S8 CLI 出口码 0/1  S9 真实仓 baseline
// 用法：node templates/_agents/scripts/check-ledger.test.mjs（装副本直跑亦然）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ledgerDrift } from './check-ledger.mjs';

let pass = 0, failCount = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { failCount++; console.log('FAIL ' + name + (detail ? '——' + detail : '')); }
}

// LF 归一 sha（同 check-ledger.mjs / doctor §4 口径）
const lfSha = (s) => createHash('sha256').update(s.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

function mkFixture(managed, entries, kitRaw) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cl-'));
  for (const [rel, content] of Object.entries(managed)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'kit.json'),
    kitRaw !== undefined ? kitRaw : JSON.stringify({ kit: 't', version: '0.0.0-test', managed: entries }));
  return root;
}

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-ledger.mjs');
const runCli = (cwd) => spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd });

// ---- S1 全对齐 → 无漂移无缺失 ----
{
  const root = mkFixture({ '.agents/scripts/a.mjs': 'A v1\n' }, [{ rel: '.agents/scripts/a.mjs', sha256: lfSha('A v1\n') }]);
  const r = ledgerDrift(root);
  check('S1 全对齐 → modified=0 gone=0 total=1', !r.skipped && r.modified.length === 0 && r.gone.length === 0 && r.total === 1, JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S2 内容漂移 → 逐份列出 rel ----
{
  const root = mkFixture({ '.agents/scripts/a.mjs': 'A 改了\n' }, [{ rel: '.agents/scripts/a.mjs', sha256: lfSha('A v1\n') }]);
  const r = ledgerDrift(root);
  check('S2 内容漂移 → modified=[a.mjs]', !r.skipped && r.modified.length === 1 && r.modified[0] === '.agents/scripts/a.mjs' && r.gone.length === 0, JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S3 managed 缺失 → gone ----
{
  const root = mkFixture({}, [{ rel: '.agents/scripts/gone.mjs', sha256: lfSha('x') }]);
  const r = ledgerDrift(root);
  check('S3 缺失 → gone=[gone.mjs]', !r.skipped && r.gone.length === 1 && r.gone[0] === '.agents/scripts/gone.mjs' && r.modified.length === 0, JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S4 CRLF 盘面 × LF 台账 → 归一不误报 ----
{
  const root = mkFixture({ '.agents/scripts/crlf.mjs': 'B v1\r\nline2\r\n' }, [{ rel: '.agents/scripts/crlf.mjs', sha256: lfSha('B v1\nline2\n') }]);
  const r = ledgerDrift(root);
  check('S4 CRLF 盘面 × LF 台账 → modified=0（归一口径）', !r.skipped && r.modified.length === 0 && r.gone.length === 0, JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S5 无 kit.json → skipped（非 flow-kit 安装兼容） ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cl-'));
  const r = ledgerDrift(root);
  check('S5 无 kit.json → skipped=true', r.skipped === true && typeof r.note === 'string', JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S6 kit.json 解析失败 → fatal ----
{
  const root = mkFixture({}, [], '{ kit: 坏 json');
  const r = ledgerDrift(root);
  check('S6 解析失败 → fatal 非空', !r.skipped && typeof r.fatal === 'string' && r.fatal.includes('解析失败'), JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S6b JSON 合法但 managed 缺失/非数组 → fatal（不静默全对齐；独立复核 P2-3） ----
{
  const root = mkFixture({}, [], JSON.stringify({ kit: 't', version: '0.0.0-test' }));
  const r = ledgerDrift(root);
  check('S6b managed 非数组 → fatal 非空（fail-loud）', !r.skipped && typeof r.fatal === 'string' && r.fatal.includes('managed'), JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S7 CLI 干净 fixture → exit 0 + 全对齐 ----
{
  const root = mkFixture({ '.agents/scripts/a.mjs': 'A v1\n' }, [{ rel: '.agents/scripts/a.mjs', sha256: lfSha('A v1\n') }]);
  const p = runCli(root);
  check('S7 CLI 全对齐 → exit 0 + 「全对齐」', p.status === 0 && p.stdout.includes('全对齐'), `status=${p.status} out=${p.stdout}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S8 CLI 漂移 fixture → exit 1 + 列出 rel + sync 提示 ----
{
  const root = mkFixture({ '.agents/scripts/a.mjs': 'A 改了\n' }, [{ rel: '.agents/scripts/a.mjs', sha256: lfSha('A v1\n') }]);
  const p = runCli(root);
  check('S8 CLI 漂移 → exit 1 + rel + sync 提示', p.status === 1 && p.stderr.includes('.agents/scripts/a.mjs') && p.stderr.includes('sync'), `status=${p.status} err=${p.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S9 真实仓 baseline：包源环境台账↔盘面全对齐；装户环境 SKIP 不计失败 ----
{
  let srcRoot = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5 && srcRoot; i++) {
    if (fs.existsSync(path.join(srcRoot, 'templates', '_agents'))) break;
    srcRoot = path.dirname(srcRoot);
  }
  if (!srcRoot || !fs.existsSync(path.join(srcRoot, 'templates', '_agents'))) {
    console.log('SKIP S9（装户环境无包源，不计失败）');
  } else {
    const r = ledgerDrift(srcRoot);
    check('S9 真实仓 baseline → 台账↔盘面全对齐', !r.skipped && r.modified.length === 0 && r.gone.length === 0, JSON.stringify({ modified: r.modified, gone: r.gone }));
  }
}

console.log(`\n合计: PASS ${pass} / FAIL ${failCount}`);
process.exit(failCount ? 1 : 0);
