<!-- 本文件为根 AGENTS.md 在 Claude Code 宿主的记忆入口。
     权威源仍为 AGENTS.md；AGENTS.md 更新后本文件保持指针语义。 -->

# Repository Guidelines

单事实源：项目根 `AGENTS.md`（执行任何任务前完整阅读）。本文件是 Claude Code 宿主的记忆入口，不重复权威规则。

## 1. 运行时联通与本地准备 (Runtime / Setup)
- {{productNote}}
- 克隆后自检：`flow-kit run check-local-gates.mjs --fix`。
- **禁令**：commit / merge / push 一律禁止 `--no-verify`。

## 2. 阶段路由 (Routing)
- 极简道 (L0) / 快速道 (L1)：`.agents/commands/new-task.md`
- 阶段流 (L2/L3)：`.agents/commands/stages.md`
- 修复 / 事故：`.agents/commands/maintain.md`
- 上线 / 发布：`.agents/commands/deploy.md`
- 合入评审：`.agents/commands/review.md`
- 自动化驱动：`.agents/commands/pipeline-run.md`（实验位）

## 3. 边界 (Boundaries)
- 宿主 Hook 与指针壳由 `.claude/` 接线到 `.agents/`。
- 权威命令与角色契约在 `.agents/commands/` 与 `.agents/roles/`。
- 宿主私有目录 `.claude/` 默认不入库。
