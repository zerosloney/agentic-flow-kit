---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-02
模块: pipeline
备注: 三轴审查改进 1——从 confirmations.jsonl 炼闭环漏斗（机器口径一次通过/返工/周期时长）入 metrics.md，补可观测性最弱维（评审 3/5）
确认指纹: 5c2a6cdd71bd2ae6
---
# INTENT — ledger-funnel-metrics（台账炼漏斗）

## 背景与问题

2026-10-02 能力成熟度评审（34/40）最弱维 = **可观测性 3/5**：metrics 只有体量快照（文档数/字节/预算占比），**没有任何闭环漏斗指标**——返工率、一次通过率、周期时长在台账里明明已有全部原料（`(doc, stage, ts)` 逐阶段事实，207 行），却未炼成可行动数据。评审原话：「台账里逐阶段 ts 明明已含全部原料，却未炼成可行动漏斗」，并把「从台账炼漏斗」列为可控准确三投之首。

现有旁证：delegations.md 自做表的人工自报「一次通过/返工×N」——机器口径漏斗落地后可与人工自报**交叉对照**（口径差异即信号）。

## 历史教训/防复发

- 检索结果：`incidents/2026-09-28-metric-claim-gate.md`（量化断言门——metrics 声明须与计算一致，检查 16 消费 metric-claims.txt）；`incidents/2026-09-28-batch-ledger-audit.md`（判据用一手事实）
- 避坑指南：
  - 漏斗指标只读台账既有字段（doc/stage/ts/source），**不新增 schema**——schema 演进是另一回事
  - 不新增文档断言（不在 README/AGENTS 写具体数字）——避免触发检查 16 的 metric-claims 登记面（登记是后续按需的事）
  - metrics.md 是**单写者**文件（gen-workflow-metrics 整段重写 + GENERATED 标记）——漏斗表并入该生成器，不开第二个写者

## 目标

- `gen-workflow-metrics.mjs` 扩展：metrics.md 增第二张表「闭环漏斗（机器口径，源：confirmations.jsonl）」，按月一行：
  - **收口**：该月置终态（done/closed）的入口文档数
  - **机器一次通过**：链路恰一次 approved + 一次终态行、无 revert-*/重确认的文档数（机器口径定义于 spec）
  - **返工件**：含 revert-* 行或多次 approved（重确认）的收口文档数
  - **中位周期**：首 approved → 终态 ts 的天数（收口件中位数，1 位小数）
  - **台账行数**：该月新增台账行
- stdout 明细：逐收口文档链路（含与 delegations 人工自报的对照提示——仅提示不对账）
- 既有体量表保留不动（同文件双表）；`gen-workflow-metrics.test.mjs` 扩漏斗 fixture（检查 20 合规）
- 回填历史月份：`--month` 补记 2026-09（台账自 2026-09-26 起，数据完整可用）

## 非目标

- 不把漏斗指标挂任何门禁（观测面，非约束面——沿 metrics「只看见趋势」定位）
- 不做 metric-claims 登记（无文档数字断言，检查 16 零接触；后续若要在 README 引用具体数字再登记）
- 不改台账 schema、不改 confirm-doc 写入逻辑
- 不做看板展示（看板读 check-loop 告警面；漏斗先落 metrics.md，看板接入另批）

## 约束

- 单写者：metrics.md 只由 gen-workflow-metrics.mjs 重写（GENERATED 标记内）
- 台账读取容错：坏行跳过（与检查 15/19 同口径）；机器口径只认 (doc/stage/ts/source) 一手字段
- 既有体量表列与断言不回退；测试套件同步扩展

## 影响面

- 模块：pipeline
- 数据库：无
- （无前端页面）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）$\rightarrow$ 级别至少 L2
  - 触及面：闭环漏斗的**聚合投影键**（机器口径定义——收口/一次通过/返工/周期的判定式，一处定义、后续所有消费方引用）

> 触及任一红线即为 L2 / L3，必须立 ../specs/YYYY-MM-DD-<主题>.md 写明如何满足，方可起草 plan。

## 验收标准（可测试）

- [x] 真仓跑 `gen-workflow-metrics.mjs`：metrics.md 双表（体量表原样 + 漏斗表新行），2026-09 与 2026-10 两个月漏斗行、数值与手工抽验一致（证据：metrics.md 双表落盘；复核者 dry-run 双月抽验 09=73/73/0/71/2、10=35/23/12/23/0，合计对账 108 收口 = 96 完整链 + 12 协议前、2 返工全在 09 月——P2-3 修正后重推导）
- [x] 漏斗 fixture：构造台账 fixture（一次通过件 / revert 件 / 重确认件 / incidents 两跳 / 跨月收口）断言各分类计数与周期中位数（证据：gen-workflow-metrics.test.mjs L1-L7 七形态（含 incident 两跳确认链与单行协议前对照）24/0 全过）
- [x] 既有体量表断言不回退：gen-workflow-metrics.test.mjs 既有用例全绿 + npm test 全绿（证据：场景 1-4 全过（场景 2 分段计数更新属双表结构合理适配）；npm test「✅ 全部套件通过」）
- [x] stdout 明细含逐文档链路与「与 delegations 自报对照」提示（证据：脚本输出「闭环漏斗：收口…」+ 逐件行 + ℹ️ 对照提示行）
- [x] verify.mjs 全绿 + check-loop 无新增告警（证据：verify 2/2 全绿；check-loop exit 0——2026-10-02 实录）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 hard-block。

## 确认与复核

- 确认日期：2026-10-02（用户对话内「确认」×3 代录，台账 source=chat-delegated）
- 确认人：用户（对话内明确放行即确认）
- 确认范围：ledger-funnel-metrics（漏斗表 + 机器口径定义 + fixture）
- 复核：已完成（independent-reviewer 新上下文）——0 P0 / 0 P1 / 3 P2，建议放行；P2×3 用户定性全收随 `ad42ca8` 收口（P2-3 口径语义盲点：incident 确认阶段按件型=fixed，两跳链归完整链、重推导 108=96+12；P2-1 终态≥2 入返工定义式；P2-2 一次通过边界声明）；口径↔实现逐条对、fixture 七形态、体量零回归、检查 16 零接触、单写者未破坏均核实