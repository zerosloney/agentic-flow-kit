---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-02
模块: pipeline
备注: 三轴审查改进 3——plan 口径收敛（2 P1）+ 泳道判定单源化 + advisory 占位符噪声豁免 + 7 项口径 P2；消除「文档与机器分叉」这一准确性最大来源
确认指纹: b55f856e62f940cc
---
# INTENT — caliber-convergence（口径收敛批）

## 背景与问题

2026-10-02 全项目三轴审查（文档/代码/能力成熟度 34/40）定位「可控准确」的第三优先改进：**文档声明与机器行为的多处口径分叉**。核心发现：

1. **P1·L1 plan 节数三处矛盾**：`workflow/README.md:68`（及模板侧）写「改动面 + 验证方式两节起步」；`fill-plan.mjs` L1_SECTIONS 实为**三节**（改动方案/约束与风险/验证计划）；`build.md:32` 写「极简三节」——README 用旧节名。
2. **P1·L2/L3 plan 节名三套互斥**：`build.md:31`「任务拆解/风险评估/执行顺序/遗留项」vs `fill-plan.mjs`「改动方案/任务拆解/执行顺序/验证计划」vs `plans/_TEMPLATE.md` 第三套——build.md 让复制模板、下一条即给不一致节名。
3. **泳道判定三种语义并存**（代码轴实证冲突）：check-loop 检查 1「级别∨risk_level 任一低即低」/ 加固门+stage-gates「级别优先、缺失回落 risk_level、L2/L3 不回落」/ check-lane-surface+confirm-doc+逐阶段「仅级别」。实证 bug：check-lane-surface 修法消息（:128）称可升「级别/risk_level」但判定只读级别——只改 risk_level 仍被拦。
4. **advisory 噪声**：check 2 占位符检测把引用/示例中的 `YYYY-MM-DD` 样例误报为占位符残留（现役 10 条 advisory 的组成部分），污染信噪。
5. **7 项口径 P2**：check-loop 头注「1-19」应为 1-20；fill-intent 头注「7 节」实 9 节；plan.md「7 节 vs 按 6 节填写」自相矛盾；`plans/_TEMPLATE.md:9` 旧两节口径；sync-hosts.md「8 个」实 11 个；三处引用不存在的「Working rules」节名悬空；AGENTS「frontmatter 6 字段」未限定仅 intent。

## 历史教训/防复发

- 检索结果：`incidents/2026-09-28-batch-ledger-audit.md`（判据多源即漂移）；`incidents/2026-09-25-wf-runtime.md`（双源纪律）；2026-10-01/02 三轴审查报告（本批来源）
- 避坑指南：
  - 口径收敛以**机器为权威**（fill-* 实现是节结构的单源），文档向机器对齐——反向（改机器迁就文档）会破坏既有 fixture 断言
  - 泳道语义定案必须先写进 spec 再动代码——三种语义各有存在理由（保守拦降级 vs 就严回落），取舍是设计决策不是顺手改
  - 「只增不松」边界：占位符豁免属**假阳性消除**（沿「INDEX 漂移行尾归一」先例），判据收窄不改阻断面

## 目标

- plan 口径单源化：L1 = Quick-Plan 三节、L2/L3 = 四节**单套命名**，以 fill-plan.mjs 实现为基准，build.md / README 对（owned）/ plans/_TEMPLATE 对齐——四处逐字一致
- 泳道判定单源化：定义单源取法函数（语义于 spec 定案），check-loop（检查 1/加固门/逐阶段）、stage-gates、check-lane-surface、confirm-doc 消费点统一或显式声明差异；修复 lane-surface 消息与判定不一致
- check 2 噪声豁免：引用块/代码片段内的日期与占位符样例不再误报
- 7 项口径 P2 逐项修复（头注数字、自相矛盾句、旧口径、悬空引用、字段数限定）

## 非目标

- 「确认落态唯一入口」段四处重复的收敛（单源化改造涉及 4 份命令文档结构，另批）
- `.zcode/drafts` 宿主路径通用化（设计讨论另批）
- frontmatter 解析器 ×7 / 台账解析 ×3 / sh-bash 死分支的代码债统一（改进外的重构债，另批）
- 漏斗指标（改进 1）、台账 CI 不变量（改进 2）
- 存量文档回填（如 2026-09-30 件缺 risk_level——存量不回填原则）

## 约束

- 双源纪律：引擎改动一律 templates/ 先行 + sync；owned 对（README/AGENTS/命令文档）手动双改
- 只增不松：占位符豁免为假阳性消除（先例：检查 18 行尾归一），不放宽真占位符检出
- 机器权威：plan 节结构以 fill-plan.mjs 为单源基准，文档对齐机器
- fixture 断言不回退：check-loop.test / fill-plan.test 等既有用例强度不降

