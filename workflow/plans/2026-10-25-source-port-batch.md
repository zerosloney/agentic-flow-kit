---
状态: approved
级别: L2
模块: infra
确认指纹: 0c5168eb228fa744
---
# PLAN — 源仓闭环优化批回灌

对应入口：../intents/2026-10-25-source-port-batch.md
对应 spec：../specs/2026-10-25-source-port-batch.md

## 任务拆解
- [ ] 1. 语法门加固：check-scripts-syntax.mjs 递归 walk（SKIP_DIRS=node_modules/.git/tmp、符号链接跳过）+ 每目录非空 fail-closed；test 补递归命中/空目录判红断言；双落
   - 判据：新断言绿且既有断言零改动
   - 依赖：无（可立即开工）
   - 风险：低
   - 留痕：（勾选时回填）
- [ ] 2. 委派在场门：delegation-presence.mjs 新模块（parseDelegationRows/rowCovers/delegationRowsOf）+ 检查 18 解析改单源供给（delegationResultRows 语义不变）+ confirm-doc 终态前置门（intents/specs/plans→done、incidents→fixed/closed；日期键 incidents 用 发现||日期）+ confirm-doc.test / delegation-presence.test / check-loop.test 扩展；双落
   - 判据：拦截/放行/豁免三组用例绿；check-loop.test 既有 18 断言零改动
   - 依赖：无（可立即开工）
   - 风险：中（单源改造须保语义零变化；incidents 族纳入是本仓判据差异点，源仓门只盖新需求族）
   - 留痕：（勾选时回填）
- [ ] 3. 发布观察台账：ledger-shards LEDGERS 增 deploy-observations（含 TABLE_HEADERS/marker 等配套）+ deploy.md §6 落账步（双落）+ templates/workflow/deploy-observations.md 与自举副本主表 + gen-workflow-metrics「发布观察」节（节 marker 同步、零数据占位、脏行 throw）+ workflow/README.md 台账句三→四（双落）+ ledger-shards.test / gen-workflow-metrics.test 扩展
   - 判据：S4/S5 断言绿；append 后主表无数据行
   - 依赖：无（可立即开工）
   - 风险：低
   - 留痕：（勾选时回填）
- [ ] 4. 挂载自检门：check-local-gate-config.mjs 新脚本（四判据：hooksPath / jsonl-union driver / .gitattributes 行 / 五钩子在位；GITHUB_ACTIONS 与非 git loud-skip；--strict）+ test 新套件 + verify.mjs 门表第 4 位与头部注释（七门→八门）+ verify.test 门数断言同步；双落
   - 判据：S6/S7 断言绿；本机全配态跑 verify 第 4 门 PASS
   - 依赖：无（可立即开工）
   - 风险：低
   - 留痕：（勾选时回填）
- [ ] 5. 引擎面收尾：check-engine-integrity --update --note（逐件凭据）+ 自举 sync 刷 kit.json managed + CHANGELOG Unreleased 入账 + workflow/INDEX.md 重建
   - 判据：check-engine-integrity 绿、sync 零漂移、INDEX 含本单
   - 依赖：被任务 1-4 阻塞
   - 风险：低
   - 留痕：（勾选时回填）
- [ ] 6. 全量验证与关单准备：npm test 全量 + verify --doc 本单（绿凭证落账）+ delegations 台账落「自做任务结果」行
   - 判据：八门全绿凭证；intent 验收标准逐条勾验
   - 依赖：被任务 5 阻塞
   - 风险：低
   - 留痕：（勾选时回填）

## 执行顺序
见任务拆解依赖行：frontier = 任务 1/2/3/4（相互独立），5 收尾，6 关单。

## 验证方式
- 验证层标注：任务 1-4 单元层（各自 test 套件）；任务 5-6 集成层（npm test 全量 + verify --doc）
- 静态门：npm test；node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-25-source-port-batch.md
- L2 追加：判据对账——检查 18 语义零变化（既有断言不改跑绿即证）；在场门豁免口径与检查 18 逐条对齐用例覆盖

## 确认与复核
- 确认后补「确认结果 / 确认时间」；`done` 只在关单出现。
