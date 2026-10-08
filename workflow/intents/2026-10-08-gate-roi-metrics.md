---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-08
模块: pipeline
备注: 2026-10-08 AI SDLC 演进缺口判断的第一刀——门禁自我度量缺席（用户 2026-10-08 拍板「先做 2，再做 1」）
确认指纹: 5ae7736b87347362
---
# INTENT — gate-roi-metrics

## 背景与问题

2026-10-08 的 AI SDLC 演进方向评审得出核心判断：**最大的缺口不是「缺一道门」，而是「没有能力判断哪道门该留」——门禁的自我度量缺席。**

本仓实证支撑：

1. **门禁数与一次通过率负相关**：门禁 16 项时 2026-10 一次通过率 61%，门禁 20 项时 **56%**（门槛 90%）。同期 `workflow/DASHBOARD.md` 与 `workflow/metrics.md` 的全部指标——文档数 / 字节 / 模块填充率 / 预算占用 / 收口 / 完整链 / 一次通过 / 返工 / 周期 / 台账行数——**100% 指向产出物，0 条指向门禁自身**（grep `误报率` / `门禁耗时` / `门禁成本` / `advisory 统计` / `噪音率` 全部 0 命中）。
2. **加门是焦虑驱动的唯一理性反应**：没有数据能回答「该拆哪道门」，于是指标一变差就加门；而加门增加流程摩擦、摩擦制造失忆（2026-10-08 关单过程中因忘重生成生成物被新门抓到 3 次）、失忆制造返工、返工拉低指标——**自我强化的负反馈**。
3. **已有零星反证但无系统口径**：`2026-09-29-p0-gate-noise-batch` 曾处理检查 18 产生 113 条不可消退 advisory；`2026-09-27-audit-gate-hardening` P3 教训明定「无判定依据的行不产出不可消除噪声」。但这些是**单门的个案复盘**，不是**门禁自身的持续度量**——每次都要重新人工审计一遍（2026-10-08 回溯返工归因时又逐行审了 29 行）。

## 历史教训/防复发

- `workflow/incidents/2026-10-08-checkloop-importable.md`：check-loop 可 import 化时留了接缝 `runCheckLoop(opts)` 返回 `{exitCode, blockers, warnings}`——本单的插桩点在同一条主流程上，接缝已就位。
- `2026-10-08-checkloop-importable` spec 风险表：1600+ 行顶层执行段 main 化「diff 巨大且回归面全量，与行为修复混批不可审」。本单只做**旁路插桩**（段间记长度差与时间戳），不改任何判定逻辑、不动任何 `warnings.push` 调用点。
- 稳定输出契约：check-loop 的 banner / 空行 / `- ` 前缀 / 两段式 / 退出码是 pre-push / pre-commit 消费者与 doctor 的依赖面。**统计必须默认静默**，只在显式 flag 下落盘。
- `papercuts` 2026-10-04 isMain 行教训：模块被 import 即全量执行门禁并 exit。本单的落盘逻辑须在 isMain 守卫内或显式 flag 下。
- 防噪红线（`audit-gate-hardening` P3）：门禁统计若自己产出不可消除噪声即违背同款红线——故**统计默认不输出、不入 git**，只落 `.agents/cache/`（已 gitignore 的运行时目录）。

## 目标

- G1 check-loop 能按**检查 ID** 给出每段的 hard-block 数、warning 数、耗时，且**默认对输出与退出码零影响**（逐字节对账为空）。
- G2 统计落 `.agents/cache/gate-stats.jsonl`（append-only 运行时数据，已 gitignore，不污染工作区）。
- G3 `agg-gate-stats.mjs` 聚合：按检查 ID 出 命中次数 / 拦截数 / 警告数 / 平均耗时 / 样本覆盖率，可排序出「噪声率最高」与「从未命中」两类。
- G4 `workflow/DASHBOARD.md` 增一节「门禁 ROI」——让数据落到决策面上（**观测面非门禁**，不改判定）。
- G5 首轮实仓跑出真实数据，为「下一批该加门还是该拆门」提供依据（**本单不自动拆门**——一个月样本才有统计意义）。

## 非目标

- 不做自动「该拆哪道门」的判定与自动改判据——数据量不足时自动化等于瞎猜，留第二刀。
- 不改任何检查的判定逻辑、文案、severity。
- 不动门禁编号（`gate-checklist.mjs` 按 id 消费）。
- 不把统计入 git（会污染工作区，且仓库已有 `.agents/verifications.jsonl` 这类入 git 台账的先例说明二者性质不同——前者是凭证、后者是高频运行时数据）。

## 约束

- 稳定输出契约：默认路径 stdout/stderr/退出码**逐字节不变**（拆插桩前后对账 diff 为空作硬验收）。
- 双源纪律：改 `templates/_agents/scripts/` → `node bin/flow-kit.mjs sync`。
- 新脚本须带同名 `.test.mjs`（检查 20），否则豁免登记。
- 插桩用**段间长度差 + 时间戳**，不改任何 `warnings.push` / `blockers.push` 调用点（降低回归面与 diff 规模）。

