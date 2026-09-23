---
name: wf-test
description: Test 阶段 · 静态门 + 切库冒烟 + UI 实测 + L2/L3 独立复核（关单在本阶段）
---

严格按 AGENTS.md 与 .agents/commands/test.md 执行：Test 阶段 · 静态门全过 + 切库冒烟（如触发）+ UI 实测 + L2/L3 独立复核。

先完整读取上述两个文件并完全遵循，读不到即停下报告阻塞；本文件不内联步骤副本，避免与权威版本漂移。

【Trae 宿主注记】
- 确认门：全过后用户确认才关单；**关单在本阶段**（勾验收 / incident 状态 / 委派留痕的口径以权威文件为准）。
- UI 实测委派 ui-verifier（.trae/agents/ui-verifier.md）；L2/L3 独立复核委派 independent-reviewer，子智能体未开启时另开新会话。
- 失败项修复仍回 wf-build，不在本阶段顺手改代码。
- L1 到此结束；L2/L3 仅当用户确认要上 prod 才进 wf-deploy。
