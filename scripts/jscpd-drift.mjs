#!/usr/bin/env node
// jscpd-drift.mjs — 重复率基线的消费入口（2026-10-12 jscpd-drift-gate）
// 动机：scripts/jscpd-baseline.json 自 1.7.7 固化以来**全仓无任何代码读它**——基线是死数据，
//  GitClear 211M 行研究（2020-2024，重构行 25%→<10%、复制粘贴行 8.3%→12.3%、重复块约 4 倍）
//  指向 AI 编码最确定的退化信号之一，而本仓 209 个克隆块正处同一趋势上。CHANGELOG 1.7.9 已在
//  incidents/_TEMPLATE.md 根因节埋了「克隆分叉」采集点——证据采集在案，**消费端缺失**。
// 做法：读基线 → 在干净 worktree 跑基线自带的复现命令 → 比对 duplicatedLinesPct → advisory 报告。
//  **刻意不挂门禁**（三条理由）：① jscpd 需 `npx --yes` 联网取包，门禁路径依赖网络即等于给
//   攻击者/断网制造绕过口；② 重复率抬升是渐进的，warning 才不产生不可消退噪声（沿 1.7.8 方案 B）；
//  ③ 样本 <1 判据（基线自身不存在 / 解析失败）一律 fail-loud 但不阻断——「登记了却没查」必须可见。
//  判据阈值：抬升 > DRIFT_WARN_PCT（默认 1.0 个百分点）报 WARN；> DRIFT_FAIL_PCT（默认 3.0）报
//  「显著抬升，建议立 intent 收敛」。**两者都只出账不阻断**——收敛须有消费方与事故证据才启动
//  （CHANGELOG 1.7.9 判据：主动收敛维持留白），本脚本只负责让抬升可见。
// 用法：node scripts/jscpd-drift.mjs [--baseline <path>] [--warn-pct <n>] [--fail-pct <n>]
//      [--json] [--no-run]（--no-run：只校验基线可解析 + 打印基线数值，不跑 jscpd——本套件用）
//      [--verify-baseline]（复扫基线 commit 确认口径仍可复现；**不是**漂移判定，默认比对 HEAD）
// 测试：node src/jscpd-drift.test.mjs（纯函数 + 夹具；不真跑 jscpd，不联网）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_BASELINE = path.join(ROOT, 'scripts', 'jscpd-baseline.json');
export const DRIFT_WARN_PCT = 1.0;
export const DRIFT_FAIL_PCT = 3.0;

// loadBaseline：读并校验基线（fail-loud）。返回 { ok, error?, baseline? }
// 校验项：文件在 / JSON 可解析 / totals 六个键齐且为有限非负数 / commit 非空 / command 非空。
// 理由：基线是判据的**输入**，输入坏了却静默跳过 = 「登记了却没查」不可见（本项目红线之一）。
export function loadBaseline(file = DEFAULT_BASELINE) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    return { ok: false, error: `基线文件不可读：${file}（${e.code || e.message}）` };
  }
  let b;
  try { b = JSON.parse(raw); } catch (e) { return { ok: false, error: `基线 JSON 解析失败：${e.message}` }; }
  const need = ['sources', 'lines', 'clones', 'duplicatedLines', 'duplicatedLinesPct', 'duplicatedTokensPct'];
  const t = b.totals || {};
  const missing = need.filter((k) => typeof t[k] !== 'number' || !Number.isFinite(t[k]) || t[k] < 0);
  if (missing.length) return { ok: false, error: `基线 totals 缺键或非法：${missing.join(', ')}（键集：${need.join(', ')}）` };
  if (typeof b.commit !== 'string' || !b.commit.trim()) return { ok: false, error: '基线缺 commit 锚（无法对质「基线量的是哪一版」）' };
  if (typeof b.command !== 'string' || !b.command.trim()) return { ok: false, error: '基线缺 command（复现命令是口径的一部分，缺它基线不可复现）' };
  return { ok: true, baseline: b };
}

