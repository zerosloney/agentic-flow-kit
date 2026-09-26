# 命令/技能 Papercut 留痕

> `.agents/commands/`、`.agents/roles/` 或已装技能在真实任务中卡住、误导、缺步骤时记一行，**不当场顺手改**。
> 同一文件命中第 2 次或用户点名时，升级为 docs 修复 commit。

| 日期 | 位置 | 症状 | 拟修 |
|------|------|------|------|
| 2026-09-26 | src/sync.mjs（台账外 managed 文件的收养分支） | 本条仓库 15 份 managed 文件（gate-checklist / source-sync-check / sync-hosts / fill-{intent,plan,spec} / pipeline-closing / source-sync-repair 等）在盘上存在但从未登记进 `.agents/kit.json`——它们是手动双写（同提交 `.agents/` 与 `templates/_agents/` 成对）带进来的，绕过了 init/sync 登记。sync 走到 `fs.existsSync(disk) && !force` 分支即跳过（报「已存在未入台账」），故**包源改了装副本不跟上**（临时克隆实证：改包源 sha 后 sync，装副本 sha 纹丝不动）。三道防线均漏：doctor 只遍历台账条目双向比对，无「台账覆盖率」检查；source-sync-check 比实际内容（当前同源全绿）且为手动工具未接门禁；pre-commit / check-loop / gate-checklist 均未引用它。当前无实际损害（内容全对齐），但改这些活跃核心件会静默落后 | sync.mjs 对「未入台账且磁盘内容 == 新版渲染 sha」的文件走收养分支（与既有台账自愈分支同一判据，逻辑安全）；doctor 增「台账覆盖率」检查（盘上 managed 类文件 vs 台账条目）；评估把 source-sync-check 接进 pre-commit。L2 契约变更，须先立 incident 走 templates/ → sync 双源流程。**已修（2026-09-26 managed-ledger-adopt）**：src/sync.mjs 收养分支 + src/doctor.mjs §4.5 台账覆盖率检查 → 本仓 15 份已收养（台账 62→77）；见 workflow/incidents/2026-09-26-managed-ledger-adopt.md |
| 2026-09-23 | workflow/specs/_TEMPLATE.md「约束遵守映射」表 | 表内行是 Shipyard 项目特定红线（Application 禁引 Infrastructure / Drawer / a-select 等），通用包装户（非 dotnet+前端项目）对着表无从下笔，只能整表改写 | 红线表改为通用行 +「按项目 AGENTS.md 红线填」指引；模板属包源，修复走 templates/ → sync |
