# 口径一致性（gate-checklist）

> 三处口径一致性检查 `gate-checklist.mjs`——把"检查项"在 doctor § ↔ check-loop § ↔ commit-check 触发器 三方对齐，避免"文档说一套、跑的是另一套"。

## 主题说明

- **问题**：项目的体检口径散落 3 处：
  - `src/doctor.mjs` §x.y 各节（机器体检实际跑什么）
  - `.agents/scripts/check-loop.sh` §N（lint / 检查项）
  - `.agents/hooks/commit-check.config.json` 的 `builds` / `checks`（提交门）
  - 任何一处改了另两处没跟，就是"口径漂移"
- **方案**：`gate-checklist.mjs` 扫 3 处源，输出"应体检项 vs 实际体检项"对比报告，差异即 WARN
- **零依赖**：仅 `node:fs` / `node:path`

## 关键决策点

- **只报告不修复**（沿用 B-b 决策）：发现漂移由开发者手动改齐，工具不自动同步
- **不替代 check-loop / doctor**：3 个工具并存，各管一段（check-loop 跑检查、doctor 体检、gate-checklist 对照口径）
- **不纳入看板告警**：本工具不挂 `wf--`，运行时不被 orchestrate 自动调用——只在人工 `flow-kit gate-checklist` 时拉起
- **检查项分组**：
  - **模板填充（13）**：workflow/intents / plans / specs / incidents frontmatter 受限子集（5 字段）、状态枚举严格、日期格式、级别合法
  - **工作流门（1）**：plan draft → approved → done 状态迁移留痕
  - **doctor 子项（11）**：目录布局、managed 台账、owned 漂移、跨宿主薄适配、check-loop 干净

## 复盘

- **commit 链**：`42618b3` plan → `f4d7d25` feat（12 文件 / 793 行）
- **套件**：10 PASS（gate-checklist.test.mjs 10 场景）；8 套件总 180/180 PASS
- **doctor**：10 PASS / 0 WARN / 0 FAIL
- **首跑发现**：本项目所有体检口径均经 gate-checklist 静态对齐后再 commit

## 原文链接

- intent：`workflow/intents/2026-09-25-gate-checklist.md`
- plan：`workflow/plans/2026-09-25-gate-checklist.md`
- 命令文档：`.agents/commands/gate-checklist.md`（双源：包源 `templates/_agents/commands/gate-checklist.md`）
- 关联：doctor / check-loop 双源对齐（`AGENTS.md` 段）