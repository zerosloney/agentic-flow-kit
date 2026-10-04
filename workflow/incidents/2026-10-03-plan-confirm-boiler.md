---
状态: fixed
级别: L2
发现: 2026-10-03
模块: pipeline
备注: 推送 v1.0.0 时三个 plan 触发「模板未填」advisory WARN（confirm-gate-one-per-call / p2-batch1 / release-draft-scope），根因同为 plan 模板「确认与复核」节样板句被检查 2 的 phRe 误判。release-draft-scope 为本次新建引入，已关单文档不可直接修改（确认内容漂移 hard-block），故走规则面根治：豁免模板样板句。命中 papercuts「检查 6 模板占位符误报」第 2 次升级条件。修复类，incident 即入口；L2 配 spec + plan
确认指纹: 1c2da8009dc24586
---
# INCIDENT — 2026-10-03 plan 确认节模板样板误报豁免

## 时间线
- 2026-10-03 推送 v1.0.0 时 check-loop 报 3 条 `[WARN 模板未填]`：`2026-09-27-confirm-gate-one-per-call` / `2026-09-27-p2-batch1` / `2026-10-03-release-draft-scope` 三个 plan 的「确认与复核」节均残留 `确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）` 样板行
- 2026-10-03 尝试直接回填 release-draft-scope plan 占位符 → 被检查 15「确认内容漂移」hard-block 拦截（done 文档绑定生效，确认指纹与内容不符）——已回退
- 2026-10-03 用户对话内指示：「彻底清理需走 superseded 或新 intent 流程」——确定走正式流程根治
- 2026-10-03 用户确认：草稿过目通过（L2 流程，spec/plan 确认门后续逐道走）

## 影响面
- `templates/_agents/scripts/check-loop.mjs` 检查 2「模板字段占位符残留」判定集合（boilerRe 增加确认节样板豁免）
- `templates/_agents/scripts/check-loop.test.mjs`（补回归场景）
- `workflow/papercuts.md`（检查 6 升级项收口）
- 三个 plan 文档**不改内容**（保持 done 状态与确认指纹一致）
- 本仓推送/提交时的 advisory WARN 减少 3 条

## 根因
plan 模板的「确认与复核」节把确认结果占位符写成 `确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）`——这是模板自带样板，含 `YYYY-MM-DD` 两处，而检查 2 的 `boilerRe` 豁免清单未覆盖该样板句 → 凡未回填该行的 plan（历史上 3 份）一律误报「模板未填」。

## 为什么之前没拦住
- 检查 2 的 boilerRe 只覆盖 specs 引用、`_YYYY-MM-DD.` 文件名格式、`format('YYYY-MM-DD')` 代码形态等，未覆盖 plan 确认节的中文样板句——样板清单随模板演进滞后
- 模板占位符误报为 advisory（不阻断），历史 plan 已带此 WARN 推送多次，未触发升级（papercuts 记录「第 2 次命中或用户点名时升级」）

## 复盘三件套（缺一不可）

1. 结构性修复
 - 修复动作 1：`templates/_agents/scripts/check-loop.mjs` 检查 2 的 `boilerRe` 增加 plan 确认节样板分支（精确匹配整句样板，避免过度豁免真实未回填）
 - 修复动作 2：`templates/_agents/scripts/check-loop.test.mjs` 补回归场景——plan 含确认节样板行 → 不报「模板未填」；plan 含真实未填占位（如 `日期: YYYY-MM-DD`）→ 仍报
 - 修复动作 3：`workflow/papercuts.md` 检查 6 条目更新为「已由 2026-10-03-plan-confirm-boiler 豁免处理」
 - 影响环境：dev（包源 + 装副本同步）
 - 是否需要新 intent：否（根因属检查判据清单滞后，单点规则面修复；papercuts 升级项随本单收口）

2. 防复发验证
 - 自动化用例：`templates/_agents/scripts/check-loop.test.mjs` 检查 2 新增确认节样板正例 + 真实占位负例（npm test 随跑）
 - 回归清单：`workflow/regression-checklist.md`「防复发验证」节追加一行

3. 规范条目
 - 落点：`templates/_agents/scripts/check-loop.mjs` boilerRe 注释（说明 plan 确认节样板豁免口径）+ `workflow/papercuts.md`
 - 引用：本次修复 commit SHA（修复完成后回填）