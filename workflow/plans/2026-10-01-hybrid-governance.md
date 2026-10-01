---
状态: approved
级别: L2
模块: pipeline
确认指纹: 809f4ad1a38addd7
---
# PLAN — hybrid-governance（补档）

对应入口：../intents/2026-10-01-hybrid-governance.md
对应 spec：../specs/2026-10-01-hybrid-governance.md

## 改动方案

**本 plan 只产生文档，不产生代码**（实现已随 20490ad 落地）：

- `workflow/intents/2026-10-01-hybrid-governance.md`（已 approved 待提交）：回填单——背景如实记录免档直提授权与本批兑现关系
- `workflow/specs/2026-10-01-hybrid-governance.md`（已 approved 待提交）：四特性判据按 20490ad 落地行为落档，10 处行号锚点
- `workflow/plans/2026-10-01-hybrid-governance.md`（本件）：补档执行步骤
- 关单时追加：intent 勾验 + `workflow/delegations.md` 自做记行（回填批）+ `workflow/INDEX.md` 重生成

## 任务拆解（L2/L3 必填；L1 仅多文件多步骤时用，单任务微改动删本节）

1. 三件套提交留痕
   - 判据：approved 态三件进 git 历史（配对门要求 plan 在树，三件同笔 docs 提交）；提交经泳道门（workflow/ 路径不命中面模式，静默放行）
   - 风险：低
2. 独立复核（L2 口径）
   - 判据：independent-reviewer 新上下文复核 spec ↔ 20490ad 落地行为一致性——抽样核对 ≥8 锚点（红线判低 / 加固门 / trust 三级 / solidify / stage-gates 豁免 / --batch / fill-intent 双写 / pre-push wiring）；结论交用户定性
   - 风险：中（补档失真是本批唯一实质风险——复核是防线）
3. 勾验与关单
   - 判据：intent 验收 5 条逐条勾验补证据（既有证据：20490ad SHA / fresh-clone 实录 / check-loop 输出 / 两档互引）；三件 done（approved 先在历史，逐件 confirm-doc）；INDEX 重生成；delegations 记行（回填 2026-10-01，结果如实记）
   - 风险：低
4. 收尾验证
   - 判据：`node .agents/scripts/verify.mjs` 全绿；check-loop 无新增告警；`git status` 干净
   - 风险：低

## 执行顺序（L2/L3 必填；L1 单文件微改动删本节）

plan 确认 → 1（提交）→ 2（复核）→ 用户定性 → 3（关单）→ 4（验证）。2 与 3 的勾验编辑可并行起草，done 落账在复核定性之后。

## 验证计划

- 静态门：测试 = `npm test`（20490ad 已全绿，本批零代码改动不触发回退；关单前 verify.mjs 复跑）；构建 = 无
- L2 追加：spec ↔ 20490ad 抽样对账 ≥8 锚点（独立复核承担）；check-loop 提交前后对照无新增告警
- 前端 / UI / L3：不适用

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-10-01 用户对话内确认，原话「确认」——plan 全文过目）；done（关单时随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（改动方案节随 plan 全文一并过目确认）
- 复核：L2——independent-reviewer 复核 spec 与 20490ad 一致性（任务 2）
