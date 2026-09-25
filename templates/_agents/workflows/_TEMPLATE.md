# Workflow 编排 — 声明格式与会话内执行契约

> 把多个子智能体派单编成一份可审查的 workflow 声明：并行 fan-out（`after` 依赖分层）、阶段门禁（`gate`）、失败重试（`retries`），由**主智能体在宿主会话内**经原生子智能体执行（`.agents/commands/orchestrate.md`），执行留痕写 `workflow/delegations.md`。

## 纪律（先读）

- **声明随 plan 确认后方可执行**：workflow 声明是 plan 任务拆解的执行器，随 plan 草稿一并全文过目；确认前只可走查校验、不得派单。
- 编排不跨确认门；子智能体不 commit / push（提交由主智能体复核后执行）。
- 声明式是跨宿主（zcode / opencode / trae / omp）诚实边界——主智能体解释执行任意脚本不可靠；宿主有原生脚本编排（如 ZCode dynamic workflows）且需真控制流时直接用宿主能力。

## 声明格式（`.agents/workflows/<主题>.md`）

frontmatter + 一张 stages 表：

```md
---
name: 并行修两域
description: 后端+前端并行实现 → 汇聚过测试 → 独立评审
concurrency: 2
---
# workflow — 并行修两域

| id | after | role | task | files（授权） | accept（验收判据） | gate | retries |
|----|-------|------|------|--------------|-------------------|------|---------|
| backend | — | implementer | 实现后端 X | src/api/** | 项目测试过 | | 0 |
| frontend | — | implementer | 改前端 Y | web/** | 构建过 | | 1 |
| gate-all | backend,frontend | — | — | — | — | npm test | |
| review | gate-all | independent-reviewer | 评审两域改动 | | 符合 plan 与判据 | | 0 |
```

字段语义：

- `after`：依赖的 stage id（逗号分隔；`—` 或空 = 第 0 层，同层并行）；**gate 行**（role 空、gate 非空）在该行依赖全 ok 后由主智能体跑命令，非零中止。
- `role`：必须 ∈ `.agents/roles/` 现有角色（implementer / independent-reviewer / ui-verifier 或项目自扩）。
- `files`：授权文件清单（glob 可）；留空 = 只读侦察任务。
- `accept`：验收判据，写进派单头；`retries`：失败重派上限（默认 0，重派 = 全新派单）。
- `concurrency`：层内并行派单上限（默认 2）。

## 执行方式

主智能体按 `.agents/commands/orchestrate.md` 执行：解析校验 → 分层 → 层内**原生子智能体**并行派单（zcode = Agent 工具 / opencode = agents；trae / omp 顺序自做，验收不变）→ 收敛复核 → gate → 留痕 → 汇总。派单 prompt 由角色契约 + 派单头 + 红线行组装，与各阶段命令的委派口径一致。
