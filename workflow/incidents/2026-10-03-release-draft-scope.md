---
状态: open
级别: L1
发现: 2026-10-03
模块: pipeline
备注: papercuts「pre-push 断档扫描 + 检查 15」条目正式立项——评估发版 draft 盲区的映射判据并收口；核心场景已由检查 17（release-unclosed）覆盖，本单聚焦剩余缺口定性 + 补测试 + papercuts 更新。修复类，incident 即 intent 等价入口；L1 配 plan
---
# INCIDENT — 2026-10-03 发版 draft 盲区评估收口（papercuts pre-push 条目）

## 时间线
- 2026-09-29 双轴审查发现 `2026-09-28-opencode-cmd-wf-prefix` 三件套全 draft 却随 v0.8.0 发版提交（`80042e9`）落地——断档扫描与检查 15 均只覆盖 confirmed/终态面，draft 态不在管辖内
- 2026-09-29 检查 17（release-unclosed）落地窄实现：最近一次 package.json version 变更提交树上，当时已是 draft/approved 的 intent/spec/plan，现在仍是 draft/approved 则阻断——回放命中 `80042e9` 树上 approved 17 份 / draft 3 份，papercut 核心场景已覆盖
- 2026-09-29 检查 17 实现时明确取舍：提交说明 → 主题名的弱映射判据（version bump 与主题文档无机器关联）易误报，维持 papercuts 条目待用户拍板
- 2026-10-03 用户对话内拍板「处理2」：立 incident 评估并收口该 papercut 条目
- 2026-10-03 用户确认：草稿过目通过（本单为 L1，plan 确认后实施）

## 影响面
- `templates/_agents/scripts/check-loop.mjs` 检查 17（发版草稿阻断）——本次评估后**不改规则语义**
- `templates/_agents/scripts/check-loop.test.mjs`（补 open incident 不参与检查 17 的显式断言）
- `workflow/papercuts.md`（pre-push 条目状态更新）

## 根因
门禁对「draft 态文档随发版静默落地」缺机器判定：发版提交与主题文档之间没有可靠的机器映射，弱映射（提交说明 → 主题名）易误报，强映射（发版提交树快照）已由检查 17 落地。剩余缺口（发版提交之后新建的草稿、open 的 incident）经评估不属于「随发版落地」的语义范围。

## 为什么之前没拦住
- 检查 17 落地前，断档扫描只查配对断裂/回路断档，检查 15 只覆盖 confirmed/终态面——draft 态无任何门禁触点
- 检查 17 落地时已对映射判据做过取舍，但 papercuts 条目未同步更新，仍显示「待用户拍板」

## 复盘三件套（缺一不可）

1. 结构性修复
 - 修复动作 1：检查 17 测试补「发版树上的 open incident 不参与」显式断言（扫描范围仅 intents/specs/plans，防未来改动将 incidents 纳入扫描范围时无测试兜底）
 - 修复动作 2：workflow/papercuts.md 的 pre-push 条目更新为「已评估（2026-10-03 release-draft-scope）：核心场景由检查 17 覆盖；弱映射不做；发版后新建草稿属正常在建流程不拦」
 - 影响环境：dev（包源测试件 + 装副本同步）
 - 是否需要新 intent：否（评估结论为不改规则语义，单点收口；检查 17 的规则设计已在 release-unclosed spec 中留档）

2. 防复发验证
 - 自动化用例：templates/_agents/scripts/check-loop.test.mjs 检查 17 场景新增「open incident 不触发发版草稿阻断」断言（npm test 随跑）
 - 回归清单：workflow/regression-checklist.md「防复发验证」节追加一行——发版 draft 盲区由检查 17 覆盖，弱映射不做

3. 规范条目
 - 落点：workflow/papercuts.md（条目状态更新）+ workflow/regression-checklist.md（防复发行）
 - 引用：本次修复 commit SHA（修复完成后回填）