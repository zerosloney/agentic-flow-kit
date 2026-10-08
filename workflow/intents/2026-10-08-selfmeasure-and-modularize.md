---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-08
模块: pipeline
备注: 2026-10-08 AI SDLC 质量评审批次——用户点名修复自测量层失真 / 返工归因不可指导改进 / check-loop 单体 / README-CHANGELOG 过期互指 / 确认门卖点升格五项
确认指纹: 36f5c592abb2cf3a
---
# INTENT — selfmeasure-and-modularize

## 背景与问题

2026-10-08 用户要求评审本仓库「AI SDLC 质量」。评审读了 HEAD（`e1624b7` / v1.3.0），实跑 `npm test`（38 套件全绿 exit 0）、`flow-kit doctor`（14 PASS / 0 WARN / 0 FAIL）、并核对台账与生成物。结论：工程质量与流程设计密度高，但弱点集中在**自测量层与可维护性**，用户点名修复五项。逐项事实：

1. **自测量层失真**：`workflow/metrics.md` 的 2026-10 行与 2026-09 行**逐字相同**（198 篇 / 1018.2 KB / 活跃 5）。实跑 `gen-workflow-metrics.mjs` 输出为 **261 篇 / 1.32 MB / 活跃 0 / 终态 261** —— 生成器逻辑本身正确，纯粹是没人重跑。`workflow/DASHBOARD.md` 头部「生成于 2026-10-07T16:44Z」，此后 10-08 仍有 3 单闭环，样本数已从 43 变 44、一次通过率从 62% 变 61%。`INDEX.md` 有检查 11 漂移门，另两个生成物都没有。
2. **返工归因不可指导改进**：`workflow/DASHBOARD.md` 自报质量门连续两月红（2026-09 一次通过率 55%、2026-10 61%，自设门槛 ≥90%，判词「连续性中断」）。`delegations.md` 的结果列只有 `一次通过 / 返工×N / 主兜底 / 返工待修` 四档，把**门禁噪声返工**（预算超限、双源漏刷、节名不一致等真实发生且频繁的形态）与**设计返工**混在同一列，扩容门第 3 项「月度返工次数 = 0」对两者一视同仁 → 指标永远红且不指示该改什么。
3. **check-loop 单体**：`templates/_agents/scripts/check-loop.mjs` 98 KB / 1470 行承载 20 个检查项；已拆出的 `check-metric-claims.mjs` 仅覆盖 1/20。`2026-10-08-checkloop-importable` 的 CHANGELOG 已留路线：「20 个检查逐个拆独立模块留渐进程序（check-metric-claims.mjs 先例）」，但未启动。
4. **README / CHANGELOG 过期互指**：`README.md:87` 标题为「当前能力（已发布 0.8.0）」，正文把 `audit` 档、`policyVersion`、检查 17/18/19、逐阶段前置门、claude/cursor/codex 薄适配、三个可选门禁、fresh init 冒烟全列为「仓库里还没打进版本号的增量」——**这些全部已随 1.1.x / 1.2.x 发布**；`README.md:93` 称「活跃层里 2026-09-23 至 09-28 的 approved / open 文档没有改成 done」——实盘活跃层为 **0**（`INDEX.md` 档案计数 261）。`CHANGELOG.md:3` 反向指「未打进 package.json 的改动见 README『当前能力』」，两处过期互指成环。
5. **确认门卖点升格**：`README.md` 五条硬规则与产品描述把确认门表述为阻断机制，但仓库自身代码注释已诚实标注信任边界（`.agents/scripts/stage-gates.mjs` 头部「本地可写台账 / 手改状态仍可伪造——本模块只把『顺手绕过』抬到『主动伪造』，不宣称通道关闭」）。台账实测 350 行中 `chat-delegated` 340 / `tty` 6，原话由 AI 自己写入本地可写 jsonl → **它是留痕，不是防伪**。措辞需与之对齐。

## 历史教训/防复发

