---
状态: done
级别: L2
日期: 2026-09-30
模块: pipeline
备注: stage-gate-machine 三件套之 spec（与 intent / plan 同名配对）；含三项待选设计点（审计形态 / incident 口径 / 生效日键）的建议
确认指纹: 84e0090a519fbff8
---
# SPEC — stage-gate-machine

<!-- 与 intents/ 下同名入口文档配对；本件与 2026-09-30-stage-gate-machine 入口、同名 plan 组成三件套 -->

## 功能行为

五个改动面，各自给出「现行为 → 目标行为、判据、边界」。

**C1 起草门（fill-spec / fill-plan）**
- 现行为：生成前零前置校验，直接写出草稿。
- 目标行为：写文件前校验「同主题入口已确认」；未过 → 不写文件、stderr 输出可判文案（含回退指引）、exit 2（用法错误仍为 1）；已过 → 原行为不变。
- 主题名与入口解析：主题名 = `--output` 的 basename 去 `.md`（与三件套同名配对同口径）；入口候选 = `workflow/intents/` 或 `workflow/incidents/` 下与主题同名的 `.md`。仓库根：从 output 路径中 `workflow` 段的上级推导；output 不含 `workflow` 段 → 视为仓外草稿，跳过校验（原行为 + stderr 一行提示）；支持 `--root` 显式覆盖（与 confirm-doc 同名参数对齐）。
- 「入口已确认」判定（fill-spec 与 fill-plan 同口径）：
  - intent 路径：文件存在、frontmatter 状态 ∈ {approved, done}，且（台账存在该 doc 的 stage ∈ {approved, done} 行，或存量口径：入口日期早于 confirmDocsEffective 或 frontmatter 含「流程: legacy」）——门禁后入口必须有台账事实，防手改状态冒充；
  - incident 路径：文件存在、「时间线」小节内行首条目含「用户确认」（maintain.md §3 既有约定；正文叙述句不算——2026-09-30 复核 P2-1 收窄）、状态 ∈ {open, fixed, closed}。
- 入口「级别」须 ∈ L0-L3——缺失即拒（fail-closed；2026-09-30 复核 P2-7）；**但存量入口短路优先**：`流程: legacy` 或日期早于确认门生效日时跳过级别校验与 spec 档（2026-09-30 增量复核 N1——存量最可能缺级别，硬拒会锁死 spec 起草与确认，违反「存量零新增」契约）。
- fill-plan 追加：入口级别（取入口 frontmatter 级别，不取 `--level`）为 L2/L3 时，同名 spec 须已确认（判定同上：状态 + 台账行 / 存量口径）。
- 边界：两入口皆缺 → 拒绝（文案指引先立入口文档）。

**C2 确认门（confirm-doc）**
- 现行为：spec / plan 的 draft→approved 不校验前置（批内调用顺序自洽即可落账）。
- 目标行为：对 `workflow/specs/` 与 `workflow/plans/` 下的同名文档，draft→approved 施加与 C1 同口径前置校验；未过 → 不写文件、不追加台账、输出可判文案（含回退路径）、该份计为「拒绝」；任一被拒 → 进程 exit 2（TTY 多份时其余继续处理，末行汇总「拒绝 N 份」）。
- 适用形态：TTY 与 --delegated 一致（与 source 无关）。不适用：intent（无前置）、incidents、approved→done、`--to` 放弃态。
- 校验时机：状态解析后、落盘与记账前；TTY 形态对未通过的份不再进入键入环节。

**C3 审计（check-loop 新增检查 19「逐阶段」[warning]）**
- 判据 A（在途扫描）：同名 spec / plan 文件存在、状态 `draft`、且其日期（frontmatter 优先，缺时回落文件名前 10 字符——plan 无「日期」字段）≥ stageGateSince 时——入口未确认（口径同 C1）→ 告警「起草先于入口确认」；入口缺合法「级别」→ 告警（与起草门 fail-closed 同口径）；plan 另判（入口为 L2/L3 且 spec 未确认或缺失）→ 告警「起草先于 spec 确认」。
- 判据 B（台账顺序）：按主题分组，对含 ≥2 条 {intents / specs / plans} approved 行的主题（每 doc 取最早 approved 行 ts），组内最早 ts ≥ stageGateSince 时，校验顺序 intents ≤ specs ≤ plans 时间非降序；违序 → 告警「台账审批顺序倒置」；组内存在更早 ts → 整组跳过（历史豁免）。
- 兼容：policy v2 新增键 `stageGateSince`（值 = 机制落地日；缺键 → 本检查整体跳过）；v1 不动；全部 warning、不 hard-block；本仓实跑对历史零新增。
- 登记：gate-checklist 对照表补检查 19 行（doctor 侧无对照——doctor 不新增检查项）。

