#!/usr/bin/env node
// quality-gates.mjs — C# 后端质量门手动触发器（CRAP / 变异 / 重复）
//
// 定位：确定性动作下沉到本脚本（跑覆盖率、解析报告、汇总），模型只做判断（解读与优先级）。
// 三道门与 Uncle Bob ub-mode 的对位：
//   crapper  → dotnet-crap   （Crap4DotNet，CRAP = CC²×(1-cov)³+CC，公式一致）
//   mutator  → dotnet stryker（Stryker.NET，自带覆盖率引擎，不依赖 coverlet）
//   dryer    → PMD CPD       （--language cs，注意是 cs 不是 csharp）
//
// 关键约束（全部来自本仓 2026-10-31 实测，详见 .agents/skills/csharp-quality-gates/SKILL.md）：
//   1. coverlet 在本机默认 TEMP 下会静默产出 0% 覆盖率 → 跑覆盖率前必须把 TEMP/TMP 改道到
//      工作区内目录；脚本已内置，并在采集结果为 0 时大声报错而不是继续往下走。
//   2. cobertura 落在 <results>/<guid>/coverage.cobertura.xml 子目录 → 脚本递归找最新的那个。
//   3. dotnet-crap --coverage 只吃绝对路径。
//   4. PMD 的 C# 语言标识是 cs；--no-cache 不是合法选项。
//   5. 只跑单测工程（集成测试要 DB，CI mid 档也不跑它）；Stryker 必须定点，全量 2 万+ 变异点不可接受。
//
// 命令：doctor | coverage | crap | dup | mutate <glob> | all
// 退出：0 通过；1 门未达标（有方法超阈值 / 有重复块）；2 用法·配置·采集失败。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const WORK = path.join(REPO, '.agents', 'tmp', 'quality-gates');
const TMP = path.join(WORK, 'tmp');
const COV_DIR = path.join(WORK, 'coverage');
const SOLUTION = path.join(REPO, 'Shipyard.Material.sln');
const UNIT_TEST_PROJ = path.join(REPO, 'tests', 'Shipyard.Material.Tests', 'Shipyard.Material.Tests.csproj');
const BACKEND = path.join(REPO, 'backend');

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : '';

class UsageError extends Error {}

function opt(key, fallback) {
  const prefix = `${key}=`;
  const i = argv.indexOf(key);
  if (i >= 0) {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${key} 缺少取值`);
    return v;
  }
  const j = argv.indexOf(prefix);
  if (j >= 0) {
    const v = argv[j + 1];
    if (v === undefined) throw new UsageError(`${key} 缺少取值`);
    return v;
  }
  return fallback;
}

function positional() {
  return argv.slice(1).filter((a) => !a.startsWith('-'));
}

// ── 工具解析：PATH → ~/.dotnet/tools → 已知安装位 ──────────────────────────
function which(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, name + e);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
  }
  return null;
}

function resolveDotnetTool(name) {
  return (
    which(name) ||
    (fs.existsSync(path.join(os.homedir(), '.dotnet', 'tools', `${name}.exe`))
      ? path.join(os.homedir(), '.dotnet', 'tools', `${name}.exe`)
      : null)
  );
}

function resolveDotnet() {
  return process.env.DOTNET_HOST_PATH || which('dotnet') || 'C:/Program Files/dotnet/dotnet.exe';
}

// PMD 是 Java 应用；不经过 pmd.bat（Windows 的 .bat 无法被 spawnSync 直接执行，
// 静默失败会得到「0 重复」的假象），改为直接调 java + PMD 官方 main class。
function resolvePmdHome() {
  const candidates = [];
  if (process.env.PMD_HOME) candidates.push(process.env.PMD_HOME);
  const root = path.join(os.homedir(), '.agents', 'tools', 'pmd');
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root).filter((x) => x.startsWith('pmd-bin-')).sort().reverse()) {
      candidates.push(path.join(root, d));
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'lib')) && fs.existsSync(path.join(c, 'conf'))) return c;
  }
  return null;
}

function resolveJava() {
  return process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', 'java.exe')
    : which('java') || 'java';
}

// ── 进程执行 ───────────────────────────────────────────────────────────────
function run(file, args, opts = {}) {
  const r = spawnSync(file, args, {
    cwd: opts.cwd || REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(opts.env || {}) },
    shell: false,
  });
  if (r.error) {
    // spawn 失败必须响亮：静默的空输出会被下游读成「0 重复 / 0 覆盖」这类假结论。
    throw new Error(`无法执行 ${file}：${r.error.message}`);
  }
  return {
    status: r.status === null ? -1 : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

// ── 工具函数 ───────────────────────────────────────────────────────────────
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function newestFile(root, name) {
  let best = null;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === name) {
        const t = fs.statSync(p).mtimeMs;
        if (!best || t > best.t) best = { path: p, mtime: t };
      }
    }
  };
  walk(root);
  return best ? best.path : null;
}

function readCoberturaStats(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const root = /<coverage\b[^>]*>/.exec(xml);
  if (!root) return null;
  const attr = (k) => {
    const m = new RegExp(`${k}="([^"]*)"`).exec(root[0]);
    return m ? m[1] : null;
  };
  return {
    lineRate: attr('line-rate'),
    linesCovered: Number(attr('lines-covered') || 0),
    linesValid: Number(attr('lines-valid') || 0),
  };
}

