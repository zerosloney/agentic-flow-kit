# Workflow 编排机制 — 编排脚本 + steps 扩展点

> kit 的跨宿主编排机制：`.agents/workflows/` 下的编排脚本承载编排语义（依赖分层 / 并行 / 重试 / gate），**宿主 AI 经 AGENTS.md 常驻指令自动加载并按语义执行**——有子智能体的宿主并行 fan-out，没有的顺序自做，验收不变。零宿主协议适配：机制只依赖所有宿主共有的四样本领（读 AGENTS.md、读仓库文件、跑终端命令、子智能体）。

## 自动加载（AGENTS.md 常驻指令）

> 多工作包编排——用户要跑编排、或 plan 执行多工作包时：读 `.agents/workflows/` 编排脚本按本文档语义执行；自定义步骤在 `steps/`。

## 编排脚本（`.agents/workflows/<主题>.md`）

frontmatter（`name` / `description` / `concurrency` 默认 2）+ 一张 stages 表：

```md
---
name: 并行修两域
description: 后端+前端并行实现 → 汇聚过测试 → 部署验证（step）→ 独立评审
concurrency: 2
---
| id | after | role | step | task / params | files（授权） | accept（验收判据） | gate | retries |
|----|-------|------|------|---------------|--------------|-------------------|------|---------|
| backend | — | implementer | — | 实现后端 X | src/api/** | 项目测试过 | | 1 |
| frontend | — | implementer | — | 改前端 Y | web/** | 构建过 | | 0 |
| gate-all | backend,frontend | — | — | — | — | — | npm test | |
| deploy-check | gate-all | — | 部署验证 | env=staging | | 部署命令 exit 0 | | 0 |
| review | deploy-check | independent-reviewer | — | 评审两域改动 | | 符合 plan 与判据 | | 0 |
```

**stage 三形态**（互斥）：

| 形态 | 判据 | 执行 |
|------|------|------|
| role 派单行 | `role` 非空 | 派子智能体（`task` 目标 / `files` 授权清单 / `accept` 验收判据写进派单头 + 红线行） |
| step 行 | `step` 非空 | 宿主 AI 读 `steps/<step>.md` 按指引执行，`task / params` 列传参 |
| gate 行 | `gate` 非空（role/step 空） | 终端跑命令，非零即中止 |

**编排语义**（执行口径，全宿主同一）：`after` 空 = 第 0 层；一层全 ok 才派依赖它的下一层；层内按 `concurrency` 分批——有子智能体的宿主并行 fan-out，没有的顺序自做（验收标准不变）；失败且 `retries` > 0 → 重派（全新上下文）；重试超限 / gate 非零 → 中止后续、汇总报告失败项。

## steps 扩展点（`.agents/workflows/steps/<名>.md`）

kit 定义的扩展机制：文件名即步骤名（steps 目录即注册表），项目把自己的领域动作（部署 / 迁移 / 审计上报…）注册进来，编排脚本 step 行引用即用。

```md
---
params: env（目标环境）；timeout-min（可选，默认 10）
---
# 步骤 — 部署验证

1. 跑终端命令：`npm run deploy -- --env <env>`，非零即步骤失败并回报 stderr 尾段
2. 跑冒烟检查：`curl -fsS https://<env>.example.com/healthz`
3. 回报：部署版本号 + 冒烟结果
```

- frontmatter `params`：参数约定（自由文本列明名称与含义）；调用方在编排脚本 `task / params` 列传参（`k=v`，空格分隔多个）。
- 正文：执行指引（编号步骤）——可指使命令、子智能体、检查动作；步骤失败按编排脚本行 `retries` 重试。

## 纪律（先读）

- **声明随 plan 确认后方可执行**：编排脚本是 plan 任务拆解的执行器，随 plan 草稿一并全文过目。
- 子智能体不跨确认门、不 commit / push（派单红线行：只改授权文件；缺输入或需偏离 → `BLOCKER:` 停下）。
- 收敛复核：派单返回后核对 diff 与授权文件范围（与 build.md 委派约定同口径）；BLOCKER 停住待处置。
- 留痕：每个派单 / step stage 完成后向 `workflow/delegations.md` 委派结果表追加一行（`一次通过` / `返工×N` / `返工待修`，口径与 agg-delegations.cjs 对齐）。
- 解析校验先行：role ∈ `.agents/roles/`、step ∈ `steps/`、after 引用存在且无环——任一不过即拒，不执行。
