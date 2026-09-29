---
状态: done
级别: L1
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 intent。开工句「WP-A 与 WP-B 开干」只授权实现。
确认指纹: cead648e2b84a0b1
---
# INTENT — 看板按完整文件名配对

## 背景与问题

看板告警按去掉日期的 slug 把文档合成一家。不同日期、同一 kebab 主题会被看成已经配对，推送时 check-loop 仍按完整文件名判缺 plan。合法的 draft 被报成「状态不在枚举内」，因为告警用的是已确认状态集，不是全量状态集。

## 目标

- 告警配对使用完整文件名（含日期），与 check-loop 检查 1 的 basename 一致。
- 同一 slug、不同日期的两份 intent，只有缺同名 plan 的那份报「入口缺 plan」。
- draft 不再报非法枚举；提示文案为「尚未确认」。
- approved 与 done 的既有配对告警不回退。
- 界面仍可按 slug 把同主题收成一组，每一行显示自己的日期。

## 非目标

- 不改 check-loop 的硬门判据。
- 不把 slug 分组从看板卡片上拆掉。

## 约束

- 只动预警层。枚举仍读 `workflow-enums.txt`，不在看板里另写一套状态字面量。
- 引擎改 `templates/_agents/`，再 sync。

## 影响面

- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2

本项不改硬门契约，级别 L1。未勾上面的契约红线。

## 验收标准（可测试）

- [x] 两份不同日期、同一 slug 的 intent，只给其中一份配同名 plan：有 plan 的无「入口缺 plan」，另一份有（证据：`workflow-board-server.test.mjs` ⑥「有同名 plan 的 intent 不报缺 plan」「没有同名 plan 的 intent 报缺 plan」；实现 `0176eab`；`7045ea8` 后 `verify.mjs` 中该套件 18/18）
- [x] draft 的告警含「尚未确认」，不含「状态不在枚举内」（证据：同套件 ⑥「draft 提示尚未确认，不报非法枚举」；`0176eab`）
- [x] approved 的 intent 加同名 approved plan：无非法枚举、无「尚未确认」、无「入口缺 plan」（证据：同套件 ⑥「approved 同名配对：无非法枚举、无尚未确认、无缺 plan」；`0176eab`）
- [x] 入口 done、同名 plan 仍是 draft：plan 仍报未终态（证据：同套件 ⑥「入口 done 而同名 plan 仍是 draft：plan 报未终态」；`0176eab`）
- [x] 现有看板套件（双跑四类 hard-block、验收节解析）保持通过（证据：同套件 ①② 四类 hard-block 双跑、④ 验收节解析，均在上述 18/18 内）
