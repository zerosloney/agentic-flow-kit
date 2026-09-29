# workflow 索引 — 活跃层与档案（生成物，勿手改）

> 生成器 `node .agents/scripts/gen-workflow-index.mjs`（状态变更 / 新建文档后重跑；`--check` 校验漂移，check-loop 会告警）。
> 活跃 = draft / approved / open（在跑）；其余状态折叠进档案计数，检索用 `node .agents/scripts/kb-search.mjs "<词>"`（默认含全部状态、活跃优先排序）。
> 模块词表见 `.agents/workflow-modules.txt`。
<!-- GENERATED:BEGIN — gen-workflow-index.mjs 整段重写，手工说明写在本行之前 -->

## 活跃（27）

| 类型 | 级别 | 状态 | 日期 | 模块 | 标题 | 验收 |
|---|---|---|---|---|---|---|
| INTENT | L2 | approved | 2026-09-29 | pipeline | 装户表面收口 | ☑0/8 |
| INTENT | L1 | approved | 2026-09-29 | pipeline | 看板按完整文件名配对 | ☑0/5 |
| INTENT | L2 | approved | 2026-09-29 | pipeline | 技术栈构建门认脚本、帮助文本列全门禁 | ☑0/5 |
| PLAN | L2 | approved | 2026-09-29 | pipeline | 装户表面收口 | — |
| PLAN | L1 | approved | 2026-09-29 | pipeline | 看板按完整文件名配对 | — |
| PLAN | L2 | approved | 2026-09-29 | pipeline | 技术栈构建门认脚本、帮助文本列全门禁 | — |
| SPEC | L2 | approved | 2026-09-29 | pipeline | 装户表面收口 | — |
| SPEC | L2 | approved | 2026-09-29 | pipeline | 技术栈构建门认脚本、帮助文本列全门禁 | — |
| PLAN | L2 | approved | 2026-09-28 | pipeline | 装户侧 derivers 动态载入 | — |
| PLAN | L1 | approved | 2026-09-28 | pipeline | 结论文档断言强于实际的窄修与纪律固化 | — |
| PLAN | L2 | approved | 2026-09-28 | pipeline | 量化断言指标签名机器门 | — |
| SPEC | L2 | approved | 2026-09-28 | pipeline | 量化断言指标签名机器门（check-loop 检查 16） | — |
| INCIDENT | L1 | open | 2026-09-27 | pipeline | 2026-09-27 P2 池批二（看板/wiki/宿主维护面收口） | — |
| SPEC | L2 | approved | 2026-09-27 | pipeline | confirm-gate-one-per-call | — |
| INCIDENT | L1 | open | 2026-09-25 | pipeline | 2026-09-25 doctor owned 漂移 WARN 升级 FAIL | — |
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

## 档案计数（132，不进表）

| 类型 | 模块 | 数量 |
|---|---|---|
| INCIDENT | pipeline | 20 |
| INTENT | pipeline | 36 |
| INTENT | wiki | 1 |
| PLAN | pipeline | 53 |
| PLAN | wiki | 1 |
| SPEC | pipeline | 21 |

终态构成：done 112 · closed 12 · fixed 8；查档案用 `node .agents/scripts/kb-search.mjs "<词>" --status all`。

<!-- GENERATED:END -->
