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
  } else if (!fs.existsSync(path.join(srcRoot, '.agents', 'kit.json'))) {
    console.log('SKIP S9（纯包源仓无 .agents/ 装副本——装户端内容清理后形态，不计失败）');
  } else {
    const r = ledgerDrift(srcRoot);
    check('S9 真实仓 baseline → 台账↔盘面全对齐', !r.skipped && r.modified.length === 0 && r.gone.length === 0, JSON.stringify({ modified: r.modified, gone: r.gone }));
  }
}

// ---- S10 入库态口径（2026-10-08 papercuts-cleanup-batch 修 5）：git 仓 fixture，分批提交场景 ----
// 核心场景（papercuts 2026-09-30 行）：sync 刷新 kit.json 后只 add 台账不 add 件 → 提交树内 kit.json
// 预 landing → 修前工作树口径「全对齐」放行（假绿），clone/CI doctor 必红；修后入库态模式拦。
{
  const GIT = process.platform === 'win32' ? 'git.exe' : 'git';
  const g = (cwd, ...args) => spawnSync(GIT, args, { cwd, encoding: 'utf8' });
  const W2 = (root, rel, content) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-cl-git-'));
  g(repo, 'init', '-q');
  g(repo, 'config', 'user.email', 't@t');
  g(repo, 'config', 'user.name', 't');
  g(repo, 'config', 'core.autocrlf', 'false');
  const kitOf = (aSha) => JSON.stringify({
    kit: 't', version: '0.0.0-test',
    managed: [{ rel: '.agents/scripts/a.mjs', sha256: aSha }],
  }) + '\n';
  W2(repo, '.agents/scripts/a.mjs', 'A v1\n');
  W2(repo, '.agents/kit.json', kitOf(lfSha('A v1\n')));
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'v1');
  // sync 模拟：件与台账同刷 v2（工作区自洽，均未提交）
  W2(repo, '.agents/scripts/a.mjs', 'A v2\n');
  W2(repo, '.agents/kit.json', kitOf(lfSha('A v2\n')));

  // S10① 只 add kit.json（分批提交）→ 暂存台账(v2) vs 入库件(HEAD v1) → 拦
  g(repo, 'add', '.agents/kit.json');
  const r1 = ledgerDrift(repo, { staged: true });
  check('S10① 入库态：台账(v2 暂存) vs 件(HEAD v1) → 拦（修前工作树口径假绿放行）',
    r1.mode === 'staged' && r1.modified.includes('.agents/scripts/a.mjs'), JSON.stringify(r1));
  // S10② 件与台账同 add → 入库态一致 → 过
  g(repo, 'add', '.agents/scripts/a.mjs');
  const r2 = ledgerDrift(repo, { staged: true });
  check('S10② 入库态：件与台账同 add → 一致过', r2.mode === 'staged' && !r2.modified.length && !r2.gone.length, JSON.stringify(r2));
  g(repo, 'commit', '-q', '-m', 'v2 both');
  // S10③ 工作树删件未暂存 → index 仍有该件（`:rel` 命中 HEAD 内容）→ 不误报 gone（复核 P1 修后语义：
  // HEAD 兜底已移除，判定路径 = `:rel` 命中而非兜底）
  fs.rmSync(path.join(repo, '.agents/scripts/a.mjs'));
  const r3 = ledgerDrift(repo, { staged: true });
  check('S10③ 入库态：工作树删件未暂存 → index 仍在，不误报', !r3.gone.length && !r3.modified.length, JSON.stringify(r3));
  // S10④ 暂存删除（git rm）→ 提交树已无该件而台账仍跟踪 → gone 拦（复核 P1：HEAD 兜底曾把它误读
  // 为「未触碰」放行 = 提交门绕过；修后与模块头「managed 删除即拦」政策一致）
  g(repo, 'rm', '-q', '--cached', '.agents/scripts/a.mjs');
  const r4 = ledgerDrift(repo, { staged: true });
  check('S10④ 入库态：暂存删除 → gone 拦（提交树=index，删除被应用）', r4.gone.includes('.agents/scripts/a.mjs'), JSON.stringify(r4));
  // S10④b 退出性提交：kit.json 被暂存删除 → 放行（skip，语义与 managed 删除拦截区分）
  g(repo, 'rm', '-q', '--cached', '.agents/kit.json');
  const r4b = ledgerDrift(repo, { staged: true });
  check('S10④b 入库态：kit.json 暂存删除（退出性提交）→ skip 放行', r4b.skipped === true, JSON.stringify(r4b));
  g(repo, 'reset', '-q', '--hard', 'HEAD'); // 复原（防脏）

  // S10⑤ isMain 无参自适应（子进程）：暂存区空 → 「工作树」；暂存区非空 → 自动「入库态」
  g(repo, 'reset', '-q', '--hard', 'HEAD'); // 清掉 ④ 的暂存删除，回到干净 v2 both
  const s1 = runCli(repo); // 暂存区空 → 工作树口径
  check('S10⑤ 暂存区空 → 工作树口径', s1.status === 0 && (s1.stdout || '').includes('工作树'), `out=${s1.stdout}`);
  W2(repo, 'unrelated.txt', 'x\n');
  g(repo, 'add', 'unrelated.txt'); // 暂存非空（无关文件即可）→ 自动入库态；kit.json 未暂存走 HEAD 兜底
  const s2 = runCli(repo);
  check('S10⑤ 暂存区非空 → 自动切入库态且一致 exit 0',
    s2.status === 0 && (s2.stdout || '').includes('入库态'), `status=${s2.status} out=${s2.stdout}`);
  // S10⑥ 姊妹漏洞（完备口径价值场景）：只 add 件不 add 台账 → 提交树 = HEAD 台账(v1? v2) + 暂存件 → 错位拦
  W2(repo, '.agents/scripts/a.mjs', 'A v3\n');
  g(repo, 'add', '.agents/scripts/a.mjs');
  const s3 = runCli(repo);
  check('S10⑥ 只 add 件不 add 台账 → 入库态错位拦 exit 1', s3.status === 1 && (s3.stderr || '').includes('.agents/scripts/a.mjs'), `status=${s3.status} err=${s3.stderr}`);
  fs.rmSync(repo, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${failCount}`);
process.exit(failCount ? 1 : 0);
