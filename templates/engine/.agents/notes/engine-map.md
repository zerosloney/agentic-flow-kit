# 引擎地图（生成物，勿手改）

> 生成器 `flow-kit run gen-engine-map.mjs`（单源现场取数；`--check` 防漂移——改引擎后重生成随同提交）。
> 一页冷启动地图：接手会话/新协作者读本页替代全仓考古；明细按 §维护 的单源指针下钻。

## 执行模型（一段）

本引擎无常驻进程：**文档即状态机**（`workflow/` 四目录，frontmatter `状态: draft→approved→done` 由 confirm-doc 迁移）+ **git 钩子即执法点** + **脚本即确定性验证器** + **AI 即执行体**（读命令/技能/角色契约行动）。质量分工：确定性脚本管事实（确认过没有/验证过没有/红线判低），模型管判断（定级/根因/设计/复核）。

## 执法卡口

git 钩子 0 个：

| 钩子 | 跑什么 |
|---|---|
| CI（azure-pipelines） | （未找到 azure-pipelines.yml——CI 触发面未知） |

## verify 门表（17 门，单源 verify.mjs GATES；--scope 按 diff 面裁剪）

`scripts-syntax` · `workflows-check` · `rule-budget` · `local-gate-config` · `engine-artifacts` · `check-loop` · `ledger-doc-presence` · `ledger-invariant` · `lane-surface-ci` · `secrets-scan` · `sbom-license` · `devcontainer` · `code-architecture` · `code-audit-fields` · `code-delete-guard` · `wiki-consistency` · `node-test`

## 机制台账状态（38 行，单源 mechanism-registry.md）

现役 38 / 已退役 0 / 待退役 0

owner-fiat 复评挂号称 4（复评到期逐条列出，交人工月判）：三件套同名配对(2027-01-21)、密钥扫描门（gitleaks）(2027-01-21)、委托引文接地(2027-01-22)、提交信息卫生检出（ci-commit-hygiene）(2027-02-05)

## 模型侧载体

- **命令** 7 篇（.agents/commands/，常驻指令面）：deploy.md、maintain.md、new-task.md、pipeline-run.md、pr-review.md、review.md、stages.md
- **技能** 26 个（.agents/skills/，按需加载）：arena、autonomous-run、blast-radius、codebase-design、dev-tour、domain-modeling、dream、eval、formal-verify、grilling、interrogate、model-upgrade、number-vetting、papercut-fix、pause-safely、perf、review-method、session-resume、show-me-your-work、tfs-pr、verify-ui、visual-parity、wayfinder、why、wiki、workflow-closeout
- **角色** 8 个（.agents/roles/，子代理契约）：implementer、independent-reviewer、pr-adjudicator、pr-finder、pr-verifier、test-designer、ui-verifier、wiki-compiler

## 数据与台账面

| 台账 | 用途 |
|---|---|
| `.agents/verifications.jsonl` | verify 绿凭证（钉 headShort + 24h 窗；--scope 行带面与基线） |
| `.agents/judgments.jsonl` | check-loop 每次运行 per-rule WARN/BLOCK 落账（agg-judgments 供数） |
| `.agents/usage.jsonl` | 角色 / 模型调用凭据（usage-log 写入，observability 供数；本机） |
| `.agents/cache/pipeline-runs/*.json` | pipeline-run 事件流（按 run 的耗时与停止类型；本机） |
| `.agents/confirmations.jsonl` + `confirmations.d/` | 确认链（append-only，指纹 sha256，提交时刻增量执法） |
| `.agents/trust-mode-audit.jsonl` | 自治授权升降级（prev-sha256 链；trust-mode 升降级时按需生成，新克隆暂缺） |
| `workflow/reviews.d/` | 复核事件级台账（采纳/拒绝/误报） |
| `workflow/papercuts.d/` | 摩擦与消债台账 |
| `workflow/delegations.md` | 委派/自做结果 + 月度聚合快照（扩容门供数） |
| `workflow/metrics.md` | 月度指标（incident/门禁成本/复核效果——GENERATED 区） |

## 维护

- 改任何单源（钩子/GATES/SECTIONS/台账/目录）后：`flow-kit run gen-engine-map.mjs` 重生成随同提交；CI/hygiene 可跑 `--check` 防漂移。
- 环境事实单源 `.agents/notes/runtime-env.md` §6；机制明细与退役阈值单源 `.agents/config/mechanism-registry.md`；门禁成本 `workflow/metrics.md`。
