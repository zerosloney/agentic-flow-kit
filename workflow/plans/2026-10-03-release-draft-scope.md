---
状态: done
级别: L1
模块: pipeline
确认指纹: 9518fe8c2e3974cf
---
# PLAN — release-draft-scope

<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->
<!-- L1 快车道 (Quick-Plan)（2026-09-30 更新）：合并 Spec 与 Plan 核心。必填三节：[改动方案, 约束与风险, 验证计划]。仅多文件多步骤时保留任务拆解/执行顺序 -->

对应入口：../incidents/2026-10-03-release-draft-scope.md

## 改动方案

- `templates/_agents/scripts/check-loop.test.mjs`（检查 17 场景）：新增断言——发版提交树上的 open incident 不触发「发版草稿」阻断。判据：在既有检查 17 夹具（发版树含 draft intent/plan）基础上，额外在 `workflow/incidents/` 放一个 open 的 incident 文件并提交，`run(T, { git: true })` 的 exit 仍为 1（由 intent/plan 触发）且输出不含该 incident 路径；单独只含 open incident 的树则 exit 0。扫描范围仅 `intents/specs/plans`，incidents 天然排除——本断言防未来把 incidents 纳入扫描范围时无测试兜底
- `workflow/papercuts.md`：pre-push 断档扫描条目（2026-09-29）状态更新为「已评估（2026-10-03 release-draft-scope）：核心场景由检查 17 覆盖；弱映射（提交说明→主题名）不做；发版后新建草稿属正常在建流程不拦」
- `workflow/regression-checklist.md`：「防复发验证」节追加一行——发版 draft 盲区由检查 17 覆盖，弱映射不做，open incident 不参与（由 check-loop.test.mjs 检查 17 场景断言）
- 改完 templates 后 `node bin/flow-kit.mjs sync` 更新装副本

## 约束与风险

- 约束：**不改 `check-loop.mjs` 检查 17 的规则语义**（发版树快照强判据维持现状）；不新增检查号；不动配对/验收/确认留痕条文；弱映射（提交说明→主题名）明确不做——误报风险高于收益，release-unclosed spec 已记录该取舍
- 风险：低（仅补测试断言 + 文档定性，无门禁行为变化）

## 验证计划

- 静态门：`npm test`（含新增检查 17 断言）全绿；`node .agents/scripts/gen-workflow-index.mjs --check` 无漂移
- 文档：papercuts.md 条目更新 + regression-checklist 新增行随提交可追溯
- L1 走快车道，不要求独立复核

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L1 不要求独立复核