// ── 命令实现 ───────────────────────────────────────────────────────────────
function doctor() {
  const rows = [];
  const dotnet = resolveDotnet();
  rows.push(['dotnet', dotnet, fs.existsSync(dotnet)]);
  const crap = resolveDotnetTool('dotnet-crap');
  rows.push(['dotnet-crap', crap || '(未安装)', !!crap]);
  const stryker = resolveDotnetTool('dotnet-stryker');
  rows.push(['dotnet-stryker', stryker || '(未安装)', !!stryker]);
  const pmdHome = resolvePmdHome();
  rows.push(['pmd', pmdHome || '(未安装)', !!pmdHome]);
  const java = resolveJava();
  rows.push(['java', java, fs.existsSync(java) || which('java') !== null]);
  rows.push(['单测工程', UNIT_TEST_PROJ, fs.existsSync(UNIT_TEST_PROJ)]);
  rows.push(['解决方案', SOLUTION, fs.existsSync(SOLUTION)]);

  console.log('工具探测：');
  for (const [n, p, ok] of rows) console.log(`  ${ok ? 'OK  ' : 'MISS'} ${n.padEnd(16)} ${p}`);
  console.log('');
  console.log('缺装时的安装命令：');
  console.log('  dotnet tool install -g Crap4DotNet');
  console.log('  dotnet tool install -g dotnet-stryker');
  console.log('  PMD：下载 pmd-dist-<ver>-bin.zip 解压到 ~/.agents/tools/pmd/（语言标识是 cs）');
  const missing = rows.filter((r) => !r[2]);
  return missing.length ? 2 : 0;
}

function coverage() {
  if (!fs.existsSync(UNIT_TEST_PROJ)) {
    console.error(`单测工程不存在：${UNIT_TEST_PROJ}`);
    return 2;
  }
  ensureDir(TMP);
  ensureDir(COV_DIR);
  // 关键：coverlet 在本机默认 TEMP 下会静默产出 0% 覆盖率 → 改道到工作区内目录。
  const env = { TEMP: TMP, TMP: TMP };
  console.log(`跑单测收覆盖率（TEMP 改道 → ${TMP}）…`);
  const r = run('dotnet', ['test', UNIT_TEST_PROJ, '--collect:XPlat Code Coverage', `--results-directory=${COV_DIR}`], { env });
  const tail = r.stdout.split(/\r?\n/).filter((l) => /已通过|失败|Passed!|Failed!|error/i.test(l)).slice(-3);
  for (const l of tail) console.log(`  ${l.trim()}`);

  const cov = newestFile(COV_DIR, 'coverage.cobertura.xml');
  if (!cov) {
    console.error('未产出 coverage.cobertura.xml —— 采集失败，勿把「无覆盖」当结论。');
    return 2;
  }
  const stats = readCoberturaStats(cov);
  console.log(`覆盖率文件：${cov}`);
  console.log(`line-rate=${stats.lineRate}  lines-covered=${stats.linesCovered}/${stats.linesValid}`);
  if (stats.linesValid > 0 && stats.linesCovered === 0) {
    console.error('');
    console.error('⚠ 采集结果为 0 命中 —— 这是采集故障，不是「代码没被测到」。');
    console.error('  已知成因：coverlet 在某些 TEMP 目录下会丢失自己写的插桩模块，');
    console.error('  testhost 退出时抛未处理 FileNotFoundException，命中数据不落报告。');
    console.error(`  本脚本已把 TEMP 改道到 ${TMP}；仍为 0 则查该目录是否被清理/杀软拦截。`);
    return 2;
  }
  console.log('');
  console.log('下一步：node .agents/skills/csharp-quality-gates/scripts/quality-gates.mjs crap');
  return 0;
}

