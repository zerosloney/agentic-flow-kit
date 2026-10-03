# workflow 索引 — 活跃层与档案（生成物，勿手改）

> 生成器 `node .agents/scripts/gen-workflow-index.mjs`（状态变更 / 新建文档后重跑；`--check` 校验漂移，check-loop 会告警）。
> 活跃 = draft / approved / open（在跑）；其余状态折叠进档案计数，检索用 `node .agents/scripts/kb-search.mjs "<词>"`（默认含全部状态、活跃优先排序）。
> 模块词表见 `.agents/workflow-modules.txt`。
<!-- GENERATED:BEGIN — gen-workflow-index.mjs 整段重写，手工说明写在本行之前 -->

## 活跃（3）

| 类型 | 级别 | 状态 | 日期 | 模块 | 标题 | 验收 |
|---|---|---|---|---|---|---|
| INCIDENT | L2 | open | 2026-10-03 | pipeline | 2026-10-03 plan 确认节模板样板误报豁免 | — |
| PLAN | L2 | approved | 2026-10-03 | pipeline | plan-confirm-boiler（plan 确认节模板样板误报豁免） | — |
| SPEC | L2 | approved | 2026-10-03 | pipeline | plan-confirm-boiler | — |

## 档案计数（210，不进表）

| 类型 | 模块 | 数量 |
|---|---|---|
| INCIDENT | pipeline | 26 |
| INTENT | pipeline | 58 |
| INTENT | wiki | 1 |
| PLAN | pipeline | 83 |
| PLAN | wiki | 1 |
| SPEC | pipeline | 41 |

终态构成：done 184 · closed 15 · fixed 11；查档案用 `node .agents/scripts/kb-search.mjs "<词>" --status all`。

<!-- GENERATED:END -->
