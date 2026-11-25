#!/usr/bin/env node
/* check-test-impact-map: 影响面映射完整性机检
 *
 * 目的：防止「新增测试类未登记 → 推送时被静默跳过」。
 * 口径：dirs.test（映射登记的集成测试目录）下所有含 [Fact]/[Theory] 的文件，
 *       其 public *Tests 类必须与 .agents/config/test-impact-map.json 的 areas 完全一致。
 *       dirs.fullchain 默认不编译（#if FCLocal），不纳入。
 * 骨架态：映射未登记（namespace/areas/paths 均空——装户尚未启用影响面选测）→ 明确 SKIP（exit 0），
 *       不做校验、不判缺失。
 * generic runner：无内建 C# 测试类解析 → 明确 SKIP（exit 0），映射完整性由项目自检。
 *
 * 何时硬红：CI 重档（--full）先跑本检查，失败即退出 1。
 * 何时软兜底：pre-push 选测时若发现未登记类，selector 自动回退全量（见 test-impact-lib.mjs）。
 *
 * 退出码：0 = 一致（含骨架态 SKIP）；1 = 缺失/陈旧/重复/测试类命名无法识别，
 *         或前置缺失（--map 缺路径、映射读取/解析/校验失败、被检查目录不存在）。
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, MAP_PATH, loadMap, mapDirs, mapRunner } from './test-impact-lib.mjs';

const CLASS_RE = /^public\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)/gm;

const walk = (dir, skipDirs) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name), skipDirs));
    } else if (entry.isFile() && entry.name.endsWith('.cs')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
};

const mapIdx = process.argv.indexOf('--map');
const mapArg = mapIdx >= 0 ? process.argv[mapIdx + 1] : undefined;
if (mapIdx >= 0 && !mapArg) {
  console.error('check-test-impact-map: --map 缺少路径');
  process.exit(1);
}

// 骨架态（映射未登记：namespace/areas/paths 均空）= 项目尚未启用影响面选测：明确 SKIP（exit 0）。
// 读取/解析失败不在此处报错——静默落到下方 loadMap，由它给出统一口径的错误。
try {
  const skeleton = JSON.parse(fs.readFileSync(mapArg || MAP_PATH, 'utf8'));
  const isEmpty =
    skeleton && typeof skeleton === 'object' && !Array.isArray(skeleton)
    && !String(skeleton.namespace || '').trim()
    && (!skeleton.areas || Object.keys(skeleton.areas).length === 0)
    && (!skeleton.paths || skeleton.paths.length === 0);
  if (isEmpty) {
    console.log('check-test-impact-map: SKIP');
    console.log('  影响面映射未登记（namespace/areas/paths 均空——骨架态）：跳过比对，不判缺失。');
    console.log('  按项目实际填写 .agents/config/test-impact-map.json 后本检查生效。');
    process.exit(0);
  }
} catch { /* 非骨架态或文件缺失 → loadMap 统一报错 */ }

let map;
try {
  map = loadMap(mapArg);
} catch (e) {
  console.error(`check-test-impact-map: ${e.message}`);
  process.exit(1);
}

// generic 执行器：内建解析只认 C# 测试类，不适用于其它栈 → 明确 SKIP（exit 0），完整性交项目自检。
if (mapRunner(map).kind === 'generic') {
  console.log('check-test-impact-map: SKIP');
  console.log('  generic runner：无内建测试类解析，跳过类清单比对（映射完整性由项目自检）');
  process.exit(0);
}

// 目录面项目级单源（test-impact-map.json 的 dirs）：缺目录面 = 选测不可裁定 → 前置失败。
const dirs = mapDirs(map);
if (!dirs.test) {
  console.error('check-test-impact-map: 前置缺失：映射缺 dirs.test（.agents/config/test-impact-map.json；按项目登记集成测试目录后重跑）');
  process.exit(1);
}
const TEST_DIR = path.resolve(ROOT, dirs.test);
const SKIP_DIRS = new Set(['bin', 'obj']);
if (dirs.fullchain) SKIP_DIRS.add(path.posix.basename(dirs.fullchain.replace(/\/$/, '')));

// 前置缺失：被检查目录不存在（未装户/骨架工程）——与上方前置失败同口径：stderr 说明 + exit 1。
if (!fs.existsSync(TEST_DIR)) {
  console.error(`check-test-impact-map: 前置缺失：被检查的目录不存在 ${path.relative(ROOT, TEST_DIR).replace(/\\/g, '/')}（按项目实际建立集成测试目录并登记影响面映射后重跑）`);
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
for (const file of walk(TEST_DIR, SKIP_DIRS)) {
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
