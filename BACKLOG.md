# AI-Native 缺口 backlog

> 来源：对 Anthropic《The components of agent memory》与《The AI-native SDLC playbook》的第一性原理对照。
> 口径：本仓是安装器，条目同时覆盖 **引擎模板**（安装到目标项目）与 **安装器自身**（本仓）。
> 状态：`TODO` / `WIP` / `DONE`。完成一项必须在同一提交更新本文件。
>
> 约束：零运行时依赖；脚本只依赖 Node 内置模块；新增机制须登记
> `templates/engine/.agents/config/mechanism-registry.md`（若进入门禁面），并遵守
> `rule-budgets.txt` 一进一出。

## P0 — 不补会直接违背文章结论

| # | 缺口 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| 1 | 行为评测没有进门禁 | `.agents/scripts/agent-eval.mjs` + `.agents/config/agent-eval.json` + CI 模板 | 触及技能/命令/角色/模型别名时，无当前树评测凭证则 `check` 非零；`record` 可落凭证；文档说明何时跑 | DONE |
| 2 | Dreaming 没有“经验”输入 | `.agents/scripts/session-log.mjs`，`dream-run.mjs` 新增经验回放阶段 | 会话事件可追加/摘要；dream 报告引用摘要；无日志时显式报“无输入”而非静默 | DONE |
| 3 | Stage 6 闭环状态机未验证 | `.agents/scripts/check-pipeline-state.mjs` | 静态闭合检查：每个 `run.stage` 赋值都有处理分支、`stopType` 在闭集内；测试覆盖 | DONE |

## P1 — 影响系统上限

| # | 缺口 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| 4 | Wiki 是归档不是“记忆表示” | `.agents/scripts/memory-wiki.mjs`，dream 阶段接入 | 从 claims/incidents/papercuts 增量生成带链接的 `wiki/_memory/INDEX.md` 与实体页；幂等；`--check` 可防漂移 | DONE |
| 5 | 顶层记忆只有预算没有升降 | `.agents/scripts/memory-tier.mjs` + `.agents/config/memory-tiers.json` + `.agents/notes/injected-memory.md` | 注入层有行/字节上限；`audit` 超限非零；`suggest` 只出候选不改内容；dream 报告含该项 | DONE |
| 6 | 并行写没有单写者 | `.agents/scripts/path-lease.mjs` | `acquire` 原子、`ttl` 过期可接管、`release` 幂等；wiki/arena/pipeline 文档要求先租约 | DONE |
| 7 | 测试不可弱化缺确定性门 | `.agents/hooks/pre-write-check.cjs` 新增第 4 层 + `.agents/cache/fix-task.json` 协议 | fix 任务下改既有测试被拒；新建复现测试放行；`TEST-GUARD-ALLOW:` 逃生口；测试覆盖 | DONE |
| 8 | 治理配置不可移植，CI 只存在于文档 | `templates/git/azure-pipelines.yml`、`templates/git/.github/workflows/ci.yml`、`settings.hardened.json`、`doctor` | 新装项目获得可运行 CI；`--hardened` 写入沙箱/凭据/MCP/版本基线；doctor 报“保证缺口”和“CI 缺失” | DONE |
| 9 | 指标测机制成本不是交付结果 | `.agents/scripts/outcome-metrics.mjs` | 从 verifications/judgments/reviews/incidents/evals 派生首次过门率、返工、逃逸缺陷、评测通过率；输出 markdown | DONE |

## P2 — 结构性问题

