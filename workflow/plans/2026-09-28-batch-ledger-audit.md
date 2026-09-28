---
状态: approved
级别: L2
日期: 2026-09-28
模块: pipeline
备注: 同名入口：../incidents/2026-09-28-batch-ledger-audit.md；同名 spec：../specs/2026-09-28-batch-ledger-audit.md。L2 四节。
确认指纹: 60f576072e148387
---
# PLAN — 并录审计改读 batch 事实

## 任务拆解

### T1 confirm-doc 记调用事实：`templates/_agents/scripts/confirm-doc.mjs`

**判据**：同一进程调用产生的台账行 `batch` 相同、`seq` 从 1 递增、`of` = 本次传入份数。

- T1.1 调用开始生成一个 `batch`（进程级，`crypto.randomBytes(3).toString('hex')` 即 6 位短串；无时间语义、无全局唯一要求）
- T1.2 `appendLedger` 落 `batch` / `seq` / `of`；`seq` 按 `docs` 迭代序递增
- T1.3 现有 `docs.length > 1` 拒绝**不动**（入口层已堵；故正常路径恒 `of=1`）
- T1.4 头注释台账 schema 段补三字段说明

**自查**：单份 delegated → 台账行 `of=1, seq=1`；TTY 模式同样记（形态无关）。

### T2 判据换锚：`templates/_agents/scripts/check-loop.mjs`

**判据**：检查 15 并录段**不再引用 quote 相等 / ts 差**；改为读 `batch`/`of`。

- T2.1 旧聚组逻辑（排序 + 线性扫描 + 2s 阈值）**整段退役**
- T2.2 新判据：按 `batch` 分组，组内 `of > 1` → 报并录；`of === 1` → 不报
- T2.3 无 `batch` 字段的行 → 降级出账（**不猜、不回溯**），文案明示「schema 演进前，无可判定」
- T2.4 头注释检查项 15 段同步口径（旧判据退役 + 新判据读事实；**不改编号**）

**自查**：本仓实跑，advisory 由 **22 条变为 8 条**（退役的 14 条并录告警全部消失——须逐条解释差异来源，确认不是误删）。

### T3 测试（两个套件）

**判据**：新增场景全绿；**既有并录场景只改判定依据与注释，不放宽断言强度**。

`check-loop.test.mjs` 新增 ≥5：
- T3.1 **换 quote 的并录仍须被拦** ← 现判据盲区，核心回归；**必须变异自验：在旧判据下变红**
- T3.2 同 batch 且 `of>1` → 报
- T3.3 `of=1` 且复用同句 quote → **不报**（修现判据假阳性）
- T3.4 人为延迟跨 2s 的并录仍须被拦（修现判据另一漏报面）
- T3.5 无 `batch` 行 → 降级出账、不误伤

`confirm-doc.test.mjs` 新增：单次调用 N 份 → batch 相同 / seq 递增 / of=N；单份 → of=1。

### T4 文档：`workflow/README.md`「审计边界」节

**判据**：台账 schema 演进声明——新增 `batch/seq/of`；历史行降级口径；append-only 故**不回填**。

### T5 双源同步与回归

**判据**：`source-sync-check --diff` 0 差异；`doctor` 0 FAIL；`verify.mjs` 全绿。

- T5.1 `flow-kit sync`（刷装副本 + 台账 sha）
- T5.2 `source-sync-check --diff` → 0 差异
- T5.3 `gate-checklist --diff` → 登记表无需改，0 断档 / 0 未登记
- T5.4 `verify.mjs` → 全绿

## 风险评估

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| 旧判据退役 → 本仓 14 条并录告警消失，被误读为「隐藏了违规」 | 改动后 advisory 骤降 | T2 自查要求**逐条解释** 22→8 的差异来源；降级出账是「如实可见」而非静默删除，文案须明示 |
| 实现时把既有并录测试「改到绿」（放宽断言） | 判据换了，旧场景语义不再成立 | T3 硬要求：只改判定依据与注释；并新增 T3.1 作为必须在旧判据下变红的回归锚 |
| 台账消费方被新字段影响 | 有第三方严格 schema 校验 | **已前置核实**（本单 spec 确认时实跑）：仅 check-loop / confirm-doc 及其测试读台账，无第三方校验 |
| 「顺手」把内容绑定 / 配对判据一起动 | 改动范围蔓延 | T2 边界写明「只动并录段」；T5.4 verify 全绿是兜底 |

## 执行顺序

1. T1 → T2 → T3（判据 + 写入 + 测试同一提交）
2. T4（文档，并入同一提交）
3. T5（sync + 三项回归）
4. 独立复核（L2 强制，基准 = 本单首个 commit；**重点复核 T3.1 是否真能拦住换 quote 的并录**）
5. 关单：逐条勾验 + `verify.mjs` 全绿 → 逐件 `confirm-doc`

## 遗留项

- **降级出账的最终形态待定**：历史无 `batch` 行是「报为『无可判定』」还是「完全静默」——实现时按「不产生不可消除噪声」（audit-gate-hardening P3 教训）取后者更可能，但需实测 advisory 噪声量后再定；两案都写进 T2.3 的文案分支
- **`quote` 的分辨力问题**：行动项①（逐件配逐件原话）已于 617cfc0 落地；台账 quote 字段的单一职责本单恢复，但**历史行的 quote 已失真**，不回改
