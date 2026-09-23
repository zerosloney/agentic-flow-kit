---
name: wf-review
description: Review · 代码评审（横切，合入前使用；P0/P1/P2 分级清单 + 用户定性与合入时机）
---

严格按 AGENTS.md 与 .agents/commands/review.md 执行：Review · 代码评审（横切，合入前使用；P0/P1/P2 分级清单 + 用户定性与合入时机）。

先完整读取上述两个文件并完全遵循，读不到即停下报告阻塞；本文件不内联步骤副本，避免与权威版本漂移。

【Trae 宿主注记】
- 顺序：机器门禁自动拦 → independent-reviewer 复核（L2/L3 强制独立，子智能体未开启时另开新会话）→ 分级清单交用户定性与决定合入时机。
- 确认门：P0/P1 未清回 wf-build；清零且用户确认后才可合入。
- finding 报告门（防误报）与机器兜底清单以权威文件为准。
