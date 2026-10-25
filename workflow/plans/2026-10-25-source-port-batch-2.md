---
状态: approved
级别: L2
模块: infra
确认指纹: 30acd43f0b3e56ba
---
# PLAN — 源仓策略分歧批回灌二

对应入口：../intents/2026-10-25-source-port-batch-2.md
对应 spec：../specs/2026-10-25-source-port-batch-2.md

## 任务拆解
- [ ] 1. 补偿行生成器：append-compensation.mjs（bindingSha256/appendLedger/loadAllConfirmations 复用；pickLastRow/buildCompensation 纯函数导出；四类拒绝面 + 缺 quote）+ append-compensation.test（S1/S2：生成→15 恢复绿、五类拒绝零写入）+ maintain.md §4「关单后裁定回填」条（双落）
   - 判据：新套件绿；真实仓手工演练一例（本单自身无需补偿——用夹具证）
   - 依赖：无（可立即开工）
   - 风险：低
   - 留痕：（勾选时回填）
- [ ] 2. 关单完成度门：stage-gates.planConfirmedFor（活跃→归档探查、ENTRY_STATUSES 判定、superseded/cancelled 恒拒语义）+ confirm-doc intent→done 前置门（L2/L3）+ stage-gates.test / confirm-doc.test 扩展（S3/S4：draft 拒/approved 过/归档过/superseded 恒拒/L1 不拦）
   - 判据：扩展用例绿且 confirm-doc.test 既有断言零改动
   - 依赖：无（可立即开工）
   - 风险：中（新执法点拦关单动作，须豁免面精确：仅 L2/L3 intent→done）
   - 留痕：（勾选时回填）
- [ ] 3. 检查 15 文案补通道：check-loop.mjs:1400 漂移 blocker 尾部补「或按 maintain.md §4 补偿行通道」+ 锚定断言排查同步（双落）
   - 判据：判据零变化（既有 15 断言不改跑绿；仅文案尾缀）
   - 依赖：无（可立即开工）
   - 风险：低
   - 留痕：（勾选时回填）
- [ ] 4. 引擎面收尾：engine-lock --update --note + 自举 sync + CHANGELOG Unreleased 入账 + INDEX 重建
   - 判据：integrity 绿、sync 零漂移
   - 依赖：被任务 1-3 阻塞
   - 风险：低
   - 留痕：（勾选时回填）
- [ ] 5. 全量验证与关单：npm test + verify --doc 本单（绿凭证）+ delegations 落行 + done 代录 + 关单提交
   - 判据：八门全绿凭证；验收标准逐条勾验
   - 依赖：被任务 4 阻塞
   - 风险：低
   - 留痕：（勾选时回填）

## 执行顺序
见任务拆解依赖行：frontier = 任务 1/2/3，4 收尾，5 关单。

## 验证方式
- 验证层标注：任务 1-3 单元层（各自 test 套件）；任务 4-5 集成层（npm test 全量 + verify --doc）
- 静态门：npm test；LEDGER_HISTORY_BASELINE=5ca9e8c2 node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-25-source-port-batch-2.md
- L2 追加：判据对账——检查 15 判据零变化（末次生效/prev 复原/豁免锚）；planConfirmedFor 与检查 1 同基名口径对齐用例

## 确认与复核
- 确认后补「确认结果 / 确认时间」；`done` 只在关单出现。
