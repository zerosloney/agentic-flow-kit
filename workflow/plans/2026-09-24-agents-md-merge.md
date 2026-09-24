---
状态: done
级别: L1
模块: pipeline
---
# PLAN — init 对已存在 AGENTS.md 按骨架标记判断跳过或追加补齐

对应入口：../intents/2026-09-24-agents-md-merge.md

## 改动面（L1 极简形态主节）
- `templates/AGENTS.md`：首行加骨架标记 `<!-- flow-kit:agents-skeleton -->`
- `src/render.mjs`：提取 `renderContent(text, vars)` 单文件渲染导出（renderTree 内联替换改调用，逻辑单源）
- `src/init.mjs`：新增导出 `hasAgentsSkeleton` / `mergeAgents`；renderTree 后特例分支——skipped 含 AGENTS.md 时按标记判定：无标记 → 文末追加渲染骨架 + owned 台账记账 + 移出跳过清单；有标记 → 明确报跳过
- `src/cli.mjs`：HELP init 行补 AGENTS.md 补齐行为说明
- `src/init.test.mjs`：新增标记探测与合并纯函数断言（交互头部文案随 init.mjs 顺带更新）

## 验证方式
- 静态门：`npm test`（新增断言入套件）
- 实测：临时目录两态——预置自写 AGENTS.md（追加后原文逐字在位）、预置含标记 AGENTS.md（文件不变）
- 闭环：本任务自己走 verify + 关单勾验

## 确认与复核
- 确认结果：approved（2026-09-24 用户随报随修——「判断 AGENTS.md 有没有对应内容，有跳过，没有补上」，需求即确认）；done（2026-09-24 关单，随入口文档置终态）
- 确认门记录：改动面 = 该要求的直接展开；「标记探测 + 文末追加」方案要点随 intent 记录
