---
状态: done
级别: L2
risk_level: L2
预判: kind=require level=L2
日期: 2026-10-26
模块: infra
沉淀: 无
确认指纹: 2d2dc01e64b9dbb6
---
# INTENT — 关单执法点前移批（验收勾验前置门 / 放弃态配对豁免 / 装户形态测试）

## 背景与问题
自审 32 项中的三项机制演进（audit-fixes 批已收四项实现级 + 文档 20 项，本批收尾）：
① →done 前置门不含「验收标准勾验」——batch-2 漏勾 S1-S5 照样落账 done（亲历实证），
执法时点与「关单在 test、勾验后才 done」协议语义错位，单机不 push 则无兜底；
② 放弃态×结构配对无豁免——draft intent→cancelled（未建 plan）合法跳转后被检查 1「配对断裂」
hard 拦（特性分支 featureHold 不归档 → 分支 push 被自家门拦到合入）；incidents 同形；
③ 新机制测试盲区形态——夹具默认裸仓（无 kit.json→v1），装户真实形态（v12：doc 链/分片默认/
锚行为差异）零覆盖，补偿行首用即断（亲历）。

## 目标
- [x] ① confirm-doc →done 前置「验收勾验门」：正文含「## 验收标准」节且节内有未勾行 → 拒（判据与检查 8 同口径，执法时点前移）（证据：confirm-doc.test S56/S57——PASS 99/0，feat bf7897d）
- [x] ② 检查 1/3 结构配对放弃态豁免（证据：check-loop.test 场景 2b/2c 三用例——346/0）
- [x] ③ v12 冒烟组 + 头注纪律（证据：S58 全链断言——家族共分片/doc 链分组接续；confirm-doc.mjs 头注）

## 非目标
- 不动检查 8 判据（勾验对账语义不变，只前移执法点）
- 不动 featureHold 归档语义（归档出口已有，本批解的是「不归档也该能推」）
- 不建全量「形态矩阵测试框架」——最小切面：v12 冒烟组 + 纪律注记

## 约束
- 引擎件双落；engine-lock --update --note；豁免零回溯（门只在跳转时点执法，存量终态不追责）
- 勾验门节边界判据 = 「## 」到下一「## 」（与检查 8 节锚定同构）；incidents →fixed/closed 不入勾验门面（其闭环执法点=防复发证据门 3x，职责不混）

## 影响面
- 模块：infra
- 数据库：无
- 前端页面：无

## 触达红线（对照 AGENTS.md）
- [x] 规则 / 契约变更（关单判据前移 + 配对判据豁免面）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3（不触及）

## 验收标准（可测试）
- [x] 场景：S1 勾验门拦截/放行（证据：S56 未勾拒+全勾过、S57 无节不拦）
- [x] 场景：S2 incidents →fixed 不受勾验门影响（证据：既有 S49 等零回归，99/0）
- [x] 场景：S3 放弃态豁免（证据：场景 2b cancelled/superseded intent、2c cancelled incident——expectOk 全过）
- [x] 场景：S4 v12 冒烟（证据：S58——intent 行落分片主台账无、doc 链接续、plan/intent 关单放行）
- [x] 场景：S5 全量测试绿 + verify 八门绿（证据：npm test 82 套件 0 失败；verify --doc 三份各 🎉 8 项通过）
