# 验证绿凭证摘要（生成物，勿手改）

> 生成器 `node .agents/scripts/gen-verify-evidence.mjs`（verify.mjs 全绿尾部自动重生成；源 .agents/verifications.jsonl 为本地台账）。
> 一行 = 验证时刻**工作树**过 verify 全量门禁全绿（短 SHA 为该时刻的**基线提交**，工作树可能含未提交改动——关单宜「先提交、后跑门」）；`套件计数` 为测试门编排器的套件 PASS/FAIL（无汇总行时缺省）；`绑定单` 为 --doc 绑定的工作流文档（不带的行不给任何单背书）。非签名链——诚实边界同 check-loop 检查 15。
> 行来源 = 本地台账绿行 ∪ 本文件既有行（**追加保全**：跨机 / 换 worktree 不失历史；代价：错行不会被重生成自动纠正，须人工改正后重跑）。

| 提交(短SHA) | 时间(UTC) | 门数 | 套件计数 | 绑定单 | runId |
|---|---|---|---|---|---|
| `8187d68` | 2026-10-23T07:35:12.219Z | 7 | PASS 79 / FAIL 0 | workflow/intents/2026-10-20-hook-esm-pin.md | — |

<!-- GENERATED:END — 共 1 行；gen-verify-evidence.mjs 生成（既有行追加保全，勿手改） -->
