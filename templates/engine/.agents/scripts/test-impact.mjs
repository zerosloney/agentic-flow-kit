#!/usr/bin/env node
/* test-impact: 影响面选测 CLI
 *
 * 已接线 pre-push（2026-11-08）：集成档 --select-range、单测档 --unit-range 均经
 * scripts/verify/backend/run-backend-tests.mjs 执行；本 CLI 保留作手动探查。
 *
 * 用法：
 *   node .agents/scripts/test-impact.mjs --range <old> <new> [--json]
 *   node .agents/scripts/test-impact.mjs --files <file1,file2,...> [--json]
 *
 * 输出：
 *   mode=filter → 给出 dotnet test --filter 表达式
 *   mode=full   → 调用方跑全量
 *   mode=none   → 不涉及集成测试
 *
 * 退出码：0 = 决策成功；2 = 参数/manifest 错误。full/none 不是错误。
 */
'use strict';

import {
  MAP_PATH,
  changedFilesFromRange,
  formatDecision,
  loadMap,
  normalizePath,
  selectForFiles,
} from './test-impact-lib.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const filesArg = [];
let range = null;

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--json') continue;
  if (arg === '--files') {
    const value = argv[i + 1];
    if (!value) usage('--files 缺少参数');
    filesArg.push(...value.split(',').map(normalizePath).filter(Boolean));
    i += 1;
    continue;
  }
  if (arg === '--range') {
    const oldSha = argv[i + 1];
    const newSha = argv[i + 2];
    if (!oldSha || !newSha) usage('--range 需要 <old> <new>');
    range = { oldSha, newSha };
    i += 2;
    continue;
  }
  usage(`未知参数：${arg}`);
}

function usage(message) {
  if (message) console.error(`test-impact: ${message}`);
  console.error('用法：node .agents/scripts/test-impact.mjs --range <old> <new> [--json]');
  console.error('      node .agents/scripts/test-impact.mjs --files <a,b,c> [--json]');
  process.exit(2);
}

let decision;
try {
  let files = filesArg;
  let rangeFailure = null;
  if (range) {
    const result = changedFilesFromRange(range.oldSha, range.newSha);
    files = result.files;
    rangeFailure = result.reason;
  }
  if (rangeFailure) {
    decision = {
      mode: 'full',
      reason: rangeFailure,
      areas: [],
      classes: [],
      filter: null,
      warnings: [rangeFailure],
      changedFiles: [],
      totalClasses: 0,
    };
    // 仍加载 manifest，尽早暴露配置错误
    loadMap();
  } else {
    const map = loadMap();
    decision = selectForFiles(map, files);
  }
} catch (e) {
  console.error(`test-impact: ${e.message}`);
  process.exit(2);
}

if (json) {
  process.stdout.write(`${JSON.stringify({ map: MAP_PATH, ...decision }, null, 2)}\n`);
} else {
  console.log('test-impact:');
  console.log(formatDecision(decision));
  if (decision.mode === 'filter') {
    console.log('run: dotnet test tests/Shipyard.Material.IntegrationTests/Shipyard.Material.IntegrationTests.csproj --no-build --filter "<filter>"');
  } else if (decision.mode === 'full') {
    console.log('run: node scripts/verify/backend/run-backend-tests.mjs --full');
  } else {
    console.log('run: （跳过集成测试）');
  }
}
