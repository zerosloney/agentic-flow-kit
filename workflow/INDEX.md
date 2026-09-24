# workflow 索引 — 活跃层与档案（生成物，勿手改）

> 生成器 `node .agents/scripts/gen-workflow-index.mjs`（状态变更 / 新建文档后重跑；`--check` 校验漂移，check-loop 会告警）。
> 活跃 = draft / approved / open（在跑）；其余状态折叠进档案计数，检索用 `node .agents/scripts/kb-search.mjs "<词>"`（默认含全部状态、活跃优先排序）。
> 模块词表见 `.agents/workflow-modules.txt`。
<!-- GENERATED:BEGIN — gen-workflow-index.mjs 整段重写，手工说明写在本行之前 -->

## 活跃（12）

| 类型 | 级别 | 状态 | 日期 | 模块 | 标题 | 验收 |
|---|---|---|---|---|---|---|
| INTENT | L1 | approved | 2026-09-24 | pipeline | Shipyard 引擎增量收包（抽取后 3 笔回流包源） | ☑5/5 |
| PLAN | L1 | approved | 2026-09-24 | pipeline | Shipyard 引擎增量收包 | — |
| INTENT | L1 | approved | 2026-09-23 | pipeline | agentic-flow-kit：AI 工作流+wiki 引擎抽离为 npx 脚手架包（flow-kit init） | ☑0/6 |
| INTENT | L1 | approved | 2026-09-23 | pipeline | M3：flow-kit sync / add-host / add-gate | ☑5/5 |
| INTENT | L2 | approved | 2026-09-23 | pipeline | M4：agentic-flow-kit 自装 dogfooding（包仓库成为包消费者） | ☑5/5 |
| INTENT | L1 | approved | 2026-09-23 | pipeline | M5：npm 发布（v0.2.0 首发） | ☑4/5 |
| PLAN | L1 | approved | 2026-09-23 | pipeline | agentic-flow-kit M1+M2 | — |
| PLAN | L1 | approved | 2026-09-23 | pipeline | CJS 扩展名消歧（.js → .cjs） | — |
| PLAN | L1 | approved | 2026-09-23 | pipeline | M3：sync / add-host / add-gate | — |
| PLAN | L2 | approved | 2026-09-23 | pipeline | M4：自装 dogfooding | — |
| PLAN | L1 | approved | 2026-09-23 | pipeline | M5：npm 发布 | — |
| SPEC | L2 | approved | 2026-09-23 | pipeline | M4 自装 dogfooding | — |

## 档案计数（9，不进表）

| 类型 | 模块 | 数量 |
|---|---|---|
| INCIDENT | pipeline | 4 |
| INTENT | pipeline | 1 |
| PLAN | pipeline | 4 |

终态构成：done 5 · fixed 3 · closed 1；查档案用 `node .agents/scripts/kb-search.mjs "<词>" --status all`。

<!-- GENERATED:END -->
