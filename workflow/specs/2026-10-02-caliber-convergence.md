---
状态: done
级别: L2
日期: 2026-10-02
模块: pipeline
备注: 口径收敛批——plan 节数/节名单源 + 泳道判定单源（分歧双严）+ check 2 样例豁免 + 7 项 P2；入口 intents/2026-10-02-caliber-convergence.md
确认指纹: a8c32493930b2a37
---
# SPEC — caliber-convergence（口径收敛批）

> 对应 intent：`intents/2026-10-02-caliber-convergence.md`。消除三轴审查定位的「文档与机器口径分叉」。

## 功能行为

### 1. plan 口径单源（机器权威：fill-plan.mjs）

| 项 | 收敛后口径（唯一） |
|----|--------------------|
| L1（Quick-Plan） | 三节：**改动方案 / 约束与风险 / 验证计划**（= fill-plan L1_SECTIONS；多文件多步骤可加任务拆解/执行顺序） |
| L2/L3 | 四节：**改动方案 / 任务拆解 / 执行顺序 / 验证计划**（= fill-plan；build.md 旧四节「任务拆解/风险评估/执行顺序/遗留项」**废弃**） |
| 对齐面 | `build.md`（根+模板）、`plan.md`（根+模板，含 7 节 vs「按 6 节填写」矛盾修复）、`workflow/README.md` 对（「改动面+验证方式两节起步」→ 三节口径）、`workflow/plans/_TEMPLATE.md` 对（头注旧两节 → 三节） |

四处 grep 无「两节起步」与旧节名残留；`fill-plan.mjs` 零改动（机器即基准）。

### 2. 泳道判定单源（**方案 C：分歧双严**，三选一由用户定案）

新增共享取法（建议落 `stage-gates.mjs` 导出，供各门禁 import；`stage-gates` 已是被多方消费的库件）：

```
laneOf(fm) → 'low' | 'high' | 'suspect'
  级别与 risk_level 均合法且一致 ∈ {L0,L1} → 'low'
  级别与 risk_level 均合法且一致 ∈ {L2,L3} → 'high'
  其余（任一缺失/非法/两值分歧）        → 'suspect'
```

**消费规则（双严）**：

| 消费点 | suspect 处置 | 现状语义 |
|--------|--------------|---------|
| check-loop 检查 1 红线判低 | 按 **low** 执行（红线照拦——就严：分歧件不得携红线过协作道） | 任一低即低（suspect 大多已拦，分歧至双高例外补齐） |
| stage-gates 起草豁免 | 按 **high** 执行（不豁免「先起草后确认」） | 级别优先回落 |
| check-loop 加固门 lane | 按 **high** 执行（L2/L3 另须 spec） | 级别优先回落 |
| confirm-doc `--batch` | 按 **high** 执行（拒绝批量，逐份走） | 仅级别 |
| check-lane-surface 关联豁免 | 按 **high** 计入（不作为豁免依据——消息指引「两字段同时升级并双写对齐」） | 仅级别（消息已失真） |
| check-loop 逐阶段前置深度 | 按 **high** 执行 | 仅级别 |

**只增不松核算**：suspect 在红线侧维持/加强拦截、在豁免侧全部收紧——无任何判据放宽；`'low'/'high'` 一致态行为与现各点一致（分歧双严仅影响原三语义分叉的分歧区间）。

**备选方案**：A 维持三语义（零成本但实证 bug 与漂移风险留存）｜B 级别优先回落推广（单字段即可换道，对抗降级弱）｜**C 分歧双严（推荐）**。

### 3. check 2 占位符样例豁免（假阳性消除）

- **豁免**：命中模式位于**行内代码**（反引号包裹）或**围栏代码块**内 = 样例引用，不报（实证噪声：`2026-09-28-check8-git-anchor.md:23` 的 `` `YYYY-MM-DD-` `` 前缀说明）
- **不豁免**：正文裸占位符（`日期: YYYY-MM-DD` 等真未填）照报——真占位符不在反引号内，检测面不缩
- 实现口径：命中行先剥行内代码段（`` `...` ``）与围栏块区域再测 `phRe`

### 4. 七项口径 P2（逐项）

| # | 位置 | 修复 |
|---|------|------|
| 1 | `check-loop.mjs:102` 头注 | 「不占 1-19 编号」→「不占 1-20 编号」 |
| 2 | `fill-intent.mjs:1` 头注 | 「共 7 节」→「共 9 节（7 节正文 + 历史教训/防复发 + 确认与复核）」按 SECTIONS 实数 |
| 3 | `plan.md`（根+模板） | 「按 6 节填写」与 7 节清单矛盾 → 统一按 _TEMPLATE 实际节数 |
| 4 | `plans/_TEMPLATE.md` 对 头注 | L1 旧两节口径 → 三节（与 §1 一致） |
| 5 | `sync-hosts.md:25` | 「8 个 commands 文件」→ 实数（实现时 `ls` 核对，当前 11） |
| 6 | `plan.md:28` / `build.md:44` / `design.md:34` | 「Working rules」悬空引用 → 改引实际节名（「门禁与提交」/「项目适配区」，实现时按语境定） |
| 7 | 根 `AGENTS.md` 适配区 | 「frontmatter 6 字段」→「intent frontmatter 6 字段（spec 5 / plan 3）」 |

