---
状态: approved
级别: L2
risk_level: L2
模块: infra
确认指纹: d0c62a3961963c32
---

# SPEC — 检查 2 日期显示格式字面量豁免（回流）

对应入口：../intents/2026-10-06-check2-datetime-literal-exempt.md

## 方案

以装仓已验证版本为基准整份复制（双侧成对）：`check-loop.mjs` 检查 2 `stripSamples` 行内剔除追加 `.replace(/YYYY-MM-DD\s+HH:mm(:ss)?/g, '')`（含实证注释）；`check-loop.test.mjs` 场景 45c 两块（dt1 豁免 / dt2 混真占位仍报，fixture 日期 2026-09-26 避检查 15 v1 锚）。设计依据见装仓档 `E:\Git\Shipyard.Material\workflow\specs\2026-10-06-check2-datetime-literal-exempt.md`。

## 约束

- 豁免不得吞真占位（负例场景钉住）；检查编号不动。
- 复制后 `flow-kit sync` 刷台账，gate 绿后提交。

## 已知边界

- 变体形态（斜杠日期等）不预防，实证再扩。
