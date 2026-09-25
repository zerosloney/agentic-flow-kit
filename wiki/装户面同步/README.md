# 装户面同步（source-sync-check）

> 装户面同步一致性检查 `source-sync-check.mjs`——权威源 `templates/_agents/` vs 装副本 `.agents/` 的 4 类差异诊断（缺失 / 孤儿 / 漂移 / frontmatter-only-diff），预防 wf-runtime 同类根因。

## 主题说明

- **问题**：managed 文件（`commands / roles / scripts / skills / hooks / workflows / board`）由 `src/sync.mjs` 跟踪；owned 文件（`AGENTS.md / notes/ / rule-budgets.txt / workflow-modules.txt`）由 `src/doctor.mjs` §6.6 owned 漂移校验——但**结构级差异**（新增文件类型错位 / 孤儿装副本 / 包源改了但装副本不在台账）无人扫
- **方案**：`source-sync-check.mjs` 扫 `templates/_agents/` 下所有 `.md / .mjs / .json / .txt`（排除 `cache/`）vs `.agents/` 对应路径，输出 4 类差异报告；4 宿主薄适配 `.zcode / .omp / .opencode / .trae` 自动 skipped
- **零依赖**：仅 `node:fs` / `node:path` / `node:crypto`
- **exit code**：`clean=0` / `findings>0=1` / `error=2`（适合 CI 用）

## 关键决策点

- **4 类诊断**：
  - **缺失**：包源有 / 装副本无（如新增文件 init 未执行）
  - **孤儿**：包源无 / 装副本有（如历史残留 / 用户本地添加）
  - **漂移**：包源与装副本都有但 sha 不一致（如包源改了装副本未跟）
  - **frontmatter-only-diff**：剥离 frontmatter 后正文段一致但整文件 sha 不同（frontmatter 漂移不计入主漂移）
- **白名单 `RENDER_OUTPUT_FILES`**：`{kit.json, settings.json, hooks/commit-check.config.json}`——init 渲染产物不属双源结构，不报孤儿
- **只报告不修复**（沿用 D 环节 B-b 决策）：发现差异由开发者手动闭环；工具不自动同步
- **不替代 sync / doctor**：3 个工具并存（sync 管 managed 升级 / doctor 管 owned 校验 / source-sync-check 管结构差异）
- **不检查 4 宿主薄适配漂移**（那是 E 环节 `sync-hosts` 范围）

## 复盘

- **commit 链**：`ea866f4` plan → `52a5e6f` feat（11 文件 / 747 行）→ `65d3441` 关单
- **套件**：26 场景（实际仓库 baseline ≥ 30 份、空目录不崩、cache 排除、4 类诊断）；9 套件总 191/191 PASS（首次跑发现 5 个真实差异 → F 环节闭环）
- **doctor**：10 PASS / 0 WARN / 0 FAIL
- **首跑发现**：1 缺失（`scripts/source-sync-check.mjs` 自己）+ 1 孤儿（`hooks/commit-check.config.json` init 渲染产物）+ 3 漂移（`commands/maintain.md / notes/runtime-env.md / scripts/ensure-board.mjs` 均为 `{{BOARD_PORT}}` 占位符未渲染）+ 1 漂移（`rule-budgets.txt` 49152 → 65536 装副本单边改）

## 原文链接

- intent：`workflow/intents/2026-09-25-source-sync-check.md`
- plan：`workflow/plans/2026-09-25-source-sync-check.md`
- 命令文档：`.agents/commands/source-sync-check.md`（双源：包源 `templates/_agents/commands/source-sync-check.md`）
- 关联：F 环节 `fix-double-source-drift`（5 个真实差异收口）、E 环节 `sync-hosts`（薄适配漂移对照）