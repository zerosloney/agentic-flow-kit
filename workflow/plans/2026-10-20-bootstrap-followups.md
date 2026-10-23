---
状态: done
级别: L2
模块: infra
确认指纹: 88075577af65a6d8
---
# PLAN — 自举连带修复批

## 改动方案
- check-regression-consistency.mjs：提取过滤裸名（无 `/` 即弃）+ 测试 +1 断言
- workflows-check.test.mjs：S14 baseline 改锚 errorCount===0 且 files≥1
- .github/workflows/kit-ci.yml：env LEDGER_HISTORY_BASELINE=5ca9e8c2
- engine-lock --update --note（受检件变更入账）

## 验收计划
node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-20-bootstrap-followups.md

## 确认与复核
- 确认后补「确认结果 / 确认时间」；`done` 只在关单出现。
