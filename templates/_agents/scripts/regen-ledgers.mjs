#!/usr/bin/env node
// regen-ledgers.mjs — 工作流台账一键重生成（2026-10-20 自源仓 0bc69a24 回灌，kit 适配）
//
// 背景：workflow/INDEX.md、metrics.md、verify-evidence.md、delegations.md 是每个任务必写的
// 共享计数器/生成物，两条并行分支各自推进后合并必在计数行撞车（结构性，非偶然）。.gitattributes
// 为四文件配了合并策略：三个生成物 merge=ours（保留本侧），delegations.md 行级并集（手工行纯追加）
// ——合并后跑本脚本即可把四件重生成出含两侧事实的正确版本。
//
// kit 适配（与源仓差异如实声明）：源仓 agg-delegations.mjs 支持 --write 自动回写快照；kit 的
// agg-delegations.cjs 是打印回贴口径（快照行打进 stdout，人工回贴 delegations.md）——第四步跑它
// 打印最新快照行，陈旧快照的替换仍由人工回贴完成（陈旧检测另有 doctor §6.5 兜底）。前三步与源仓同构。
//
// 用法：
//   node .agents/scripts/regen-ledgers.mjs            # 四步串行（合并 develop / 解台账冲突后跑）
//
// 真值源不在本脚本：INDEX ← workflow 文档树；metrics ← 各 done 文档与台账；
// verify-evidence ← .agents/verifications.jsonl（合并侧经 jsonl-union 已含两侧绿凭证）；
// delegations 快照 ← 手工行区。因此「任取一侧 + 重生成」恒等于两侧并集的正确版本。
// stale 兜底：INDEX/metrics 漂移会被 check-loop 检查 11 / verify 的生成物一致性门拦下。

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 重生成步骤（单源：本函数被 CLI 与测试共用）
export function buildSteps() {
  return [
    { name: 'workflow/INDEX.md', args: ['.agents/scripts/gen-workflow-index.mjs'] },
    { name: 'workflow/metrics.md', args: ['.agents/scripts/gen-workflow-metrics.mjs'] },
    { name: 'workflow/verify-evidence.md', args: ['.agents/scripts/gen-verify-evidence.mjs'] },
    // kit 打印回贴口径：打印最新月度快照行，人工回贴替换 delegations.md 陈旧行（见头注适配声明）
    { name: 'workflow/delegations.md 月度快照（打印回贴口径）', args: ['.agents/scripts/agg-delegations.cjs'] },
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
  console.log('\n[regen-ledgers] 台账已重生成（前三件落盘含两侧事实；delegations 快照行为打印口径，若有陈旧按上方输出回贴）。建议随后跑 node .agents/scripts/verify.mjs 复核。');
}

if (process.argv[1] && process.argv[1].endsWith('regen-ledgers.mjs')) {
  main();
}
