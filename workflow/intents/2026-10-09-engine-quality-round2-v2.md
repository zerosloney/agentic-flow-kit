---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-09
模块: pipeline
备注: round2 重立单（v1 勾验事故 superseded——实现已交付，本单重走验证与关单）
确认指纹: 3da497c147c103ad
---
# INTENT — engine-quality-round2-v2

## 背景与问题

v1（`2026-10-09-engine-quality-round2`，已 superseded）完成了 B-D-A-E-C 五层全部实现与验证（代码提交 9ca1675 / 6e96edf / 9ff8740，独立复核 P0=0 且 P1-1/P2×2 全处置），但**关单勾验操作事故**：以 `split('- [ ] ')` 盲勾替换勾验，误伤「触达红线」节三行（「未触及，不勾」被勾上）与验收节两条例证行（G-D/G-A1 的证据占位无「证据：」前缀未被替换命中）——触发检查 8「勾选缺证据」hard，且该档 done 后内容绑定（检查 15）使直接编辑必双 hard，按引擎明示通道走 superseded 重立本单。

本单目标 = **对已交付实现重走合法闭环**：验收标准以实际交付事实逐条陈述（每条自带实证据，不再有占位替换），验证矩阵复跑确认，关单收口。

## 历史教训/防复发

- 检索结果：kb-search 命中 v1 三件套（superseded）与本单同源方案；engine-quality-batch（上一批闭环先例）。
- 避坑 1（v1 事故根因）：**验收标准起草时即写最终证据**（占位文本不进 done 流程），勾验只做「[ ] → [x] + 证据确认」的逐条精确编辑，禁止全文替换类批量操作。
- 避坑 2（v1 事故放大器）：触达红线节与验收节都有 `- [ ]` 形态——批量替换无节界感知。红线三行的正确终态 = 仅首条勾（L2 红线触及），后两行不勾。
- 避坑 3：done 后内容绑定不可编辑——勾验事故在 confirm-doc **之前**发现即无代价，之后只能 superseded 重立（本单代价：三件套重走）。

## 目标

- **G-1**：对 v1 已交付实现（B1 sync-hosts 多根对账 / B2 edit-face-check / B3 CI 红回溯 / D 台账哈希链 / A1 检查7拆模块 / A2 exempt 清理 / E ARCHITECTURE.md / C 合并预览纪律）完成合法闭环收口——本单不新增任何实现改动。
- **G-2**：独立复核结论（P0=0、P1-1 探针行残留→void 作废行处置、P2-1 口径勘误、P2-2 faces 计数）与全部处置证据在案（spec 确认与复核节 + papercuts）。

## 非目标

- 不改任何 v1 交付的实现代码（全部已在 9ca1675/6e96edf 落库并验证）。
- 不追溯编辑 superseded 的 v1 三件套（内容绑定）。

## 约束

- 验收标准逐条精确编辑，禁止批量替换。
- 双源纪律、零运行时依赖等既有红线全部沿用（实现侧已满足，本单只复核不变量）。

## 影响面

- 模块：pipeline
- 数据库：无
- 文件面：仅 workflow 文档（本三件套 + delegations 补记）——无代码改动。

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更——v1 交付含检查 15 判定扩展（哈希链验链）等契约面，本单关单覆盖其闭环 → L2（已定 L2）
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → L3——未触及，不勾

## 验收标准（可测试）

- [x] G-B1 sync-hosts 多根对账：包源 fixture 项目根 .zcode 漂移可检出、--apply 可修复且 frontmatter 保留、装户布局回归不变；实仓 84 对 0 漂移含「对账面：」自描述行（证据：src/sync-hosts.test.mjs 42/0——S10/S11/S12 新场景 + 既有 36 断言零改动；node bin/flow-kit.mjs sync-hosts --diff 实测输出）
- [x] G-B2 编辑时快检：edit-face-check 工作树面 hard→2/预算超限→1/全绿→0 三 exit 语义 + WARN 明细透传（证据：templates/_agents/scripts/edit-face-check.test.mjs 9/0——全绿面/破坏面删索引 WARN 点名/预算超限三场景）
- [x] G-B3 CI 红回溯：failure 步骤双侧在案（证据：grep if: failure() 于 .github/workflows/ci.yml 与 templates/_github/workflows/kit-ci.yml 均命中；内联脚本 new Function 语法解析通过；runner 实绿待 push 后佐证）
- [x] G-D 台账哈希链：写入侧 prevHash/hash（appendLedger 单点）、验链侧检查 15 断裂 hard、存量无 hash 行零告警、哈希函数单源 policy.ledgerChainHash（证据：confirm-doc.test S8b 三断言 57/0；check-loop.test 场景 21a 篡改→hard + 21b 还原即绿 + 21c 存量兼容 237/0；实仓冒烟四步 + 禁用验链判据→21a 当场红的反证）
- [x] G-A1 检查 7 拆模块：check-stage-index.mjs + 直测 5 断言；check-loop 接线后头部清单行逐字不动、gate-checklist 登记完整（证据：check-stage-index.test.mjs 5/0；node .agents/scripts/gate-checklist.mjs --diff 输出登记完整 0 断档 0 未登记；check-loop.test 237/0 既有断言零改动）
- [x] G-A2 exempt 停车场清理：verify-wiki-consistency.test 3/0（一致绿/未登记红/协议目录缺失红）+ wiki-search.test 3/0（--scope 固定/显式 -n 透传/exit 透传）；exempt 表移除两行、ensure-board 永久工具豁免定性；检查 20 零缺失告警（证据：node .agents/scripts/check-loop.mjs 输出无「脚本测试缺失」）
- [x] G-E 架构单源：ARCHITECTURE.md 落仓库根（八节：定位/三层分发/闭环/门禁 20 检查索引/双入口/自我度量/质量底座/已知边界）；papercuts 缓做定性 4 行（MCP 化/fleet/L2 快车道深水区/P1-1 探针行处置）（证据：文件在案 grep 节标题命中）
- [x] G-C 合并预览纪律：design/build/new-task 三模板各含「三件套合并预览」节；sync-hosts --apply 后 84 对全对齐（证据：grep 合并预览于三模板命中；sync-hosts --diff 输出 0 漂移）
- [x] 全量门：npm test 全部套件通过（含 lint 首步）；eslint 0 error；doctor 14 PASS 0 WARN 0 FAIL；source-sync-check 0 漂移；rule-budget --all exit 0；check-loop 仅存量 1 条 advisory（三件套不全，用户拍板保留）（证据：本单关单前全量复跑输出）
- [x] 复核闭环：L2 独立复核完成——P0=0；P1-1（D 冒烟探针行残留实仓台账）已处置（papercuts 定性 + stage=void 作废行经 appendLedger 链上追加 + 冒烟今后一律 tmp fixture）；P2-1 验链坏行口径注释勘误 + 报文物理行号（已修）；P2-2 faces 计数改实际配对>0 宿主数（已修，84 对不变）（证据：independent-reviewer 复核报告（会话在案）+ spec「确认与复核」节 + papercuts 2026-10-09 行）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。

## 确认与复核

- 确认日期：2026-10-09（自治批次——授权链同 v1：用户 goal 指令；superseded 重立为该授权范围内的合法修订通道）
- 确认人：用户（goal 指令）
- 确认范围：五层方案内容（实现已交付并复核）+ 本重立单的闭环收口
- 复核：L2 独立复核已在实现提交后完成（结论见 G-复核对账条）——本单无新增代码，复核结论直接承继
