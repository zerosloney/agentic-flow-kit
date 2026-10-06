# workflow 索引 — 活跃层与档案（生成物，勿手改）

> 生成器 `node .agents/scripts/gen-workflow-index.mjs`（状态变更 / 新建文档后重跑；`--check` 校验漂移，check-loop 会告警）。
> 活跃 = draft / approved / open（在跑）；其余状态折叠进档案计数，检索用 `node .agents/scripts/kb-search.mjs "<词>"`（默认含全部状态、活跃优先排序）。
> 模块词表见 `.agents/workflow-modules.txt`。
<!-- GENERATED:BEGIN — gen-workflow-index.mjs 整段重写，手工说明写在本行之前 -->

## 活跃（3）

| 类型 | 级别 | 状态 | 日期 | 模块 | 标题 | 验收 |
|---|---|---|---|---|---|---|
| INTENT | L2 | approved | 2026-10-06 | infra | 闭环引擎审查修复回流批次（policy v4 / 检查 18 豁免 / 装户边界标注 / pre-push 两段式） | ☑0/5 |
| PLAN | L2 | approved | 2026-10-06 | infra | 闭环引擎审查修复回流批次 | — |
| SPEC | L2 | approved | 2026-10-06 | infra | 闭环引擎审查修复回流批次 | — |

## 档案计数（236，不进表）

| 类型 | 模块 | 数量 |
|---|---|---|
| INCIDENT | pipeline | 31 |
| INTENT | infra | 2 |
| INTENT | pipeline | 60 |
| INTENT | wiki | 1 |
| PLAN | infra | 2 |
| PLAN | pipeline | 90 |
| PLAN | wiki | 1 |
| SPEC | infra | 2 |
| SPEC | pipeline | 47 |

终态构成：done 205 · closed 19 · fixed 12；查档案用 `node .agents/scripts/kb-search.mjs "<词>" --status all`。

<!-- GENERATED:END -->