- 检索结果：`node .agents/scripts/kb-search.mjs "快照"` 命中 `workflow/intents/2026-09-29-p0-gate-noise-batch.md`（done / L2）——**同款问题已识别过一次**。该单背景第 3 条原文：「量化反馈环回写无门：workflow/delegations.md 月度聚合快照停留在『有效任务 2、一次通过率 100%』（09-23 初数据），agg-delegations 实时算出『有效任务 20、一次通过率 50%、返工 13 次』」；其目标 G3 只做了「doctor §6.5 增快照新鲜度检查（陈旧 = WARN）」。**本次是同一类缺口的剩余两面**（metrics.md / DASHBOARD.md），修法沿用先例而非另造机制。
- `workflow/incidents/2026-09-24-metrics-glob-vocab.md`（fixed / L1）：gen-workflow-metrics 曾因自实现 mini-glob 出错，明确定性「快照脚本口径修复，不触门禁——rule-budget.sh 走 shell glob 本就无此缺陷」。本次不改它的 glob 实现。
- `gen-workflow-metrics.mjs:9` 的既定设计声明：「**不做 --check / 不挂门禁**：快照是历史记录——任何文档改动都会让『当前值』漂移，拿它做漂移校验只会常红」。本次**尊重该决策**（用户 2026-10-08 拍板采纳修正方案）：metrics.md 不挂漂移门，只重跑刷真值。
- `2026-10-08-checkloop-importable` spec 风险表留教训：1600+ 行顶层执行段 main 化「diff 巨大且回归面全量，与行为修复混批不可审」。本次拆分**独立成批**，且只取低耦合检查，不与行为修复混批。
- 避坑指南：门禁不得产出不可消退噪声（`2026-09-27-audit-gate-hardening` P3 教训）。新增的 DASHBOARD 漂移门必须规避「生成于」时间戳造成的逐字节常红，否则又造一个常驻噪声源。

## 目标

- G1 `DASHBOARD.md` 有机器守门：当前视图语义（文件头「与 INDEX.md 状态变更后重跑同模式」）兑现为 `--check` + 检查 11 覆盖，陈旧即出账。
- G2 `metrics.md` 十月行刷成真值（261 篇口径），且**不新增**任何会因月内文档演进而常红的门。
- G3 台账结果列能区分门禁噪声返工与设计返工，扩容门判据据此拆分，指标能指示改进方向。
- G4 check-loop 按检查拆模块的范式跑通（本批 4 个低耦合检查），1470 行显著瘦身，后续检查可照同一模式渐进。
- G5 README / CHANGELOG 过期互指断开：能力清单单源（CHANGELOG），README 指向它；确认门措辞与代码已声明的信任边界对齐。

## 非目标

- 不一次拆完 20 个检查：耦合高的检查 1 / 5（共享文档循环）、8（证据核验）、15（指纹对账）本批不动，diff 巨大且回归面全量。
- 不改 `policy.mjs` 的任何生效日锚与存量豁免面——那是独立的制度议题，本次不夹带。
- 不改 `gen-workflow-metrics.mjs` 的 glob 实现与月度快照语义（沿 `2026-09-24-metrics-glob-vocab` 定性）。
- 不回填 `delegations.md` 存量行的结果列：新增取值向后兼容，旧行照原义解析（与 batch/seq/of 纯增字段先例同款）。
- 不动检查项编号：检查 11 的覆盖面扩展而非新增编号（清单头部「不得增删改号」）。

## 约束

- 引擎双源纪律：一律改 `templates/`（包源），随后 `node bin/flow-kit.mjs sync` 更新 `.agents/` 装副本；`.agents/` 直改会被 doctor 台账漂移拦。
- 门禁输出稳定输出契约：check-loop CLI 的 banner / 空行 / `- ` 前缀 / 两段式 / 退出码**逐字节不变**；拆分后以 stash 同状态对账 `diff` 为空作关单证据。
- 检查编号、标题、severity 不得增删改（`gate-checklist.mjs` 的 PAIRS 登记表按 id 消费）。
- 新增引擎脚本须带同名 `.test.mjs`，否则检查 20 出账（或在 `.agents/scripts-test-exempt.txt` 登记豁免并写明理由）。
- 文档改动后 `node .agents/scripts/gen-workflow-index.mjs` 重生成索引（检查 11 守门）。

## 影响面

- 模块：pipeline
- 数据库：无
- 改动面：`templates/_agents/scripts/`（check-loop.mjs、新增拆分模块与其测试、gen-workflow-dashboard.mjs、agg-delegations.cjs）、`.agents/scripts-test-exempt.txt`（如需）、`templates/AGENTS.md`（如门禁口径行需补）、`workflow/`（INDEX/metrics/DASHBOARD/delegations/README 头部）、`README.md`（owned）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（门禁判据、台账记法、生成物守门口径）→ 级别 L2
- [x] 无 schema / 迁移 SQL / DI 链 / 认证与中间件管线改动 → 不构成 L3