// parseReport：从 jscpd JSON 报告取 totals（pure，供测试直喂夹具）
// 字段位置随版本变过：statistics.total（5.x 实测）/ Statistics.Total（驼峰）；比率键 5.4.1 实测为
// percentage / percentageTokens，早期为 duplicatedLinesPct / duplicatedTokensPct——逐路径探测，
// 取不到落 null（不猜、不用 0 冒充——取不到 ≠ 没退化）。
export function parseReport(json) {
  const stats = (json && json.statistics) || (json && json.Statistics) || null;
  if (!stats) return null;
  const t = stats.total || stats.Total || null;
  if (!t) return null;
  // 键名随版本变过三处：驼峰 Statistics/Total/DuplicatedLinesPct、jscpd 5.x 实测小写
  // total.percentage / percentageTokens（5.4.1 实跑确认）、以及早期 duplicatedLinesPct——逐路径探测取首个有限数。
  const pick = (...vals) => vals.find((v) => typeof v === 'number' && Number.isFinite(v)) ?? null;
  return {
    sources: pick(t.sources, t.Sources),
    lines: pick(t.lines, t.Lines),
    clones: pick(t.clones, t.Clones),
    duplicatedLines: pick(t.duplicatedLines, t.DuplicatedLines),
    duplicatedLinesPct: pick(t.percentage, t.duplicatedLinesPct, t.Percentage, t.DuplicatedLinesPct),
    duplicatedTokensPct: pick(t.percentageTokens, t.duplicatedTokensPct, t.PercentageTokens, t.DuplicatedTokensPct),
  };
}

// compareDrift：基线 vs 实测的纯比对（pure）。返回 { deltaPct, level, lines }
// level：'ok' | 'warn' | 'high' | 'unknown'（实测取不到 → unknown，**不判 ok 也不判红**——
//   拿不到数据不是「没退化」的证据，混同即谎报）。
export function compareDrift(basePct, curPct, warnPct = DRIFT_WARN_PCT, failPct = DRIFT_FAIL_PCT) {
  if (typeof basePct !== 'number' || typeof curPct !== 'number' || !Number.isFinite(basePct) || !Number.isFinite(curPct)) {
    return { deltaPct: null, level: 'unknown', lines: [] };
  }
  const deltaPct = curPct - basePct;
  const lines = [`重复率 ${curPct.toFixed(2)}%（基线 ${basePct.toFixed(2)}%，Δ ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}pct）`];
  let level = 'ok';
  if (deltaPct > failPct) {
    level = 'high';
    lines.push(`⚠️ 显著抬升（>+${failPct}pct）——建议立 intent 收敛：根因若涉重复/未收拢代码，incidents 根因节按「克隆分叉」记两处位置`);
  } else if (deltaPct > warnPct) {
    level = 'warn';
    lines.push(`⚠️ 抬升（>+${warnPct}pct）——advisory 只可见不阻断；重复率是 AI 编码退化的先行指标，建议对基线复测一次确认非偶发`);
  } else {
    lines.push('✅ 未抬升');
  }
  return { deltaPct, level, lines };
}

// pickRef：实测面选哪个 commit（pure，供测试钉死——这条判据错则整个脚本变成「自我复读」：
// 扫基线 commit 必然得到 Δ=0，对比毫无意义）
export function pickRef(verifyBaseline, baselineCommit) {
  return verifyBaseline ? baselineCommit : 'HEAD';
}