function findCoverage() {
  const explicit = opt('--coverage');
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      console.error(`覆盖率文件不存在：${explicit}`);
      return null;
    }
    return explicit;
  }
  const cov = newestFile(COV_DIR, 'coverage.cobertura.xml');
  if (!cov) {
    console.error('未找到覆盖率文件——先跑 `coverage` 子命令（或用 --coverage <绝对路径> 指定）。');
    return null;
  }
  const stats = readCoberturaStats(cov);
  if (stats && stats.linesValid > 0 && stats.linesCovered === 0) {
    console.error('⚠ 该覆盖率文件命中数为 0（采集故障），用它算 CRAP 会得到「纯复杂度排序」的假象。');
    console.error('  请重跑 `coverage` 子命令（TEMP 改道后重采）。');
    return null;
  }
  return cov;
}

function crap() {
  const crapTool = resolveDotnetTool('dotnet-crap');
  if (!crapTool) {
    console.error('未找到 dotnet-crap —— 装：dotnet tool install -g Crap4DotNet');
    return 2;
  }
  const cov = findCoverage();
  if (!cov) return 2;

  const threshold = Number(opt('--threshold', '30'));
  const minCrap = Number(opt('--min-crap', '0'));
  const topN = Number(opt('--top', '15'));
  const outJson = path.join(WORK, 'crap-report.json');

  console.log(`跑 CRAP 分析（threshold=${threshold}）…`);
  const r = run(crapTool, ['analyze', SOLUTION, '--coverage', cov, '--output', outJson, '--threshold', String(threshold)]);
  if (r.status === 2) {
    console.error(r.stdout.trim() || r.stderr.trim());
    return 2;
  }
  let j;
  try {
    j = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  } catch (e) {
    console.error(`CRAP 报告解析失败：${e.message}`);
    return 2;
  }
  const methods = j.methods || [];
  const zero = methods.filter((m) => !m.coverage || m.coverage === 0);
  const over = methods.filter((m) => (m.crap || 0) > threshold);
  const danger = methods
    .filter((m) => (!m.coverage || m.coverage === 0) && (m.crap || 0) > threshold)
    .sort((a, b) => (b.crap || 0) - (a.crap || 0));

  console.log('');
  console.log(`方法总数 ${methods.length}  零覆盖 ${zero.length}（${Math.round((100 * zero.length) / (methods.length || 1))}%）  超阈值(>${threshold}) ${over.length}`);
  console.log(`报告：${outJson}`);
  console.log('');
  console.log(`零覆盖且超阈值（补测优先级，按 CRAP 降序，取前 ${topN}）：`);
  if (!danger.length) {
    console.log('  （无）');
  }
  for (const m of danger.slice(0, topN)) {
    const name = String(m.fullName || m.name || '').split('(')[0];
    console.log(`  CRAP=${String(m.crap).padStart(8)}  CC=${String(m.complexity).padStart(3)}  cov=${m.coverage}  ${name}`);
  }
  if (minCrap > 0) {
    const sel = methods.filter((m) => (m.crap || 0) >= minCrap).sort((a, b) => b.crap - a.crap);
    console.log('');
    console.log(`--min-crap ${minCrap} 命中 ${sel.length} 个方法（已含在报告中）`);
  }
  return over.length ? 1 : 0;
}

function dup() {
  const pmdHome = resolvePmdHome();
  if (!pmdHome) {
    console.error('未找到 PMD —— 下载 pmd-dist-<ver>-bin.zip 解压到 ~/.agents/tools/pmd/（含 lib/ 与 conf/ 的那层）');
    return 2;
  }
  const minTokens = opt('--minimum-tokens', '100');
  const topN = Number(opt('--top', '10'));
  const java = resolveJava();
  const cp = [path.join(pmdHome, 'conf'), path.join(pmdHome, 'lib', '*')].join(path.delimiter);
  console.log(`跑 PMD CPD 重复检测（--language cs --minimum-tokens ${minTokens}）…`);
  const r = run(java, ['-cp', cp, 'net.sourceforge.pmd.cli.PmdCli', 'cpd', '--language', 'cs', '--minimum-tokens', minTokens, BACKEND]);
  const text = r.stdout + r.stderr;
  const blocks = [];
  // 注意：PMD 输出里 "duplication in the following files:" 之后、行号之前都带尾随空格，
  // 正则不容许它就会 0 匹配——静默变成「没有重复」。故此处 [ \t]* 必需。
  const re = /Found a (\d+) line \((\d+) tokens\) duplication in the following files:[ \t]*\r?\n((?:Starting at line \d+ of [^\r\n]+\r?\n?)+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const files = [];
    const fre = /Starting at line (\d+) of ([^\r\n]+)/g;
    let f;
    while ((f = fre.exec(m[3])) !== null) files.push({ line: Number(f[1]), file: f[2].trim() });
    blocks.push({ lines: Number(m[1]), tokens: Number(m[2]), files });
  }
  // 格式漂移守卫：文本里有 duplication 字样却一块没解析出来 → 解析器过期，不是「没有重复」。
  if (!blocks.length && /duplication/i.test(text)) {
    console.error('⚠ PMD 输出含 duplication 字样但未能解析出任何重复块——解析器可能已过期（PMD 升级改了输出格式）。');
    console.error('  禁把本次结果当作「没有重复」；请人工看原始输出：');
    console.error(text.split(/\r?\n/).slice(0, 20).join('\n'));
    return 2;
  }
  console.log('');
  console.log(`重复块数：${blocks.length}`);
  const sorted = blocks.sort((a, b) => b.tokens - a.tokens);
  for (const b of sorted.slice(0, topN)) {
    const loc = b.files.map((x) => `${path.basename(x.file)}:${x.line}`).join('  |  ');
    console.log(`  ${String(b.tokens).padStart(5)} tokens / ${String(b.lines).padStart(3)} 行   ${loc}`);
  }
  return blocks.length ? 1 : 0;
}

