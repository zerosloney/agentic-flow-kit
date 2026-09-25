---
状态: approved
级别: L1
日期: 2026-09-25
模块: pipeline
备注: 源自 2026-09-25 双维度审查报告改进方向第 3 条。用户对话内确认「改进方向 3」。行为保持重构：枚举值一个不改，只换读取来源；沿 workflow-modules.txt 单源先例（sh 可 grep + node 可读的纯文本）。
---

# INTENT — 状态/级别枚举单源化（workflow-enums.txt，10 处手抄副本归一）

## 背景与问题
- 2026-09-25 双维度审查实证：同一套状态/级别枚举以机器行为形式散抄在 6 个文件 10 处——check-loop.sh 的 `st_ok_doc`（:107）、incident 状态枚举（:327）、incident 级别词表（:335）、L3 放弃件豁免（:183）；workflow-board-server.mjs 的 `STATUS_ENUM`（:60-65）、`PLAN_TERMINAL`（:59）、L3 放弃豁免（:97）；kb-search.mjs `ACTIVE_STATUS`（:81）；gen-workflow-index.mjs `ACTIVE_STATUS`（:35）；fill-{intent,plan,spec}.mjs 的 `LEVELS`（各 :7-9）。
- 口径一致靠注释人工维持（如看板 :54「口径对齐 check-loop.sh」、kb-search :81「与 workflow/INDEX.md 活跃口径一致」）——任何一处改枚举（如未来加 `blocked` 态）其余 9 处静默漂移。
- 仓库已有单源先例 `.agents/workflow-modules.txt`（词表被 check-loop / kb-search / gen-workflow-index 三方共读）却未覆盖枚举。

## 目标
- 新增单源 `templates/_agents/workflow-enums.txt`（8 键）：`doc.status.all/confirmed/active/terminal/abandoned` + `incident.status.all/active` + `level.all`——语义区分已确认/活跃/终态/放弃留档四个子集。
- 新增读取器 `templates/_agents/scripts/workflow-enums.mjs`：parse + 跨键不变量校验（子集关系、活跃∩终态=∅、关键态在位）+ `loadEnums` fail-loud（无 fallback——kit 自带文件，缺失属安装破损，直接抛错崩得可见；doctor §2 布局门同把关）。
- 10 处消费方全部改读单源：sh 侧启动时一次读入预生成 case 模式（零 per-call fork，遵守 check-loop 性能纪律）；node 侧 import helper。
- check-loop.test.sh fixture 提供单源文件 + 新增「文件缺失 → exit 1」fail-loud 场景；doctor §2 布局清单补该文件。
- templates/workflow/README.md「文档协议」补一句枚举单源指引。

## 非目标
- 不改任何枚举值与判定行为（值不变仅换源；全部既有测试套件须无回归通过）。
- 不迁移「规则子集」case（如 L2|L3 须 spec 的级别分级规则——那是规则逻辑不是词表）。
- 不动生成文档注释 / README 里的枚举 prose（叙述性文字，非机器判定）；不覆盖 delegations「结果列」词表（不同领域，agg-delegations 单域消费）。

## 约束
- 零依赖；sh 消费方启动时一次读文件预生成模式串，不进 per-document 循环（MSYS fork 代价纪律）。
- 双源纪律：包源改 templates/_agents/，sync 刷装副本（台账内文件自动覆盖；未入台账的 fill-* 三对手动 cp）。

## 影响面
- 模块：pipeline
- 数据库：无
- 前端页面：无

## 触达红线（对照 AGENTS.md）
- [ ] 规则 / 契约变更 → 否（枚举值与判定行为零变化，纯读取来源重构；沿 modules.txt 先例 L1）

## 验收标准（可测试）
- [ ] 单源 8 键 + helper + 测试落位双源（sync 入台账 / 未入台账件手动 cp），`workflow-enums.test.mjs` 断言真实文件解析、不变量通过、坏行/重复键/缺键/缺文件 fail-loud
- [ ] 10 处消费方改读单源且行为零回归：check-loop 4 处、看板 4 处、kb-search / gen-workflow-index 活跃集、fill-*×3 级别表——既有 34 场景 check-loop 套件 + kb-search / fill-* / gen-index 套件全绿
- [ ] fail-loud 双路径实测：fixture 缺单源文件 → check-loop exit 1 含「枚举单源」提示；node 侧 loadEnums 对不存在路径抛错（测试断言）
- [ ] 消费方源码机器字面量清零：`grep -n "superseded" 消费方.mjs/.sh` 仅剩注释/生成 prose，无判定逻辑字面量（词表归一的可复核证据）
- [ ] doctor §2 布局含 `.agents/workflow-enums.txt`（28 项）且 doctor 0 FAIL
- [ ] `npm test` 全绿 + `source-sync-check --diff` 0 差异

## 确认与复核
- 确认日期：2026-09-25
- 确认人：用户（对话内「继续，改进方向 3」——审查报告改进方向第 3 条）
- 确认范围：枚举单源化 + 消费方改造 + fail-loud；非目标不含枚举值变更与规则子集迁移
- 复核：L1 不要求独立复核
