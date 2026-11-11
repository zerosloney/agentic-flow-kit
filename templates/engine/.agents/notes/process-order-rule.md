# 顺序红线：先定级 → 三件套 → 确认 → 才动手

来源：2026-11-03 流程倒置事件（incident `workflow/incidents/2026-11-03-po-pml-outbound-guards.md`、`workflow/papercuts.md` 同日条目）。`new-task.md` 首屏只留一句指针，正文细节在此。

## 规则

1. **动手前**跑 `new-task.md` §1 两问定级（结构面 → L3；契约或共享口径 → L2；都没有 → L1）。一次报多项缺陷时**逐项定级，取最高**。
2. 命中 L2 / L3：先落 `workflow/incidents/`（缺陷类）或 `workflow/intents/`，再 `spec`，再 `plan`，**逐份 `confirm-doc` 通过后才允许改代码**。L1 也要先有 plan（写清判据）。
3. **禁「先改后补档」**：确认门的语义是「用户点头的那份方案先于实现存在」。事后补档无法还原时间序 = 绕过确认门；一旦发生，须在 incident「门禁失效分析」与 `workflow/papercuts.md` 双落登记，并在提交信息中指明。
4. 判级不确定时默认**按高一级处理并先落文档**，不要先写代码再回填级别。

## 为什么文档状态门拦不住，以及现在哪道门拦得住

- 级别是判断而非机器可判信号：同一改动可能是「纯新增只读字段」（L1）或「既有语义收紧」（L2），hook 无法从 diff 推断级别。
- 确认指纹只校验文档状态与承诺面，不校验发生顺序。`confirm-doc` 在实现之后调用，文档门仍会通过。
- 顺序的机器信号在提交时刻：`.agents/hooks/check-confirm-order.mjs`（2026-11-08 档 2-D 起由 `.githooks/commit-msg` 调用——pre-commit 读不到提交消息；合并跳过改由脚本探测 `MERGE_HEAD` 状态文件）。暂存的 `backend/` 源码、`frontend/src` 的 vue/ts、`tests/**/*.cs`、数据维护 SQL，必须逐条出现在**状态为 approved** 的 `workflow/plans/` 正文里，或命中豁免：①L0 车道（消息体含非空 `L0:` 行且产品文件 ≤3）②覆盖性 plan 与本批同暂存（L1 单笔提交，`done` 亦可）。`done` 的**历史** plan 不算覆盖；`draft` 也不算。squash、rebase、cherry-pick 跳过。
- 定级本身仍靠执行者。先改后补档若绕过本门（路径没写进 plan、或提交不经 git 钩子），仍双落 incident + papercuts。

## 复现痕迹（2026-11-03）

- 实现提交 `302226b8` 先于 `83b7015f` 的三件套补档；check-loop 期间无阻塞（因门只看状态），说明顺序面无机器保护。