// runJscpd：在干净 worktree 复现基线命令（口径必须与基线一致，否则比的是两件事）
// 为何 worktree：jscpd 按盘面扫，未跟踪/被忽略文件会污染分母——基线口径是「HEAD 干净 worktree」。
// **扫哪个 commit（关键）**：ref 默认 **HEAD**——比对的是「基线量过的那一版」与「现在这一版」的差，
//   扫 baseline.commit 只会得到 Δ=0 的恒等结果（那不是漂移检查，是自我复读）。基线 commit 仅在
//   `--verify-baseline` 下复扫，用于确认「基线还能被复现」（口径漂移自查，与漂移判定是两件事）。
export function runJscpd(baseline, cwd = ROOT, ref = pickRef(false, null)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscpd-drift-'));
  try {
    const wt = path.join(tmp, 'wt');
    const add = spawnSync('git', ['worktree', 'add', '--detach', wt, ref], { cwd, encoding: 'utf8' });
    if (add.status !== 0) return { ok: false, error: `git worktree add ${ref} 失败（${ref} 是否可解析？）：${(add.stderr || '').trim().split('\n')[0]}` };
    // 基线 command 含 `<tmp>` 占位（复现说明如此记载），按基线自述替换为本次输出目录
    const outDir = path.join(tmp, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const cmd = baseline.command.replace(/<tmp>/g, outDir);
    // 朴素分词：按空白切，引号包裹的整段去掉引号（基线命令形态固定为
    // `npx --yes jscpd --format "<fmt>" --reporters "json" --output <dir> .`——不引号内的空格，
    // 无需完整 shell 解析器；遇到需要 shell 语法时应改基线而非让本解析器变聪明）
    const args = cmd.split(/\s+/).filter(Boolean).map((a) => (/^".*"$/.test(a) ? a.slice(1, -1) : a));
    const r = spawnSync('npx', args, { cwd: wt, encoding: 'utf8', shell: process.platform === 'win32' });
    const report = path.join(outDir, 'jscpd-report.json');
    if (!fs.existsSync(report)) return { ok: false, error: `jscpd 未产出报告（exit=${r.status}）：${(r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' / ')}` };
    let json;
    try { json = JSON.parse(fs.readFileSync(report, 'utf8')); } catch (e) { return { ok: false, error: `jscpd 报告解析失败：${e.message}` }; }
    const totals = parseReport(json);
    if (!totals || totals.duplicatedLinesPct == null) return { ok: false, error: 'jscpd 报告 totals 取不到 duplicatedLinesPct（跨版本字段位置有出入，需更新 parseReport）' };
    return { ok: true, totals };
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', path.join(tmp, 'wt')], { cwd, encoding: 'utf8' });
    spawnSync('git', ['worktree', 'prune'], { cwd, encoding: 'utf8' });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const out = { json: false, noRun: false, verifyBaseline: false, baseline: DEFAULT_BASELINE, warnPct: DRIFT_WARN_PCT, failPct: DRIFT_FAIL_PCT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--no-run') out.noRun = true;
    else if (a === '--verify-baseline') out.verifyBaseline = true;
    else if (a === '--baseline') out.baseline = path.resolve(argv[++i] || '');
    else if (a === '--warn-pct') out.warnPct = Number(argv[++i]);
    else if (a === '--fail-pct') out.failPct = Number(argv[++i]);
    else { console.error(`❌ 未知参数：${a}\n用法：node scripts/jscpd-drift.mjs [--baseline <path>] [--warn-pct <n>] [--fail-pct <n>] [--json] [--no-run] [--verify-baseline]`); process.exit(1); }
  }
  if (!Number.isFinite(out.warnPct) || !Number.isFinite(out.failPct) || out.warnPct < 0 || out.failPct < out.warnPct) {
    console.error('❌ 阈值非法：须 0 ≤ warn-pct ≤ fail-pct 且均为有限数');
    process.exit(1);
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const load = loadBaseline(opts.baseline);
  if (!load.ok) {
    // fail-loud 但不阻断：基线坏了必须可见，静默跳过 = 「登记了却没查」
    if (opts.json) console.log(JSON.stringify({ ok: false, error: load.error }));
    else console.error(`❌ jscpd 漂移检查：${load.error}`);
    process.exit(1);
  }
  const b = load.baseline;
  const baseNote = `基线 commit ${b.commit}（${b.date || '日期未记'}）：${b.totals.sources} 文件 / ${b.totals.lines} 行 / ${b.totals.clones} 克隆块 / 重复 ${b.totals.duplicatedLinesPct}%`;
  if (opts.noRun) {
    if (opts.json) console.log(JSON.stringify({ ok: true, baseline: b.totals, note: baseNote }));
    else console.log(`[jscpd-drift] --no-run：只校验基线可解析。\n  ${baseNote}`);
    process.exit(0);
  }
  const run = runJscpd(b, ROOT, pickRef(opts.verifyBaseline, b.commit));
  if (!run.ok) {
    if (opts.json) console.log(JSON.stringify({ ok: false, error: run.error, baseline: b.totals }));
    else console.error(`❌ jscpd 漂移检查：${run.error}`);
    process.exit(1);
  }
  const cmp = compareDrift(b.totals.duplicatedLinesPct, run.totals.duplicatedLinesPct, opts.warnPct, opts.failPct);
  const out = { ok: cmp.level !== 'unknown', level: cmp.level, ref: opts.verifyBaseline ? b.commit : 'HEAD', baseline: b.totals, current: run.totals, note: baseNote };
  if (opts.json) console.log(JSON.stringify(out));
  else {
    console.log(`# jscpd 重复率漂移（advisory，只可见不阻断）\n  ${baseNote}`);
    console.log(`  实测面：${opts.verifyBaseline ? `基线 commit ${b.commit} 复扫（口径自查，非漂移判定）` : 'HEAD 干净 worktree'}`);
    for (const l of cmp.lines) console.log(`  ${l}`);
    console.log(`  实测：${run.totals.sources} 文件 / ${run.totals.lines} 行 / ${run.totals.clones} 克隆块 / 重复 ${run.totals.duplicatedLines} 行`);
    console.log('  口径：干净 worktree + 基线自带复现命令（与基线同口径才可比）；重复率抬升是 AI 编码退化的先行指标（GitClear 2025），收敛须有消费方与事故证据才启动。');
  }
  process.exit(0); // 恒 0：这是报告器不是门禁——阈值触达不阻断任何提交
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) main();
