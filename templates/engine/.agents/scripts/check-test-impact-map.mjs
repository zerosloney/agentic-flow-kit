#!/usr/bin/env node
/* check-test-impact-map: 影响面映射完整性机检
 *
 * 目的：防止「新增测试类未登记 → 推送时被静默跳过」。
 * 口径：tests/Shipyard.Material.IntegrationTests 下所有含 [Fact]/[Theory] 的文件，
 *       其 public *Tests 类必须与 .agents/config/test-impact-map.json 的 areas 完全一致。
 *       FullChain/ 默认不编译（#if FCLocal），不纳入。
 *
 * 何时硬红：run-backend-tests.mjs --full（CI 重档）先跑本检查，失败即退出 1。
 * 何时软兜底：pre-push 选测时若发现未登记类，selector 自动回退全量（见 test-impact-lib.mjs）。
 *
 * 退出码：0 = 一致；1 = 缺失/陈旧/重复/测试类命名无法识别。
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadMap } from './test-impact-lib.mjs';

const TEST_DIR = path.join(ROOT, 'tests', 'Shipyard.Material.IntegrationTests');
const SKIP_DIRS = new Set(['bin', 'obj', 'FullChain']);
const CLASS_RE = /^public\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)/gm;

const walk = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.cs')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
};

let map;
try {
  const mapIdx = process.argv.indexOf('--map');
  const mapPath = mapIdx >= 0 ? process.argv[mapIdx + 1] : undefined;
  if (mapIdx >= 0 && !mapPath) throw new Error('--map 缺少路径');
  map = loadMap(mapPath);
} catch (e) {
  console.error(`check-test-impact-map: ${e.message}`);
  process.exit(1);
}

const mapped = new Map();
for (const [area, classes] of Object.entries(map.areas)) {
  for (const cls of classes) {
    if (!mapped.has(cls)) mapped.set(cls, new Set());
    mapped.get(cls).add(area);
  }
}

const source = new Map();
const errors = [];
for (const file of walk(TEST_DIR)) {
  const src = fs.readFileSync(file, 'utf8');
  const classes = [];
  for (const m of src.matchAll(CLASS_RE)) {
    if (m[1].endsWith('Tests')) classes.push(m[1]);
  }
  if (classes.length > 0) {
    const ns = (src.match(/^namespace\s+([A-Za-z0-9_.]+)/m) || [])[1];
    if (ns && ns !== map.namespace) {
      errors.push(`测试命名空间与 manifest 不一致：${path.relative(ROOT, file)} → ${ns}（期望 ${map.namespace}）`);
    }
    for (const cls of classes) {
      if (source.has(cls)) {
        errors.push(`测试类重复声明：${cls}（${path.relative(ROOT, source.get(cls))} 与 ${path.relative(ROOT, file)}）`);
      } else {
        source.set(cls, file);
      }
    }
    continue;
  }
  if (/\[(Fact|Theory)\b/.test(src)) {
    errors.push(`无法识别的测试类（文件含 [Fact]/[Theory] 但没有 public *Tests 类）：${path.relative(ROOT, file)}`);
  }
}

const missing = [...source.keys()].filter((cls) => !mapped.has(cls)).sort();
const stale = [...mapped.keys()].filter((cls) => !source.has(cls)).sort();

if (missing.length) {
  errors.push(`未登记的测试类（${missing.length}）：\n  - ${missing.join('\n  - ')}`);
}
if (stale.length) {
  errors.push(`manifest 中已不存在的测试类（${stale.length}）：\n  - ${stale.join('\n  - ')}`);
}

if (errors.length) {
  console.error('check-test-impact-map: FAIL');
  for (const err of errors) console.error(`- ${err}`);
  console.error('修复：更新 .agents/config/test-impact-map.json 后重跑。');
  process.exit(1);
}

const areaCounts = Object.entries(map.areas)
  .map(([area, classes]) => `${area}=${classes.length}`)
  .join(' ');
console.log('check-test-impact-map: OK');
console.log(`  classes: ${source.size}（source=${source.size}, mapped=${mapped.size}）`);
console.log(`  areas: ${Object.keys(map.areas).length}（${areaCounts}）`);
console.log(`  always: ${map.always.length}`);
console.log(`  paths: ${map.paths.length}`);
