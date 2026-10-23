#!/usr/bin/env node
// papercut-debt-sensor.test.mjs — 存量债传感器 fixture（B10a 随件测试；上游无直测，
//   kit 侧按「新增引擎脚本默认必须带同名 .test.mjs」立——判定面与传感器单源，防再同步漂移）
// 覆盖：三态计数（未升级 / ✅ 已消债 / ⏸ 暂缓无理由仍计债）/ ⏸带理由消债 / [env] 前缀单列 envPending
//   不入债池 / 命中次数抽取 / stale 只标不排 / 分片合并读（主台账 ∪ papercuts.d）/ CRLF 容忍 /
//   管道符并回症状列 / CLI 退出码恒 0（含台账缺失）与 --json 形状
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan, envPending, DEFER_REASONED_RE } from './papercut-debt-sensor.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(SCRIPT_DIR, 'papercut-debt-sensor.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${desc}`); }
  else { fail++; console.log(`FAIL ${desc}${detail ? '\n  ' + detail : ''}`); }
};
const mkroot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papercut-sensor-'));
  fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
  return root;
};
const HEADER = '| 日期 | 位置 | 症状 | 拟修 |\n|------|------|------|------|\n';
const writeLedger = (root, text) => fs.writeFileSync(path.join(root, 'workflow', 'papercuts.md'), text, 'utf8');

// ---- S1 三态计数：未升级 / ✅ 已消债 / ⏸ 暂缓无理由仍计债；⏸带理由消债 ----
{
  const root = mkroot();
  writeLedger(root, HEADER
    + '| 2026-10-01 | `.agents/commands/build.md` | 症状甲 | 拟修甲 |\n'
    + '| 2026-10-02 | `.agents/commands/test.md` | 症状乙 | 拟修乙 ✅ 已升级修复(2026-10-03): 已改 |\n'
    + '| 2026-10-03 | `.agents/scripts/x.mjs` | 症状丙 | 拟修丙 ⏸ 暂缓无理由 |\n'
    + '| 2026-10-04 | `.agents/scripts/y.mjs` | 症状丁 | 拟修丁 ⏸ 暂缓（2026-10-05）：前提已消失，判失效 |\n');
  const rows = scan(root);
  check('S1a 数据行 4 条全入池（env 无）', rows.length === 4, `len=${rows.length}`);
  check('S1b 未升级计债', rows.filter((r) => !r.settled).length === 2, JSON.stringify(rows.map((r) => r.settled)));
  check('S1c ✅ 判已消债', rows[1].resolved === true && rows[1].settled === true);
  check('S1d ⏸ 无理由仍计债（deferred 但不 settled）', rows[2].deferred === true && rows[2].deferredReasoned === false && rows[2].settled === false);
  check('S1e ⏸带理由判消债', rows[3].deferredReasoned === true && rows[3].settled === true);
  check('S1f DEFER_REASONED_RE 形态：全角括号+全角冒号+非空理由', DEFER_REASONED_RE.test('⏸ 暂缓（2026-10-05）：理由 X') && !DEFER_REASONED_RE.test('⏸ 暂缓无理由'));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S2 [env] 前缀：不进债池、单列 envPending（仅未 settled）----
{
  const root = mkroot();
  writeLedger(root, HEADER
    + '| 2026-10-01 | `[env] 无外网装不上依赖` | 症状戊 | 拟修戊 |\n'
    + '| 2026-10-02 | `[env] 本机时区漂移` | 症状己 | 拟修己 ⏸ 暂缓（2026-10-03）：前提已消失 |\n'
    + '| 2026-10-03 | `.agents/scripts/z.mjs` | 症状庚 | 拟修庚 |\n');
  const rows = scan(root);
  const env = envPending(root);
  check('S2a [env] 行不进债池', rows.length === 1 && rows[0].symptom === '症状庚', JSON.stringify(rows.map((r) => r.symptom)));
  check('S2b envPending 只列未 settled 的 env 行', env.length === 1 && env[0].symptom === '症状戊', JSON.stringify(env.map((r) => r.symptom)));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S3 命中次数抽取（症状/拟修文本「第 N 次命中」，取最大）----
{
  const root = mkroot();
  writeLedger(root, HEADER
    + '| 2026-10-01 | `.agents/commands/build.md` | 第 2 次命中：症状辛 | 拟修辛 |\n'
    + '| 2026-10-02 | `.agents/commands/build.md` | 症状壬 | 拟修壬（第 3 次命中） |\n');
  const rows = scan(root);
  check('S3a 第 2 次命中抽出', rows[0].hits === 2, `hits=${rows[0].hits}`);
  check('S3b 多处命中取最大且默认 1', rows[1].hits === 3, `hits=${rows[1].hits}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S4 stale 只标不排：位置列路径不存在 → stale true；存在 → false ----
{
  const root = mkroot();
  fs.mkdirSync(path.join(root, '.agents', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'scripts', 'real.mjs'), '// x\n', 'utf8');
  writeLedger(root, HEADER
    + '| 2026-10-01 | `.agents/scripts/real.mjs` | 症状子 | 拟修子 |\n'
    + '| 2026-10-02 | `.agents/scripts/gone.mjs` | 症状丑 | 拟修丑 |\n');
  const rows = scan(root);
  check('S4a 路径存在 → stale false', rows[0].stale === false);
  check('S4b 路径不存在 → stale true（仍留在 unresolved）', rows[1].stale === true && rows.length === 2);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S5 分片合并读：主台账 ∪ papercuts.d/*.md（B8 ledger-shards 读侧单源）----
{
  const root = mkroot();
  fs.mkdirSync(path.join(root, 'workflow', 'papercuts.d'), { recursive: true });
  writeLedger(root, '# 命令/技能 Papercut 留痕\n\n' + HEADER
    + '| 2026-10-01 | `.agents/commands/build.md` | 主表症状 | 主表拟修 |\n');
  fs.writeFileSync(path.join(root, 'workflow', 'papercuts.d', '2026-09.md'),
    HEADER + '| 2026-09-01 | `.agents/commands/test.md` | 分片症状 | 分片拟修 |\n', 'utf8');
  const rows = scan(root);
  check('S5a 分片行并入扫描面', rows.length === 2, JSON.stringify(rows.map((r) => r.symptom)));
  check('S5b 分片行判定照常（未升级计债）', rows.filter((r) => !r.settled).length === 2);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S6 CRLF 容忍 + 管道符并回症状列 ----
{
  const root = mkroot();
  writeLedger(root, HEADER.replace(/\n/g, '\r\n')
    + '| 2026-10-01 | `.agents/scripts/w.mjs` | 症状含管道 `a|b` 续 | 拟修寅 |\r\n');
  const rows = scan(root);
  check('S6a CRLF 台账照常解析', rows.length === 1, JSON.stringify(rows));
  // 源仓口径钉死：并回分支只 trim 症状列（中间段），拟修列（尾部段）不 trim——逐字保留
  check('S6b 单元格内管道符并回症状列（拟修列含原文即可）', rows[0].symptom.includes('a|b') && rows[0].proposedFix.includes('拟修寅'),
    JSON.stringify({ symptom: rows[0].symptom, proposedFix: rows[0].proposedFix }));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S7 CLI：退出码恒 0（正常 / 台账缺失），--json 形状 ----
{
  const root = mkroot();
  writeLedger(root, HEADER + '| 2026-10-01 | `.agents/commands/build.md` | 症状卯 | 拟修卯 |\n');
  const r1 = spawnSync(process.execPath, [CLI, '--json', '--root', root], { encoding: 'utf8' });
  const j1 = JSON.parse(r1.stdout || '{}');
  check('S7a 正常：exit 0 + debt 计数', r1.status === 0 && j1.debt === 1 && j1.total === 1 && j1.resolved === 0,
    JSON.stringify({ status: r1.status, debt: j1.debt }));
  check('S7b --json unresolved 带行号与命中数', j1.unresolved?.[0]?.line >= 1 && j1.unresolved?.[0]?.hits === 1, JSON.stringify(j1.unresolved));
  const r2 = spawnSync(process.execPath, [CLI, '--root', root], { encoding: 'utf8' });
  check('S7c 人读摘要 exit 0 且含 debt 行', r2.status === 0 && /未消债 1/.test(r2.stdout), String(r2.stdout).slice(0, 200));

  const empty = mkroot();
  const r3 = spawnSync(process.execPath, [CLI, '--json', '--root', empty], { encoding: 'utf8' });
  const j3 = JSON.parse(r3.stdout || '{}');
  check('S7d 台账缺失：exit 恒 0 + [ERROR] + debt null（测量失败不阻断回路）',
    r3.status === 0 && j3.debt === null && /\[ERROR\] papercut-debt-sensor/.test(r3.stderr),
    JSON.stringify({ status: r3.status, stderr: String(r3.stderr).slice(0, 120) }));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
}

// ---- S8 kit 适配钉子：读侧必须走 ledger-shards（分片消费）——防再同步回退成裸读主台账 ----
{
  const src = fs.readFileSync(CLI, 'utf8');
  check('S8a 传感器经 readLedgerText 读台账（分片感知）', /readLedgerText\(root,\s*'papercuts'\)/.test(src));
  check('S8b 零子进程约束：不 import child_process', !/child_process/.test(src));
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
