// check-stage-index.mjs — check-loop 检查 7 模块（阶段索引同步，2026-10-09 engine-quality-round2 A1）
// 拆分先例 = check-hygiene.mjs（检查 2/9/11/12/13）/ check-metric-claims.mjs（检查 16）：
//   ctx 传入既有 helper（linesOf——读异常响亮出账 + 按空文档降级的语义承载者，零复刻），
//   模块只返回 warnings 数组，不打印、不 exit、不改 ctx。
// 输出顺序契约：调用点位置即 warnings 插入序（check-loop 原位调用，段 id 沿 sh 版 '6'——清单编号 7
//   不动，gate-checklist 按 id 消费面不受影响）。
// 判据（沿 sh 版逐条）：AGENTS.md 与 .agents/commands/new-task.md 须各含全部阶段指令路径串
//   `.agents/commands/<cmd>.md`（双向索引）；缺任一 = WARN。两文件可合法缺失（text 判空预期缺失态）。
// 测试：node templates/_agents/scripts/check-stage-index.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { gateSeg, finishSegs, makeCollector, appendSegs } from './gate-seg.mjs';

const STAGE_CMDS = ['plan', 'design', 'build', 'test', 'deploy', 'maintain', 'review'];
const FACE_DOCS = ['AGENTS.md', '.agents/commands/new-task.md'];

export function runCheckStageIndex(ctx) {
  const { root: ROOT, linesOf } = ctx;
  const warnings = [];
  // 插桩（selfmeasure 先例）：局部收集器 + appendSegs 并入全局——模块产出局部数组，直接共用全局
  // 游标会错账（check-hygiene.mjs:36-39 实测教训）
  const localStats = makeCollector(warnings, []);
  const markGate = (id, label) => { if (ctx.gateStats) gateSeg(localStats, id, label); };

  markGate('6', '阶段索引同步');
  for (const cmd of STAGE_CMDS) {
    for (const doc of FACE_DOCS) {
      // existsSync 守卫（2026-10-06-check19-entry-enoent 同类）：两文件可合法缺失（下方 text 判空本就
      // 预期缺失态），fail-loud fs 读下按空跳过、不再响亮出账
      const docPath = path.join(ROOT, doc);
      const text = fs.existsSync(docPath) ? linesOf(docPath) : null;
      if (text && !text.some((l) => l.includes(`.agents/commands/${cmd}.md`))) {
        warnings.push(`- [WARN 阶段索引漂移] ${doc} 缺 ${cmd} 指令索引(两处阶段表须同步维护)`);
      }
    }
  }

  if (ctx.gateStats) appendSegs(ctx.gateStats, finishSegs(localStats));
  return warnings;
}
