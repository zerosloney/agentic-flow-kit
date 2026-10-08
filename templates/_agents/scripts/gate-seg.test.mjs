// gate-seg.test.mjs — 门禁 ROI 段插桩共用件测试（2026-10-08 gate-roi-metrics）
// 被测：gateSeg 结算语义 / finishSegs 幂等 / makeCollector 引用同一对数组。
// 判据单源所在：check-loop.mjs 与 check-hygiene.mjs 都靠本件插桩，故它的正确性是全部门禁成本度量的地基——
// 段归属算错则整张 ROI 表失真而无人察觉。端到端回归网仍是 check-loop.test.mjs（223 断言）。
// 用法：node templates/_agents/scripts/gate-seg.test.mjs
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const { gateSeg, finishSegs, makeCollector, appendSegs } =
  await import(pathToFileURL(path.join(SCRIPT_DIR, 'gate-seg.mjs')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
};

// ---- makeCollector：引用同一对数组（不复制）----
{
  const w = [], b = [];
  const c = makeCollector(w, b);
  check('makeCollector：引用同一对数组（push 即被看见，无复制）', c.warnings === w && c.blockers === b);
  check('makeCollector：初始 segs 为空、current 为空', Array.isArray(c.segs) && c.segs.length === 0 && c.current === null);
}

// ---- gateSeg：每次调用结算上一段，首调不结算 ----
{
  const w = [], b = [];
  const c = makeCollector(w, b);
  gateSeg(c, '1', '检查一');
  check('gateSeg：首次调用只记起点不结算（segs 仍空）', c.segs.length === 0 && c.current.id === '1');
  w.push('a'); b.push('b'); b.push('c');          // 段一产出 1 warn + 2 blocks
  gateSeg(c, '2', '检查二');
  check('gateSeg：第二次调用结算上一段（warns=1 blocks=2，id/label 对）',
    c.segs.length === 1 && c.segs[0].id === '1' && c.segs[0].label === '检查一'
    && c.segs[0].warns === 1 && c.segs[0].blocks === 2, JSON.stringify(c.segs));
  check('gateSeg：结算后 current 切到新段', c.current.id === '2');
  // 零命中段也要入账（死检查识别依赖「声明了但从未命中」——漏记即误判为未声明）
  gateSeg(c, '3', '检查三');
  check('gateSeg：零命中段照样入账（warns=0 blocks=0）',
    c.segs.length === 2 && c.segs[1].id === '2' && c.segs[1].warns === 0 && c.segs[1].blocks === 0, JSON.stringify(c.segs));
}

// ---- finishSegs：结算末段 + 幂等（writeGateStats 与输出段各调一次不得重复入账）----
{
  const w = [], b = [];
  const c = makeCollector(w, b);
  gateSeg(c, '1', '检查一');
  w.push('x');
  const segs1 = finishSegs(c);
  check('finishSegs：结算末段（末段后无下次调用否则该段丢失）',
    segs1.length === 1 && segs1[0].id === '1' && segs1[0].warns === 1, JSON.stringify(segs1));
  const segs2 = finishSegs(c);
  check('finishSegs：幂等——二次调用不重复入账（防 __end__ 伪段污染表）',
    segs2.length === 1 && !segs2.some((s) => s.id === '__end__'), JSON.stringify(segs2));
  check('finishSegs：结算后 current 置空', c.current === null);
}

// ---- ms 单调不减（耗时度量地基）----
{
  const c = makeCollector([], []);
  gateSeg(c, '1', 'a');
  const t = Date.now(); while (Date.now() - t < 5) { /* 占位：保证有可测间隔 */ }
  gateSeg(c, '2', 'b');
  check('耗时字段：ms 为非负整数且单调（门禁成本度量的地基）',
    Number.isInteger(c.segs[0].ms) && c.segs[0].ms >= 0, JSON.stringify(c.segs[0]));
}

// ---- appendSegs：模块化门禁的段归属（本次实抓到错账的根因，钉死）----
// 症状：check-hygiene.mjs 的增量不反映到 check-loop 的数组上，直接共用游标会让 hygiene 各段恒记 0，
//       而它的全部增量被误记到模块之后的第一段（检查 3）。下面是该场景的最小复现与修复后行为。
{
  const globalW = [], globalB = [];
  const g = makeCollector(globalW, globalB);
  gateSeg(g, '1', '检查1');            // 模块前的一段
  globalW.push('w-check1');            // 检查 1 产出 1 条

  // 模块（局部数组）：检查 2 → 检查 11 各产出 1 条
  const localW = [];
  const l = makeCollector(localW, []);
  gateSeg(l, '2', '检查2');
  localW.push('w-check2');
  gateSeg(l, '11', '检查11');
  localW.push('w-check11');

  appendSegs(g, finishSegs(l));
  const order = g.segs.map((s) => s.id);
  const byId = new Map(g.segs.map((s) => [s.id, s.warns]));
  check('appendSegs：模块后的一段先结算（检查 1 不被外来段吞掉）',
    order[0] === '1' && byId.get('1') === 1, JSON.stringify(g.segs));
  check('appendSegs：外来段按序并入且各自归属正确（2 → 1 条、11 → 1 条，**不都记到后一段**）',
    order.slice(1).join(',') === '2,11' && byId.get('2') === 1 && byId.get('11') === 1, JSON.stringify(g.segs));
  check('appendSegs：并入后游标清空，下一段从零起算（不把外来增量算进模块之后的段）',
    g.current === null, JSON.stringify(g.current));
  gateSeg(g, '3', '检查3');
  globalW.push(...['w-check3a', 'w-check3b']);
  gateSeg(g, '4', '检查4');
  check('appendSegs：模块之后的第一段只记自己的增量（检查 3 = 2 条，不含 hygiene 的 2 条）',
    g.segs.find((s) => s.id === '3').warns === 2, JSON.stringify(g.segs));

  // 空外来段：既不并入也不提前结算（不改变原有结算时序）
  const w2 = [], b2 = [];
  const g2 = makeCollector(w2, b2);
  gateSeg(g2, '1', 'a');
  appendSegs(g2, []);
  check('appendSegs：空外来段 → 收集器原样不动（不结算、不并入，结算时序不变）',
    g2.segs.length === 0 && g2.current !== null, JSON.stringify(g2));
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);