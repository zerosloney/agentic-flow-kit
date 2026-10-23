// agg-gate-stats.test.mjs — 门禁 ROI 聚合测试（2026-10-08 gate-roi-metrics）
// 覆盖：聚合数学 / 窗口过滤 / 坏行容错 / 死检查识别 / 噪声率排序 / 按耗时降序 / 空数据降级。
// 用法：node templates/_agents/scripts/agg-gate-stats.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const { aggregate, readRows } =
  await import(pathToFileURL(path.join(SCRIPT_DIR, 'agg-gate-stats.mjs')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
};

const NOW = Date.parse('2026-10-08T00:00:00.000Z');
const run = (ts, segs) => ({ ts, segs });
const seg = (id, warns, blocks, ms, label = `检查${id}`) => ({ id, label, warns, blocks, ms });

// ---- 1. 聚合数学 ----
{
  const rows = [
    run('2026-10-07T00:00:00.000Z', [seg('8', 0, 0, 10000, '验收'), seg('4', 2, 0, 20, '引用')]),
    run('2026-10-08T00:00:00.000Z', [seg('8', 0, 0, 12000, '验收'), seg('4', 1, 0, 30, '引用'), seg('3', 0, 1, 5, 'incidents')]),
  ];
  const a = aggregate(rows, NOW, null);
  check('聚合：runs 计 2', a.runs === 2, `runs=${a.runs}`);
  const s8 = a.list.find((x) => x.id === '8');
  check('聚合：按 id 累计（检查 8 = 2 次运行 / 均耗时 11000ms）',
    s8.runs === 2 && s8.avgMs === 11000 && s8.msSum === 22000, JSON.stringify(s8));
  const s4 = a.list.find((x) => x.id === '4');
  check('聚合：警告累计与命中次数（检查 4 = 命中 2 / 警告 3 / 噪声率 1.5）',
    s4.hits === 2 && s4.warns === 3 && s4.noiseRate === 1.5, JSON.stringify(s4));
  const s3 = a.list.find((x) => x.id === '3');
  check('聚合：blocks 计入命中（检查 3 拦截 1 次 → hits=1）', s3.hits === 1 && s3.blocks === 1, JSON.stringify(s3));
  check('聚合：默认按累计耗时降序（成本视角优先）', a.list[0].id === '8', a.list.map((x) => x.id).join(','));
  check('聚合：costTotal = 各段 ms 之和', a.costTotal === 22000 + 50 + 5, String(a.costTotal));
}

// ---- 2. 窗口过滤 ----
{
  const rows = [
    run('2026-01-01T00:00:00.000Z', [seg('8', 0, 0, 99999, '验收')]),
    run('2026-10-07T00:00:00.000Z', [seg('8', 0, 0, 1000, '验收')]),
  ];
  const a = aggregate(rows, NOW, 30);
  check('窗口：30 天外的运行被排除（runs=1，耗时不含 99999）',
    a.runs === 1 && a.costTotal === 1000, `runs=${a.runs} cost=${a.costTotal}`);
  const b = aggregate(rows, NOW, null);
  check('窗口：days=null 取全量（runs=2）', b.runs === 2, `runs=${b.runs}`);
}

// ---- 3. 死检查与噪声率排序 ----
{
  const rows = [
    run('2026-10-07T00:00:00.000Z', [
      seg('8', 0, 0, 5000, '验收'),          // 贵但从不命中 → 死检查
      seg('17', 0, 0, 4000, '发版树'),       // 贵且从不命中 → 死检查
      seg('11', 5, 0, 100, '漂移'),          // 高噪声
      seg('4', 1, 0, 10, '引用'),            // 低噪声
    ]),
  ];
  const a = aggregate(rows, NOW, null);
  const deadIds = a.dead.map((x) => x.id).sort();
  check('死检查：识别「声明了但从未命中」（8/17），且按耗时排序（8 在前）',
    deadIds.join(',') === '17,8' || deadIds.join(',') === '8,17', deadIds.join(','));
  check('噪声率 top：11（5.0）> 4（1.0）', a.noiseTop.map((x) => x.id).join(',') === '11,4', a.noiseTop.map((x) => x.id).join(','));
  check('死检查不进 noiseTop（从不命中 ≠ 高噪声）', !a.noiseTop.some((x) => x.id === '8'));
}

// ---- 4. 坏行容错 + 空数据 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-gatestats-'));
  const f = path.join(root, 'gate-stats.jsonl');
  fs.writeFileSync(f, [
    'not-json-bad-line',
    JSON.stringify(run('2026-10-07T00:00:00.000Z', [seg('8', 0, 0, 100)])),
    '',
    JSON.stringify({ ts: '2026-10-07T00:00:00.000Z' }), // 无 segs
  ].join('\n') + '\n');
  const rows = readRows(f);
  check('坏行容错：非 JSON / 无 segs 的行跳过不抛（其余 1 行入账）', rows.length === 1 && rows[0].segs.length === 1);
  check('坏行容错：文件不存在 → 空数组不抛', readRows(path.join(root, 'nope.jsonl')).length === 0);
  check('空数据降级：aggregate 返回零值而非抛', aggregate([], NOW, 30).runs === 0 && aggregate([], NOW, 30).list.length === 0);
  // 段体缺字段容错
  const r2 = aggregate([{ ts: '2026-10-07T00:00:00.000Z', segs: [{ id: '8' }, null, { warns: 1 }] }], NOW, null);
  check('段体容错：缺 ms / null 段 / 缺 id 段不抛', r2.runs === 1 && r2.list.find((x) => x.id === '8').avgMs === 0);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);