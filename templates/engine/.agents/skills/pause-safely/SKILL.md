---
name: pause-safely
description: 长跑中断/离开前留可续现场——写 resume brief（状态/下一步/未决/证据指针），停掉自己起的进程，不提交不删除；供暂停、离线、上下文压缩、会话重启前使用。
---

# pause-safely — 暂停留痕

## 触发

- 用户说「先停 / 我走了 / 明天继续」。
- 上下文即将压缩、会话即将重启。
- 长跑（`autonomous-run` / `pipeline-run`）需要挂起。

## 步骤

1. **写 resume brief** 到 `tmp/pause-<slug>.md`（不提交）：
   - **现场**：分支、HEAD 短 SHA、worktree 路径、`git status --porcelain -uall` 摘要。
   - **做到哪**：已完成单元 + 对应绿凭证 `headShort` / 决策轨迹行。
   - **下一步**：第一个未完成动作，具体到文件/命令。
   - **未决**：等用户拍板的分叉、已知风险、被阻塞项。
   - **证据指针**：`workflow/plans/...` 勾选态、`decisions.tsv`、`tmp/verify-*.log`、截图路径。
   - **进程**：自己起的服务/端口/PID（只记自己起的）。
2. **不提交、不推送、不删除**：未提交改动原样保留；需要提交时先问用户。
3. **停进程**：只停本会话启动的进程；不按进程名杀，按 PID/端口。
4. **恢复**：新会话先按 `.agents/skills/session-resume/SKILL.md` 重建，再读 resume brief；不靠记忆。

## 边界

- 不清理 worktree、不删临时文件、不 `git reset`——暂停不是收尾。
- 不把 resume brief 写成流水账；只留「下一个人能接着做」的事实。
- 不提交半成品；不 `--no-verify`。
