// check-stage-index.test.mjs — 检查 7 模块直测（2026-10-09 engine-quality-round2 A1）
// 四面：全绿 / AGENTS 侧缺索引 / new-task 文件缺失合法 / gate-seg 段归属（局部收集器并入）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCheckStageIndex } from './check-stage-index.mjs';
import { makeCollector, finishSegs } from './gate-seg.mjs';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
};

// ctx 构造：linesOf 提供读异常→null 语义（与 check-loop 内部实现同语义；「判定零复刻」指模块不重写
// 判据，测试 fixture 提供测试版 helper 是 check-hygiene.test 先例）
function makeCtx(root, overrides = {}) {
  const fileLinesCache = new Map();
  const linesOf = (file) => {
    if (!fileLinesCache.has(file)) {
      let lines = null;
      try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { lines = null; }
      fileLinesCache.set(file, lines);
    }
    return fileLinesCache.get(file);
  };
  return { root, linesOf, ...overrides };
}
const ROUTES = '.agents/commands/plan.md → .agents/commands/design.md → .agents/commands/build.md → .agents/commands/test.md → .agents/commands/deploy.md → .agents/commands/maintain.md';
const mkRoot = (agentsBody, newTaskBody, { noAgents, noNewTask } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csi-'));
  fs.mkdirSync(path.join(root, '.agents', 'commands'), { recursive: true });
  if (!noAgents) fs.writeFileSync(path.join(root, 'AGENTS.md'), agentsBody);
  if (!noNewTask) fs.writeFileSync(path.join(root, '.agents', 'commands', 'new-task.md'), newTaskBody);
  return root;
};
const FULL = `# AGENTS\n\n${ROUTES}\n\n**横切**：.agents/commands/review.md\n`;
const FULL_NT = `# new-task\n\n| Plan | ${ROUTES} | Review(.agents/commands/review.md) |\n`;

{
  // ① 双面全索引 → 零告警
  const root = mkRoot(FULL, FULL_NT);
  const r = runCheckStageIndex(makeCtx(root));
  check('① 双面全索引 → 零告警', r.length === 0, JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // ② AGENTS 侧缺 plan → 仅 AGENTS.md 侧告警（new-task 索引齐全不误报）
  const root = mkRoot(FULL.replace('.agents/commands/plan.md → ', ''), FULL_NT);
  const r = runCheckStageIndex(makeCtx(root));
  check('② AGENTS 侧缺 plan → WARN 点名 AGENTS.md',
    r.some((w) => w.includes('AGENTS.md 缺 plan 指令索引')), JSON.stringify(r));
  check('② new-task 侧不告警（其索引齐全）', !r.some((w) => w.includes('new-task.md 缺')), JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // ③ new-task 文件不存在 = 合法缺失态（existsSync 守卫）→ 零告警
  const root = mkRoot(FULL, FULL_NT, { noNewTask: true });
  const r = runCheckStageIndex(makeCtx(root));
  check('③ new-task 文件缺失 → 合法缺失零告警', r.length === 0, JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // ④ gate-seg 段归属：ctx.gateStats 在场时段 '6' 入账、warns 与实际 WARN 数一致（selfmeasure 接线
  //   教训：模块须用局部收集器 + appendSegs，直接共用全局游标会错账）
  const root = mkRoot(FULL.replace('.agents/commands/plan.md → ', ''), FULL_NT);
  const stats = makeCollector([], []);
  const r = runCheckStageIndex(makeCtx(root, { gateStats: stats }));
  const seg6 = finishSegs(stats).filter((s) => s.id === '6');
  check('④ gate-seg：段 6 入账一次且 warns 与实际 WARN 数一致',
    seg6.length === 1 && seg6[0].warns === r.length && r.length === 1,
    JSON.stringify({ seg6, ret: r }));
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
