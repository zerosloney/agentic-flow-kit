---
状态: approved
级别: L2
模块: pipeline
确认指纹: af66c83ba3711c8f
---
# PLAN — plan-confirm-boiler（plan 确认节模板样板误报豁免）

对应入口：../incidents/2026-10-03-plan-confirm-boiler.md
对应 spec：../specs/2026-10-03-plan-confirm-boiler.md

## 改动方案

- `templates/_agents/scripts/check-loop.mjs`：检查 2 的 `boilerRe` 正则增加 plan 确认节样板分支——精确匹配整句 `确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）`；`boilerRe` 定义处注释说明豁免口径（plan 模板确认节样板，2026-10-03-plan-confirm-boiler）
- `templates/_agents/scripts/check-loop.test.mjs`：检查 2 新增成对回归场景——①正例：plan 含确认节样板行 → 不报「模板未填」；②负例：plan 含真实未填 `日期: YYYY-MM-DD` → 仍报
- `workflow/papercuts.md`：检查 6（模板占位符误报）条目更新为「已由 2026-10-03-plan-confirm-boiler 豁免处理」
- `workflow/regression-checklist.md`：「防复发验证」节追加一行——plan 确认节样板句由 boilerRe 豁免，真实占位仍拦（check-loop.test.mjs 检查 2 场景）
- 改完 templates 后 `node bin/flow-kit.mjs sync` 更新装副本
- 三个已关单 plan（confirm-gate-one-per-call / p2-batch1 / release-draft-scope）**不改内容**——避免触发检查 15 确认内容漂移

## 任务拆解（L2/L3 必填）

1. 修改 `check-loop.mjs` 的 `boilerRe`
 - 判据：`node .agents/scripts/check-loop.mjs`（或 check-loop.sh）对三个 plan 不再报「模板未填」；真实占位负例仍报
 - 风险：低（仅扩展豁免正则，判定集合单点变更）
2. 补 `check-loop.test.mjs` 回归场景
 - 判据：新场景 PASS；`npm test` 全绿
 - 风险：低
3. 更新 `papercuts.md` + `regression-checklist.md`
 - 判据：两处落点可追溯；`gen-workflow-index.mjs --check` 无漂移
 - 风险：低
4. `sync` 更新装副本并验证
 - 判据：`node bin/flow-kit.mjs sync` 后 `.agents/` 与 `templates/` 一致；推送时三个 WARN 消失
 - 风险：低

## 执行顺序（L2/L3 必填）

1 → 2 → 3 → 4（代码判据先行，测试随后钉住，文档收口，最后 sync 双源）

## 验证计划

- 静态门：`npm test`（含新增检查 2 正例/负例）全绿；`node .agents/scripts/check-loop.mjs` 本仓自扫三 plan 无「模板未填」WARN；`node .agents/scripts/gen-workflow-index.mjs --check` 无漂移
- L2 追加：规则面比对——检查 2 判定集合仅增豁免分支，其他检查号输出不变；三个已关单 plan 的 git 内容零改动

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 `draft → approved` 并回填本节（确认环节的机器可见态），`done` 只在关单出现——禁从 `draft` 直跳 `done`（2026-09-22 papercut）。
- 确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（`build.md` 两道门，逐次，不合并）
- 复核：L2 推荐独立复核（本单低风险，如安排由 independent-reviewer 执行）