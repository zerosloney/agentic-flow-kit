---
description: Design 阶段 · 起 spec（L2/L3 强制，L1 可省略直接进 build）
---

严格按 AGENTS.md 与 .agents/commands/design.md 执行：Design 阶段 · 起 spec（L2/L3 强制，L1 可省略直接进 build）。

先完整读取上述两个文件并完全遵循，读不到即停下报告阻塞；本文件不内联步骤副本，避免与权威版本漂移。

【OpenCode 宿主注记】
- 确认门：spec 草稿经用户确认；L3 另有独立复核门，复核未过不得确认。
- L3 独立复核委派 `independent-reviewer`（`.opencode/agents/independent-reviewer.md`，契约读 `.agents/roles/independent-reviewer.md`）——subagent 天然独立上下文，权威命令 `fallback: new-session` 的隔离要求即满足。
- 确认后进 build。
