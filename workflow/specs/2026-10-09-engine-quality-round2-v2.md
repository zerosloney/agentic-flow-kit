---
状态: approved
级别: L2
日期: 2026-10-09
模块: pipeline
备注: engine-quality-round2-v2（v1 superseded 重立关单单）
确认指纹: abc2beab2a42c4ea
---
# SPEC — engine-quality-round2-v2

## 功能行为

本 spec 为 **v1（已 superseded）已交付实现的重立关单单**——零新增功能行为。v1 八项交付（S1 sync-hosts 多根对账 / S2 edit-face-check / S3 CI 红回溯 / S4 台账哈希链 / S5 检查7拆模块 / S6 exempt 清理 / S7 架构单源 / S8 合并预览纪律）全部已随 9ca1675 / 6e96edf 落库并通过独立复核（P0=0；P1-1 探针行残留→void 作废行处置、P2-1 验链口径勘误+物理行号已修、P2-2 faces 计数已修）。

本单行为面仅两件：
1. **闭环收口**：验证矩阵复跑（npm test / eslint / doctor / source-sync / sync-hosts / rule-budget / gate-checklist）+ confirm-doc 逐件 done。
2. **v1 事故留痕**：勾验盲勾事故根因与避坑在 v2 intent「历史教训」节；P1-1 处置（papercuts 行 + stage=void 作废行）已在库。

## 数据流

无新数据流（实现侧数据流见 v1 spec，superseded 在案；验证矩阵复跑读同一批脚本与台账）。

## 系统改动

| # | 文件 | 改动 |
|---|------|------|
| 1 | workflow/{intents,specs,plans}/2026-10-09-engine-quality-round2-v2.md | 本三件套（新增） |
| 2 | workflow/delegations.md | 补记 v1 superseded 原因行 |
| 3 | workflow/INDEX.md 等生成物 | 随状态变更重生成 |

无代码改动（v1 实现已交付）。

## 约束遵守映射

- **零运行时依赖 / 双源纪律 / gate-checklist 契约**：实现侧已满足（v1 验证在案），本单零代码改动即零新风险。
- **内容绑定纪律**：v1 三件套 superseded（不编辑）；本三件套勾验逐条精确（v1 事故避坑 1）。
- **L2 三段式闭环链**：本三件套 approved 留痕 → （实现已在库）→ 关单 docs。

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| 重立单被误读为重复立项 | 低 | intent 背景节 + 备注 + delegations 行三处声明 superseded 因果 |
| 验证矩阵复跑环境漂移 | 低 | 全量门逐项复跑，任一红即停 |

## 确认与复核

- 确认日期：2026-10-09（自治批次——授权链同 v1）
- 复核：L2 独立复核已随 v1 实现完成（P0=0，全处置）；本单零代码改动，结论直接承继