function mutate() {
  const globs = positional();
  if (!globs.length) {
    console.error('用法：mutate <glob> [glob...]  —— 必须定点，全量 2 万+ 变异点不可接受');
    console.error('例：mutate "**/PurchaseOrderService.cs"');
    return 2;
  }
  const dotnet = resolveDotnet();
  const args = [
    'stryker',
    '-p',
    'Shipyard.Material.Application.csproj',
    '--mutate',
    globs[0],
    '--skip-version-check',
    '-O',
    path.join(WORK, 'stryker'),
  ];
  for (const g of globs.slice(1)) args.push('--mutate', g);
  console.log(`跑变异测试：${globs.join(' , ')}（可能耗时数分钟）…`);
  const r = run(dotnet, args, { cwd: path.join(REPO, 'tests', 'Shipyard.Material.Tests') });
  const out = r.stdout + r.stderr;
  let willTest = null;
  for (const l of out.split(/\r?\n/)) {
    const m = /(\d+)\s+total mutants will be tested/.exec(l);
    if (m) willTest = Number(m[1]);
    if (/mutants created|NoCoverage|CompileError|mutation score|Killed:|Survived:/.test(l)) {
      console.log(`  ${l.trim()}`);
    }
  }
  // 假绿守卫：glob 没匹配到任何东西 → 0 个变异点待测 → 不是「通过」，是用法错。
  if (willTest === 0) {
    console.error('');
    console.error('⚠ 0 个变异点待测 —— glob 没匹配到任何代码（Stryker 把全部变异点按 mutate 过滤掉了）。');
    console.error('  禁把本次结果当作「变异测试通过」；请核对 glob（如 "**/PurchaseOrderService.cs"）与工程名。');
    return 2;
  }
  console.log('');
  console.log('解读要点：得分低先分清两种原因——');
  console.log('  (a) 测试没断言到位（NoCoverage 少、被杀比例低）→ 测试无效');
  console.log('  (b) 代码压根没被跑到（NoCoverage 多）→ 该路径缺测试，别急着加断言');
  return r.status === 0 ? 0 : 1;
}

function all() {
  console.log('══ 1/3 覆盖率 ══');
  const c = coverage();
  if (c !== 0) return c;
  console.log('');
  console.log('══ 2/3 CRAP ══');
  const r1 = crap();
  console.log('');
  console.log('══ 3/3 重复代码 ══');
  const r2 = dup();
  console.log('');
  console.log(`汇总：CRAP 门 ${r1 === 0 ? '通过' : '未达标'}；重复门 ${r2 === 0 ? '通过' : '未达标'}`);
  console.log('（变异测试默认不跑：耗时长，需定点，见 `mutate <glob>`）');
  return r1 === 0 && r2 === 0 ? 0 : 1;
}

const COMMANDS = { doctor, coverage, crap, dup, mutate, all };

try {
  if (!cmd) throw new UsageError('缺子命令');
  const fn = COMMANDS[cmd];
  if (!fn) throw new UsageError(`未知子命令：${cmd}`);
  ensureDir(WORK);
  process.exit(fn());
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`用法错误：${e.message}`);
    console.error('命令：doctor | coverage | crap | dup | mutate <glob> | all');
    process.exit(2);
  }
  console.error(`未预期错误：${e && e.stack ? e.stack : e}`);
  process.exit(2);
}
