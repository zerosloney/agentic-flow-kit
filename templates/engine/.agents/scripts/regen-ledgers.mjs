#!/usr/bin/env node
// regen-ledgers.mjs — 工作流台账一键重生成（2026-10-20 消「每合并必冲突」配套件）
//
// 背景：workflow/INDEX.md、metrics.md、verify-evidence.md、delegations.md 是每个任务必写的
// 共享计数器/生成物，两条并行分支各自推进后合并必在计数行撞车（结构性，非偶然）。2026-10-20 起
// .gitattributes 为四文件配了合并策略：三个生成物 merge=ours（保留本侧），delegations.md
// 行级并集（手工行纯追加）——合并后跑本脚本即可把四件重生成出含两侧事实的正确版本。
//
// 用法：
//   flow-kit run regen-ledgers            # 四件全量重生成（合并 develop / 解台账冲突后跑）
//   flow-kit run regen-ledgers --check    # 仅校验各生成器 --check/--dry-run 口径（支持者跑，不支持者跳过）
//
// 真值源不在本脚本：INDEX ← workflow 文档树；metrics ← 各 done 文档与台账；
// verify-evidence ← .agents/verifications.jsonl（合并侧经 jsonl-union 已含两侧绿凭证）；
// delegations 快照 ← 手工行区。因此「任取一侧 + 重生成」恒等于两侧并集的正确版本。
// stale 兜底：INDEX/metrics 漂移会被 verify 的 wiki 三方一致性 / 台账不变量门拦下（实证 2026-10-20）。

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOW_KIT_PROJECT_ROOT || path.resolve(SCRIPT_DIR, '..', '..');
const SCRIPTS_DIR = process.env.FLOW_KIT_RUNTIME_SCRIPTS || path.join(ROOT, '.agents', 'scripts');

// 重生成步骤（单源：本函数被 CLI 与测试共用）
export function buildSteps(scriptsDir = SCRIPTS_DIR) {
  return [
    { name: 'workflow/INDEX.md', args: [path.join(scriptsDir, 'gen-workflow-index.mjs')] },
    { name: 'workflow/metrics.md', args: [path.join(scriptsDir, 'gen-workflow-metrics.mjs')] },
    { name: 'workflow/verify-evidence.md', args: [path.join(scriptsDir, 'gen-verify-evidence.mjs')] },
    { name: 'workflow/delegations.md 月度快照', args: [path.join(scriptsDir, 'agg-delegations.mjs'), '--write'] },
  ];
}

// 步骤执行（spawn 注入缝：测试用假 spawn 记录调用，CLI 用真 spawnSync）
export function runSteps(steps, spawnFn = spawnSync, nodeBin = process.execPath) {
  const results = [];
  for (const step of steps) {
    const r = spawnFn(nodeBin, step.args, { cwd: ROOT, stdio: 'inherit' });
    const ok = r.status === 0;
    results.push({ ...step, ok });
    console.log(`${ok ? '✅' : '❌'} ${step.name}${ok ? '' : `（exit ${r.status}）`}`);
    if (!ok) break; // fail-fast：下游台账可能依赖上游产物
  }
  return results;
}

function main() {
  const results = runSteps(buildSteps());
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n[regen-ledgers] ${failed.length}/${results.length} 步失败——先修上游再重跑`);
    process.exit(1);
  }
  console.log('\n[regen-ledgers] 四台账已重生成（含两侧事实）。建议随后跑 flow-kit run verify 复核。');
}

if (process.argv[1] && process.argv[1].endsWith('regen-ledgers.mjs')) {
  main();
}