## 数据流

```
fill-plan.mjs（节结构单源，零改动）
  ← build.md / plan.md / README 对 / _TEMPLATE 对 对齐（文档面）
stage-gates.mjs 新导出 laneOf(fm)
  ← check-loop（检查1/加固门/逐阶段）/ confirm-doc(--batch) / check-lane-surface import
check-loop 检查 2：phRe 命中前剥行内代码与围栏块
```

## 系统改动

| # | 文件（双源成对） | 类型 | 内容 |
|---|------|------|------|
| 1 | `templates/_agents/scripts/stage-gates.mjs`（+装副本） | 修改 | 导出 `laneOf(fm)`（三态 + 消费谓词 laneLow/laneHigh）；自身 draftGateFor 改用 |
| 2 | `templates/_agents/scripts/check-loop.mjs`（+装副本） | 修改 | 检查 1 / 加固门 / 逐阶段改 import laneOf；检查 2 剥行内代码与围栏块；头注 1-20 |
| 3 | `templates/_agents/scripts/check-lane-surface.mjs`（+装副本） | 修改 | 泳道判定与消息改双严口径（suspect 计 high、消息指引两字段对齐） |
| 4 | `templates/_agents/scripts/confirm-doc.mjs`（+装副本） | 修改 | `--batch` 级别读取改 laneOf（suspect 拒批量） |
| 5 | `templates/_agents/scripts/fill-intent.mjs`（+装副本） | 修改 | 头注节数修正（仅注释） |
| 6 | `templates/_agents/scripts/check-loop.test.mjs`（+装副本） | 修改 | laneOf 三态用例 + 各消费点分歧态断言 + check 2 豁免三态用例 |
| 7 | `templates/_agents/scripts/check-lane-surface.test.mjs` / `confirm-doc.test.mjs`（+装副本） | 修改 | suspect 态断言（消息一致性回归） |
| 8 | `build.md` / `plan.md` / `design.md` / `sync-hosts.md`（根+模板 owned 对） | 修改 | plan 口径对齐 + Working rules 引用 + 8→11 |
| 9 | `workflow/README.md` + `templates/workflow/README.md`（owned 对） | 修改 | L1 三节口径 |
| 10 | `workflow/plans/_TEMPLATE.md` + `templates/workflow/plans/_TEMPLATE.md`（owned 对） | 修改 | 头注三节口径 |
| 11 | 根 `AGENTS.md`（owned 单侧适配区行） | 修改 | 6 字段限定 intent（模板侧本就通用表述，核对后定） |
| 12 | `.agents/kit.json` | 自动 | sync 登记装副本 |

## 约束遵守映射

- **机器权威**：fill-plan.mjs 零改动，全部文档面向其对齐 ✓
- **只增不松**：suspect 双严在两类消费点均为收紧或持平（§2 核算表）；check 2 豁免仅样例引用，裸占位符照报 ✓
- **双源纪律**：脚本改 templates/ 先行 + sync；owned 对手动双改 ✓
- **fixture 断言不回退**：既有用例只允许因 suspect 收紧而变严（expectOk→expectHard 方向），禁止反向；lane-surface 消息断言按新口径更新（行为语义变更经本 spec 授权）✓
- **gate-checklist**：检查项编号零变化（仅头注数字勘误），登记表无需变更；跑 `--diff` 核对 ✓

## 风险评估

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| R1 | laneOf 分歧双严使存量「双写一致」件行为不变、但历史上手改过单字段的件被收紧（如 drafting 豁免失效） | 低 | fill-intent 以来双写为常态；受影响件会得到明确「两字段对齐」指引；fixture 覆盖三态 |
| R2 | check 2 豁免被用于伪装（占位符包反引号逃检） | 低 | 模板正文占位符均裸文本；真占位符检测面不变；豁免限定行内代码/围栏块（语义即「样例」） |
| R3 | 多消费点改动引入回归 | 中 | 每消费点既有套件 + 新增三态断言；全量 npm test + verify；gate-checklist --diff |
| R4 | 文档对齐遗漏某处旧口径 | 低 | 验收 grep「两节起步/风险评估/遗留项/Working rules/1-19」全库清零 |
| R5 | 回滚 | 低 | 纯判据与文档收敛，无数据/状态；单 revert 即回 |

## 确认与复核

- 确认日期：2026-10-02（用户对话内「确认方案C」代录，台账 source=chat-delegated）——**泳道方案 C（分歧双严）定案生效**
- 复核：已完成（independent-reviewer 新上下文）——初判「修复后放行」：P1×2 + P2×2 用户定性全收随 `2989d9c` 收口（加固门 suspect 补 spec 前置 / sync-hosts 76 对 / S31b/S31c 断言 / 注释残留）；plan 口径单源、方案 C 六消费点映射、check 2 豁免不缩检测面、断言无回退均核实。**实现细化**：laneOfEntry 分歧判定按 riskLevelSince=2026-10-01 协议锚分界（存量单字段不追溯，见 intent 确认节声明）