---
description: Deploy 阶段 · prod 上线清单（静态门 / 配对 / 回归 / DB / 授权 / 24h 观察；关单在 test）
---

严格按 AGENTS.md 与 .agents/commands/deploy.md 执行：Deploy 阶段 · prod 上线清单（静态门 / 配对检查 / 回归 / DB / 授权 / 24h 观察；文档关单在 test，本阶段不重复关单）。

先完整读取上述两个文件并完全遵循，读不到即停下报告阻塞；本文件不内联步骤副本，避免与权威版本漂移。

【OpenCode 宿主注记】
- 确认门：上线授权 = 用户对话内一句确认 + release/<日期> tag 留痕；无第二审批人，AI 不得自行上线、不得 `git push` 绕门禁。
- 本阶段不委派子智能体；回滚 SQL 等数据安全判断由主智能体做、用户拍板。
- 异常进 maintain；用户确认无异常 = prod 闭环，AI 不得自行宣告。
