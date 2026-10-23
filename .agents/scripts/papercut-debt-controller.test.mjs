#!/usr/bin/env node
// papercut-debt-controller.test.mjs — 回路控制器 fixture（B10a 随件测试；上游无直测，
//   kit 侧按「新增引擎脚本默认必须带同名 .test.mjs」立——排序键与 scope gate 防再同步漂移）
// 覆盖：排序键三序（命中次数降序 > 日期降序 > 原行序升序）/ scope gate（源码/数据库面拦下照列）/
//   stale 与「同上」承接行转待人工定性 / debt=0 达成态 / 全员被拦警示态 / 口径单源（不复制判定正则）/
//   CLI 退出码（0 正常含无目标；2 测量不可用）与 --json 形状
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(SCRIPT_DIR, 'papercut-debt-controller.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${desc}`); }
  else { fail++; console.log(`FAIL ${desc}${detail ? '\n  ' + detail : ''}`); }
};
const mkroot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papercut-ctrl-'));
  // 位置列引用的文档面文件须真实存在——否则传感器 stale 判定（位置列路径全不存在）会把
  // 条目转 needsHuman，排序键 / scope gate 场景测不到目标选取
  for (const p of ['.agents/commands', '.agents/scripts']) {
    fs.mkdirSync(path.join(root, ...p.split('/')), { recursive: true });
  }
  fs.writeFileSync(path.join(root, '.agents', 'commands', 'a.md'), '# a\n', 'utf8');
  fs.writeFileSync(path.join(root, '.agents', 'commands', 'b.md'), '# b\n', 'utf8');
  fs.writeFileSync(path.join(root, '.agents', 'commands', 'c.md'), '# c\n', 'utf8');
  fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
  return root;
};
const HEADER = '| 日期 | 位置 | 症状 | 拟修 |\n|------|------|------|------|\n';
const writeLedger = (root, text) => fs.writeFileSync(path.join(root, 'workflow', 'papercuts.md'), text, 'utf8');
const run = (root, ...extra) => spawnSync(process.execPath, [CLI, '--root', root, ...extra], { encoding: 'utf8' });

// ---- S1 排序键：命中次数降序 > 日期降序 > 原行序升序 ----
{
  const root = mkroot();
  writeLedger(root, HEADER
    + '| 2026-10-01 | `.agents/commands/a.md` | 症状早 | 拟修早 |\n'                       // 行序 1，日期早，hits=1
    + '| 2026-10-05 | `.agents/commands/b.md` | 症状新 | 拟修新 |\n'                       // 行序 2，日期新，hits=1 → 日期降序胜
    + '| 2026-10-03 | `.agents/commands/c.md` | 第 2 次命中：症状复发 | 拟修复发 |\n');    // hits=2 → 恒胜
  const r = run(root, '--json');
  const j = JSON.parse(r.stdout || '{}');
  check('S1a exit 0', r.status === 0, `status=${r.status} stderr=${String(r.stderr).slice(0, 120)}`);
  check('S1b 主排序键 = 命中次数降序', j.target?.location === '`.agents/commands/c.md`', JSON.stringify(j.target?.location));
  check('S1c 平手时日期降序（近期优先）', j.queue?.[1]?.location === '`.agents/commands/b.md`', JSON.stringify(j.queue?.map((q) => q.location)));
  check('S1d 再平手原行序升序', j.queue?.[2]?.location === '`.agents/commands/a.md`');
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S2 scope gate：拟修触及源码/数据库面 → 拦下照列（不选为目标）----
{
  const root = mkroot();
  writeLedger(root, HEADER
    + '| 2026-10-01 | `.agents/commands/a.md` | 文档面症状 | 补一段说明 |\n'
    + '| 2026-10-02 | `backend/api/x.py` | 源码面症状 | 修校验逻辑 |\n'
    + '| 2026-10-03 | `tests/` | 测试面症状 | 补用例（涉及 DDL） |\n');
  const r = run(root, '--json');
  const j = JSON.parse(r.stdout || '{}');
  check('S2a exit 0（含全部被拦态）', r.status === 0);
  check('S2b scope gate 拦下 2 条（backend/ + tests/DDL）', j.skippedOutOfScope?.length === 2, JSON.stringify(j.skippedOutOfScope?.map((s) => s.location)));
  check('S2c 在选目标只含文档面条目', j.target?.location === '`.agents/commands/a.md`', JSON.stringify(j.target?.location));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S3 stale 与「同上」承接行 → needsHuman（不作为自动目标）----
{
  const root = mkroot();
  writeLedger(root, HEADER
    + '| 2026-10-01 | `.agents/commands/a.md` | 文档面症状甲 | 拟修甲 |\n'
    + '| 2026-10-02 | `.agents/scripts/gone.mjs` | 路径已不存在 | 定性失效 |\n'
    + '| 2026-10-03 | 同上两处 | 承接上行 | 定性重定位 |\n');
  const r = run(root, '--json');
  const j = JSON.parse(r.stdout || '{}');
  check('S3a stale 与「同上」行转待人工', j.needsHuman?.length === 2, JSON.stringify(j.needsHuman?.map((h) => h.location)));
  check('S3b 待人工条目不进 queue', !j.queue?.some((q) => q.location === '.agents/scripts/gone.mjs' || q.location === '同上两处'));
  check('S3c 文档面条目照常在选', j.target?.location === '`.agents/commands/a.md`');
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S4 debt = 0：achieved 态（本轮无目标）----
{
  const root = mkroot();
  writeLedger(root, HEADER
    + '| 2026-10-01 | `.agents/commands/a.md` | 症状 | 拟修 ✅ 已升级修复(2026-10-02): 已改 |\n');
  const r = run(root, '--json');
  const j = JSON.parse(r.stdout || '{}');
  check('S4a debt=0 → achieved true 且无目标', r.status === 0 && j.achieved === true && j.target === null && j.debt === 0,
    JSON.stringify({ debt: j.debt, achieved: j.achieved }));
  const r2 = run(root);
  check('S4b 人读口径出「设定点已达成」', /设定点已达成/.test(r2.stdout));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S5 全员被 scope gate 拦 → 警示态、exit 0 ----
{
  const root = mkroot();
  writeLedger(root, HEADER + '| 2026-10-01 | `backend/api/x.py` | 源码面症状 | 修校验逻辑 |\n');
  const r = run(root);
  check('S5a 全员被拦：exit 0 + 需人工授权警示', r.status === 0 && /scope gate 拦下/.test(r.stdout) && /需人工决定是否单独授权/.test(r.stdout),
    JSON.stringify({ status: r.status, stdout: String(r.stdout).slice(0, 200) }));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S6 测量不可用：exit 2（debt 未知）----
{
  const root = mkroot();
  const r = run(root, '--json');
  const j = JSON.parse(r.stdout || '{}');
  check('S6a 台账缺失 → exit 2 + error JSON', r.status === 2 && j.target === null && typeof j.error === 'string',
    JSON.stringify({ status: r.status, error: j.error }));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S7 kit 适配钉子：口径单源（控制器不复制传感器判定正则）----
{
  const src = fs.readFileSync(CLI, 'utf8');
  check('S7a 控制器 import 传感器 scan（不复制判定面）', /import\s*\{\s*scan as sensorScan\s*\}\s*from\s*'\.\/papercut-debt-sensor\.mjs'/.test(src));
  check('S7b 控制器不复制 ✅/⏸ 判定正则', !/'✅'|"✅"/.test(src.replace(/^\/\/.*$/gm, '')));
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
