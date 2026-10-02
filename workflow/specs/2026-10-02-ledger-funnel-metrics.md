---
状态: approved
级别: L2
日期: 2026-10-02
模块: pipeline
备注: 台账炼漏斗——机器口径一次通过/返工/周期入 metrics.md 双表；入口 intents/2026-10-02-ledger-funnel-metrics.md
确认指纹: 905b3f32f8959136
---
# SPEC — ledger-funnel-metrics（台账炼漏斗）

> 对应 intent：`intents/2026-10-02-ledger-funnel-metrics.md`。补可观测性最弱维：台账 (doc, stage, ts, source) → 可行动漏斗。

## 功能行为

### 漏斗口径定义式（本 spec 为单源，后续消费方引用此处）

输入：台账按 doc 分组、组内按 ts 升序的行链。`revert-*` 行为注记（不占链位但参与返工判定）。

| 术语 | 定义式 |
|------|--------|
| **收口件** | 链内存在 stage ∈ {done, closed} 行的 doc（intent/spec/plan 终态=done；incident=closed） |
| **完整链收口** | 收口件且链内存在 approved 行 |
| **协议前收口** | 收口件且链内无 approved 行（首行即终态——2026-09-27 确认门生效前建档或存量补关，链路不可判） |
| **一次通过**（完整链收口的子集） | 非 revert 行恰为 1×approved + 1×终态，且无 revert-* 行 |
| **返工件**（完整链收口的子集） | 含 revert-* 行，或 approved 行 ≥2（重确认） |
| **周期时长** | 收口件：首 approved（协议前件为首行）ts → 终态 ts，天数差 1 位小数；「中位周期」= 当月收口件的中位数 |
| **月度归桶** | 按收口件的**终态行 ts** 所在月 |

真仓校准（2026-10-02 实测）：108 收口 = 92 完整链（含 2 返工：one-per-call 重确认 + effective-date-anchor 回退）+ 16 协议前。

### metrics.md 第二表

`gen-workflow-metrics.mjs` 在体量表后追加：

```
## 闭环漏斗（机器口径，源：.agents/confirmations.jsonl——定义式见 specs/2026-10-02-ledger-funnel-metrics.md）

| 月份 | 收口 | 完整链 | 协议前 | 一次通过 | 返工件 | 中位周期(天) | 台账行数 |
```

- 与体量表同月键、同 GENERATED 标记段（单写者不变）；同月重跑更新该行
- stdout 明细：逐收口件链路摘要（行数/形态/周期）+ 提示行「机器口径可与 delegations.md 自做表人工自报交叉对照（差异即信号，不对账）」
- `--month` 补记语义不变（同月更新）

### 2026-09 回填

实现后跑 `--month 2026-09` 与当月各一行，落 metrics.md 双月漏斗。

## 数据流

```
.agents/confirmations.jsonl（append-only，207 行）
  → gen-workflow-metrics.mjs 读台账（坏行跳过，同检查 15 容错）+ 既有体量事实源
  → workflow/metrics.md（体量表 + 漏斗表，GENERATED 段整段重写）
```

## 系统改动

| # | 文件 | 类型 | 内容 |
|---|------|------|------|
| 1 | `templates/_agents/scripts/gen-workflow-metrics.mjs`（+装副本） | 修改 | 读台账 → 漏斗聚合（口径定义式实现）→ 第二表渲染 + stdout 明细 |
| 2 | `templates/_agents/scripts/gen-workflow-metrics.test.mjs`（+装副本） | 修改 | 漏斗 fixture（一次通过/revert/重确认/协议前/incidents 两跳/跨月）+ 既有体量断言不回退 |
| 3 | `workflow/metrics.md` | 生成 | 双表 + 双月漏斗行（生成物） |
| 4 | `.agents/kit.json` | 自动 | sync |

## 约束遵守映射

- **单写者**：metrics.md 仍仅由 gen-workflow-metrics 重写 ✓
- **检查 16 零接触**：不新增任何文档数字断言，metric-claims 不登记 ✓
- **判据一手事实**：只读台账 doc/stage/ts/source 既有字段，零 schema 变更 ✓
- **台账容错同口径**：坏行跳过（检查 15/19 同款）✓
- **检查 20 合规**：测试套件同步扩展 ✓

## 风险评估

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| R1 | 口径误判（如 revert 行后又有合法 approved 的正常修正流被计返工） | 低 | 定义式按机器事实（链路形态）判定，非价值判断；「返工件」是描述性计数不挂门禁；fixture 覆盖各形态 |
| R2 | 协议前件占比高导致早期月漏斗失真 | 低 | 「协议前」单列透明呈现（16/108≈15%），不混入一次通过率分母 |
| R3 | 体量表回归 | 低 | 既有断言不动 + 全量套件 |
| R4 | 回滚 | 低 | 生成器单函数扩展，revert 即回；metrics.md 重跑即复原 |

## 确认与复核

- 确认日期：2026-10-02（用户对话内「确认」代录，台账 source=chat-delegated）
- 复核：L2——independent-reviewer 复核口径定义式与实现一致、fixture 覆盖各形态、体量表零回归、真仓双月数值抽验