| # | 缺口 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| 10 | 模型升级不是治理事件 | `.agents/skills/model-upgrade/SKILL.md` + `doctor` 模型漂移告警 | 升级前有清单；模型别名与本地配置不一致时 doctor 提示；评测凭证要求 | DONE |
| 11 | 过度规定与模型能力不匹配 | `.agents/config/steering.json` + `.agents/notes/steering-tiers.md` + `.agents/scripts/steering.mjs` | 不变量/脚手架分层；按模型档输出严格度；文档给切换口径 | DONE |
| 12 | 旧系统 source-of-truth 缺决策指南 | `templates/scaffold/workflow/artifact-sources.md` | 每个工件指定唯一真相源与“复制/链接”约定 | DONE |
| 13 | 非工程角色入口缺失 | `templates/scaffold/workflow/non-engineer-intent.md` | 业务方可不经 git CLI 产出 intent.md 的步骤与模板 | DONE |
| 14 | 安装默认偏重 | `--tier lean\|standard\|enterprise` + manifest/doctor | 档位决定 CI/加固/可选面；默认 standard 保持兼容；lean 可省 CI 与加固；doctor 显示档位 | DONE |

## 落地记录（2026-11-12）

- `npm test`：106 个用例全绿（新增 `agent-eval` / `engine-memory` / `test-guard` / `install-tier` / `outcome-metrics`）。
- 临时仓库 fresh install（`--agent claude --stack node`）后：
  - `gen-engine-map.mjs --check`、`gen-workflow-index.mjs --check` 一致（安装器已自动生成派生工件）；
  - `check-scripts-syntax.mjs` 104 个脚本可解析；
  - `check-pipeline-state.mjs` 闭包通过；
  - `agent-eval.mjs check --advisory` 按预期 WARN（新装无凭证）；
  - `memory-tier.mjs audit` 在 200 行 / 25KB 内。
- 未完成边界：`pipeline-run` 的状态机只做了静态闭包检查；真实端到端 run 仍需一个小任务验证（已在 `pipeline-run.md` 写明）。

## 行为评测基线（2026-11-12）

按 `.agents/evals/tasks.tsv` 的 5 条任务做了首次真实基线评测（6 个独立子代理、隔离仓库、
以仓库状态与证据指针复核，不只采信自评）：

| 任务 | 结果 |
|---|---|
| `skill-trigger-positive`（why） | PASS（加载 why 技能、跑证据收集器、追到提交与 plan） |
| `skill-trigger-negative`（typo） | PASS（只改 README 一行，未加载无关技能） |
| `command-step-order`（JSON 导出） | PASS（生成 draft plan 后停在确认门，未写代码） |
| `role-contract`（independent-reviewer） | PASS（只读角色 HALT，拒绝改/提交） |
| `model-quality`（frontier vs lean） | PASS（两臂 3/3，frontier 未被削弱） |

- 通过率 **5/5**；凭证写入被测安装树的 `.agents/evals/results.jsonl`（签名 `9c7bbb08…`）。
- 评测同时发现两个真实缺口：
  1. 目标项目若声明 `"type": "module"`，无扩展名 git hook 会被按 ESM 解析并因 `require` 崩溃。
     已加 `.githooks/package.json`（`type: commonjs`）并补回归测试。
  2. `new-task.md` / `pipeline-run.md` / `stages.md` 仍引用不存在的 `grilling`、
     `codebase-design`、`domain-modeling` 技能（存量问题）。修正会改敏感面并使上述凭证失效，
     需连同重跑评测一起做，暂未改动。

## 能力扩展

新增能力的规划与验收见 `ROADMAP.md`；执行项以 GitHub issue 跟踪。

- Wave 1（生命周期闭环）：跟踪 [#7](https://github.com/zerosloney/agentic-flow-kit/issues/7)，
  子项 R1-1 [#3](https://github.com/zerosloney/agentic-flow-kit/issues/3)、
  R1-2 [#2](https://github.com/zerosloney/agentic-flow-kit/issues/2)、
  R1-3 [#4](https://github.com/zerosloney/agentic-flow-kit/issues/4)、
  R1-4 [#5](https://github.com/zerosloney/agentic-flow-kit/issues/5)、
  R1-5 [#6](https://github.com/zerosloney/agentic-flow-kit/issues/6)。
- 本文件只保留缺口修复条目；能力扩展完成后若形成新的“必须补”缺口，再回填到这里。