**C4 命令文档与口径澄清（替换式改写，受规则面预算约束）**
- design.md：前置句「确认同名入口文档已批准……否则拒绝」→ 注明「已由机器强制：fill-spec / confirm-doc 未过即拒、回 plan.md 补确认」；
- build.md：前置句与「逐件确认」段旁补一句机器门口径（入口 + spec 双重校验、被拒回退路径）；
- plan.md：「确认后 → 立即 docs(workflow) 单独提交留痕」补注「入口文档提交的实际最早可行点受 pre-commit 闭环配对（增量）门约束（同名 spec / plan 文件须已在位）」——先例：61ec130（入口 approved 提交时同名 spec / plan 为工作区未提交草案）；
- maintain.md：§1 / §4 补「incident 草稿过目留痕（时间线『用户确认』）是 L2/L3 起草 spec 的机器前置（fill-spec / confirm-doc 会校验）」。
- 双源：templates/_agents/commands/ 先改 → `.agents/commands/` sync + 宿主薄适配 sync-hosts --apply。

**C5 测试（沿既有套件扩场景，双向：拒绝 + 放行）**
- fill-spec.test.mjs：无入口拒 / 入口 draft 拒 / 入口 approved 放 / incident 口径（marker 拒与放）/ 仓外草稿不拦；
- fill-plan.test.mjs：L1 入口 approved 放 / L1 入口 draft 拒 / L2 缺 spec 拒 / L2 spec approved 放 / 级别取入口 frontmatter；
- confirm-doc.test.mjs：spec 前置未过拒（exit 2 + 台账零新增 + 状态未改）/ plan 同 / 两形态合规放 / done 与 --to 不受影响 / 并录 compose（三次逐件仍旧全绿）；
- check-loop.test.mjs：检查 19 判据 A、B 双向 + 日期门静默；
- 如采「建议 A」（共享模块），主覆盖经四个消费套件，可选补 stage-gates 直测。
- 判据：全量套件基线全绿（现 30 套件）；新增场景全绿。

## 数据流

纯脚本 / 文档链路，无服务与表：
1. 起草：fill-spec / fill-plan 读入口（文件 + 台账）→ 判决 → 生成草稿或拒绝；
2. 确认：confirm-doc 读同主题入口（文件 + 台账）→ 判决 → 落盘（状态 + 指纹）+ 追加台账，或拒绝；
3. 审计：check-loop 读文档现状 + 台账，按 stageGateSince 判决出账；
4. 发布：templates/ 包源 → flow-kit sync（.agents/ 副本 + kit.json）→ sync-hosts（宿主薄适配）；
5. 关单：沿既有 test.md 流程（本单不新增关单步骤）。

## 系统改动

| 文件 | 侧 | 改动 |
|------|-----|------|
| templates/_agents/scripts/stage-gates.mjs（新增） | 包源 | C1 / C2 共享纯函数（入口确认判定 + 级别解析 + 回退文案）——采「建议 A」时新增 |
| templates/_agents/scripts/fill-spec.mjs | 包源 | C1：前置校验接线 |
| templates/_agents/scripts/fill-plan.mjs | 包源 | C1：前置校验接线（含级别分支） |
| templates/_agents/scripts/confirm-doc.mjs | 包源 | C2：前置校验 + exit 2 语义 |
| templates/_agents/scripts/check-loop.mjs | 包源 | C3：检查 19（内联实现，注释互引共享口径） |
| templates/_agents/scripts/policy.mjs | 包源 | C3：v2 增 stageGateSince |
| templates/_agents/scripts/gate-checklist.mjs | 包源 | 登记表补检查 19 行 |
| templates/_agents/scripts/ 四个 test 套件 | 包源 | C5 场景 |
| templates/_agents/commands/ 四命令（plan / design / build / maintain） | 包源 | C4 措辞 |
| .agents/ 对应副本 + kit.json | 装副本 | sync 刷新 |
| modules/hosts/ 各宿主四命令副本 | 宿主薄适配 | sync-hosts --apply |

## 约束遵守映射

