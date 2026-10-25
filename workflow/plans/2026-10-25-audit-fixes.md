---
状态: approved
级别: L2
模块: infra
确认指纹: cde87db4fbaa8881
---
# PLAN — 流程自审修复批

对应入口：../incidents/2026-10-25-audit-fixes.md
对应 spec：../specs/2026-10-25-audit-fixes.md

## 改动方案
- 判据③两行 + 测试夹具（双落）
- 枚举收口三件（enums txt / 检查3文案 / stage-gates 派生）+ 测试
- .gitattributes 补第二行；README 迁移指引补条
- release.yml 前置 CI 门（本仓 yml；查 templates/_github 是否有同构件）

## 验证计划
npm test；LEDGER_HISTORY_BASELINE=5ca9e8c2 verify --doc 本单；文档批另笔 docs 提交

## 确认与复核
- 确认后补「确认结果 / 确认时间」；`done/fixed` 只在关单出现。