## 验收标准（可测试）

- [x] G1：`node .agents/scripts/gen-workflow-dashboard.mjs --check` 在 DASHBOARD.md 与盘面一致时 exit 0、手工改一行后 exit 1 并输出可执行提示；「生成于 <ISO 时间戳>」行不参与比较（否则恒漂移）（证据：`gen-workflow-dashboard.test.mjs` 场景④ 7 断言全绿——归一三态纯函数直测「仅生成于戳不同→相等 / CRLF 盘面→相等 / 内容真漂移仍不等」+ 端到端「盘面缺失 exit 1 / 刚生成 exit 0 / 内容漂移 exit 1 含差异行号与修复命令 / --check 不写盘」；关单前实仓三态复验：一致 exit 0 → 追加一行后 exit 1（首个差异第 29 行）→ 重生成后 exit 0）
- [x] G1：`check-loop.mjs` 检查 11 覆盖 INDEX.md 与 DASHBOARD.md 两个生成物，两条独立 WARN 文案各自指名修复命令；`check-loop.test.mjs` 补正反场景（证据：`check-loop.test.mjs` 场景 27b 两场景——「装户未生成过 DASHBOARD.md → 不出仪表盘漂移 WARN」与「DASHBOARD 漂移 → WARN 仪表盘漂移 且 exit 0（含 gen-workflow-dashboard.mjs 修复命令）」；`check-hygiene.test.mjs` 检查 11 三场景（生成器缺失跳过 / 双告警 / DASHBOARD 缺失跳过）；实仓 `check-loop.mjs` 盘面一致时零新增告警。**新门已在本次关单中产生真实价值**：勾验 intent 与追加 delegations 台账行后，check-loop 立即同时报出 `WARN 索引漂移` 与 `WARN 仪表盘漂移` 两条——其中 **DASHBOARD 漂移在本修复前是完全不可见的观测面**（无任何检查覆盖），现已被门抓住；重生成后复跑仅剩 1 条存量 WARN）
- [x] G2：`workflow/metrics.md` 2026-10 行与 `node .agents/scripts/gen-workflow-metrics.mjs` 实跑输出一致（文档数 / 字节 / 活跃数三处均对得上）（证据：十月行已刷为「264（活跃 3 / 终态 261）| 1.35 MB | 264/264 | 71.7 KB | 1.3 KB（3 行）」，生成器实跑「261→264 篇 / 1.35 MB（活跃 0→3 / 终态 261）」；改前该行与 2026-09 行逐字相同=198 篇 / 1018.2 KB，属未重跑的陈旧快照）
- [x] G3：`agg-delegations.cjs` 新增门禁噪声返工取值可解析；扩容门第 3 项只对设计返工判 `=0`；门禁噪声返工单列观测；旧行结果值解析行为逐条不变（向后兼容）（证据：`agg-delegations.test.mjs` 场景 6 共 7 断言全绿——「识别 rework-noise」/「存量四档解析逐条不变」/「新旧形态互不误吞（`$` 锚定，半角括号不认）」/「双列累计分离（设计 0 / 噪声 5）」/「avgRework 仍含噪声→delegations.md 快照表结构零改动」/「门 3 只对设计返工判 ok 且噪声数字在描述里可见」/「反例：设计返工 1 + 噪声 1 → 门 3 仍 ❌」；DASHBOARD 质量表已出「设计返工 | 门禁噪声返工」双列）
- [x] G3：`workflow/delegations.md` 头部记法补新取值定义；`agg-delegations.test.mjs` 补新旧取值场景（证据：头部新增取值定义 + 门禁噪声定义与四类形态 + 边界段（作者手写不可机器判真伪、不得用于给设计返工贴标签洗白指标、拿不准时写 `返工×N`）；§并发扩容门槛同步改为「月度**设计**返工次数为 0」）
- [x] G4：检查 2 / 9 / 12 / 13 迁出到独立模块，check-loop.mjs 行数下降，四检查的判定口径与文案**逐字节不变**（stash 同状态 stdout+stderr diff 为空）（证据：`check-loop.mjs` 1473 → 1383 行（净减 90）；**拆分前后 CLI stdout+stderr `Compare-Object` 对账 diff 为空**（取 `git show HEAD:.agents/scripts/check-loop.mjs` 临时件跑 before、sync 后跑 after，两次 exit 0、banner/WARN 行逐行一致）；判定零复刻——ctx 传入既有 helper（docFiles/fmGet/linesOf/isTracked），模块内无重新实现）
- [x] G4：新增模块带同名 `.test.mjs`，检查 20 全绿；`npm test` 全量 exit 0（证据：`check-hygiene.mjs` + `check-hygiene.test.mjs` 成对新增，检查 20 扫描「无测试脚本」列表为 0（其余 6 个均既有豁免登记）；`check-hygiene.test.mjs` 10/0 全绿；`npm test` 38 套件 exit 0，含 check-loop 223/0、gen-workflow-dashboard 25/0、agg-delegations 22/0）
- [x] G5：`README.md` 无「已发布 0.8.0」与「还没打进版本号的增量」两处过期表述；`CHANGELOG.md` 首行反向互指删除（证据：**判据口径修正**——原写「全仓 grep 无命中」不可满足：存量 done intent `2026-09-29-adopter-surface.md` 的验收证据合法引用该串（done 态内容绑定，永不可改），本批三件套的需求描述亦含该串。实际判据收窄为 **`README.md` 零命中**：`已发布 0.8.0` / `还没打进版本号` / `活跃层里 2026-09-23` / `见 README` 四串在 README.md 均 0 命中；全仓剩余命中全部归属 CHANGELOG 元描述 / 存量 done 证据 / 本批三件套描述三类合法留痕，逐条列明无一是残留的过期表述。CHANGELOG 首行反向互指已改为「能力清单的单一真相源即本文件」）
- [x] G5：README 确认门表述与 `stage-gates.mjs` 已声明的信任边界一致（明确留痕而非防伪）（证据：README「五条硬规则」节新增「关于『确认门』的诚实边界」段——「确认门是**留痕机制，不是防伪机制**」「台账是本地可写文件，刻意手改仍可伪造」「实际作用是把『顺手绕过』抬到『主动伪造』……而非关闭通道」，并指向 `.agents/scripts/stage-gates.mjs` 头部信任边界段）
- [x] 静态门：`node .agents/scripts/verify.mjs` exit 0（测试 + check-loop 双绿）、`node bin/flow-kit.mjs doctor` 0 FAIL、`templates/` 与 `.agents/` 目标件零 diff（证据：`node .agents/scripts/verify.mjs` exit 0——「✅ 1/2 测试通过 / ✅ 2/2 闭环校验通过 / 🧾 测试绿凭证已落账 verifications.jsonl（PASS 15 / FAIL 0）」（policyVersion 5 的 done 前置凭证）；doctor 14 PASS / 0 WARN / 0 FAIL；本批 8 个目标件双源 sha 逐文件对账 0 差异（check-loop.mjs / check-loop.test.mjs / check-hygiene.mjs / check-hygiene.test.mjs / gen-workflow-dashboard.mjs / gen-workflow-dashboard.test.mjs / agg-delegations.cjs / agg-delegations.test.mjs）；新文件行尾全 LF（CRLF=0，`.gitattributes` `*.mjs text eol=lf`）；关单终态三生成物自检全绿：`gen-workflow-index.mjs --check` exit 0、`gen-workflow-dashboard.mjs --check` exit 0、check-loop 仅剩 1 条存量 WARN）

## 确认与复核

- 确认日期：2026-10-08
- 确认人：用户（对话内明确放行即确认）
- 确认范围：用户 2026-10-08 在对话内点名「按照性价比建议修复 1，2，3，4，5」，并就两处关键取舍拍板——修复 1 采纳修正方案（只给 DASHBOARD.md 加漂移门，metrics.md 保持不挂门仅重跑刷真值）、修复 3 拆 4 个低耦合检查（2/9/12/13）立范式
- 复核：L2 独立复核未执行——本批按 AGENTS.md「单人 + AI 协作」约定由用户拍板放行；`git diff -w` 主视图的拆分接缝复核与输出契约不变量（逐字节对账）已在关单前由主智能体实测完成（diff 为空），结论记入同名 spec「确认与复核」节。**若后续需要第三方视角复核，本批是最值得复核的一批**（拆分接缝的 ctx 完整性是本批唯一无法被现有测试完全覆盖的判据——模块自测用自己的 ctx 组装函数，实测已证它掩盖过一次真实集成 bug）。