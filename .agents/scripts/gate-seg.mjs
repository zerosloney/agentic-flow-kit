// gate-seg.mjs — 门禁 ROI 段插桩共用件（2026-10-08 gate-roi-metrics）
// 为什么独立成件：check-loop.mjs 与 check-hygiene.mjs **互相不能反向 import**（前者已 import 后者，
// 后者再 import 前者即循环依赖）——而两者都要插桩。判据单源必须只有一处，故抽本件。
//
// 机制：每次 gateSeg() 调用先**结算上一段**（段内 warnings/blockers 增量条数 + 耗时），再记本段起点。
// 统计完全由数组长度差推出——**不改任何 warnings.push / blockers.push 调用点**，判定逻辑与文案零改动。
// 默认路径（无 --gate-stats）下 segs 只在内存里攒、不打印不写盘 → 输出契约逐字节不变（硬约束：
// pre-push / pre-commit 消费者 + doctor 的 WARN 行计数 + check-loop.test.mjs 223 断言全依赖它）。
//
// 耗时口径**刻意包含子进程时间**（检查 11 调两个生成器 --check、检查 13 调 sh rule-budget.sh）——
// 门禁真实成本本就要含子进程；不做剔除，但看板与 spec 均显式声明该口径防误读。
export function gateSeg(collector, id, label) {
  const now = Date.now();
  const prev = collector.current;
  if (prev) {
    collector.segs.push({
      id: prev.id,
      label: prev.label,
      warns: collector.warnings.length - prev.w,
      blocks: collector.blockers.length - prev.b,
      ms: now - prev.t,
    });
  }
  collector.current = { id, label, w: collector.warnings.length, b: collector.blockers.length, t: now };
}

// finishSegs：结算末段（末段之后没有下一次 gateSeg 调用，须显式收口，否则最后一段不进账）
export function finishSegs(collector) {
  if (!collector.current) return collector.segs; // 已结算过（幂等——writeGateStats 与输出段各调一次不会重复入账）
  gateSeg(collector, '__end__', '__end__'); // 本次调用结算上一段；记下的 current 置空防重复结算
  collector.current = null;
  return collector.segs;
}

// makeCollector：建收集器（引用同一对数组，不复制数据）
export function makeCollector(warnings, blockers) {
  return { warnings, blockers, segs: [], current: null };
}

// appendSegs：并入「在别处结算出的段」，供模块化门禁使用（2026-10-08 gate-roi-metrics 修复）。
//   背景：check-hygiene.mjs 产出的是**局部** warnings 数组（由 check-loop 事后 spread 进全局），
//   故它的增量在模块执行期间**不反映**到 check-loop 的数组上。若直接共用游标插桩，后果是确定的错账：
//   本模块 5 段恒记 0 条命中，而它的全部增量会被误记到模块之后的第一个段（检查 3）头上——
//   实测已抓到：某次 hygiene 产出 1 条警告被记成「检查 13 命中」。
//   语义：先结算本收集器当前段（模块前的检查，如检查 1）→ 按序并入外来段 → 游标清空，
//   下一个 gateSeg 从零起算，Δ 天然正确。
//   空 segs 直接返回且**不结算**当前段：没有东西可并入时不该改变原有结算时序。
export function appendSegs(collector, segs) {
  if (!segs || !segs.length) return collector.segs;
  finishSegs(collector);
  collector.segs.push(...segs);
  collector.current = null;
  return collector.segs;
}