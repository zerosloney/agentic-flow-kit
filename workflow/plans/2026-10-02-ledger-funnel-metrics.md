---
状态: done
级别: L2
模块: pipeline
确认指纹: 0586285046ea29a2
---
# PLAN — ledger-funnel-metrics（台账炼漏斗）

对应入口：../intents/2026-10-02-ledger-funnel-metrics.md
对应 spec：../specs/2026-10-02-ledger-funnel-metrics.md（口径定义式单源表，真仓校准 108 收口 = 92 完整链 + 16 协议前）

## 改动方案

- `templates/_agents/scripts/gen-workflow-metrics.mjs`（+装副本）：读台账（坏行跳过）→ 按 doc 链聚合（口径定义式实现：收口/完整链/协议前/一次通过/返工/周期）→ metrics.md 体量表后追加「闭环漏斗」第二表（同 GENERATED 段）+ stdout 逐件明细与「与 delegations 自报对照」提示
- `templates/_agents/scripts/gen-workflow-metrics.test.mjs`（+装副本）：漏斗 fixture（一次通过/revert/重确认/协议前/incidents 两跳/跨月收口）+ 既有体量断言不动
- `workflow/metrics.md`（生成物）：双表 + 2026-09/2026-10 双月漏斗行
- `.agents/kit.json`：sync 自动

## 任务拆解（L2/L3 必填）

1. 漏斗聚合函数 + 第二表渲染
   - 判据：真仓 `--month 2026-09` 与当月各出一行；108 收口分类计数与 spec 校准值一致（92/16/2）
   - 风险：中（口径实现需与定义式逐条对齐；周期中位数计算）
2. 漏斗 fixture（测试套件扩展）
   - 判据：六形态用例全绿（一次通过/revert/重确认/协议前/incidents 两跳/跨月）；既有体量断言全绿
   - 风险：低
3. 真仓回填 + stdout 明细核验
   - 判据：metrics.md 双表落盘；stdout 含逐件链路与对照提示；手工抽验 2 个收口件周期值
   - 风险：低
4. sync + 全量验证
   - 判据：sync 无漂移；npm test 全绿；verify 全绿；check-loop 无新增告警
   - 风险：低

## 执行顺序（L2/L3 必填）

1 → 2 → 3 → 4 收口。

## 验证计划

- 静态门：测试 = `npm test`（含扩展套件）；构建 = 无
- L2 追加：口径定义式 ↔ 实现逐条对账；真仓数值抽验（108/92/16/2）；独立复核
- 前端 / UI / L3：不适用

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done。
- 确认结果：approved（2026-10-02 用户对话内确认，原话「确认」——plan 全文过目）；done（2026-10-02 关单，随入口文档置终态；实现 dcb7d1f + P2×3 收口 ad42ca8）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（改动方案节随 plan 全文一并过目确认）
- 复核：已完成——0 P0 / 0 P1 / 3 P2 建议放行，全收随 ad42ca8；fixture 七形态 24/0、体量零回归、检查 16 零接触、单写者未破坏均核实