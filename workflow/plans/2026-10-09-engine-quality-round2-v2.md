---
状态: done
级别: L2
模块: pipeline
确认指纹: 21160e0341445228
---
# PLAN — engine-quality-round2-v2

对应入口：../intents/2026-10-09-engine-quality-round2-v2.md
对应 spec：../specs/2026-10-09-engine-quality-round2-v2.md

## 改动方案

- workflow/{intents,specs,plans}/2026-10-09-engine-quality-round2-v2.md：本三件套（零代码改动——v1 实现已交付并复核）
- workflow/delegations.md：补记 v1 superseded 因果行
- workflow/INDEX.md / DASHBOARD.md / metrics.md：随状态变更重生成

## 任务拆解

1. **T1 · 验证矩阵复跑**（对已交付实现）
   - 判据：npm test 全部套件通过；eslint 0；doctor 14 PASS 0 WARN 0 FAIL；source-sync-check 0 漂移；sync-hosts --diff 84 对 0 漂移；gate-checklist 登记完整；rule-budget exit 0；check-loop 仅存量 1 条 advisory
   - 风险：低（全部命令在 v1 关单前已绿，复跑防环境漂移）
2. **T2 · 留痕与关单**
   - 步骤：delegations 补记 → 生成物刷新 → confirm-doc 三件逐份 done → 关单 docs 提交
   - 判据：三件套状态 done；verify --doc 绿凭证绑本单；delegations 含 superseded 因果行
   - 风险：低

## 执行顺序

T1 → T2（T1 全绿方进 T2——verify 非绿不关单）。

## 验证计划

- 全量门（T1 判据清单逐项）
- L2 契约比对：gate-checklist 登记完整（v1 已过，复跑确认）；check-loop 头部清单 vs 6e96edf 逐字一致（v1 已验，不变量）
- 关单：verify.mjs --doc 绿凭证 → 逐条勾验（本 plan 即收口清单）→ confirm-doc 逐份 done

### 偏离留痕（对 spec / 惯例）

1. **v1 勾验事故因果**：split('- [ ] ') 盲勾误伤红线三行与两条例证行 → done 后检查 8 hard + 检查 15 内容绑定双 hard 死锁 → 按引擎明示通道三件 superseded 重立（本单）。避坑写入 intent「历史教训」：验收标准起草时即写最终证据，勾验禁止全文替换类批量操作。
2. **三件套 delegated 同句**（goal 原话）：同 v1 偏离 ①，自治批次授权链，如实留痕供对质。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节，done 只在关单出现。
- 确认结果：approved（2026-10-09 自治批次，授权链同 v1——goal 指令范围内的合法修订重立）；done（关单时随入口文档置终态）
- 确认门记录：本 plan 即收口清单（零代码改动，T1/T2 两任务）
- 复核：L2 独立复核已随 v1 实现完成（P0=0 全处置）——本单零代码改动，结论直接承继

