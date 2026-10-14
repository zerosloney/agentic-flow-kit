# 命令/技能 Papercut 留痕

> `.agents/commands/`、`.agents/roles/` 或已装技能在真实任务中卡住、误导、缺步骤时记一行，**不当场顺手改**。
> 同一文件命中第 2 次或用户点名时，升级为 docs 修复 commit。
> **分片（2026-10-13 ledger-shard-ledgers）**：数据行按月存 `workflow/papercuts.d/<YYYY-MM>.md`（本文件只留说明与表头）。追加一行用 `node .agents/scripts/ledger-shards.mjs --append papercuts --row "<行>"`（缺省按行内日期定月，`--month` 可覆盖）；读侧（`papercut-debt-sensor.mjs` 等）自动合并主台账 ∪ 全部分片，无需改动。手工编辑分片亦可，但须自带表头。
> **存量债回路**：未升级条目累积 = 存量债，清理跑 papercut 回路（传感器测 debt → 控制器选目标 → `papercut-fix` 技能执行），口径单源 `.agents/loop/papercut-debt/DESIGN.md`。

| 日期 | 位置 | 症状 | 拟修 |
|------|------|------|------|
