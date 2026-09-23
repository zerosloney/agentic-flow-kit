---
状态: approved
级别: L1
日期: 2026-09-24
模块: pipeline
备注: 2026-09-24 用户对话内明示两项范围（「包侧做 path 前缀过滤增强后可消除，同时 workflow 看板默认不开启」）。调查修正：builds 的 prefix 触发能力引擎已有（commit-check.cjs 触发式 `ext 匹配 OR prefix 前缀`），缺的是文档与测试固化——本任务将其补全并落地应用，不新增引擎逻辑。
---
# INTENT — builds prefix 文档化 + 触发器测试；看板默认不拉起

## 背景与问题
- Shipyard 回流后发现：builds 按扩展名全局触发，wiki 看板 .html 变更会误起前端构建（papercuts 在案）。引擎本有 `prefix` 字段（前缀触发，OR 语义）但从未写进配置示例，等于隐藏能力。
- 任务入口命令默认幂等拉起看板（ensure-board.ps1，全新启动还弹浏览器）——用户裁定默认不开启，改为按需手动。

## 目标
1. commit-check.cjs 配置示例注释补 `prefix` 字段说明；新增 `commit-check-trigger.test.mjs` 固化触发语义（ext-only / prefix-only / 双不命中 SKIP / .agents 自改不触发 / --full 全跑）。
2. 看板默认不拉起：plan.md / maintain.md「任务入口动作」改为按需提示（默认跳过）；AGENTS.md、workflow/README.md（模板）、doctor.mjs 端口信息行措辞同步。
3. 落地应用（Shipyard 装户）：sync 引擎与命令文档；commit-check.config.json 前端构建改 `prefix: "frontend/"`（精确复刻旧版前缀行为，wiki html 不再触发）；owned 文档（AGENTS.md / workflow README 看板行）手工同步；停掉探活遗留的看板进程。

## 非目标
- 不改 commit-check 触发逻辑本身（prefix OR 语义保持；AND 组合按需再立）。
- 不删 ensure-board.ps1 / workflow-board-server.mjs（按需手动入口保留）。
- 不动看板告警规则与 check-loop 口径。

## 影响面
- 模块：pipeline；包侧 templates 6 文件（commit-check.cjs 注释、plan/maintain 命令文档、AGENTS.md、workflow/README.md、新测试）+ src/doctor.mjs 一行；Shipyard 侧 sync + owned 两文件手工 + config 一处 + 停进程。
- 数据库：无；前端页面：无。

## 触达红线
- 规则 / 契约（任务入口口径变更 → L1 工具级定档依据同 2026-09-24 增量收包先例）：门禁能力只增不减；看板从「默认拉起」改「按需」，预警层属性不变。

## 验收标准（可测试）
- [ ] commit-check-trigger.test.mjs 五场景全绿并接入 run-tests（npm test 全套件绿）
- [ ] 配置示例注释含 prefix 说明；引擎逻辑零改动（diff 仅注释与文档）
- [ ] plan/maintain/AGENTS.md/workflow README/doctor 无「默认拉起」口径残留（grep 断言）
- [ ] Shipyard：wiki .html 暂存不触发前端构建、frontend/ 文件暂存触发（对照探针）；看板进程已停；sync 后 doctor 7 PASS
