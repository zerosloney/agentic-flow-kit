#!/usr/bin/env node
/* test-impact: 影响面选测 CLI
 *
 * 已接线 pre-push（2026-11-08）：集成档 --select-range、单测档 --unit-range 由项目在
 * .agents/hooks/commit-check.config.json 的 pushTests 里声明执行命令；本 CLI 保留作手动探查。
 *
 * 用法：
 *   flow-kit run test-impact.mjs --range <old> <new> [--json]
 *   flow-kit run test-impact.mjs --files <file1,file2,...> [--json]
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
  ROOT,
  changedFilesFromRange,
  formatDecision,
  loadMap,
  normalizePath,
  selectForFiles,
  selectDynamicTestImpact,
  formatDynamicDecision,
} from './test-impact-lib.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const dynamic = argv.includes('--dynamic');
const filesArg = [];
let range = null;

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--json' || arg === '--dynamic') continue;
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
  console.error('用法：flow-kit run test-impact.mjs --range <old> <new> [--dynamic] [--json]');
  console.error('      flow-kit run test-impact.mjs --files <a,b,c> [--dynamic] [--json]');
  process.exit(2);
}

let decision;
let map = null;
try {
  let files = filesArg;
  let rangeFailure = null;
  if (range) {
    const result = changedFilesFromRange(range.oldSha, range.newSha);
    files = result.files;
    rangeFailure = result.reason;
  }
  if (dynamic) {
    if (rangeFailure) {
      decision = {
        mode: 'full',
        reason: rangeFailure,
        impactedTests: [],
        directImpactedTests: [],
        transitiveImpactedTests: [],
        changedFiles: [],
        unmappedFiles: [],
        totalKnownTests: 0,
        skippedTestsCount: 0,
        accelerationRatio: 0,
        warnings: [rangeFailure],
        graphStats: { nodeCount: 0, edgeCount: 0, testCount: 0 },
      };
    } else {
      decision = selectDynamicTestImpact(ROOT, files);
    }
  } else if (rangeFailure) {
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
    map = loadMap();
    decision = selectForFiles(map, files);
  }
} catch (e) {
  console.error(`test-impact: ${e.message}`);
  process.exit(2);
}

if (json) {
  process.stdout.write(`${JSON.stringify({ ...(dynamic ? {} : { map: MAP_PATH }), ...decision }, null, 2)}\n`);
} else if (dynamic) {
  console.log('dynamic-test-impact:');
  console.log(formatDynamicDecision(decision));
} else {
  console.log('test-impact:');
  console.log(formatDecision(decision));
  if (decision.mode === 'filter') {
    if (map && map.runner && map.runner.kind === 'generic') {
      console.log(`run: <项目集成测试命令>（filter: ${decision.filter}；命令模板见 test-impact-map.json 的 runner.list）`);
    } else {
      const testDir = map && map.dirs && map.dirs.test ? String(map.dirs.test).replace(/\/?$/, '/') : '<dirs.test>/';
      console.log(`run: dotnet test ${testDir}…csproj --no-build --filter "<filter>"`);
      console.log('     （工程路径以 .agents/config/test-impact-map.json 的 dirs.test 为准）');
    }
  } else if (decision.mode === 'full') {
    console.log('run: <项目集成测试全量命令>（见 .agents/hooks/commit-check.config.json 的 pushTests）');
  } else {
    console.log('run: （跳过集成测试）');
  }
}
