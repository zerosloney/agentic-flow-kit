---
name: flow-kit
description: 按仓库内的 AI 闭环开工。用户说开工、走闭环、起 intent、起 spec 时使用。
---

# flow-kit

仓库根 AGENTS.md 是 Codex 自动读取的项目说明。阶段命令的权威正文在 .agents/commands/。

- 总入口：.agents/commands/new-task.md
- 与 Claude / Cursor 同形的薄转发，供显式引用：.codex/commands/wf-*.md
- 角色薄转发：.codex/agents/*.md，行为以 .agents/roles/ 为准

Codex 会装入本技能。.codex/commands 不会被注册成斜杠命令。