- 双源纪律：全部先改 templates/ 包源，随后 sync + sync-hosts --apply；source-sync-check --gate 与 sync-hosts --diff 零差异验收。
- 判据基座：入口「已确认」以 confirmations.jsonl 台账为机器事实源（沿检查 15 生效锚口径）+ 存量豁免（日期早于 confirmDocsEffective 或「流程: legacy」）——与配对门 / 检查 1 的存量口径一致。
- 既有配对门交互（只声明、不改动）：pre-commit 闭环配对（增量）要求入口提交时同名 spec / plan 文件已在工作区；本单不改变它，只在命令文档澄清「确认后提交」对入口的最早可行点。
- 确认语义不动：不改 TTY / --delegated / quote / batch·seq·of / 并录审计；不改 done 内容绑定与放弃态。
- 政策门：v2 增量键；v1 冻结；新增检查缺键时整项跳过（向后兼容）。
- 输出契约：既有成功路径 stdout 与退出码不变；新增拒绝路径 exit 2（可判）。
- 兼容：adopter 存量文档零新增告警（判据 A 日期门 + 判据 B ts 门）；本仓实跑基线对照。
- 设计点一·共享逻辑形态：**建议 A** = 新建 stage-gates.mjs 供 fill 与 confirm 复用（先例：fill-* 已 import 同目录 workflow-enums.mjs）；check-loop 检查 19 内联（沿「门禁脚本自包含、防兄弟依赖」先例），注释互引。备选 B = 四处全内联；备选 C = 四处全共享（含 check-loop 运行时依赖）。
- 设计点二·incident 口径：**建议 B（已按复核 P2-1 收窄）** = 存在 + 「时间线」小节行首条目含「用户确认」；备选 A = 仅存在。
- 设计点三·生效日键：**建议** = 新增 stageGateSince，值 = 机制落地日（当日及以后新档 / 新台账行受审；历史全豁免——沿 confirm-gate-machine「本任务恰在生效日前、闭环自洽」先例）。

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| 门误伤既有 / 在途流程（如存量入口无台账行被拒） | 中 | 存量豁免口径（日期 / 流程: legacy）；拒绝文案给回退路径；用例覆盖双入口 |
| incident 判据（「用户确认」字样）脆弱或被绕过 | 低 | 与 maintain.md 约定同源；信任边界如实声明；后续可升级显式登记（另单） |
| 命令文档预算（规则面预算硬拦） | 中 | 替换式改写、一进一出；rule-budget 实测过门 |
| 新增共享模块的装户分发 | 低 | 沿 managed-ledger-adopt 机制；source-sync-check 覆盖；装户零告警验收 |
| 审计误报存量 | 低 | 双日期门 + 本仓实跑基线对照零新增 |
| 被判据误解为「通道关闭」（伪造仍可） | 低 | 文案沿 2026-09-28 信任边界声明；不宣称不可绕 |

## 确认与复核

- 确认日期：2026-09-30（台账 ts 2026-09-29T23:33:31Z，source=chat-delegated，原话「可以」，batch ddcbf5）
- 确认范围：spec 草稿全文过目；三项设计点按建议落定（一·共享模块建议 A：stage-gates.mjs 供 fill 与 confirm 复用、check-loop 内联；二·incident 口径建议 B：存在 + 正文含「用户确认」；三·新增 stageGateSince，值 = 机制落地日）
- 复核后小修（2026-09-30，独立复核 P2 处置）：P2-1 incident 留痕收窄为「时间线小节行首条目」（防叙述句误命中）；P2-7 入口缺「级别」fail-closed；P2-2 判据 A 补日期回落口径（见上）；P2-6 workflow 段大小写不敏感；P2-8 补交叉一致性测试
- 增量复核修订（2026-09-30，第二次独立复核 0 P0 / 1 P1 / 1 P2）：**N1（P1）已修**——P2-7 的 fail-closed 未与存量豁免耦合，会锁死存量/legacy 缺级别入口的 spec 起草与确认；改为**存量短路优先**（legacy 入口跳过级别校验与 spec 档，与配对门 / 检查 1 / 15 / 19 同口径）；**N2（P2）已处理**——incident `_TEMPLATE.md` 时间线补「用户确认」格式样例行（门文案同步给出两种行首形态）
- 复核：L2 独立复核已执行**七轮**（独立上下文，`independent-reviewer` 角色契约，全程只读、零仓库改动）——完整记录见下方「复核链」
- 复核链（每轮结论 / 实质问题 / 处置）：
  - R1：0 P0 / 0 P1 / P2×8 —— 声明与测试矩阵不符、方向词用反、incident 判据脆弱 → 已修
  - R2：**0 P0 / 1 P1** / P2×1 —— **N1** fail-closed 未与存量豁免耦合（锁死存量/legacy 缺级别入口的 spec 起草与确认）→ 已修（存量短路优先）
  - R3：**0 P0 / 2 P1** / P2×2 —— **N2** 模板样例解析器认不出（照抄即门不过）；S16/S14 夹具假绿 → 已修
  - R4：**0 P0 / 1 P1** / P2×3 —— 放宽前缀引入**叙述句假阳性**（可解锁整条授权链）→ 已修（词边界）；注释未改净 → 已修
  - R5：**0 P0 / 1 P1** / P2×4 —— 加词边界引入**加粗围栏假阴性**（与模板契约冲突）→ 已修（词后允许收尾围栏）
  - R6：**0 P0 / 0 P1** / P2×1 —— 检查 19 的 incident 分支零覆盖（反向注入实证）→ 已修（补正负用例）
  - R7：**0 P0 / 0 P1 / 0 P2** —— 3 条加固（两处正则无测试钉住同口径 / 模板样例内嵌描述 / 正例单条不承重）→ 全部已修
  - 复核者撤回的 2 条非问题：doctor「1 FAIL」为其取样瞬时快照（本仓复跑 13 PASS / 0 WARN / 0 FAIL）；S18/S20 模板路径（实测两侧均存在、同源，不改写法）
  - **如实记录（教训）**：R2/R4/R5 三轮 P1 均为「修上一条时引入」——根因是**补丁式改正则**；终结办法 = **形态矩阵 13 例（8 正 + 5 负）端到端测试**，并由复核者做**反向注入验证承重性**（收紧→正例红 / 放宽→负例红）。R7 后收敛为 0 P0 / 0 P1 / 0 P2。
