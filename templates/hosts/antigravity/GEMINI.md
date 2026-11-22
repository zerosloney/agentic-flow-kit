<!-- 本文件为根 AGENTS.md 在 Antigravity CLI (AGY) 宿主的记忆入口。
     权威源仍为 AGENTS.md；AGENTS.md 更新后本文件保持指针语义。 -->

# Repository Guidelines (Antigravity CLI)

项目记忆入口。单事实源：项目根 `AGENTS.md`（执行任何任务前完整阅读）。

## 1. 运行时与门禁
- 克隆后自检：`flow-kit run check-local-gates.mjs --fix`
- **禁令**：commit / merge / push 一律禁止 `--no-verify`。

## 2. 全局红线 (Universal Laws)
- **安全/隐私**：不提交密钥、令牌、`.env` 或真实用户数据。
- **不可逆操作**：生产部署、远程推送、数据删除等操作必须用户明确要求。
- **最小改动**：优先做满足需求的最小改动，禁止顺手重构无关代码或修改格式。

## 3. 阶段路由与技能
- **极简道 (L0) / 快速道 (L1)**：`.agents/commands/new-task.md`
- **阶段流 (L2/L3)**：`.agents/commands/stages.md`
- **修复 / 维护**：`.agents/commands/maintain.md`
- **合入评审**：`.agents/commands/review.md`
- **可用技能索引**：`.agents/skills/`（Antigravity CLI 原生发现并按需加载）

## 4. 边界与单源
- 权威命令与角色约定位于 `.agents/commands/` 与 `.agents/roles/`。
- 宿主私有目录为 `.gemini/`。
