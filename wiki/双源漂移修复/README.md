# 双源漂移修复（fix-double-source-drift）

> 收口 source-sync-check 跑出的 5 个真实差异——4 处漂移（`{{BOARD_PORT}}` 占位符未渲染 + rule-budgets 单边改）+ 1 处孤儿白名单扩展。

## 主题说明

- **问题**：source-sync-check 首次实测发现仓库内 5 个真实差异——`templates/_agents/` 与 `.agents/` 自相矛盾（CI / 装户复制都会触发"包源 vs 装副本不一致"的台账基线漂移）
- **方案**：4 处漂移手动修齐（包源 → 装副本方向）+ 1 处白名单扩展（`hooks/commit-check.config.json` 加入 `RENDER_OUTPUT_FILES`）+ 测试场景新增 S8/S9
- **零依赖**：仅文本替换 + 工具白名单常量扩展

## 关键决策点

- **修复方向是包源 → 装副本**：B-b 决策"包源是权威源，应反映装副本实际状态"——4 处占位符 `{{BOARD_PORT}}` 实际就是装副本跑通后留下的 8933，包源模板侧的同源问题
- **`{{BOARD_PORT}}` → `8933`**：
  - `templates/_agents/commands/maintain.md`：注释「基端口 {{BOARD_PORT}}」→「基端口 8933」
  - `templates/_agents/notes/runtime-env.md`：注释「workflow 看板：{{BOARD_PORT}}」→「workflow 看板：8933」
  - `templates/_agents/scripts/ensure-board.mjs`：注释「与命令文档 {{BOARD_PORT}} 同源」→「与命令文档 8933 同源」
- **`rule-budgets.txt` 49152 → 65536**：本轮 C 环节关单时装修副本未同步包源（同 wf-runtime 同类根因的真实样本）
- **白名单扩展**：`RENDER_OUTPUT_FILES` 加 `hooks/commit-check.config.json`（init 渲染产物，与 `kit.json` / `settings.json` 同类）；保留别名 `TARGET_EXCLUDE = RENDER_OUTPUT_FILES`（向后兼容）
- **新增测试场景 S8 + S9**：
  - **S8**：白名单 3 项（`commit-check.config.json` / `kit.json` / `settings.json`）都不报孤儿 + 非白名单孤儿（`real-orphan.json`）仍报
  - **S9**：实际仓库 `hooks/commit-check.config.json` 不在孤儿列表

## 复盘

- **commit 链**：`e3454bf` plan → `b5988d7` feat（12 文件 +105 / -36）→ `564c6bb` 关单
- **套件**：4 场景新增（S1 fixture 调整 +1、S8 +2、S9 +1）；18 套件总 309/309 PASS
- **doctor**：10 PASS / 0 WARN / 0 FAIL（`rule-budgets.txt` 装修副本后 sync 刷台账 → owned 哈希自愈）
- **source-sync-check**：51/51 无差异 ✅
- **预算**：`.agents/commands/` 49152 → 65536（增量 16384B，给后续 5+ 环节 helper 命令留余量）

## 原文链接

- intent：`workflow/intents/2026-09-25-fix-double-source-drift.md`
- plan：`workflow/plans/2026-09-25-fix-double-source-drift.md`
- 关联：
  - C 环节 `source-sync-check`（差异报告来源）
  - E 环节 `sync-hosts`（薄适配漂移 vs 双源结构漂移的边界）
  - incident `workflow/incidents/2026-09-25-wf-runtime.md`（同根因：包源改了装副本未跟）