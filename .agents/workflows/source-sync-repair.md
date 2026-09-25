---
name: source-sync-repair
description: 装户面双源漂移修复专项——跑 source-sync-check 看 4 类差异（缺失 / 孤儿 / 漂移 / frontmatter-only-diff）→ 按 B-b 决策方向修齐（包源 → 装副本同步）→ 重跑确认 0 差异 → 走 pipeline-closing 标准关单。基于 F 环节真实过程沉淀
concurrency: 2
---
# workflow — source-sync-repair（装户面双源漂移修复）

> 双源结构（`templates/_agents/` 包源 + `.agents/` 装副本）的差异修复。F 环节（2026-09-25-fix-double-source-drift）首次实测发现 5 个真实差异并闭环，本文件（custom）把修复路径固化为可复用编排。所有 stage 用 role 派单 + gate 终端两种形态——不引新 step。

| id | after | role | step | task / params | files（授权） | accept（验收判据） | gate | retries |
|----|-------|------|------|---------------|---------------|-------------------|------|---------|
| scan-diff | — | implementer | — | 跑 source-sync-check --diff（首次摸底） | .agents/scripts/source-sync-check.mjs | 输出 4 类差异报告（缺失 / 孤儿 / 漂移 / frontmatter-only-diff），无 error | | 0 |
| classify | scan-diff | implementer | — | 按差异类型分类：缺失/漂移走 repair；孤儿走白名单扩展或装副本删除；frontmatter-only-diff 走角色契约确认 | workflow/intents/<date>-fix-double-source-drift.md | intent 立 draft + 4 段改动面（漂移修复 / 白名单 / 测试 / docs）+ 9 条验收标准 | | 0 |
| repair | classify | implementer | — | 按 intent 改动面修漂移：包源 → 装副本同步；白名单 RENDER_OUTPUT_FILES 扩展（含 hooks/commit-check.config.json 等 init 渲染产物）；test.mjs 新增 S8/S9 场景；双源纪律（包源改了装副本手动同步） | 见 intent | source-sync-check --diff 报告漂移数减少；双源文件 sha 一致 | | 1 |
| gate-rescan | repair | — | — | — | — | — | node .agents/scripts/source-sync-check.mjs --diff（必须 0 差异） |  |
| sync-refresh | gate-rescan | implementer | — | 跑 flow-kit sync 刷台账（owned 哈希按盘面自愈） | .agents/kit.json | sync exit 0；doctor 报 owned 漂移已自愈 | | 0 |
| feat-commit | sync-refresh | implementer | — | 提交 feat commit（fix(模块名)） | 工作区所有变更文件 | pre-commit 钩子全过；commit message 含 4 段改动面 + 白名单扩展 | | 0 |
| closeout | feat-commit | implementer | — | 走 pipeline-closing 标准关单（intent 8 条验收勾验 + plan → done + docs commit）；如有需要新建 wiki/双源漂移修复/README.md 沉淀 | workflow/intents/, workflow/plans/, workflow/INDEX.md, wiki/双源漂移修复/README.md | intent + plan 状态均 done；9 条验收勾验含 commit SHA 证据；wiki 主题更新（如适用） | | 0 |

**编排语义**：第 0 层 scan-diff → 第 1 层 classify（差异分诊）→ 第 2 层 repair（按分诊结果修漂移）→ 第 3 层 2 关静态门（gate-rescan + sync-refresh，并行 fan-out）→ 第 4 层 feat-commit → 第 5 层 closeout（复用 pipeline-closing 6 阶段闭环尾段）。失败且 retries > 0 → 重派（全新上下文）；gate-rescan 非零 → 中止后续、回到 repair 重派。

**与 pipeline-closing 的关系**：source-sync-repair 是 pipeline-closing 的子集（第 3-6 层复用），不重复定义 6 阶段全流程；closeout stage 引用 pipeline-closing 的关单动作。如需完整 6 阶段闭环（含 author / gate-doc / confirm / plan-commit），直接用 pipeline-closing 即可。

**白名单扩展协议**（沿用 source-sync-check.mjs 的 RENDER_OUTPUT_FILES）：init 渲染产物（`kit.json` / `settings.json` / `hooks/commit-check.config.json`）不属双源结构；新增白名单项必须同时加进 source-sync-check.mjs + test.mjs 新场景，且 gate-rescan 跑通 0 命中才认闭环。

**纪律**（先读）：
- 声明随 plan 确认后方可执行；本 workflow 修复必须先立 intent + plan（用 pipeline-closing 的 author stage 起草）。
- 子智能体不跨确认门、不 commit / push（派单红线行：只改授权文件；缺输入或需偏离 → `BLOCKER:` 停下）。
- 留痕：每个派单 stage 完成后向 `workflow/delegations.md` 委派结果表追加一行。
- 解析校验先行：role ∈ `.agents/roles/`、`after` 引用存在且无环——任一不过即拒，不执行。