## 影响面

- 模块：pipeline
- 数据库：无
- 改动面：`templates/_agents/scripts/check-loop.mjs`（插桩 + `--gate-stats` flag）、新增 `agg-gate-stats.mjs` + `.test.mjs`、`gen-workflow-dashboard.mjs`（加一节）、`.gitignore`（若需）

## 触达红线（对照 AGENTS.md）

- [x] 规则 / 契约变更（新增 flag + 新增指标消费方）→ 级别 L2
- [x] 无 schema / 迁移 SQL / DI 链改动 → 不构成 L3

## 验收标准（可测试）

- [x] G1：`node .agents/scripts/check-loop.mjs`（默认路径）stdout+stderr 与退出码与插桩前**逐字节相同**；插桩前后对账 diff 为空
  - 证据：19 段插桩完成后跑默认路径，stdout+stderr 与插桩前基线逐字节 diff 为空（见末条「静态门」的加严对账——基线取自 HEAD 版 check-loop.mjs，同仓状态同 env 下 Compare-Object 为空、退出码同为 0）；测试 `check-loop.test.mjs` **231/0**（既有 223 条断言**零改动**即最强输出契约钉子 + 新增 8 条）。另测「默认路径不落 `gate-stats.jsonl`」「默认路径 stderr 无 `[gate-stats]` 摘要行」两条。
- [x] G1：`node .agents/scripts/check-loop.mjs --gate-stats` 时写 `.agents/cache/gate-stats.jsonl`，每行含 ts + 各检查段的 `{id, label, warns, blocks, ms}`
  - 证据：实仓落盘成功，每行形如 `{ts, root, segs:[{id,label,warns,blocks,ms}], totalMs}`；测试断言行顶层含 ts/root/totalMs、每段含 label 与非负整数 ms、每次运行只 append 一行。
- [x] G1：14 个段全部被计入，无遗漏无重复；`id` 与 check-loop 头部清单编号一致（`gate-checklist.mjs` 按 id 消费）
  - 证据：**偏离原判据，已核实为更准**——实为 **19 段** = check-loop 主流程 14 + check-hygiene 模块 5（检查 2/9/11/12/13 在上一单已迁出主流程，仍属门禁段，故一并插桩）。测试断言段 id 集合 == `{1,2,3,4,5,6,8,9,10,11,12,13,14,15,16,17,18,19,20}` 且唯一（19 = 19，无重复无遗漏）；**未新增任何检查项编号**。
  - 证据：**段归属核对（plan 验证计划要求）**——实仓 `check-loop` 真实输出仅 1 条 WARN（三件套不全 = 检查 3），同一次落盘的唯一非零段即 `id=3 warns=1 blocks=0`，其余 18 段全零，归属精确对应、无错记、无漏记、无重复。
  - 证据：**自查抓到并实证复现的一个真错账（已修）**——第一版让 `check-hygiene.mjs` 的 5 段直接记在 check-loop 的**全局**收集器上，但该模块产出的是**局部** `warnings` 数组（check-loop 事后才 spread 进全局），执行期间全局长度不动 → 该模块 5 段恒记 0 命中、**末段（检查 13）整段丢失**，其增量本会全部被误记到模块之后的第一个段（检查 3）头上。修法 = 模块内建局部收集器 + 新增 `gate-seg.appendSegs`（先结算模块前的那一段、再按序并入、清游标使下一段从零起算）。
  - 证据：**断言非恒绿（实证）**——把实现还原成修复前形态在临时目录跑同一套测试 → 新增的 5 条归属断言**红 4 条**（只入账 4 段、warns 全为 0 而模块实际产出 2 条）；修复后 `check-hygiene.test.mjs` 15/0、`gate-seg.test.mjs` 15/0。
- [x] G2：落盘后 `git status` 仍干净（`.agents/cache/` 已 gitignore）
  - 证据：跑 `--gate-stats` 前后 `git status --short` 输出一致，`gate-stats.jsonl` 从不出现在未跟踪列表；`.agents/cache/` 亦不在 `kit.json` managed 台账（managed 103→107 恰为 4 个新引擎脚本，运行时目录未被收编）。
- [x] G3：`agg-gate-stats.mjs` 输出按检查 ID 的表（命中 / 拦截 / 警告 / 均耗时），并给出「噪声率最高 top N」与「声明了但从未命中」两类
  - 证据：`agg-gate-stats.test.mjs` **15/0**——聚合数学 / 双列累计 / 窗口过滤（`--days N` 与 `null` 全量）/ 坏行容错（文件不存在与非法行均不抛）/ 死检查识别且按耗时排序 / 噪声率排序 / 空数据降级 / 段体缺字段容错。
