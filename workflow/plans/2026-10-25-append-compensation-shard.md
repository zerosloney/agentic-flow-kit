---
状态: done
级别: L2
模块: infra
确认指纹: dbc20f8ea73f788d
---
# PLAN — append-compensation 分片口径修正

对应入口：../incidents/2026-10-25-append-compensation-shard.md
对应 spec：../specs/2026-10-25-append-compensation-shard.md

## 改动方案
- append-compensation.mjs：appendLedger 第三参 { shard: CONFIRM_SHARDED!==0 && ledgerDocChainActive(loadKitPolicy(root)) }（已改待提交）
- append-compensation.test：补 v12 kit.json 夹具断言（补偿行落分片路径、主台账不新建）
- 勾验补正：batch-2 intent S1-S5 补勾 + 补偿行分片重落（已改待提交）
- engine-lock --update --note 重锚

## 验证计划
node .agents/scripts/check-loop.mjs（零 HARD-BLOCK）；npm test；LEDGER_HISTORY_BASELINE=5ca9e8c2 node .agents/scripts/verify.mjs --doc workflow/incidents/2026-10-25-append-compensation-shard.md

## 确认与复核
- 确认后补「确认结果 / 确认时间」；`done/fixed` 只在关单出现。
