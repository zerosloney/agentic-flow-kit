// agg-gate-stats.mjs — 门禁 ROI 聚合（2026-10-08 gate-roi-metrics）
// 读 .agents/cache/gate-stats.jsonl（check-loop --gate-stats 落的运行时数据）→ 按检查 ID 聚合
//   运行次数 / 命中次数 / 拦截数 / 警告数 / 平均耗时 → 输出表 + 两类决策依据：
//   ① 噪声率 top N（警告数 ÷ 命中次数，降序）——该收窄或该修的候选；
//   ② 死检查（声明了但从未命中）——该拆或该降级的候选。
//
// **为什么需要它**（本件存在的理由）：本仓门禁 16→20 项期间，2026-10 一次通过率 61%→56%——
// 门禁数与质量指标负相关，但此前无任何数据能回答「该加门还是该拆门」（metrics/DASHBOARD 全部指标
// 100% 指向产出物、0 条指向门禁自身）。加门是焦虑驱动的唯一理性反应，因为拆门没有依据。
//
// 耗时口径**含子进程时间**（检查 11 调两个生成器 --check、检查 13 调 sh rule-budget.sh）——
// 门禁真实成本本就要含子进程，不做剔除；输出中显式标注防误读为「纯计算耗时」。
// 坏行容忍跳过（与 confirmations.jsonl / delegations 台账同容错口径）。
// 用法：node .agents/scripts/agg-gate-stats.mjs [--days 30]
// 测试：node templates/_agents/scripts/agg-gate-stats.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CHECK_LOOP_ROOT || path.resolve(SCRIPT_DIR, '..', '..');
const STATS_FILE = path.join(ROOT, '.agents', 'cache', 'gate-stats.jsonl');

// readRows：读 jsonl，坏行跳过不抛
export function readRows(file = STATS_FILE) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && Array.isArray(e.segs)) out.push(e);
    } catch { /* 坏行跳过 */ }
  }
  return out;
}

// aggregate：按 id 聚合（pure，供测试直测）。days = 统计窗口（天），null = 全量。
//   runs  = 该段被记录到的运行次数；hits = 至少命中一次（warns+blocks>0）的运行次数；
//   warns / blocks = 累计条数；msSum / avgMs = 累计与平均耗时。
export function aggregate(rows, now = Date.now(), days = null) {
  const cutoff = days ? now - days * 86400000 : null;
  const by = new Map();
  let runs = 0;
  for (const r of rows) {
    if (cutoff) {
      const t = Date.parse(r.ts || '');
      if (!Number.isFinite(t) || t < cutoff) continue;
    }
    runs++;
    for (const s of r.segs || []) {
      if (!s || !s.id) continue;
      if (!by.has(s.id)) by.set(s.id, { id: s.id, label: s.label || '', runs: 0, hits: 0, warns: 0, blocks: 0, msSum: 0 });
      const a = by.get(s.id);
      a.runs++;
      a.label = s.label || a.label;
      a.warns += Number(s.warns) || 0;
      a.blocks += Number(s.blocks) || 0;
      a.msSum += Number(s.ms) || 0;
      if ((Number(s.warns) || 0) + (Number(s.blocks) || 0) > 0) a.hits++;
    }
  }
  const list = [...by.values()].map((a) => ({
    ...a,
    avgMs: a.runs ? Math.round(a.msSum / a.runs) : 0,
    noiseRate: a.hits ? a.warns / a.hits : 0, // 每次命中的平均警告条数（0 = 从不产噪声）
  }));
  list.sort((x, y) => y.msSum - x.msSum); // 默认按累计耗时降序——成本视角优先
  const noiseTop = [...list].filter((a) => a.warns > 0).sort((x, y) => y.noiseRate - x.noiseRate);
  const dead = list.filter((a) => a.hits === 0);
  const costTotal = list.reduce((a, s) => a + s.msSum, 0);
  return { runs, list, noiseTop, dead, costTotal };
}

function fmtMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function main() {
  const i = process.argv.indexOf('--days');
  const days = i >= 0 ? Number(process.argv[i + 1]) : 30;
  const rows = readRows();
  const { runs, list, noiseTop, dead, costTotal } = aggregate(rows, Date.now(), Number.isFinite(days) ? days : null);

  if (!runs || !list.length) {
    console.log('门禁 ROI：未采集——跑 `node .agents/scripts/check-loop.mjs --gate-stats` 后重试');
    console.log('（数据落 .agents/cache/gate-stats.jsonl，该目录已 gitignore；首次采集后本表才有内容）');
    return;
  }

  console.log(`# 门禁 ROI 聚合（窗口 ${days} 天 / 有效样本 ${runs} 次运行）\n`);
  console.log('耗时口径**含子进程时间**（检查 11 调生成器 --check、检查 13 调 sh rule-budget.sh）——门禁真实成本，不做剔除。\n');
  console.log('| 检查 | 名称 | 命中/运行 | 拦截 | 警告 | 累计耗时 | 均耗时 | 每次命中警告数 |');
  console.log('|------|------|-----------|------|------|----------|--------|----------------|');
  for (const a of list) {
    console.log(`| ${a.id} | ${a.label} | ${a.hits}/${a.runs} | ${a.blocks} | ${a.warns} | ${fmtMs(a.msSum)} | ${fmtMs(a.avgMs)} | ${a.noiseRate.toFixed(1)} |`);
  }
  console.log(`\n累计门禁耗时 ${fmtMs(costTotal)}（${runs} 次运行，均 ${fmtMs(Math.round(costTotal / runs))}/次）`);

  console.log(`\n## ① 噪声率 top（警告数 ÷ 命中次数）——收窄或修的候选`);
  if (noiseTop.length) for (const a of noiseTop) console.log(`  检查 ${a.id} ${a.label}：${a.noiseRate.toFixed(1)} 条/次命中（累计 ${a.warns} 条警告）`);
  else console.log('  （无段产出过警告）');

  console.log(`\n## ② 死检查（声明了但从未命中）——拆或降级的候选`);
  if (dead.length) for (const a of dead) console.log(`  检查 ${a.id} ${a.label}：${a.runs} 次运行零命中，累计耗时 ${fmtMs(a.msSum)}`);
  else console.log('  （每段都至少命中过一次）');

  if (runs < 5) console.log(`\n⚠️ 样本仅 ${runs} 次运行——**结论待样本积累**（建议 ≥30 次 / ≥30 天后再据此改判据；此刻只作线索不作决策依据）`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('agg-gate-stats.mjs');
if (isMain) main();