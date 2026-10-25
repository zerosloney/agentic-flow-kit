---
状态: approved
级别: L2
risk_level: L2
预判: kind=require level=L2
日期: 2026-10-25
模块: infra
沉淀: 无
确认指纹: ddaad5dcb2de7b5c
---
# INTENT — 源仓闭环优化批回灌（语法门加固 / 委派在场门 / 发布观察台账 / 挂载自检门）

## 背景与问题
源仓（Shipyard.Material）2026-10-24/25 引擎演进审查发现四项通用机制 kit 无对应物：
① check-scripts-syntax 只 readdirSync 顶层——源仓复核实证「脚本子目录化 / 目录清空即静默去门」
（97b9b247 修复），kit 同疾；② 委派台账对账只有检查 18 事后 WARN，「该写而未写」漂移数月才可见；
③ deploy §6 的 24h 观察结论不落账，闭环漏斗断在部署后；④ core.hooksPath 不随 clone 传播、漏配即
门禁全静默失效，仅 npx doctor 手动面对质。用户 2026-10-25 对话内确认移植本四项（「确认移植」）；
策略分歧三件（补偿行 / 关单完成度门 / 台账指针门）未拍板不入本批。

## 目标
- [ ] ① check-scripts-syntax 递归扫描 + 每目录非空 fail-closed（源仓 97b9b247 同款修复）
- [ ] ② confirm-doc 终态前置「委派台账在场门」——判据/豁免与检查 18 单源（新模块 delegation-presence.mjs）
- [ ] ③ deploy-observations 第四台账（生而分片）+ deploy.md §6 落账步 + metrics「发布观察」节
- [ ] ④ check-local-gate-config 挂 verify 引擎段第 4 位（WARN 档 + --strict + CI/非 git loud-skip，判据适配 kit 面）

## 非目标
- 不收编补偿行机制 / 关单完成度门 / 台账指针存在性门（策略分歧，待另批拍板）
- 不收编 page-refactor 技能、tfs-pr、gitleaks、--fast 分层语义等装户私有或明确不移植面
- 不动检查 18 判据语义（只把解析来源改由单源模块供给，既有断言零变化）

## 约束
- 引擎件双落：.agents/（自举面）+ templates/_agents/（分发面）镜像；engine-lock 走 --update --note 显式演进
- 在场门豁免口径与检查 18 逐条一致（delegationSince=2026-10-06 锚沿用，不新增锚）；两表解析口径与
  agg-delegations splitTables 互引纪律不变
- 台账新员生而分片（主表只留说明+表头），零存量迁移、零回溯

## 影响面
- 模块：infra
- 数据库：无
- 前端页面：无

## 触达红线（对照 AGENTS.md）
- [x] 规则 / 契约变更（关单判据 + 台账契约 + verify 门表）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3（不触及）

## 验收标准（可测试）
- [ ] 场景：S1 语法门递归命中与空目录 fail-closed（证据：check-scripts-syntax.test 新断言）
- [ ] 场景：S2 委派在场门拦截与放行（证据：confirm-doc.test 扩展用例）
- [ ] 场景：S3 豁免口径与检查 18 一致（证据：confirm-doc.test 边界用例）
- [ ] 场景：S4 观察台账生而分片与合并读（证据：ledger-shards.test 扩展用例）
- [ ] 场景：S5 metrics 发布观察节零数据占位 / 脏行 fail-loud（证据：gen-workflow-metrics.test 扩展用例）
- [ ] 场景：S6 挂载自检 WARN / --strict / loud-skip 三档（证据：check-local-gate-config.test 新套件）
- [ ] 场景：S7 verify 引擎段八门全绿（证据：verify --doc 本单输出）
