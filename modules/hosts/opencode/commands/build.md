---
description: Build 阶段 · 起 plan + 实现代码 + 自验（两道确认门，确认后才动代码）
---

严格按 AGENTS.md 与 .agents/commands/build.md 执行：Build 阶段 · 起 plan + 写代码。

先完整读取上述两个文件并完全遵循，读不到即停下报告阻塞；本文件不内联步骤副本，避免与权威版本漂移。

【OpenCode 宿主注记】
- 两道确认门：① plan 草稿全文确认（draft→approved）② 计划模式列改动文件清单确认——两道全过才动代码。
- 范围明确的工作包可委派 `implementer`（`.opencode/agents/implementer.md`，契约读 `.agents/roles/implementer.md`，权限已禁 git commit/push）；不满足角色契约时按 `fallback: main` 由主智能体执行。
- 实现中需偏离已确认 plan（公共接口 / 未列文件 / 新依赖 / 判据影响）→ 停下向用户说明，确认后再继续。
- 完成后进 test。
