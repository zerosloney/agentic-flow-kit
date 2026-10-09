---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-09
模块: pipeline
备注: round3 重立单（漏勾全量门条即 done 触发双 hard 死锁——实现已交付 3817ea7，重走关单）
确认指纹: 106f9edc9f7041a6
---
# INTENT — engine-quality-round3-v2

## 背景与问题

v1（`2026-10-09-engine-quality-round3`，已 superseded）完成了九维提升优先级 1→4 全部实现与验证（代码提交 3817ea7，独立复核 P0=0 且 P1-1/P2×5 全处置），但**关单勾验漏勾**：验收 6 条只勾了 5 条（「全量门」条漏勾）即 confirm-doc done——触发检查 8「验收未对账」hard（新建档勾缺=hard），叠加检查 15 内容绑定成死锁，按引擎明示通道 superseded 重立本单。

本单 = **对已交付实现重走合法关单**（round2-v2 先例）：验收标准起草即终态（全部 [x] 带实证据——实现已交付、全量矩阵已绿，证据在案），零代码改动。

## 历史教训/防复发

- 检索结果：kb-search 同域命中 round2-v2（同款死锁 superseded 先例——漏勾条目 1 条 vs 本单 1 条，同根因：勾验在 confirm-doc 前无机器核对清单）。
- 避坑 1（round2-v2 + 本单双实证）：勾验前先 `grep -c '- \[ \]'` 核对剩余未勾数 == 0，再 confirm-doc；验收标准起草即终态。
- 避坑 2：done 前置门（approved 留痕）与内容绑定构成的双 hard 死锁无就地修复通道——superseded 重立是唯一合法出口，代价三件套重走。

## 目标

- **G-1**：对 v1 已交付实现（W1 addedDates 持久缓存 / W2 fill-intent 历史坑注入 / W3 registry fallback / W4 metrics 趋势+确认负担）完成合法关单——零代码改动。
- **G-2**：v1 复核结论（P0=0、P1-1 模块名入关键词已补、P2×5 全处置）与处置证据承继在案。

## 非目标（L1 微改动无实质内容可删本节，不硬填）

- 不改任何 v1 交付的实现代码。
- 不追溯编辑 superseded 的 v1 三件套。

## 约束（L1 微改动无实质内容可删本节，不硬填）

- 验收标准起草即终态；关单前 `grep -c '- \[ \]'` 归零自检。
- 双源纪律等既有红线全部沿用（实现侧已满足）。

## 影响面

- 模块：pipeline
- 数据库：无
- 文件面：仅 workflow 文档（本三件套 + delegations 补记）——无代码改动。

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更——v1 交付含 check-loop 数据源缓存等契约面，本单关单覆盖其闭环 → L2（已定 L2）
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → L3——未触及，不勾

## 验收标准（可测试）

- [x] G-W1 缓存生效：addedDates 按 HEAD 键持久缓存、同 HEAD 复用、变更重算、fail-open（证据：check-loop.test 场景 22a-e 五断言 242/0；实仓 added-dates.json 生成、检查 8 段 gate-stats 实测 12.6→8.9s -29%）
- [x] G-W2 注入生效：fill-intent 自动 kb-search 注入「历史教训」节、零命中走手工命令注释行、命中注入列表（证据：fill-intent.test 30/0——kb 注入/零命中占位双断言；实仓 check-loop 主题注入 4 条同域 incident、零命中主题「手工跑」行生效；复核 P1-1 模块名入关键词已补）
- [x] G-W3 fallback 在案：双 yml registry.npmjs.org 兜底 + papercuts 台账锚缓做定性行（证据：grep 双 yml 命中 + 内联语法解析通过；papercuts 2026-10-09 行在案）
- [x] G-W4 趋势与负担：history 每日一行幂等 + metrics.md 趋势/确认负担行（证据：history 首日行 {docsTotal:287, passRate:86%, confirmCalls:247}、二跑 wc=1 幂等；metrics.md 趋势行「247 次（上月 157 次，+57%）」；gen-workflow-metrics.test 24/0）
- [x] G-降频缓做：plan 偏离留痕②「样本 1<5 不决策」定性（证据：gate-stats 实测样本 1 次 + papercuts 降频行）
- [x] 全量门：npm test 全部套件通过；eslint 0；doctor 14 PASS 0 WARN 0 FAIL；source-sync 0 漂移；rule-budget exit 0；check-loop 仅存量 1 条 advisory；sync-hosts 84 对 0 漂移；gate-checklist 登记完整（证据：v1 关单前全量矩阵输出——本轮关单前复跑确认）
- [x] 复核闭环：L2 独立复核完成——P0=0；P1-1（W2 关键词缺模块名）已补齐；P2×5 处置（注释勘误/fail-open 注释行/shallow 注记/tmp 自愈/spec「--check」说法勘误）（证据：independent-reviewer 复核报告（会话在案）+ v1 spec「确认与复核」节（superseded 在案）+ fill-intent.test 30/0 与注释行冒烟）

> **闭环对账**：关单在 test 阶段。

## 确认与复核

- 确认日期：2026-10-09（自治批次——授权链同 v1：用户「按此顺序我可以直接走 L2 闭环」；superseded 重立为授权范围内合法修订通道）
- 确认人：用户（goal 指令）
- 确认范围：优先级 1→4 实现（已交付并复核）+ 本重立单关单收口
- 复核：L2 独立复核已随 v1 实现完成（P0=0 全处置）——本单零代码改动，结论直接承继
