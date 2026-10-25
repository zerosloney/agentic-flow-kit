# 发布观察台账（24h 观察结论）

> deploy.md §6 的上线后观察结论落账处：一行 = 一次 release 的 24h 观察结论。上线了却长期无行 = 观察结论未落账的挂债形态（机制先于数据建账，零数据也可见）。
> 记法：结果列枚举 `通过` / `异常`（枚举外脏行会让 metrics 生成器 fail-loud）；异常行必须在 incident 列关联 `workflow/incidents/` 文件名，通过行写 `-`；确认方式摘要（如「用户对话内确认」「监控面板 24h 无告警」）。
> **生而分片（2026-10-25 source-port-batch，自源仓优化5 回灌）**：数据行按月存 `workflow/deploy-observations.d/<YYYY-MM>.md`（本文件只留说明与表头，无存量迁移）。追加一行用 `node .agents/scripts/ledger-shards.mjs --append deploy-observations --row "| YYYY-MM-DD | release/<日期> | 通过\|异常 | <incident 文件名或 -> | <确认方式摘要> |"`；读侧自动合并主台账 ∪ 全部分片（`gen-workflow-metrics.mjs`「发布观察」节月度聚合）。

| 日期 | release | 结果 | incident | 确认方式 |
|------|---------|------|----------|----------|
