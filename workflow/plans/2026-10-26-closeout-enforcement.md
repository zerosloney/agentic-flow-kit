---
状态: done
级别: L2
日期: 2026-10-26
模块: infra
确认指纹: 62e4a5e3a798c368
---
# PLAN — 关单执法点前移批

对应入口：../intents/2026-10-26-closeout-enforcement.md
对应 spec：../specs/2026-10-26-closeout-enforcement.md

## 改动方案
- confirm-doc：→done 且 intents/specs/plans 且正文含验收标准节 → 节内未勾行拒（新前置门，置于 done 前置门后）+ 头注纪律
- check-loop：检查 1（intent 缺 plan/spec、spec 缺入口、plan 缺入口）与检查 3（incident 缺 plan/spec）配对判定前 abandoned 短路
- 测试：confirm-doc.test S1 组（未勾拒/全勾过/无节不拦/incident 不拦）+ S56 v12 组；check-loop.test S3 组（cancelled intent/incident 无 plan 不拦）

## 验证计划
npm test；LEDGER_HISTORY_BASELINE=5ca9e8c2 node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-26-closeout-enforcement.md

## 确认与复核
- 确认后补「确认结果 / 确认时间」；`done` 只在关单出现。
