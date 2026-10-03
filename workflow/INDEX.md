# workflow 索引 — 活跃层与档案（生成物，勿手改）

> 生成器 `node .agents/scripts/gen-workflow-index.mjs`（状态变更 / 新建文档后重跑；`--check` 校验漂移，check-loop 会告警）。
> 活跃 = draft / approved / open（在跑）；其余状态折叠进档案计数，检索用 `node .agents/scripts/kb-search.mjs "<词>"`（默认含全部状态、活跃优先排序）。
> 模块词表见 `.agents/workflow-modules.txt`。
<!-- GENERATED:BEGIN — gen-workflow-index.mjs 整段重写，手工说明写在本行之前 -->

## 活跃（7）

| 类型 | 级别 | 状态 | 日期 | 模块 | 标题 | 验收 |
|---|---|---|---|---|---|---|
| INCIDENT | L1 | open | 2026-10-03 | pipeline | 2026-10-03 P2 池批三（pipeline-run 二轮复核 P2×3 收尾） | — |
| INTENT | L2 | approved | 2026-10-03 | pipeline | check-evidence-process | ☑0/5 |
| PLAN | L2 | approved | 2026-10-03 | pipeline | check-evidence-process | — |
| PLAN | L1 | approved | 2026-10-03 | pipeline | p2-pool-batch3 | — |
| SPEC | L2 | approved | 2026-10-03 | pipeline | check-evidence-process | — |
| INCIDENT | L1 | open | 2026-09-27 | pipeline | 2026-09-27 P2 池批二（看板/wiki/宿主维护面收口） | — |
| INCIDENT | L1 | open | 2026-09-25 | pipeline | 2026-09-25 doctor owned 漂移 WARN 升级 FAIL | — |

## 档案计数（201，不进表）

| 类型 | 模块 | 数量 |
|---|---|---|
| INCIDENT | pipeline | 22 |
| INTENT | pipeline | 57 |
| INTENT | wiki | 1 |
| PLAN | pipeline | 80 |
| PLAN | wiki | 1 |
| SPEC | pipeline | 40 |

终态构成：done 179 · closed 14 · fixed 8；查档案用 `node .agents/scripts/kb-search.mjs "<词>" --status all`。

<!-- GENERATED:END -->
