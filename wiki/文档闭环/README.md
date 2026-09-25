# 文档闭环（doc-fill-tools）

> 文档闭环填空工具 `fill-{intent,spec,plan}.mjs`——AI 起草 workflow 入口文档时，机器保证模板与节标题不出错，AI 专注于内容本身。

## 主题说明

- **问题**：AI 起草 workflow/intents / plans / specs 时，常错填 frontmatter 字段（如 `状态` 写成 `status`，或状态值超出 `draft/approved/done/superseded/cancelled` 枚举）、漏写节标题、混入过期模板片段——check-loop 后续扫描会报错，浪费一轮 commit
- **方案**：3 个 fill 工具从 `workflow/intents / plans / specs/_TEMPLATE.md` 读节标题，输出符合 frontmatter 受限子集（5 字段：状态 / 级别 / 日期 / 模块 / 备注）的草稿到指定路径；正文留 `<...>` 占位符让 AI 填实
- **零依赖**：仅 `node:fs` / `node:path`

## 关键决策点

- **3 个工具独立**（不合并单入口）：fill-intent / fill-spec / fill-plan 各自对应模板，避免互相耦合
- **frontmatter 受限子集 5 字段**：状态（严格枚举）/ 级别（L0-L3）/ 日期（YYYY-MM-DD）/ 模块（必填，单值）/ 备注；check-loop 只扫 frontmatter 取机器字段，正文不再写状态/级别行
- **fill-plan 无日期字段**：与 `workflow/plans/_TEMPLATE.md` 对齐（L1 plan _TEMPLATE 不含日期字段）
- **不替代 AI 起草**：本工具只输出模板与提示句——AI 负责填实「背景与问题」「目标」「影响面」「验收标准」等节

## 复盘

- **commit 链**：`22e8316` plan → `406a3f6` feat（21 文件 / 774 行）
- **套件**：3 个 fill 套件 57/57 PASS（fill-intent / fill-spec / fill-plan 各 19 PASS）；7 套件总 170/170 PASS
- **doctor**：10 PASS / 0 WARN / 0 FAIL
- **首跑发现**：本项目所有 workflow/intents / plans / specs 后续均由 fill 工具起草（草稿机械保证模板正确）

## 原文链接

- intent：`workflow/intents/2026-09-25-doc-fill-tools.md`
- plan：`workflow/plans/2026-09-25-doc-fill-tools.md`
- 命令文档：`.agents/scripts/fill-{intent,spec,plan}.mjs`（双源：包源 `templates/_agents/scripts/fill-*.mjs`）
- 关联：frontmatter 受限子集（`AGENTS.md` / `workflow/README.md` 段）