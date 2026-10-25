# workflow 索引 — 活跃层与档案（生成物，勿手改）

> 生成器 `node .agents/scripts/gen-workflow-index.mjs`（状态变更 / 新建文档后重跑；`--check` 校验漂移，check-loop 会告警）。
> 活跃 = draft / approved / open（在跑）；其余状态折叠进档案计数，检索用 `node .agents/scripts/kb-search.mjs "<词>"`（默认含全部状态、活跃优先排序）。
> 模块词表见 `.agents/workflow-modules.txt`。
<!-- GENERATED:BEGIN — gen-workflow-index.mjs 整段重写，手工说明写在本行之前 -->

## 活跃（3）

| 类型 | 级别 | 状态 | 日期 | 模块 | 标题 | 验收 |
|---|---|---|---|---|---|---|
| INTENT | L2 | approved | 2026-10-26 | infra | 关单执法点前移批（验收勾验前置门 / 放弃态配对豁免 / 装户形态测试） | ☑0/5 |
| PLAN | L2 | approved | 2026-10-26 | infra | 关单执法点前移批 | — |
| SPEC | L2 | approved | 2026-10-26 | infra | 关单执法点前移批 | — |

## 档案计数（24，不进表）

| 类型 | 模块 | 数量 |
|---|---|---|
| INCIDENT | infra | 3 |
| INTENT | infra | 5 |
| PLAN | infra | 8 |
| SPEC | infra | 8 |

终态构成：done 21 · fixed 3；查档案用 `node .agents/scripts/kb-search.mjs "<词>" --status all`。

<!-- GENERATED:END -->
