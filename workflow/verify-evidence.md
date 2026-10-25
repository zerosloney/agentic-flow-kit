# 验证绿凭证摘要（生成物，勿手改）

> 生成器 `node .agents/scripts/gen-verify-evidence.mjs`（verify.mjs 全绿尾部自动重生成；源 .agents/verifications.jsonl 为本地台账）。
> 一行 = 验证时刻**工作树**过 verify 全量门禁全绿（短 SHA 为该时刻的**基线提交**，工作树可能含未提交改动——关单宜「先提交、后跑门」）；`套件计数` 为测试门编排器的套件 PASS/FAIL（无汇总行时缺省）；`绑定单` 为 --doc 绑定的工作流文档（不带的行不给任何单背书）。非签名链——诚实边界同 check-loop 检查 15。
> 行来源 = 本地台账绿行 ∪ 本文件既有行（**追加保全**：跨机 / 换 worktree 不失历史；代价：错行不会被重生成自动纠正，须人工改正后重跑）。

| 提交(短SHA) | 时间(UTC) | 门数 | 套件计数 | 绑定单 | runId |
|---|---|---|---|---|---|
| `8187d68` | 2026-10-23T07:35:12.219Z | 7 | PASS 79 / FAIL 0 | workflow/intents/2026-10-20-hook-esm-pin.md | — |
| `bd63a44` | 2026-10-23T12:44:18.993Z | 7 | PASS 79 / FAIL 0 | workflow/intents/2026-10-20-bootstrap-followups.md | — |
| `9ba0b79` | 2026-10-23T12:56:33.765Z | 7 | PASS 79 / FAIL 0 | workflow/intents/2026-10-20-agg-cause-lineage.md | — |
| `5637482` | 2026-10-25T07:26:51.288Z | 8 | PASS 81 / FAIL 0 | workflow/plans/2026-10-25-source-port-batch.md | — |
| `4a2eac5` | 2026-10-25T09:27:50.454Z | 8 | PASS 82 / FAIL 0 | workflow/plans/2026-10-25-source-port-batch-2.md | — |
| `6f97f76` | 2026-10-25T10:51:53.356Z | 8 | PASS 82 / FAIL 0 | workflow/incidents/2026-10-25-append-compensation-shard.md | — |
| `48babc4` | 2026-10-25T11:02:24.567Z | 8 | PASS 82 / FAIL 0 | workflow/incidents/2026-10-25-ci-env-leak.md | — |
| `4ce4862` | 2026-10-25T17:12:39.063Z | 8 | PASS 82 / FAIL 0 | workflow/incidents/2026-10-25-audit-fixes.md | — |
| `89cbc95` | 2026-10-25T17:18:49.584Z | 8 | PASS 82 / FAIL 0 | workflow/incidents/2026-10-25-audit-fixes.md | — |

<!-- GENERATED:END — 共 9 行；gen-verify-evidence.mjs 生成（既有行追加保全，勿手改） -->
