---
状态: done
级别: L2
模块: infra
确认指纹: 97816e1384c634de
---
# SPEC — 源仓策略分歧批回灌二

对应入口：../intents/2026-10-25-source-port-batch-2.md

## 功能行为

### ① 补偿行生成器（append-compensation.mjs，源仓 d134be8f 回灌适配）
终态文档（done/closed/superseded/cancelled）改正文后，按 owner 裁定追加**重确认补偿行**：
同 doc+stage、fingerprint = bindingSha256（改后内容按末次行 prev 复原口径哈希，单源
check-loop.mjs 导出）、prev 沿用该 doc+stage 末次台账行、quote = 用户裁定原话必填
（source: chat-delegated、quoteGrounding: verbatim）。写入走 confirm-doc.appendLedger
（分片/主台账口径与确认门同一出口，doc 链由 appendLedger 维护）。检查 15 按末次生效——
补偿行落账后内容漂移 blocker 消解（判据零变化）。
拒绝面（fail-loud，防把 s15 绑定降级路径改造成失配 hard）：非终态（前向跳转走 confirm-doc，
无补偿面）/ 台账无该 doc+stage 行 / 末次行缺 prev（schema 演进前存量）/ 内容与末次指纹一致
（无可补偿漂移）/ 缺 --quote。用法：`node .agents/scripts/append-compensation.mjs <doc...> --quote "<用户原话>"`。
maintain.md §4 增「关单后裁定回填」条（政策与生成器指针）。

### ② 关单完成度门·收窄版（planConfirmedFor，源仓 97b9b247 回灌收窄）
stage-gates 新增 planConfirmedFor(root, base)：同名 plan 须存在且已确认（approved/done；
归档感知——workflow/archive/<月>/plans/ 同名可命中，台账匹配仍用原路径）。
confirm-doc 前置门：L2/L3 **intent** →done 时未过 → 拒绝落账（提示先走 build.md 完成同名 plan
并确认）。边界（源仓 2026-10-24 复核 m2 同款）：plan 被合法置 superseded/cancelled 时本门**恒拒**
——该 intent 的 →done 通道随之关闭，正确处置是 intent 同步 superseded，不在本门加放弃态放行
（否则「plan 已废弃但 intent 照样关单」成为逃逸路径）。L1 intent 不在本门面（协作道语义）。

### ③ 检查 15 文案补通道
漂移 blocker 文案尾部补补偿行通道指引（maintain.md §4 / append-compensation.mjs）；
判定逻辑、豁免锚、末次生效口径全部零变化。既有测试若锚定原文案则同步断言。

## 验收场景

### S1 补偿行生成与漂移消解
- GIVEN done 文档已有含 prev 的台账行，正文被修改
- WHEN append-compensation <doc> --quote "<原话>"
- THEN 台账追加行（fingerprint=bindingSha256、prev 沿用、source=chat-delegated）；检查 15 复核绿

### S2 拒绝面
- GIVEN 非终态 / 无台账行 / 末次行缺 prev / 内容未变 / 缺 --quote
- WHEN 同上
- THEN 五类各自拒绝（reason 点名）、零写入、exit 非零

### S3 关单完成度门
- GIVEN L2 intent approved 已提交，同名 plan 为 draft / approved / 仅存于归档 / superseded
- WHEN confirm-doc intent →done
- THEN draft 拒绝；approved 放行；归档命中放行；superseded 恒拒且提示「intent 同步 superseded」

### S4 泳道与锚点
- GIVEN L1 intent →done（无同名 plan 或 plan 任意态）
- WHEN confirm-doc
- THEN 本门不拦；confirm-doc.test 既有断言（前置门/在场门文案锚）全绿零改动

### S5 verify 八门
- WHEN node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-25-source-port-batch-2.md
- THEN 八门全绿（含本批改动面）

## 数据流
① 终态文档正文 → bindingSha256(lines, 末次行 prev) → appendLedger（分片/主台账 + doc 链）→
检查 15 末次生效对账。② confirm-doc intent→done → planConfirmedFor（活跃 → 归档探查 + 台账
approved/done 判定）→ 拒绝或放行。

## 系统改动清单
- 后端：无（引擎面）
- 引擎（双落）：append-compensation.mjs（新，+test）、stage-gates.mjs（+planConfirmedFor，test 扩展）、
  confirm-doc.mjs（intent→done 前置门，test 扩展）、check-loop.mjs（检查 15 文案一行，断言同步如有）、
  maintain.md §4 条（模板+自举双落）、engine-lock --update --note、kit.json 自举 sync、CHANGELOG Unreleased
- 数据库：无
- 前端：无

## 约束遵守映射（对照 AGENTS.md 触达红线 / 工程原则）
| 红线 / 工程原则 | 本 spec 如何满足 |
|------|------------------|
| 关单判据 + 终态修订政策变更 → L2 | 三件套防御道；补偿行是**收口既有暗路**（末次生效本就支持），非放宽判据——s15 判据零变化 |
| 单源纪律 | 指纹单源 bindingSha256、写入单源 appendLedger、plan 确认判据单源 planConfirmedFor（检查 1/关单门同基名） |
| 最短可工作 diff | reviewLineFor 不搬（与 L2 模板语义冲突）；台账指针门不搬（verify 已兜底） |

## 验收判据
| 判据（可观察行为） | 证据（测试文件 / 命令 / 证据文件） | 状态 |
|---|---|---|
| 全量测试绿（含新/扩套件） | npm test | 覆盖 |
| 引擎八门全绿（本单 --doc 绑定） | node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-25-source-port-batch-2.md | 覆盖 |

## 风险评估
- 补偿行被滥用为「随意改已关单文档」｜应对：--quote 必填 + source=chat-delegated 如实记账 + maintain §4 政策边界声明（append-only 不改历史行，对质靠 git）
- planConfirmedFor 拦住在途 L2 关单｜应对：仅 L2/L3 intent→done 新执法点；plan approved 即过；归档感知
- 存量 L2 intent 已 done 而 plan 仍 draft｜应对：本门只在 confirm-doc 动作时刻执法（存量不回溯，检查 1 存量面不变）

## 确认与复核
- 确认结果 / 确认时间写在文件头 frontmatter。
