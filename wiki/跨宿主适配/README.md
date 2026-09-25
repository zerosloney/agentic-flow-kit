# 跨宿主适配（cross-host-sync）

> 跨宿主适配层同步工具 `flow-kit sync-hosts` + doctor §6.7 漂移检查——让 4 宿主（`.zcode` / `.omp` / `.opencode` / `.trae`）薄适配与权威源保持一致。

## 主题说明

- **问题**：4 宿主编排脚本各自读自己的 `.agents/commands/` 与 `.agents/roles/`，但工程真相源在 `templates/_agents/`；薄适配（`modules/hosts/<h>/{agents,commands}/*.md`）一旦手改或权威源改后未跟，就会出现 4 宿主行为漂移
- **方案**：薄适配 = 权威源正文 + 宿主特化 frontmatter；`flow-kit sync-hosts --diff` 按正文段 sha 比对（剥离 frontmatter）；`--apply` 单向覆盖正文、不动 frontmatter
- **覆盖**：28 份薄适配（4 宿主 × 3 roles + 8 commands × 2 宿主 `opencode` / `trae`）

## 关键决策点

- **B-b 方案**（用户 2026-09-25 拍板）：薄适配正文 = 权威源正文 + frontmatter 保留宿主特化字段；不反向同步（防宿主特化污染权威源）
- **正文段 sha 比对**：工具按"剥离 frontmatter 后的正文"计算 sha（而非整文件），frontmatter 漂移不计入报告
- **trae commands 加 `name: wf-X` 前缀**：`wf-new-task` / `wf-plan` / `wf-design` / `wf-build` / `wf-test` / `wf-deploy` / `wf-maintain` / `wf-review`；HOST_DIR 4 宿主 `.zcode` / `.omp` / `.opencode` / `.trae`
- **doctor §6.7 包源环境自动 skipped**：检测 `templates/_agents + modules/hosts` 同时存在时跳过（薄适配同步只在装户环境有意义）
- **B-b 决策「只报告不修复」**：sync-hosts 是工具不是自动同步；doctor §6.7 只报 WARN 不升 hard-block（首次引入按 2026-09-25 user 拍板决策 3）

## 复盘

- **commit 链**：`7313436` plan → `95c2a13` feat（47 文件 / 2214 行）→ `80317aa` 关单
- **套件**：4 套件 113/113 PASS（含 `src/sync-hosts.test.mjs` 26 场景）
- **doctor**：10 PASS / 0 WARN / 0 FAIL；§6.7 包源环境 skipped
- **首跑发现**：28 份薄适配中有 0 漂移（28 改写后已对齐）；新契约（正文 = 权威源）首次落地

## 原文链接

- intent：`workflow/intents/2026-09-25-cross-host-sync.md`
- plan：`workflow/plans/2026-09-25-cross-host-sync.md`
- 命令文档：`.agents/commands/sync-hosts.md`（双源：包源 `templates/_agents/commands/sync-hosts.md`）
- 关联：engine 双源纪律（`AGENTS.md` 段）