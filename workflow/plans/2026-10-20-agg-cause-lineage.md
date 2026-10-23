---
状态: approved
级别: L2
模块: infra
确认指纹: d87befa594b4158a
---
# PLAN — 委派台账原因谱系统一

## 改动方案
- agg-delegations.cjs：parseResult 原因括号（噪声互斥）/ CAUSES+ADOPT_CAUSE+CAUSE_ANCHOR 常量 /
  causeSummary / metrics 采纳豁免与 adoptedRework / 月度输出行 / 快照备注 / exports
- agg-delegations.test.mjs：场景 10 七断言（createRequire 载 .cjs）
- delegations.md 记法节（模板 + 本仓装户副本镜像）
- engine-lock --update --note

## 验收计划
node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-20-agg-cause-lineage.md

## 确认与复核
- 确认后补「确认结果 / 确认时间」；`done` 只在关单出现。
