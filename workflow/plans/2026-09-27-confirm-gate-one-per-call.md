---
状态: done
级别: L2
模块: pipeline
确认指纹: e375e302a137abe5
---
# PLAN — confirm-gate-one-per-call

对应入口：../incidents/2026-09-27-confirm-gate-one-per-call.md
对应 spec：../specs/2026-09-27-confirm-gate-one-per-call.md

## 改动面

- `templates/_agents/scripts/confirm-doc.mjs`：--delegated 分支参数校验层加单文档强制（docs.length > 1 → exit 1 + 逐件口径提示，先于文档处理循环、不写台账）；头注释补口径
- `templates/_agents/scripts/confirm-doc.test.mjs`：+2 场景——delegated 双文档拒绝（exit 1 + 提示 + 台账零写入 + 文档零改动）；delegated 单文档照常（S11 既有回归确认不破）
- `templates/_agents/scripts/check-loop.mjs`：15 新增并录批次 warning 子检查（delegated 合法行按 quote 相同 + ts 差 < 2s 聚组，组 > 1 → warning；revert-draft 注记行跳过）；头注释口径
- `templates/_agents/scripts/check-loop.test.mjs`：+3 场景——同 quote 双份 2s 内 warning；异 quote / 间隔 > 2s 不报；TTY 多文档行不参与聚组
- `templates/_agents/commands/{plan,design,build,test}.md`：确认门段补「逐件调用（多份并录会被拒）」一句
- `AGENTS.md`（根 + templates/AGENTS.md）：确认门条款补「--delegated 逐件调用」
- 装副本/薄适配：sync + sync-hosts --apply（commands 正文改）

## 任务拆解

1. **T1 单文档强制**（confirm-doc + 测试）
   - 判据：confirm-doc.test 新场景绿（拒绝/照常两路）；实测 delegated 双文档 → exit 1 提示
   - 风险：低
2. **T2 批次 warning**（check-loop 15 子检查 + 测试）
   - 判据：check-loop.test 新场景绿；本仓实跑——今日存量并录批次以 warning 可见（数量与台账实况一致）
   - 风险：低（warning 级）
3. **T3 文案四处**（commands ×4 + AGENTS ×2）+ sync 双源同步
   - 判据：AGENTS.md 预算内（+~80B）；source-sync-check 0 差异；sync-hosts 34 对对齐
   - 风险：低
4. **T4 收口**：全套回归（npm test + verify.mjs）+ doctor + feat 提交
   - 判据：全绿；check-loop 15 既有判定零回归（配对/绑定场景全绿）
   - 风险：低

## 执行顺序

T1 → T2 → T3 → T4（串行，件少）。

## 验证方式

- 静态门：npm test 全套（confirm-doc 21/0 +2 / check-loop 69/0 +4 场景）；doctor 0 FAIL；advisory +13 条「确认并录」存量可见（6 L2 单×2 批 + sync-hosts×1，与台账 47 行 delegated 实况对数）——全绿达成
- L2 追加：delegated 双文档拒绝实测留证；台账批次聚组在本仓实跑对数
- 回滚：单 feat 提交 revert 即回

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节，done 只在关单出现。
- 确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 推荐独立复核（independent-reviewer；采纳/驳回由用户定性）
