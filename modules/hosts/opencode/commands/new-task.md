---
description: AI-Native 闭环总入口 · 6 阶段路由（新需求 → plan / 修复 → maintain）+ 级别判断（L0-L3）
---

严格按 AGENTS.md 与 .agents/commands/new-task.md 执行：闭环总入口 · 路由判断（新需求 intent → plan / 修复 incident → maintain）+ 级别判断（L0-L3）。

先完整读取上述两个文件并完全遵循，读不到即停下报告阻塞；本文件不内联步骤副本，避免与权威版本漂移。

【OpenCode 宿主注记】
- 输出路由结论与级别，指明进入哪个 .agents/commands/*.md 阶段；不并阶段、不跳阶段。
- approval_required 阶段产出未经用户对话内一句话确认，不得进入下一阶段。
- opencode 无宿主级即时钩子；机器门禁以 `.githooks/`（git 提交时硬拦）为准，`git commit/merge/push` 三处禁 `--no-verify`。
