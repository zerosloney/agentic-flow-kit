---
name: wf-plan
description: Plan 阶段 · 立 intent（AI 起草、用户确认；本阶段不委派子智能体）
---

严格按 AGENTS.md 与 .agents/commands/plan.md 执行：Plan 阶段 · 立 intent（AI 起草、用户确认；本阶段不委派子智能体）。

先完整读取上述两个文件并完全遵循，读不到即停下报告阻塞；本文件不内联步骤副本，避免与权威版本漂移。

【Trae 宿主注记】
- 确认门：intent 草稿全文输出给用户过目，一句"可以"即确认（draft→approved），确认前不进下一阶段。
- 已有 approved intent 时按级别跳转：L1 → wf-build；L2/L3 → wf-design。
- 本阶段不委派子智能体，由主智能体起草；任务入口动作与红线勾选口径以权威文件为准。
