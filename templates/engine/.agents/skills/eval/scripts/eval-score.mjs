#!/usr/bin/env node
// eval-score.mjs — 盲评 A/B 计分器（2026-10-22 pstack /eval 借鉴）
// 用法：node .agents/skills/eval/scripts/eval-score.mjs <results.tsv> [--json]
// TSV 表头：task	expected	a	b
//   a/b = pass|fail（或 1/0/true/false/y/n）；空 = 未跑，跳过。
// 输出：A 命中率 / B 命中率 / Δ（百分点）/ 翻转任务（a≠b）。
// 退出：0 正常；2 文件缺失/无有效行。
import fs from 'node:fs';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const asJson = argv.includes('--json');
if (!file) {
  console.error('用法：node .agents/skills/eval/scripts/eval-score.mjs <results.tsv> [--json]');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`eval-score: 文件不存在 ${file}`);
  process.exit(2);
}

const norm = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (['pass', '1', 'true', 'y', 'yes'].includes(s)) return true;
  if (['fail', '0', 'false', 'n', 'no'].includes(s)) return false;
  return null;
};

const rows = [];
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  const cells = line.split('\t').map((c) => c.trim());
  if (cells[0] === 'task') continue;
  const [task, expected, a, b] = cells;
  const av = norm(a);
  const bv = norm(b);
  if (!task || av === null || bv === null) continue;
  rows.push({ task, expected, a: av, b: bv });
}
if (!rows.length) {
  console.error('eval-score: 无有效行（需要 task/expected/a/b，a/b 为 pass|fail）');
  process.exit(2);
}

const total = rows.length;
const aPass = rows.filter((r) => r.a).length;
const bPass = rows.filter((r) => r.b).length;
const aRate = (aPass / total) * 100;
const bRate = (bPass / total) * 100;
const deltaPp = aRate - bRate;
const flips = rows.filter((r) => r.a !== r.b).map((r) => r.task);

if (asJson) {
  console.log(JSON.stringify({ total, a: { pass: aPass, rate: aRate }, b: { pass: bPass, rate: bRate }, deltaPp, flips }, null, 2));
  process.exit(0);
}
console.log(`A 命中 ${aPass}/${total} (${aRate.toFixed(1)}%)｜B 命中 ${bPass}/${total} (${bRate.toFixed(1)}%)｜Δ ${deltaPp >= 0 ? '+' : ''}${deltaPp.toFixed(1)}pp｜翻转 ${flips.length}`);
if (flips.length) console.log(`翻转任务：${flips.join('、')}`);
if (Math.abs(deltaPp) < 20) console.log('提示：Δ < 20pp，小 N 噪声内，不要宣称有效。');