- [x] G4：`workflow/DASHBOARD.md` 增「门禁 ROI」节，`gen-workflow-dashboard.mjs --check` exit 0
  - 证据：**实施中偏离 spec 场景 E，理由随代码与台账留痕**——本单实施时发现 spec「DASHBOARD 从 cache 聚合」与上一单刚加入的**检查 11 `--check` 覆盖面互斥**：采集数据每跑一次门禁就变一次，铺进 DASHBOARD 等于「每次采集必产一条漂移 WARN」，与「防不可消除噪声」红线正面冲突；连「有无数据」按 cache 存在性分支也会在首次采集时翻转文案。故取最小正确实现：**节内容恒为静态**（采集命令 + 查看命令 + 耗时口径 + 为何不铺数值），数值一律走 `agg-gate-stats.mjs` 命令行，空数据降级由该 CLI 自带「未采集」提示承担。
  - 证据：`gen-workflow-dashboard.test.mjs` **30/0**，其中本节 5 条钉死「采集数据从无到有 → `--check` exit 0」「再变一次 → 仍 exit 0 且盘面字节恒等」「节内容不含任何耗时/次数运行数值」；实仓 `gen-workflow-dashboard.mjs --check` exit 0。
- [x] G5：首轮实仓数据落盘并产出可读结论（哪些检查在产出噪声、哪些是死检查）
  - 证据：实仓逐次采集（`check-loop.mjs --gate-stats` → `agg-gate-stats.mjs`）。**成本高度集中**：检查 8 验收标准对账 12.6s、17 发版树未收口 11.2s、14 确认留痕 10.1s、1 配对 4.6s、13 常驻面预算 4.3s——前五段吃掉绝大部分门禁耗时，其余 14 段合计不足 1s。**噪声侧**：样本内无一条检查产出超过 1 条警告；唯一命中的检查 3（三件套不全）为存量问题。
  - **数据推翻本单立项时的预测**：立项时预判「检查 4 和 11 噪声率最高」，实测检查 4 仅 14ms、检查 11 仅 213ms 且均零命中。样本量远不足 30，聚合器已自带「样本 <5 次只作线索不作决策依据」告警——**本单据此不拆任何门**（拆门决策待 ≥30 次 / ≥30 天样本）。
  - 诚实边界：以上为**方向性线索而非决策依据**。耗时数字受本机负载与并发测试进程影响明显（同一检查不同运行间可差 1 倍以上），跨机器比较无意义；要据此改判据须先积累 30 天样本。
- [x] 静态门：`verify.mjs` exit 0、`doctor` 0 FAIL、双源零 diff
  - 证据：`verify.mjs` **exit 0**（`npm test` 全套套件通过 + 闭环校验通过，测试绿凭证 PASS 15 / FAIL 0 已落账 `.agents/verifications.jsonl`）；`doctor` **14 PASS / 0 WARN / 0 FAIL**（managed 107 份校验通过、台账覆盖率完整）；双源零差异（`git diff --no-index` 逐件比对 templates ↔ .agents：check-loop / check-hygiene / check-hygiene.test / gate-seg / gate-seg.test / agg-gate-stats / agg-gate-stats.test / gen-workflow-dashboard / gen-workflow-dashboard.test / check-loop.test 全部一致）；`gen-workflow-dashboard.mjs --check` 与 `gen-workflow-index.mjs --check` 均 exit 0。
  - 证据：**输出契约硬对账（重做了一次更严的版本）**——先前基线取自「生成物漂移时刻」，对账不可比；改为把 HEAD 版的 `check-loop.mjs`（插桩前）复制到 `.agents/` 下的临时目录、在**同一仓状态、同一 env** 下与当前版各跑一次，`Compare-Object` 结果为空——stdout+stderr **逐字节相同**，退出码同为 0。对账后临时目录已删除（可恢复通道），未留残留。

## 确认与复核

- **关单退回记录（2026-10-08，留痕用）**：本档曾于 02:08 走完 `approved→done`（台账两条 done 行如实保留，可对质），随后被门禁**检查 8** hard-block 拦下——当时「G1 段条目」下的四条证据写成 `证据（**…**）：`，而检查 8 的判据是 `证据[：:]`（冒号须紧跟「证据」二字），四行全不匹配；而检查 15 的四终态内容绑定又规定 done 后不得改正文，机器给出的唯一出口 `--to superseded` 语义上不成立（本单结论未被任何新档取代）。经用户 2026-10-08 拍板走「重走关单」：本档退回 `approved`，修正证据格式后重走 `approved→done`。**代价与诚实边界**：这一步是手工回退状态、不走状态机；台账的两条 done 行不清除、不改写，可与 git 历史对质。
- 确认日期：
- 确认人：用户（对话内明确放行即确认）
- 确认范围：用户 2026-10-08 拍板「先做 2，再做 1」——即先做门禁 ROI 度量（本单），再做差分验证（后续单）；同日就「重走关单」方案再拍板一次
- 复核：L2 独立复核未执行（用户放行）；主智能体以「插桩前后输出逐字节对账」+ 全量测试 + 实仓首轮数据取证替代