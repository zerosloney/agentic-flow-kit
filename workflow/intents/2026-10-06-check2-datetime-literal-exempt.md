---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-06
模块: infra
备注: 装户（Shipyard.Material）2026-10-06-check2-datetime-literal-exempt 回流批次，用户 2026-10-06 对话拍板「按照你的建议继续修」；随 1.1.6 发版
确认指纹: fe0143af0fd01caf
---

# INTENT — 检查 2 日期显示格式字面量豁免（装户回流）

## 背景与问题

装户全量审查发现检查 2（模板占位符残留）把正文裸写的 `YYYY-MM-DD` 一律当未填占位，误伤「描述日期显示格式的字面量」（`YYYY-MM-DD HH:mm`）——装户 cancel-export intent/plan 实证 2 条 advisory（正文叙述的是该功能自实现的匹配时间列格式），2026-10-06 装户 loop-audit intent 现场复现 1 条。现有豁免（反引号/围栏/样板/命名约定）均不覆盖裸写格式描述。

## 目标

- 检查 2 `stripSamples` 行内剔除追加 `YYYY-MM-DD\s+HH:mm(:ss)?`（时间粒度后缀 = 格式描述非占位）；真占位（裸 `YYYY-MM-DD` 无时间后缀）照拦。
- 测试补正反两场景（豁免 / 混真占位仍报）；只豁免实证形态，变体不预防（出现假阳性再扩）。

## 非目标

- 其他日期变体（斜杠日期 / 十二小时制）不预防。

## 影响面

- 模块：infra（check-loop.mjs + check-loop.test.mjs 各 1 处，双侧成对）；数据库：无

## 触达红线

- [x] 跨调用方契约变更（检查 2 判定口径）→ 级别至少 L2（risk_level 双写 L2）
- [ ] 其余不触及

## 验收标准（可测试）

- [ ] `node src/run-tests.mjs` 全绿（含检查 2 新正反场景）
- [ ] `node .agents/scripts/source-sync-check.mjs --gate` 绿；两仓 check-loop.mjs / check-loop.test.mjs 零 diff（LF 归一）
- [ ] package.json version 1.1.6 + CHANGELOG 记本批

> **闭环对账**：关单在 test 阶段。intent 置 done 前逐条勾验补证据。
