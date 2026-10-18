#!/usr/bin/env node
// jscpd-drift.test.mjs — jscpd 漂移检查的纯函数 + 夹具回归（2026-10-12 jscpd-drift-gate）
// 不真跑 jscpd、不联网：runJscpd 走真 worktree + npx，离线不可靠且慢；本套件只钉判据纯函数与
// --no-run 端到端（基线可解析性）。真跑路径由 CI 的 workflow_dispatch 手动 job 覆盖。
// 用法：node src/jscpd-drift.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// fileURLToPath 而非手搓 pathname 解码（源仓 fdded128 同根因）：非 ASCII 路径经 URL 百分号编码后解析错路径。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'jscpd-drift.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const mod = await import(pathToFileURL(SCRIPT).href);
const { loadBaseline, parseReport, compareDrift, pickRef, DRIFT_WARN_PCT, DRIFT_FAIL_PCT } = mod;

const tmp = (name, content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jscpd-drift-test-${name}-`));
  const f = path.join(dir, 'baseline.json');
  fs.writeFileSync(f, content, 'utf8');
  return f;
};
const cleanup = (...fs_) => fs_.forEach((f) => fs.rmSync(path.dirname(f), { recursive: true, force: true }));

// ---- 场景 1：真实基线可解析（消费端接的是本仓锚，不是夹具）----
{
  const r = loadBaseline();
  check('场景 1：本仓基线可解析且六键齐', r.ok, r.error);
  check('场景 1：基线含 commit 锚 + 复现命令 + 日期',
    r.ok && !!r.baseline.commit && !!r.baseline.command && !!r.baseline.date,
    r.ok ? JSON.stringify(r.baseline) : 'load 失败');
  check('场景 1：默认阈值单调（0 < warn ≤ fail）',
    DRIFT_WARN_PCT > 0 && DRIFT_FAIL_PCT >= DRIFT_WARN_PCT, `${DRIFT_WARN_PCT} / ${DRIFT_FAIL_PCT}`);
  check('场景 1：基线重复率在合理区间（0 < pct ≤ 100）',
    r.ok && r.baseline.totals.duplicatedLinesPct > 0 && r.baseline.totals.duplicatedLinesPct <= 100,
    r.ok ? String(r.baseline.totals.duplicatedLinesPct) : '');
}

// ---- 场景 2：fail-loud —— 判据的输入坏了必须可见（红线：无判定依据不产噪声，但也绝不静默）----
{
  const missing = tmp('missing', '{}');
  check('场景 2：totals 缺键 → fail-loud 且点名缺哪些键',
    !loadBaseline(missing).ok && /缺键或非法/.test(loadBaseline(missing).error), loadBaseline(missing).error);
  cleanup(missing);

  const noCommit = tmp('nocommit', JSON.stringify({ totals: { sources: 1, lines: 2, clones: 1, duplicatedLines: 1, duplicatedLinesPct: 1, duplicatedTokensPct: 1 }, command: 'x' }));
  check('场景 2：缺 commit 锚 → fail-loud（基线量的是哪一版无法对质）',
    !loadBaseline(noCommit).ok && /commit/.test(loadBaseline(noCommit).error), loadBaseline(noCommit).error);
  cleanup(noCommit);

  const noCmd = tmp('nocmd', JSON.stringify({ totals: { sources: 1, lines: 2, clones: 1, duplicatedLines: 1, duplicatedLinesPct: 1, duplicatedTokensPct: 1 }, commit: 'abc1234' }));
  check('场景 2：缺复现命令 → fail-loud（口径不可复现）',
    !loadBaseline(noCmd).ok && /command/.test(loadBaseline(noCmd).error), loadBaseline(noCmd).error);
  cleanup(noCmd);

  const bad = tmp('bad', '{ not json');
  check('场景 2：JSON 不可解析 → fail-loud', !loadBaseline(bad).ok && /解析失败/.test(loadBaseline(bad).error), loadBaseline(bad).error);
  cleanup(bad);

  const absent = path.join(os.tmpdir(), 'jscpd-drift-nonexistent-baseline.json');
  check('场景 2：文件不存在 → fail-loud（不是「无数据即 OK」）', !loadBaseline(absent).ok, loadBaseline(absent).error);

  const neg = tmp('neg', JSON.stringify({ totals: { sources: 1, lines: 2, clones: -1, duplicatedLines: 1, duplicatedLinesPct: 1, duplicatedTokensPct: 1 }, commit: 'a', command: 'b' }));
  check('场景 2：负数值 → fail-loud', !loadBaseline(neg).ok, loadBaseline(neg).error);
  cleanup(neg);
}

// ---- 场景 3：parseReport 跨版本字段探测 ----
{
  check('场景 3：小写字段路径命中', parseReport({ statistics: { total: { sources: 2, lines: 10, clones: 1, duplicatedLines: 3, duplicatedLinesPct: 30, duplicatedTokensPct: 20 } } })?.duplicatedLinesPct === 30);
  check('场景 3：驼峰字段路径命中（jscpd Statistics/Total/DuplicatedLinesPct）',
    parseReport({ Statistics: { Total: { Sources: 2, Lines: 10, Clones: 1, DuplicatedLines: 3, DuplicatedLinesPct: 30, DuplicatedTokensPct: 20 } } })?.duplicatedLinesPct === 30);
  check('场景 3：jscpd 5.4.1 实测字段路径命中（statistics.total.percentage / percentageTokens）',
    parseReport({ statistics: { total: { sources: 116, lines: 26228, clones: 231, duplicatedLines: 2029, percentage: 7.736, percentageTokens: 6.398 } } })?.duplicatedLinesPct === 7.736);
  check('场景 3：5.x 与早期 duplicatedLinesPct 混用时逐路径取首个有限数',
    parseReport({ statistics: { total: { duplicatedLinesPct: 7.49, percentage: 7.736 } } })?.duplicatedLinesPct === 7.736);
  check('场景 3：结构不可识别 → null（不猜、不用 0 冒充）',
    parseReport({ foo: 1 }) === null && parseReport(null) === null && parseReport({}) === null);
  const partial = parseReport({ statistics: { total: { sources: 2 } } });
  check('场景 3：部分键缺失 → 其余为 null（compareDrift 据此判 unknown）',
    partial.duplicatedLinesPct === null && partial.sources === 2, JSON.stringify(partial));
}

// ---- 场景 4：compareDrift 四态 ----
{
  check('场景 4：持平（Δ0）→ ok', compareDrift(7.49, 7.49).level === 'ok');
  check('场景 4：下降（Δ<0）→ ok 且不报抬升', compareDrift(7.49, 6.0).level === 'ok' && compareDrift(7.49, 6.0).deltaPct < 0);
  const warn = compareDrift(7.49, 8.60);
  check('场景 4：Δ+1.11pct → warn（越过 warn 阈值，未到 fail）',
    warn.level === 'warn' && Math.abs(warn.deltaPct - 1.11) < 1e-9 && warn.lines.some((l) => /抬升（>\+1pct）/.test(l)), JSON.stringify(warn));
  const high = compareDrift(7.49, 11.0);
  check('场景 4：Δ+3.51pct → high 且提示立 intent 收敛（指回 incidents 克隆分叉采集点）',
    high.level === 'high' && high.lines.some((l) => /立 intent 收敛/.test(l)) && high.lines.some((l) => /克隆分叉/.test(l)), JSON.stringify(high));
  const unknown = compareDrift(7.49, null);
  check('场景 4：实测取不到 → unknown（既不判 OK 也不判红——拿不到数据不是「没退化」的证据）',
    unknown.level === 'unknown' && unknown.deltaPct === null, JSON.stringify(unknown));
  const custom = compareDrift(10, 11, 0.5, 2.0);
  check('场景 4：自定义阈值生效（Δ+1.0 在 0.5/2.0 档下仍为 warn）', custom.level === 'warn', JSON.stringify(custom));
}

// ---- 场景 4b：实测面选 commit（这条判据错则脚本退化为「自我复读」）----
{
  check('场景 4b：默认比对 HEAD 而非基线 commit（扫基线 commit 必得 Δ=0，等于没测）',
    pickRef(false, '9e0cbc5') === 'HEAD', pickRef(false, '9e0cbc5'));
  check('场景 4b：--verify-baseline 才复扫基线 commit（口径自查，与漂移判定分离）',
    pickRef(true, '9e0cbc5') === '9e0cbc5', pickRef(true, '9e0cbc5'));
}

// ---- 场景 5：--no-run 端到端（真实基线；不出网、零 jscpd 依赖）----
{
  const r = spawnSync(process.execPath, [SCRIPT, '--no-run'], { cwd: ROOT, encoding: 'utf8' });
  check('场景 5：--no-run → exit 0 且打印基线数值', r.status === 0 && /重复 7\.49%/.test(r.stdout), `exit=${r.status}\n${r.stdout}${r.stderr}`);
  const j = spawnSync(process.execPath, [SCRIPT, '--no-run', '--json'], { cwd: ROOT, encoding: 'utf8' });
  let parsed = null;
  try { parsed = JSON.parse(j.stdout); } catch { /* 断言下方给出 */ }
  check('场景 5：--no-run --json → 机器可读且 totals 齐',
    j.status === 0 && parsed && parsed.ok === true && parsed.baseline && parsed.baseline.clones > 0, j.stdout);
  check('场景 5：--json 输出含基线 commit 锚（可对质「量的是哪一版」）',
    parsed && parsed.note && parsed.note.includes('基线 commit'), JSON.stringify(parsed));
}

// ---- 场景 6：阈值参数校验与未知参数 ----
{
  const bad = spawnSync(process.execPath, [SCRIPT, '--warn-pct', '5', '--fail-pct', '1', '--no-run'], { cwd: ROOT, encoding: 'utf8' });
  check('场景 6：warn > fail → exit 1', bad.status === 1, `exit=${bad.status}\n${bad.stderr}`);
  const nan = spawnSync(process.execPath, [SCRIPT, '--warn-pct', 'abc', '--no-run'], { cwd: ROOT, encoding: 'utf8' });
  check('场景 6：非数值阈值 → exit 1', nan.status === 1, `exit=${nan.status}\n${nan.stderr}`);
  const unknownArg = spawnSync(process.execPath, [SCRIPT, '--wat'], { cwd: ROOT, encoding: 'utf8' });
  check('场景 6：未知参数 → exit 1 且给用法', unknownArg.status === 1 && /用法/.test(unknownArg.stderr), `exit=${unknownArg.status}\n${unknownArg.stderr}`);
  const badBase = spawnSync(process.execPath, [SCRIPT, '--baseline', path.join(os.tmpdir(), 'no-such-baseline.json'), '--no-run'], { cwd: ROOT, encoding: 'utf8' });
  check('场景 6：基线坏 → exit 1 且报错（不静默跳过）', badBase.status === 1 && /基线/.test(badBase.stderr), `exit=${badBase.status}\n${badBase.stderr}`);
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('\n用法：node src/jscpd-drift.test.mjs'); process.exit(1); }
process.exit(0);
