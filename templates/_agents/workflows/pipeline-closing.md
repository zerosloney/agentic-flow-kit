---
name: pipeline-closing
description: 推广环节 6 阶段闭环——起草 intent + plan（双写）→ 用户对话内确认 → 按 plan 改动面实施 → 3 关静态门（source-sync-check / npm test / doctor）→ 关单留痕（intent + plan → done + docs commit）。可复用于本项目所有 L1 推广环节（新增工具 / 微改动 / 协议修补）
concurrency: 2
---
# workflow — pipeline-closing（推广环节 6 阶段闭环）

> 把 5 个已闭环推广环节（E/A/D/C/F/B）的标准节奏固化为可复用编排。所有 stage 用 role 派单 + gate 终端两种形态——不引新 step（`_TEMPLATE.md` 解析校验要求 `step ∈ steps/`，新增 step 留给后续项目注册）。

| id | after | role | step | task / params | files（授权） | accept（验收判据） | gate | retries |
|----|-------|------|------|---------------|--------------|-------------------|------|---------|
| author | — | implementer | — | 起草 intent + plan（双写 fill-{intent,plan}.mjs 生成草稿 + AI 填实），状态 draft | workflow/intents/<date>-<topic>.md, workflow/plans/<date>-<topic>.md | intent frontmatter 5 字段齐 + 状态 draft + 验收标准 ≥ 5 条；plan L1 极简 2 节齐 | | 1 |
| gate-doc | author | — | — | — | — | — | node .agents/scripts/fill-intent.test.mjs && node .agents/scripts/fill-plan.test.mjs |  |
| confirm | gate-doc | implementer | — | 用户对话内一句"可以"+ plan 状态 draft → approved + 回填「确认与复核」节 | workflow/plans/<date>-<topic>.md | plan 状态 approved + 「确认结果：approved（YYYY-MM-DD 用户对话内确认）」 | | 0 |
| plan-commit | confirm | implementer | — | 提交 plan 立项 commit（docs(workflow)） | workflow/intents/, workflow/plans/, workflow/INDEX.md | pre-commit 钩子全过；commit message 含 plan 改动面摘要 | | 0 |
| build | plan-commit | implementer | — | 按 plan §改动面 执行（含双源纪律：包源改了装副本手动同步） | 见 plan | plan 改动面全部完成；双源文件 sha 一致 | | 1 |
| gate-sync | build | — | — | — | — | — | node .agents/scripts/source-sync-check.mjs --diff（必须 0 差异） |  |
| gate-test | build | — | — | — | — | — | npm test（必须全绿） |  |
| gate-doctor | build | — | — | — | — | — | node bin/flow-kit.mjs doctor（必须 0 FAIL） |  |
| feat-commit | gate-sync,gate-test,gate-doctor | implementer | — | 提交 feat commit（feat(模块名)） | 工作区所有变更文件 | pre-commit 钩子全过；commit message 含 build 改动面摘要 | | 0 |
| closeout | feat-commit | implementer | — | 补 intent 8 条验收勾验 + plan → done + 关单 docs commit 留痕；同步 INDEX.md（如适用） | workflow/intents/<date>-<topic>.md, workflow/plans/<date>-<topic>.md, workflow/INDEX.md | intent + plan 状态均 done；8 条验收勾验含 commit SHA 证据；commit message 含关单 commit + 8 条勾验摘要 | | 0 |

**编排语义**：第 0 层 author → 第 1 层 gate-doc + confirm（confirm 是用户对话门，宿主 AI 停下询问）→ 第 2 层 plan-commit → 第 3 层 build → 第 4 层 3 关静态门（并行 fan-out）→ 第 5 层 feat-commit → 第 6 层 closeout。失败且 retries > 0 → 重派（全新上下文）；gate 非零 → 中止后续、汇总报告失败项。

**纪律**（先读）：
- 声明随 plan 确认后方可执行——本 workflow 是 plan 任务拆解的执行器；plan 草稿先经用户对话内确认。
- 子智能体不跨确认门、不 commit / push（派单红线行：只改授权文件；缺输入或需偏离 → `BLOCKER:` 停下）。
- 留痕：每个派单 stage 完成后向 `workflow/delegations.md` 委派结果表追加一行（`一次通过` / `返工×N` / `返工待修`）。
- 解析校验先行：role ∈ `.agents/roles/`、`after` 引用存在且无环——任一不过即拒，不执行。