---
状态: approved
级别: L2
模块: infra
确认指纹: 379c2141c0bcb6e8
---
# SPEC — 委派台账原因谱系统一

对应入口：../intents/2026-10-20-agg-cause-lineage.md

## 功能行为
结果格括号位复用：`返工×N（门禁噪声）` 既有形态优先消费；其余 `返工×N（原因）` 与
`主兜底（原因）` 解析出 cause。causeSummary：直方图（词表排序优先、词表外照收）+ 未记总数 +
锚前存量/锚后待记分列（CAUSE_ANCHOR='2026-10-20'，无日期行按待记）。metrics：复核采纳行
（cause=复核采纳）不计 reworkSum（门 3 随之豁免）、单列 adoptedRework 观测。月度输出增
「返工原因」行；快照行备注增未记分列与采纳标注。

## 验收场景

### S1 原因括号解析与噪声互斥
- GIVEN 结果格 `返工×2（需求歧义）` 与 `返工×1（门禁噪声）`
- WHEN parseResult
- THEN 前者 kind=rework 且 cause=需求歧义；后者 kind=rework-noise 无 cause

### S2 未记分列
- GIVEN 锚前裸返工行 + 锚后裸返工行 + 带原因行
- WHEN causeSummary
- THEN unrecordedPre=1 / unrecordedSince=1 / 直方图含带原因行

## 系统改动清单
- 后端：agg-delegations.cjs（解析/常量/causeSummary/metrics/输出/exports）+ 其 test（场景 10）；delegations.md 记法节（模板+装户副本）；engine-lock --note
- 数据库：无
- 前端：无

## 约束遵守映射（对照 AGENTS.md 触达红线 / 工程原则）

| 红线 / 工程原则 | 本 spec 如何满足 |
|------|------------------|
| 台账记法 + 门 3 判据收窄（L2） | 零 schema 变更（括号位复用）；存量零回填语义保持；收窄有源仓谱系先例 |
| 简洁优先 | 不引新列、不迁模块格式，最小 diff |

## 验收判据

| 判据（可观察行为） | 证据（测试文件 / 命令 / 证据文件） | 状态 |
|---|---|---|
| 套件全绿（场景 10 七断言） | npm test | 覆盖 |
| 本仓七门全绿 | node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-20-agg-cause-lineage.md | 覆盖 |

## 风险评估
- 装户存量行无原因（聚合出未记计数）｜ 应对：锚前/锚后分列 + 记法声明「存量不回填是政策非欠账」

## 确认与复核
- 确认结果 / 确认时间写在文件头 frontmatter。
