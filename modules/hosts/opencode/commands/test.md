---
description: Test 阶段 · 静态门 + 切库冒烟 + UI 实测 + L2/L3 独立复核（关单在本阶段）
---

严格按 AGENTS.md 与 .agents/commands/test.md 执行：Test 阶段 · 静态门全过 + 切库冒烟（如触发）+ UI 实测 + L2/L3 独立复核。

先完整读取上述两个文件并完全遵循，读不到即停下报告阻塞；本文件不内联步骤副本，避免与权威版本漂移。

【OpenCode 宿主注记】
- 终端是 PowerShell：取真退出码、`$LASTEXITCODE` 假绿陷阱、Git Bash 绝对路径调法见 `.agents/notes/runtime-env.md` §1，断言"通过"前先确认命令真的跑了。
- 跑静态门前先看 `.agents/notes/runtime-env.md` §2（本地 API 进程锁 bin 下 DLL，谁跑门谁先停 API）。
- UI 实测委派 `ui-verifier`（`.opencode/agents/ui-verifier.md`）；L2/L3 独立复核委派 `independent-reviewer`——本宿主 subagent 原生可用，`fallback: new-session` 的独立上下文天然满足。
- 失败项修复仍回 build，不在本阶段顺手改代码；全过后用户确认才关单（勾验收 / incident 状态 / 委派留痕口径以权威文件为准）。
- L1 到此结束；L2/L3 仅当用户确认要上 prod 才进 deploy。
