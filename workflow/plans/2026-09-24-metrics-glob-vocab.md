---
状态: done
级别: L1
日期: 2026-09-24
模块: pipeline
---
# PLAN — gen-workflow-metrics 预算表 glob 词表收口：单星前缀+后缀匹配，出表警告跳过

对应入口：../incidents/2026-09-24-metrics-glob-vocab.md

## 改动面
- `templates/_agents/scripts/gen-workflow-metrics.mjs`：scanSurface 的 glob 分支改为——校验「基名内恰好一个 `*`」（多 `*` / 目录段 `*` → 警告跳过），按「基名前缀 startsWith + 后缀 endsWith」双条件匹配（原「首个 * 取后缀 endsWith」丢弃前缀，`pl*.md` 误吃全目录 .md）；目录不存在警告跳过保持。
- `templates/_agents/scripts/gen-workflow-metrics.test.mjs`：补场景 4（前缀过滤 / 出表跳过 / 合计口径 / exit 0）。
- `workflow/regression-checklist.md`：防复发验证节追加条目。

## 验证方式
- 静态门：`npm test` 全套件全绿（gen-workflow-metrics 含新场景 4）。
- 口径对齐：修复后 metrics 与 rule-budget.sh（shell glob）对单星基名 glob 计量同文件集；本仓库现用预算表（`*.md` 空前缀）行为不变。

## 确认与复核
- 确认结果：approved（2026-09-24 用户对话内点名「要收口 立小单」）；done（2026-09-24 关单：npm test 全绿（metrics 16 断言含场景 4）+ 本仓实跑口径不变，修复 commit 6a16a0a 已回填 incident）
