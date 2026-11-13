---
description: PR 面板评审——多子代理找 bug + 独立投票 + 台账
stage: review（横切）
triggers:
  - "评审这个 PR"
  - "跑 PR 面板评审"
  - "pr-review"
---

# PR Review · 面板评审

## 触发规则

满足任一条，跑面板评审；均不满足，走 `.agents/commands/review.md` 分级评审，禁跑面板：
- diff 触及信任边界 / 数据面 / 公共契约
- 合 main 前
- 疑难回归需多镜头交叉验证

## 流程

脚本：`flow-kit run pr-review`（子命令细节 `--help`）。按序执行，禁跳步：

1. `plan --base <ref> --head <ref>`；高风险快检加 `--fast`（单镜头档）。现场落 `.agents/tmp/pr-review/<runId>/`（run.json / briefs / tasks.json）
2. 按 `tasks.json` 并行派 finder / verifier 子代理；角色契约见 `.agents/roles/pr-finder.md`、`pr-verifier.md`、`pr-adjudicator.md`
3. 依序执行：`collect` → `verify` → `adjudicate`（escalated 项）→ `dispose` → `summary`

## 落账

- 台账 artifact + 月度一行写 `workflow/reviews.d/`（append-only）。
- 已跑评审的 PR，在 PR Evidence 追加一行：`面板评审：<runId>（Important n / Nit n / Pre-existing n）`。
