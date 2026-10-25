---
状态: done
级别: L2
risk_level: L2
预判: kind=require level=L2
日期: 2026-10-25
模块: infra
沉淀: 无
确认指纹: 26e3b2545ee1189d
---
# INTENT — 源仓策略分歧批回灌二（补偿行生成器 / 关单完成度门收窄版）

## 背景与问题
前单（2026-10-25-source-port-batch）遗留三项策略分歧待拍板，用户 2026-10-25 对话内「按照你建议来」
授权按审查倾向处置。处置决定：**收编补偿行机制**（终态文档裁定回填的第三条路——源仓 10-24 踩坑
实证「手搓指纹被检查 15 HARD-BLOCK」，工具化收口为单源口径）；**收编关单完成度门收窄版**
（缺口核验：本仓检查 1 只要求同名 plan **存在**、不要求**已确认**——L2/L3 intent 可在同名 plan
仍 draft 时合规关单，agent 跳过 closeout 自核即逃逸，与源仓 97b9b247 复核 P1 同形洞）；
**不收编**台账指针存在性门（verify 八门关单时已兜底悬空行，提交时刻增量面小）与
reviewLineFor hard 化（本仓 L2 spec 模板本无独立复核行——升 hard 与模板语义冲突，属
policyVersion 演进另批）。

## 目标
- [x] ① append-compensation.mjs 常驻补偿行生成器：指纹 bindingSha256 单源 + 末次行选取 + 四类拒绝面（fail-loud）+ maintain.md §4 落「关单后裁定回填」条
- [x] ② stage-gates.planConfirmedFor（归档感知）+ confirm-doc L2/L3 intent →done 前置「同名 plan 必已确认」门（superseded plan 恒拒并指向正确处置）
- [x] ③ 检查 15 漂移 blocker 文案补补偿行通道指引（判据零变化，末次生效口径不动）

## 非目标
- 不收编台账指针存在性门（check-ledger-doc-presence）——verify 八门已兜底，决策留痕见背景
- 不收编 reviewLineFor hard 化——L2 无复核行是本仓模板既有语义，升 hard 须 policyVersion 演进另批
- 不动检查 15 判据（末次生效 / prev 复原 / 豁免锚全部原样）；不动 confirm-doc 既有门文案锚点

## 约束
- 引擎件双落（.agents/ + templates/_agents/）；engine-lock --update --note 显式演进
- 补偿行政策边界如实声明：owner 裁定原话必填（--quote）、只追加不改历史行、source=chat-delegated
- planConfirmedFor 判据与检查 1 配对面同基名（家族同名）；归档感知（关单即归档语义，台账 doc 字段不改）

## 影响面
- 模块：infra
- 数据库：无
- 前端页面：无

## 触达红线（对照 AGENTS.md）
- [x] 规则 / 契约变更（关单判据 + 终态修订政策 + 台账写入通道）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3（不触及）

## 验收标准（可测试）
- [x] 场景：S1 补偿行生成与检查 15 恢复绿（证据：append-compensation.test 场景 1——指纹 bindingSha256 同函数复算即绿，PASS 9/0，feat 4a2eac5）
- [x] 场景：S2 四类拒绝面 + 缺 --quote 拒跑（证据：append-compensation.test 场景 2a-2e，五类拒绝零写入）
- [x] 场景：S3 关单完成度门拦截/放行/归档感知/superseded 恒拒（证据：confirm-doc.test S51/S52/S55/S53——PASS 94/0）
- [x] 场景：S4 L1 intent 不拦 + 既有门文案锚点零改动（证据：confirm-doc.test S54 + S46-S50 既有断言零变化）
- [x] 场景：S5 verify 八门全绿（证据：verify --doc 三份各 🎉 8 项通过；npm test 82 套件 0 失败）