## 影响面

- 模块：pipeline
- 数据库：无
- （无前端页面）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）$\rightarrow$ 级别至少 L2
  - 触及面：plan 文档协议（节数/节名全局口径）+ 泳道判定判据（门禁语义统一）+ check 2 检测判据（豁免规则）

> 触及任一红线即为 L2 / L3，必须立 ../specs/YYYY-MM-DD-<主题>.md 写明如何满足，方可起草 plan。

## 验收标准（可测试）

- [x] plan 口径四处一致：fill-plan.mjs / build.md（含模板源）/ workflow/README.md 对 / plans/_TEMPLATE.md 对——L1 三节、L2/L3 四节单套命名，grep 无「两节起步」残留（证据：fill-plan.mjs 零改动（机器基准）；源面 grep「两节起步/旧四节节名」清零——余量仅 .agents/cache 生成缓存与本批三件套自引；复核者逐字比对四文件节名与 L1_SECTIONS/FULL_SECTIONS 一致）
- [x] 泳道取法单源：全库泳道判定实现收敛为 1 个共享函数（或各点显式 import 单源）；check-lane-surface 消息与判定一致（证据：stage-gates.mjs 导出 laneOfEntry/laneOfDoc（协议锚 policy.riskLevelSince=2026-10-01），六消费点（check-loop 检查1/加固门/逐阶段、stage-gates draftGateFor、confirm-doc --auto与--batch、check-lane-surface）全部 import 单源；fixture：lane-surface「分歧→suspect 拦 + 两字段对齐指引」与「两字段一致 high→豁免」、检查1「分歧勾红线拦/协议前 L2 单字段不拦」、加固门 H7、confirm-doc S31b/S31c；存量 15 个协议前 done L2 件零追溯（预检实证 + 复核确认））
- [x] check 2 噪声下降：真实仓库 advisory 中占位符误报清零（引用块内日期样例不再报）（证据：真仓「模板未填」8→2——余 2 为 2026-09-27 旧 plan 真未填日期（真阳性，正确保留）；check-loop.test 检查2 三态 fixture（反引号/围栏不报、裸占位照报））
- [x] 7 项口径 P2 逐项可 grep 验证修复（证据：源面 grep「不占 1-19 / 8 个 commands / Working rules」清零（含 5 宿主适配 76 对 sync-hosts --apply 与 trae rules）；fill-intent 头注 9 节、plan.md 8 节清单、_TEMPLATE 三节口径、AGENTS 6 字段限定 intent 均落盘可查）
- [x] 全量回归：npm test 全绿（fill-plan/check-loop 等既有断言不回退）+ verify.mjs 全绿 + check-loop 无新增 hard-block（证据：npm test「✅ 全部套件通过」（check-loop 187/0 含 H7、confirm-doc 48/0 含 S31b/c、fill-plan 30/0、lane-surface 21/21）；verify 2/2；gate-checklist 0 断档 0 未登记；check-loop exit 0；S10c/lane-surface 断言更新均属 spec 授权语义变更、无 expectHard→expectOk 回退——复核确认）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 hard-block。

## 确认与复核

- 确认日期：2026-10-02（用户对话内「确认」/「确认方案C」/「执行」代录，台账 source=chat-delegated）
- 确认人：用户（对话内明确放行即确认）
- 确认范围：caliber-convergence（plan 口径单源 + 泳道判定单源方案 C + advisory 豁免 + 7 项 P2）
- 复核：已完成（independent-reviewer 新上下文）——初判「修复后放行」：P1×2（加固门 suspect 逃逸 spec 前置 / 5 宿主交付面旧口径未 sync）+ P2×2（测试注释残留 / confirm-doc suspect 断言未兑现），用户定性**全收**，随 `2989d9c` 收口（加固门 `!== 'low'` + H7 fixture + sync-hosts 76 对对齐含 trae rules + S31b/S31c）；口径与判据维度（plan 单源 / 方案 C 六消费点 / check 2 豁免 / 断言不回退）初轮即核实
- **实现口径细化声明**：laneOfEntry 的「分歧」判定按字段协议生效边界落地（锚 `policy.riskLevelSince=2026-10-01`——此前建档的 intent 无 risk_level 不判 suspect，按级别单字段；此后双字段须一致）——spec §2 字面未预设该边界，系实现预检发现字面语义会追溯硬拦 15 个存量 done L2 件后的必要细化，符合 intent 非目标「存量不回填」约束，在此明示留痕