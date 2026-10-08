# 量化证据台账（委派 + 自做任务）

> 目的：把「一次完成率 / 平均返工次数 / 主兜底占比 / 月度故障数」从感觉变成数字——**数字达标之前不扩并发**（门槛见 §并发扩容门槛）。
> 记法（主智能体顺手写一行，不增加用户负担）：
> - **委派结果表**：每次向子智能体/执行模型委派后追加一行。
> - **自做任务结果表**：主智能体自己完成的 **L1+ 新需求任务**，闭环时（intent→done）追加一行；**修复类不重复记**——incident 本身即故障信号，聚合脚本按月扫 `workflow/incidents/` 计数。
> - 结果列取值：`一次通过`（静态门首跑全过且复核无 P0/P1 返工）/ `返工×N`（设计面返工，回炉 N 次）/ `返工×N（门禁噪声）`（**返工由门禁面而非设计面触发**，见下）/ `返工×N + 门禁噪声×M`（**行内双值：混合归因**，见下）/ `主兜底`（executor 失败、主智能体接手——委派口径专用，计返工信号）/ `返工待修`（未闭环，不计入率，单列提示）。
> - **门禁噪声返工**（2026-10-08 selfmeasure-and-modularize 新增）：指返工根因在门禁面而非设计面——预算超限（常驻面单篇/合计）、双源漏刷（`templates/` 改了没 sync）、节名/字段名与消费方不一致、门禁自身误报等。本仓质量门曾连续两月红（一次通过率 55% / 61%，门槛 ≥90%）且指标不指示改进方向，根因即两档混列：扩容门第 3 项「月度返工次数 = 0」对门禁噪声与设计返工一视同仁。拆分后第 3 项只对**设计返工**判 `=0`，门禁噪声返工单列观测（数字仍可见，不隐藏）。
>   **边界（防标签滥用）**：该取值由作者手写、机器无法判真伪（同 `--delegated` 信任边界，见 incidents/2026-10-05-host-gitignore-localonly-revoke 台账行先例）——**不得用于给设计返工贴「门禁噪声」标签洗白指标**；机器侧保障是台账行 append-only + 检查 18 对账 + 事后对质。判据拿不准时**写 `返工×N`**，宁可让指标红也不要掩盖真问题。
> - **行内双值**（2026-10-08 rework-attribution-split 新增）：一次任务里设计返工与门禁噪声都有时写 `返工×N + 门禁噪声×M`。
>   **为什么需要第三种格式**：单值格式无法表达混合归因——一行只记一个返工总数时，「1 次设计 + 1 次噪声」只能整行倒向某一侧，而整行倒向噪声 = 洗白设计返工。行内双值让**两个归因各自落到自己的列**。
>   **为什么用行内双值而不是拆成两行**：拆行会虚增有效任务数、进而抬高一次通过率的分母（一次通过率 = 一次通过数 ÷ 有效任务数）。行内双值保持「一行 = 一个任务」，`total` 与 `passRate` 分母不变（`agg-delegations.test.mjs` 场景 7 有专测断言）。
> 聚合：`node .agents/scripts/agg-delegations.cjs` → 输出各月指标 + 扩容门判定 + 可粘贴快照行，粘贴进 §月度聚合快照（每月一行）。聚合时顺路按「三类清理清单」巡检 AGENTS.md：代码/配置已可推导的删；只针对一次需求的细节移 wiki 或删；已被脚本/hook/测试自动保证的只留入口。
> 口径说明：合并冲突率不适用（单人串行 + 每阶段确认）；人工复核负担以「复核类委派的返工行」近似（见结果列 + 备注）。
> 调整某角色的模型指派前，先从 `workflow/incidents/` 取 3 个已定性 bug 丢给候选模型做回归对比，再拍板。

## 委派结果

| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 |
|------|----------------|------------|------|------|
| 2026-09-23 | general-purpose(子代理) | agentic-flow-kit 抽包：15 份工作流文档清洗为通用模板（7 命令占位符化 + 2 角色去项目举例 + 6 适配层清洗） | 一次通过 | 项目 token 零残留扫描通过；通用脚本引用保留完好；主智能体复核清洗范围无偏离（intent 2026-09-23-agentic-flow-kit-npx-package，2026-09-23 自发起仓库迁入） |
| 2026-09-24 | Explore(子代理) | 全项目审查扫描：引擎脚本/门禁钩子/宿主模块/文档协议对照，产出 A-F 分级发现清单 | 一次通过 | 关键指控（台账吞数据/锚点静默跳过/ENOENT 崩栈）经主智能体逐条实证复核成立，据此立 incident 2026-09-24-review-fixes |

## 自做任务结果

| 日期 | 任务一句话 | 结果 | 备注 |
|------|------------|------|------|
| 2026-10-08 | 2026-10-08-gate-roi-metrics：门禁自我度量（方向 2）——① `gate-seg.mjs` 插桩共用件（段间长度差 + 时间戳推 warns/blocks/ms，不动任何 `warnings.push` 调用点，check-loop 与 check-hygiene 双 import 无循环依赖）② check-loop 19 段插桩 + `--gate-stats` flag，落 `.agents/cache/gate-stats.jsonl`（append-only、已 gitignore、不进 managed 台账）③ `agg-gate-stats.mjs` 聚合器（按检查 ID 出命中/拦截/警告/耗时 + 噪声率 top + 死检查）④ DASHBOARD 增「门禁 ROI」节（**刻意不铺运行数值**） | 返工×3 | 三件套 approved→done（用户 2026-10-08 拍板「先做 2，再做 1」）；返工点：① **DASHBOARD 节第一版按 cache 存在性分支**（「未采集」/「已采集」两态）——测试直接打红：`--check` exit 1。根因是本仓上一单刚把 DASHBOARD 纳入检查 11 `--check` 覆盖面，而 cache 已 gitignore → 新克隆必然无 cache，一采集文案即翻转 = 又一条漂移 WARN，**与「防不可消除噪声」红线正面冲突**；改为全静态文案（降级语义交 CLI：`agg-gate-stats.mjs` 空数据自带「未采集」提示），测试钉死「采集数据从无到有、从少到多，--check 恒 exit 0 且盘面字节恒等」；② 测试断言自身写错两条（`/\d/` 误伤文案里的「检查 11」编号；造 cache 在生成之后导致状态预期错位）；③ **段归属错账（自查 diff 时抓到，实证复现）**——`check-hygiene.mjs` 的 `warnings` 是**局部数组**（check-loop 事后才 spread 进全局），而段增量记在全收集器上，执行期间全局长度不动 → hygiene 5 段恒记 0 命中、**检查 13 段整段丢失**，其增量本会全部堆到模块之后的第一个段（检查 3）。修法 = 模块内建局部收集器 + 新增 `gate-seg.appendSegs`（先结算模块前那段、再按序并入、清游标）；**实证**：把实现还原成修复前跑同一套测试 → 5 条新断言红 4 条（只入账 4 段、warns 全 0 而实际产出 2 条），修复后 15/0；**偏离 spec 场景 E**：spec 原写「DASHBOARD 从 cache 聚合」，实施时发现该要求与检查 11 覆盖面互斥，取最小正确实现（节内只放口径 + 采集/查看命令，数值走命令行），理由随代码注释与本行留痕；**关单往返**：首次 `approved→done` 后被检查 8 hard-block 拦下——证据行写成 `证据（**…**）：`，而判据是 `证据[：:]`（冒号须紧跟「证据」），四条全不匹配；而检查 15 的四终态内容绑定禁止 done 后改正文，机器唯一出口 `--to superseded` 语义不成立 → 经用户拍板走「重走关单」（intent 手工退回 approved + 正文留痕 + 修正格式 + 重走 `approved→done`），**台账保留两条 done 行可对质**，代价是手工回退一次状态不走状态机；证据：插桩前后默认路径 stdout+stderr **逐字节 diff 为空**、check-loop **231/0（223 既有断言零改动 + 新增 8）**、gate-seg 15/0、agg-gate-stats 15/0、check-hygiene 15/0、dashboard 30/0、doctor 14 PASS 0 FAIL、managed 103→107 双源零 diff；**首轮实仓数据**：成本高度集中——检查 8 验收标准对账 12.6s、17 发版树未收口 11.2s、14 确认留痕 10.1s、1 配对 4.6s、13 常驻面预算 4.3s，前五段吃掉绝大部分门禁耗时；**数据推翻本单立项时的预测**（原判「检查 4 和 11 噪声率最高」：实测检查 4 仅 14ms、检查 11 仅 213ms 且都零命中）——聚合器自带「样本 <5 次只作线索」告警，本单不据此拆门；归属实证：实仓真实输出仅 1 条 WARN（三件套不全 = 检查 3），落盘数据唯一非零段即 `id=3 warns=1`，18 段全零；主智能体自做 |
| 2026-10-08 | 2026-10-08-rework-attribution-split：返工归因行内拆分——结果列增第三格式 `返工×N + 门禁噪声×M`（一行两归因、**total 按行计 1 不虚增任务数**）+ 存量 29 行逐行审计（可标 1 / 不可精确拆分 3 / 全设计返工 25）+ L29 adopter-ci-github 精确拆分标注 + 台账「判定留痕」节（含数据质量问题清单） | 返工×1 | 三件套 approved→done（用户 2026-10-08 追问「怎么不执行？」即授权按 B 方案直接落地，原话在台账）；返工点：场景 6 首条旧断言 `parseResult('返工×2（门禁噪声）').rework === 2` 转红——**发现上一单的实现疏漏**：纯噪声档当时把 `rework` 字段也填了 N（噪声被当成设计返工），只因 `metrics()` 恰好从另一字段取值而未暴露，本单更正为 `{kind:'rework-noise', rework:0, reworkNoise:2}` 并在断言文案写明更正原因（外部行为 metrics/第 3 项/聚合输出零变化）；测试 22/0 → 31/0（新增场景 7 共 9 条：双值解析 / 宽容空格 / 四格式互不误吞 / 非法数字落 unknown / **total 不虚增** / 双列累计 / passRate 分母不变 / 纯噪声行门 3 ✅ / 含设计返工门 3 ❌ 反例）；实仓指标：2026-10 设计返工 16→15、门禁噪声 0→1、**有效任务 24 与一次通过率 58% 均不变**（证明未靠虚增分母粉饰）；全量 npm test 38 套件 exit 0、doctor 14 PASS 0 FAIL、双源零 diff；主智能体自做 |
| 2026-10-08 | 2026-10-08-selfmeasure-and-modularize：自测量层修复批——① DASHBOARD 生成物漂移门（gen-workflow-dashboard --check 双归一 + 检查 11 扩覆盖面，装户缺失即跳过）② 台账门禁噪声返工归因拆分（结果列新增 `返工×N（门禁噪声）`，扩容门第 3 项只对设计返工判 0，存量零回填）③ check-loop 卫生类检查拆模块（检查 2/9/11/12/13 → check-hygiene.mjs，1473→1383 行）④ README/CHANGELOG 能力清单收敛单源 ⑤ 确认门措辞改「留痕非防伪」；metrics.md 重跑刷真值 | 返工×4 | 三件套 approved→done（delegated 台账在档，用户就 2 处取舍拍板）；返工点：① **ctx 键名不匹配**——模块解构 `root` 而 check-loop 实参传 `ROOT`，被 doctor 的 check-loop FAIL 抓到（模块自测用 makeCtx 传小写故全绿，是典型「自测掩盖集成 bug」，逐字节对账与真实 doctor 各抓一层）；② 模块内输出顺序写成 2→9→12→13，违反「warnings 按插入序、行序属稳定输出契约」，自查发现并改回 2→9→11→12→13（测试钉死）；③ 新测试 fixture 漏建 DASHBOARD.md 致双告警场景空跑（装户跳过分支正确生效暴露）；④ 顺序断言 fixture 漏建词表致检查 12 整段跳过；验收：拆分前后 CLI stdout+stderr **逐字节 diff 为空**（核心证据）、check-hygiene 10/0、agg 22/0、dashboard 25/0、check-loop 223/0、全量 npm test 38 套件 exit 0、doctor 14 PASS 0 FAIL、双源 8 件零 diff；偏离：验收判据原写「全仓 grep 无命中」不可满足（存量 done intent 的验收证据合法引用该串）→ 收窄为 README.md 零命中并在勾验中如实留痕；主智能体自做 |
| 2026-10-08 | 2026-10-08-checkloop-importable：check-loop 可 import 化重构——isMain 主守卫 + runCheckLoop(opts) 接缝（返回 {exitCode,blockers,warnings}，CLI 输出 stash 同状态逐字节不变）+ 四纯零件导出 + unit 直测套件（papercuts 2026-10-04 isMain 行用户点名单独立项） | 返工×2 | 三件套 fixed/closed（delegated 台账在档）；返工点：① codemod 三缺陷（配平失衡/缩进退出点漏匹配/重复 return）三重验证网当场修；② 互斥文案拆散断言子串「不能同时使用」致 rev 套件 FAIL——恢复连续子串复绿（教训留 plan 偏离留痕③）；独立复核 diff -w 视图零 P0/P1/P2；同状态对账 diff 空；219/0+28/0+10/0+全套 exit 0；主智能体自做 |
| 2026-10-08 | 2026-10-08-workflow-dashboard：workflow 仪表盘——gen-workflow-dashboard.mjs 生成 DASHBOARD.md（红绿灯：质量门复用 agg 判据 + 关单时长带 P50≤1/P90≤10）+ 关单时长新指标（立项日→台账最早 done 行，存量诚实跳过）+ readLedger 使能导出（root+soft） | 一次通过 | 两件套 done（delegated 台账在档）；测试 18/0（时长四例 / 带三态 / agg 同值对账 / 端到端 / 空台账降级）；首跑真实对账 P50=0/P90=7/max=8 样本 43、质量门红灯真实亮起（当月 62%<90%）；floor 日历天修正（round 同日记 1）；包源份 ROOT 边角教训留 plan 偏离留痕；主智能体自做 |
| 2026-10-08 | 2026-10-08-papercuts-cleanup-batch：papercuts 清账批——sync 一次自洽（记账三段移生成器后）+ 检查18 表头签名识别（与 agg 同口径互引）+ 检查14 台账 OR（回溯三历史树零新增、真实树消 3 条存量误报）+ 检查4 全角逗号 + check-ledger 入库态（暂存区非空即入库态、暂存删除即拦）+ 台账十处处置标注（5 真刺 + 4 勘误 + isMain 留立项） | 返工×1 | 三件套 done（delegated 台账在档）；返工点：独立复核 P1——HEAD 兜底把暂存删除误读为「未触碰」放行（提交门绕过，`:rel` 缺失唯一可达路径即暂存删除）当场修复 + S10④ 翻转/④b 新增；P2 plan 偏离留痕补齐；P3-a 文案分叉 / P3-b 头注释滞后顺带；修1/2/4 与标注 PASS；回归 sync 78/0、check-loop 219/0、ledger 18/0、全套 exit 0；主智能体自做 |
| 2026-10-07 | 2026-10-07-adopter-ci-github：装户 GitHub Actions CI 远端门下发——templates/_github/workflows/kit-ci.yml（owned 薄门，统一入口 verify.mjs）+ isOwned `.github/` 前缀 + srcTemplatePath 点前缀泛化（.agents 特例推广，感知锚覆盖新面）+ AGENTS.md 门禁节口径行两处（rule-budgets 7680→8192 双源成对），Anthropic AI-Native SDLC 必修缺口②，TFS 装户手放 azure-pipelines 方案留对话档 | 返工×1 + 门禁噪声×1 | 三件套 done（delegated 台账在档）；**归因回溯标注（2026-10-08 rework-attribution-split）**：原记 `返工×2`，两个返工点各归一门面——① **门禁噪声**：pre-commit 规则面预算拦 AGENTS.md 7969B>7680，新增 CI 远端门口径行属合法增长而 7680 是历史实测+余量，门禁拦的是合规改动（按 53d3105 先例 512B 步进上调预算）；② **设计返工**：rule-budgets 只改装副本被双源门拦，确属违反双源纪律，门禁正确拦下真错。两条各有依据、可逐点对质；独立复核零 P0/P1，P2-1（分支策略提示断言）+P3-1（isOwned 存量正例）当场补断言；npm test 全套 36 套件 exit 0（含与并行会话 1.2.2 提交的一次瞬时撞态复跑确认）；fresh-init/S16 共 +10 断言；主智能体自做 |
| 2026-10-07 | 2026-10-07-verify-evidence：测试绿机器凭证——verify.mjs 全绿落账 verifications.jsonl + confirm-doc done 前置 advisory（24h 窗口）+ 检查 8 凭证对账（无 SHA「测试绿」声明须对账），窗口判定单源 hasFreshVerifyLine，policyVersion v5，Anthropic AI-Native SDLC「make test before done」必修缺口①，随 v1.2.0 发版 | 一次通过 | 三件套 done（delegated 台账在档）；测试 +7 场景（verify 落账 ×3 / 前置 ×2 / 对账 ×2）；实仓冒烟台账行 {passed:15,failed:0}；关单时新前置首次真实使用即静默通过（当天绿行对账）；独立复核 PASS 零 P0/P1，P2-1（PIPELINE_RUN_ID 无生产方）当场修复 runNode env 注入；v1-v4 装户零变化、存量零回溯；主智能体自做 |
| 2026-10-06 | 2026-10-06-template-downstream：模板下发感知机制——owned 模板 srcSha256 锚 + sync 三方 sha 判定（判据单源 templateDriftOf 四态，唯一出账=源演进且未跟随 advisory）+ doctor §6.9 只读回显 + init 初始锚 + 前缀翻译（_agents→.agents，感知面 13 件），S18/S20 装户事故根因，随 v1.1.9 发版 | 返工×1 | 三件套 done（delegated 台账在档）；返工点：① doctor 新节未登记 gate-checklist PAIRS 被 S10 拦（门禁按设计抓漏）补登记；② 复核 P2-1 前缀翻译缺失当场修复单源点并补 S15⑥ 断言；③ debug 误跑 sync 未传 --dir 致 fixture 件短暂落仓，清理 amend 出历史；独立复核七承诺全过零 P0/P1；npm test 全套件通过（关单后复跑复绿实证）；主智能体自做 |
| 2026-10-06 | 2026-10-06-check2-datetime-literal-exempt：装户回流——检查 2 日期显示格式字面量豁免（YYYY-MM-DD HH:mm(:ss) 行内剔除再判，真占位照拦），随 v1.1.6 发版 | 一次通过 | 三件套 done（delegated 台账在档）；复制双侧 + sync 刷台账一次通过（run-tests FAIL 0 / gate 绿 / 两仓 2 份零 diff）；装仓同日先行关单验证 207/207、WARN 31→29 |
| 2026-10-06 | 2026-10-06-backflow-loop-audit-remediation：装户（Shipyard.Material 2026-10-06-loop-audit-remediation）回流批次——检查 18 delegationSince 生效日豁免 + POLICIES v4 + commands 装户边界标注 ×6 + pre-push CI 注释两段式，随 v1.1.5 发版 | 返工×1 | 三件套 done（delegated 台账在档）；返工点：① 手动双侧复制漏刷 managed 台账 → trae-hooks 4 FAIL（pre-commit 模拟拦 commit），flow-kit sync 刷台账收口；② build.md 标注后 8386B 超单篇预算 8192 被拦，rule-budgets 单篇 8192→8704（512B 步进、与装户同值）双源成对；③ sync-hosts 30 对薄适配漂移 --apply 收口；终态两仓 9+1 份零 diff、run-tests FAIL 0、gate 绿 |
| 2026-10-05 | 2026-10-05-check8-digit-sha-misfire：检查 8 全数字短 SHA 误分类根治——纯数字串豁免改 rev-parse 实证分流（全数字短 SHA≈4.4%/夹具曾被误分类为时间戳文本致证据核验静默跳过）+ 豁免分支出账 + linesOf 按文件去重 | 返工×1 | incident/spec/plan 三件套 done（delegated 台账在档，指纹逐件对上）；返工点：L2 复核抓 P1——探针临时件 _probe-tmp.mjs（gitignored）在盘期间被 sync 收编进 kit.json 台账，fresh clone doctor 会 FAIL，删临时件 + sync 出册收口（教训：临时件生命周期须罩住台账刷新）；探针 A/B 修复前 10/10 复现 → 修复后 40 轮 0 次（构造性钉子场景 5u：git tag 全数字 ref）；随 v1.1.2 发版；主智能体自做 |
| 2026-10-05 | 2026-10-05-gitout-fail-open：check-loop gitOut/fs/夹具三层 fail-open 根治——spawn 异常响亮出账（stderr 按 type 去重）+ 瞬时类重试（spawnGit 统一通道）+ 夹具 gitRetry/shortSha 防瞬时失败，治 CI flake | 一次通过 | incident/spec/plan 三件套 done（delegated 台账在档）；探针 A/B 修复前 10/10 复现 → 修复后 40 轮 0 次（装副本/包源 201/0 与 199/0 差 2 为 metric-derivers 环境自适应分支）；L2 独立复核放行 + 4 项 P2 关单前收口（出账时机对称化/夹具 git add 入统一通道/计数订正/断言补注）；随 v1.1.1 发版；主智能体自做 |
| 2026-10-05 | 2026-10-05-host-gitignore-localonly-revoke：撤销 zcode/omp localOnly 档位——七宿主一律入库（init/add-host 不再向装户 .gitignore 追加宿主目录，草稿目录改装户自管） | 一次通过 | intent/spec/plan 三件套 done（delegated 台账 6 行在档，指纹逐件对上）；独立复核 8/8 验收满足、P2×3 全处置（P2-1 本单顺带、P2-2 闭合、P2-3 既有缺口不扩）；S7 断言翻转 + ROpt 可选读 + templates 注释两件 sync 刷装副本（kit.json sha 对齐）；随 v1.1.0 发版（tag + npm publish 双绿）；主智能体自做 |
| 2026-10-04 | review-fix-batch：双轴审查 13 项发现批修复（cards 键名对齐 intent 验收 / watchdead 广播+目录兜底 / 404·500 区分 / 确认门要点渲染 / 场景重号消除+type=sha 端到端正例 / safeRunPath 白名单测试 / AGENTS.md 三段式口径） | 返工×1 | incident 2026-10-04-review-fix-batch（L2，spec/plan 同名 approved+done delegated）；返工点：初版场景 47 用 import 直测——check-loop.mjs 无主守卫，import 即全量跑门禁并 exit，套件空心化（exit 0 断言全没跑），自测探针当场抓到回炉改端到端正例并回退 export（记 papercuts）；npm test 全绿（check-loop 196 断言）、浏览器实测三态（确认门要点/工单回归/空态）、doctor 13 PASS |
| 2026-10-04 | plan-section-name-evidence：check-loop 证据校验兼容 L1 plan「改动方案」节（verifyEvidenceTruth 节名正则扩一项，消除「真实提交被误判证据无关」的验收证据误报） | 一次通过 | incident 2026-10-04-plan-section-name-evidence（L2，门禁判据面；spec/plan 同名 approved+done delegated）；正/负例测试场景 43/44 钉住；npm test 全绿；发现过程记 papercuts 2026-10-04 fill-plan 行（d8d3d7d） |
| 2026-10-03 | plan 确认节模板样板豁免（检查 2 boilerRe 精确豁免确认节样板句，三 plan 占位符 WARN 清零） | 一次通过 | incident 2026-10-03-plan-confirm-boiler（L2，门禁判据面）；spec+plan 确认门逐道走（delegated）；npm test 全绿，真实仓三 WARN 3→0 |
| 2026-10-03 | check-evidence-process：检查8证据核验新增过程证据判据（runId 严格形态标记放行，+3 回归场景+防复发行） | 一次通过 | intent 2026-10-03-check-evidence-process（L2，门禁判据面）；随批修 pipeline-run 测试跨日红（PIPELINE_RUN_TODAY 钩子，挂 p2-pool-batch3）；check-loop 测试 190/0、真实仓 exit 0 |
| 2026-10-02 | pipeline-run 跨宿主全自动闭环执行器（状态机脚本+工单协议+run 事件流+命令封装五宿主） | 一次通过（演练修 3 缺陷） | intent 2026-10-02-pipeline-run；测试 18 组双侧绿；演练矩阵（L0/verify-only 本仓真实 + L1/L2/incident 沙箱真实工具链）抓 3 真缺陷当场根因修（d176321）：untracked 目录折叠误报、运行态副产物误拦、verify 后代码提交缺口 |
| 2026-10-06 | 自做（主智能体，用户交办） | v1.1.4 回流批次三件（policy v3 + 检查 8 记录型提交豁免 + 预算 fixture 自校准；intent 2026-10-06-v114-backflow-batch-r2，前组同主题 done 后双字段/改动面对齐走补偿行） | 一次通过（套件抓出 2 处 fixture 缺陷当场修：--staged agLimit 作用域、fixture 父目录） | 静态门：npm test 865 PASS / 0 fail、双源 --gate exit 0、check-loop 全绿；发版提交 f760c42 |
| 2026-09-24 | 关单 verify 固定编排脚本（npm test + check-loop 一键过门） | 一次通过 | intent closeout-verify-script；fixture 6 断言 + 真实双步绿路径实跑首跑全过 |
| 2026-09-25 | workflows 编排脚本机器 linter（解析校验先行落地）+ doctor §6.8 接线 | 一次通过 | intent 2026-09-25-workflows-linter；fixture 14 场景 + 真实仓库 baseline 断言；期间修复测试断言自身 E 码切片 bug 一次（非实现返工），实现一次通过 |
| 2026-09-25 | gate-checklist 关键词匹配退役→显式配对登记表 + --json/死代码修复 | 返工×1 | intent 2026-09-25-gate-checklist-registry；实现返工 1 次——实跑暴露小节号无尾随点解析 bug（doctorCount 8/12），正则二次修正后 14 场景全绿；真实仓库登记完整 0/0 |
| 2026-09-25 | 状态/级别枚举单源化（workflow-enums.txt + 10 处消费方归一） | 返工×1 | intent 2026-09-25-enum-single-source；实现返工 1 次——case 变量模式串 POSIX 不成立（| 是语法层 alternation，参数展开不出），实跑 69 份误报暴露后改 in_set 内建成员测试；CRLF 防御（enum_val 去 \r + 双场景）顺手落地；终态 37/0 + 20 套件全绿 |
| 2026-09-26 | 编排执行面补强（human 确认门第四形态 + wf-journal run journal） | 一次通过 | intent 2026-09-26-orchestration-journal-human；linter 15/0 + wf-journal 9/0 + 21 套件全绿首跑全过；端到端 add×3+status 实跑分层正确，演示数据已清理 |
| 2026-09-26 | check-loop sh→node 全量迁移（14 检查项 + 37 场景移植 + 5 消费方接线 + shim） | 返工×2 | intent 2026-09-26-check-loop-node；实现返工 2 次——①检查 4 漏 workflow 根级 *.md（fixture 移植实跑暴露）②.mjs 头部清单编号错位（5 并入 1 致 #7 空缺，gate-checklist 登记断档即时抓住）；终态基线快照逐行一致 + 22 套件全绿 + 净减 ~1850 行 |
| 2026-09-26 | 确认门机器化（confirm-doc TTY 脚本 + 指纹台账 + check 15） | 一次通过 | intent 2026-09-26-confirm-gate-machine；本单为流程违规复盘的机制修复，三件套逐件对话确认（bootstrap）后开工；confirm-doc 10/0 + check-loop 41/0 + 23 套件全绿首跑全过 |
| 2026-09-27 | check-loop 自查误报批修复（审查 P1×2+P2×2+P3×4 + 8 回归场景 + 适配层引用断线修复） | 返工×2 | incident 2026-09-26-check-loop-review-fixes（随报随修回溯单）；实现返工 2 次——①引用正则字符类漏逗号（`fill-{intent` 截断，场景 42 实跑红）②适配层首版脚本行尾 LF 化 + 漏 omp 宿主（sync-hosts --diff 对账暴露，改 applyForward 同款拼装重写 12+3 份）；主智能体双轴审查（子智能体供应商不可用降级亲审）+ 修复同会话；警告 32→10、check-loop 套件 49/49、doctor 12 PASS |
| 2026-09-27 | sync-hosts 适配层欠账清零（12 对 apply + 6 份新建，34 对全对齐） | 一次通过 | intent 2026-09-27-sync-hosts-adapter-backlog（incident 2026-09-26-check-loop-review-fixes 备注的遗留立项）；方向分析先行——行尾归一化 sha 比对权威源 git 全历史 12/12 命中排除手改，apply 安全；欠账根因（改权威源命令后未跑 --apply）随每次 sync-hosts --diff 非零漂移可见 |
| 2026-09-27 | 确认门对话委托代录模式（--delegated + 台账 source/quote 如实记账） | 一次通过 | intent 2026-09-27-confirm-gate-delegated（L2）；用户 5 次要求代跑被 TTY 门拒 → 问设计合理性 → 拍板「2选2」改设计；confirm-doc 13/13 + check-loop 50/50；三件套双跳用户 TTY 亲跑闭环，委托模式正式首用为同日 backlog 关单 |
| 2026-09-27 | 门禁体系加固批（审查复核 6 项：done 内容绑定 + 双源门禁接 pre-commit + 引用扫描收窄 + 配对补 spec + 边界声明） | 一次通过 | intent 2026-09-27-audit-gate-hardening（L2）；check-loop 56/0 + source-sync-check 19/0 + verify.mjs 全绿首跑全过；L2 独立复核（independent-reviewer 子代理）实证指纹互逆性 + 复跑全套，判「有条件通过」0 P0/P1（条件=用户关单追认绑定生效日切换 2026-09-28）；T2/T4 拦截探针实测留证；advisory 10→6 |
| 2026-09-27 | 机器门覆盖面补齐（incidents 确认门 + CI 服务端四道门 + quotepatch） | 返工×1 | intent 2026-09-27-gate-coverage（L2）；首提交 4652309 全绿，L2 独立复核临时克隆实证抓出 P1（CI 门在 runner 克隆必红：hooksPath / .zcode gitignore 冲突 / owned CRLF 漂移三根因）→ 2a40afb 返工收口（owned sha LF 归一 + .zcode 入库 + CI hooksPath）后克隆复跑四道门 + npm test 全绿；quotepatch 非 ASCII 探针实测；confirm-doc 15/0 + check-loop 62/0 |
| 2026-09-27 | 闭环收尾批（--to 终态确认门 + managed sha 六处 LF 归一） | 返工×1 | intent 2026-09-27-closing-coverage（L2）；实现返工 1 次——首版只归一读取侧，fresh sha 仍 CRLF（sync 23 份「本地已改」暴露），补 render.mjs 写盘归一后六处口径闭合、克隆 managed WARN 13→0（复核基线对照实证）；期间误触发 soft reset 摘掉立项提交，ORIG_HEAD 即时恢复零丢失（commit-msg 门禁拦 "wip" 试提交后清理命令时序错误的连锁，全程无内容损失）；L2 独立复核判「通过」0 P0/P1，P2-1 措辞随 a526a7f 收口；confirm-doc 19/0 + check-loop 65/0 + source-sync-check 21/0 |
| 2026-09-27 | init 安装器 P1×4 收口（执行位 / init 时序 / 供应链防线 / 记账归一） | 返工×1 | intent 2026-09-27-init-p1-batch（L2）；首提交 7903325 实测三件套全过（fresh init exit 0 / 预植恶意脚本 ×3 命令 0 标记 / CRLF 合并 owned 26 份无漂移），L2 独立复核重演实验后抓条件①（spec 承诺的测试场景未落地——实现时漏写）→ f6ffc3e 补 init.test ⑦节 5 断言 + README 威胁模型收窄（复核实测预植 .githooks 会被挂载执行，原文表述夸大）+ doctor §6.5/§6.8 存在性先行 + sync unchanged 补 chmod；init.test 28/0 + verify 全绿 |
| 2026-09-27 | 看板+kb 审查 P1×4 收口（告警单源化 / 单包崩溃 / 扩容门对齐 / kb revive 校验） | 一次通过 | intent 2026-09-27-board-kb-p1（L2）；d8dd6d4 一次落地（看板 hard-block 单源 check-loop + 双跑断言固化 10 场景 / 畸形请求 400 实测 / Host 403 / 扩容门对齐 delegations.md 反例实测 ❌ / kb 结构损坏 30 场景 + 测试注入式缓存）；L2 独立复核判「通过」0 P0/P1，P2×2（延迟 35 倍低估）随 1f7b9ed rider（60s TTL 实测 10.8s→376ms + 击键去抖）；board/agg/kb/metrics 四套件 10+14+30+16 全绿 |
| 2026-09-27 | 宿主门禁 P1×3 收口（dotnet-ca BRE 豁免 / CONTROLLERS_DIR fail-open / trae 强推 token 化） | 返工×1 | incident 2026-09-27-host-gates-p1（L1，修复类不重复记自做——此行为测试基建补记：两新套件 gate-dotnet-ca 5/0 + trae-hooks 19/0 进 npm test 常驻）；实现返工 1 次——测试夹具三修（CONFIG 整行正则替换 / Controllers 目录创建时序 / 断言误中提示语），门禁本体一次落对；L1 快速独立复核判「通过」0 P0/P1，P2×3（-vf 组合短旗标 / 跨 && 误并 / exempt 字符串拼接）随 a06e77d 全收 |
| 2026-09-27 | P2 池批一（init 装户安全 + managed sha 收尾） | 返工×2 | intent 2026-09-27-p2-batch1（L2）；c2c6316 后 L2 独立复核初判「不建议关单」——P1×3（EOL 断言读 HEAD 与 pack 读工作树错位被本提交自身证伪 / --force 追加特例缺口 / papercuts 编辑后未 sync 致 doctor FAIL）+ P2×3 → 57760ce 全收（EOL 改工作树就地归一 159 份零 CR / 追加特例端到端实测 / 台账刷齐 + protectedSkipped 补记）；教训：EOL 断言口径两轮才对（HEAD→工作树→就地归一）；init.test 31/0 + 全套 24 套件绿 |
| 2026-09-28 | 量化断言机器门 L2 独立复核（check-loop 检查 16，基准 c96a250 → c9e7ce3） | 返工×1 | incident 2026-09-28-metric-claim-gate（L2）；复核者在 detached worktree 内独立验证、**未改动主工作区**——确认 5 项断言中 4 项成立（零假阳性 / 形态收窄承重 / **检查 1-15 逐字节未动** / 测试该 1 项为 sh 环境预存 / 语法错守卫有牙），并抓出**实现方未自知的 P1×1 + P2×4**：① 转义按整行生效可藏真断言（实证：同行带反斜杠 0 告警 / 不带 2 告警）② 形态不符静默漏过 ③ `docs.count.*` 与扫描面口径不一（盘面 60 vs HEAD 59）④ 登记表误按 managed 记账（与其项目自持设计矛盾，装户加行即永久漂移）⑤ 登记表示例引用不存在的指标名——全部采纳修复 + 4 条回归场景（89→92）；**复核方法论价值**：其独立发现「c9e7ce3 自身 hard-block 自己的门」（新 spec/plan 缺同名入口文档），暴露实现方当时以「续作」为由跳过 incident 的判断错误 |
| 2026-09-25 | 会话内原生子智能体 fan-out 取代 headless runner（orchestrate 命令） | 返工×1 | intent 2026-09-25-orchestrate-in-session（回填 2026-09-29）；08f6207 落地关单后用户对话纠偏改形态为目录约定（d9a7620）；无独立复核记录（09-25 早于复核模板） |
| 2026-09-25 | 脚本化子智能体编排（workflow 脚本 + headless runner） | 返工×1 | intent 2026-09-25-subagent-orchestration（回填 2026-09-29）；3ce4ef9 关单后独立复核抓 P0×1（Windows 批处理 prompt 截断）+ P1×4，6d6e239 全修（incident 2026-09-25-wf-run-review-fixes）；runner 形态整体废止（08f6207）计入 orchestrate-in-session 行，不重复计 |
| 2026-09-25 | 编排脚本 + steps 扩展点，AGENTS.md 全宿主自动加载零适配 | 返工×1 | incident 2026-09-25-wf-runtime（回填 2026-09-29）；d9a7620 关单后回溯收口 27da05c（装副本 AGENTS.md 双源漂移 + 验收未勾 + INDEX 未刷新）；doctor owned 漂移校验（7ccc7b9/75707c3）为未立项后续加固不计返工 |
| 2026-09-26 | managed 文件台账收养分支 + doctor 台账覆盖率检查 | 一次通过 | incident 2026-09-26-managed-ledger-adopt（回填 2026-09-29）；03648df 立项 → 9d39413 实现 → 942c03f 关单；无独立复核（当时 L2 不强制，spec 节载明）；关单后无同主题修复提交 |
| 2026-09-27 | 确认门逐件化：--delegated 单文档强制 + 并录审计 | 一次通过 | incident 2026-09-27-confirm-gate-one-per-call（回填 2026-09-29）；独立复核 0 P0/P1，P2×4 关单前全采纳（0abb57d）；并录判据方向性替换另立 batch-ledger-audit 单不计本单；关单后无同主题修复提交 |
| 2026-09-28 | 装户可扩展指标取数器（内置硬编码 + 模块可选载入，fail-loud） | 返工×1 | incident 2026-09-28-adopter-derivers（回填 2026-09-29）；independent-reviewer 复核 P1×1（shipped 套件 src/ 路径在装户崩）+ P2×4 全采纳（08768eb 收口）；关单后无同主题修复提交 |
| 2026-09-28 | 并录审计改读调用事实 batch/seq/of（弃时间戳猜测） | 一次通过 | incident 2026-09-28-batch-ledger-audit（回填 2026-09-29）；verifier 复核 0 P0/P1，P2×4 关单前全采纳（acf93b6 + 583f31a）；关单后无同主题修复提交 |
| 2026-09-28 | 检查 8 生效日锚改 git 首次加入日期 | 返工×1 | incident 2026-09-28-check8-git-anchor（回填 2026-09-29）；verifier 复核 P1×1（「锚不可手填」表述不实——git commit --date= 可伪造 author date）+ P2×2 采纳（87bb788 表述更正）；关单后无同主题修复提交 |
| 2026-09-28 | 检查 15 生效日锚由自报日期改台账 ts | 一次通过 | incident 2026-09-28-confirm-gate-effective-date-anchor（回填 2026-09-29）；verifier 复核 0 P0/P1，P2×4 关单前全采纳（92cdf03）；关单后无同主题修复提交 |
| 2026-09-28 | pre-commit 补 managed 台账快检（拦 sha 预 landing） | 一次通过 | intent 2026-09-28-ledger-precommit-gate（回填 2026-09-29）；independent-reviewer 复核 0 P0/P1，P2-2/P2-3 关单前采纳（9894de7）、P2-1 为 spec 已声明取舍；关单后无同主题修复提交 |
| 2026-09-28 | opencode 命令薄适配统一 wf- 前缀（与 trae 对齐） | 返工×1 | intent 2026-09-28-opencode-cmd-wf-prefix（回填 2026-09-29）；ff3c721 还原误带入 doctor.test 的 opencode rename 预期（main CI 红）；无独立复核记录（spec 仅推荐）；关单复验为主智能体自抽 7 条证据 |
| 2026-09-29 | 检查 16 内联债拆出 check-metric-claims + 扫描口径 tracked-only + TTY 逃生门声明 | 一次通过 | intent 2026-09-29-check16-inline-debt（回填 2026-09-29）；independent-reviewer 复核 7 项全 CONFIRMED 0 P0/P1，P2×2 关单前采纳（ad2117a）；关单后无同主题修复提交 |
| 2026-09-29 | 委派台账对账检查（L2/L3 done 无台账行 → 警告） | 一次通过 | intent 2026-09-29-delegation-ledger（回填 2026-09-29）；初复核 P2×1（正例未锁整行）关单前收紧（7e8ee74），终复核 0 P0/P1/P2；关单后无同主题修复提交 |
| 2026-09-29 | pre-push 扫描被推送 sha 的 workflow 树 | 一次通过 | intent 2026-09-29-push-scans-tree（回填 2026-09-29）；复核 0 P0/P1，P2×2 关单前采纳（fcf82c7）；关单后无同主题修复提交 |
| 2026-09-29 | 发版树上 approved 未收口 hard-block（policy v2 版本锚） | 一次通过 | intent 2026-09-29-release-unclosed（回填 2026-09-29）；复核（基准 894cf8c→fc1ceff）0 P0/P1/P2；实现至关单间无修复提交 |
| 2026-09-29 | node 构建门认 scripts.build、--help 列全门禁目录 | 一次通过 | intent 2026-09-29-stack-build-when（回填 2026-09-29）；复核 0 P0/P1，P2×2 关单前采纳（7045ea8）；关单后无同主题修复提交 |
| 2026-09-30 | stage-gate-machine：流程闭环逐阶段机器化（起草门 / 确认门 / 检查19 审计） | 返工×3 | intent 2026-09-30-stage-gate-machine（回填 2026-09-30）；七轮独立复核 R2/R4/R5 各 1 项 P1（均「修上一条时引入」）→ 形态矩阵 13 例 + 反向注入验承重收口，终轮 0 P0 / 0 P1 / 0 P2；主智能体自做 |
| 2026-09-30 | confirm-gate-approved-history：done 前置门（approved 态须已进 git 历史） | 一次通过 | intent 2026-09-30-confirm-gate-approved-history（回填 2026-09-30）；独立复核 0 P0 / 0 P1，P2×6 全处置（S26 崩溃保护 + 统一台账 helper / test.md 措辞 / git 封装登记 / 两项信任边界声明）；本单为首个实践——approved 留痕提交 0189631 先于 done，关单经自建门放行；主智能体自做 |
| 2026-09-30 | p0-gate-noise-batch：门禁噪声修复批（check18 判据对齐 / check14 生效日后移 / 快照回写门禁化 / pre-push 注释对齐 / 台账补缺） | 返工×1 | intent 2026-09-29-p0-gate-noise-batch（回填 2026-09-30）；初复核 0 P0 / 0 P1 / P2×5 + 增量复核 0 P0 / 1 P1 / P2×5（F2/F3 修订后）——P1-1 提交树 kit.json 预 landing 属提交态边界（非实现缺陷），处置 = 完整提交 + clone 复验；修订轮含 F2 测试矩阵补缺（注入验承重）+ F3 方向词 + 词表误报改写；主智能体自做 |
| 2026-09-30 | adopter-surface：装户表面收口（README / CHANGELOG / 审计归档 / audit 档 / 检查 17 / 宿主薄适配 / fresh init / 三门禁） | 一次通过 | intent 2026-09-29-adopter-surface（回填 2026-09-30；实施 2c83677 完成于 09-29，本日补关单前独立复核与收口）；独立复核 0 P0 / 0 P1 / P2×4——6 组反向注入验承重、P2 全处置；主智能体自做 |
| 2026-10-01 | drift-hardening：泳道完整性门禁（触达面判低拦截 + 探索标记拦截） | 返工×2 | intent 2026-10-01-drift-hardening（L2）；实现返工 2 次——①pre-commit 接线误用 run_gate（sh 把 node 当脚本解释，trae-hooks 套件实跑抓到）②整文件暂存捆带工作区 in-flight hybrid 批内容（独立复核 P1-1，定性 fix-forward 留痕 intent 关单节）；复核 0 P0 / 3 P1 / 5 P2，P1 全采纳（c51555e 收口）；套件 19/19 + verify 全绿 + experiment 分支本仓实录拦截；主智能体自做 |
| 2026-10-01 | hybrid-governance 补档：四特性回填三件套（实现已随用户授权免档直提 20490ad 落地） | 一次通过 | intent 2026-10-01-hybrid-governance（L2 回填批，零代码改动）；独立复核 12 锚点判据全一致 / 叙事真实，1 P1（落地归属口径）+ 3 P2 全收随关单编辑收口；勾验证据引用 20490ad / fresh-clone 实录 / 复核报告；主智能体自做 |
| 2026-10-01 | M4 dogfooding 补关单（当年 L2 完成未关档） | 一次通过 | intent 2026-09-23-m4-dogfooding（回填 2026-10-01，v0.9.0 发版门检查 17 触发）——验收 5 条当年已全勾验，本仓即 init 装户，dogfooding 由后续全部闭环批（含 2026-10-01 两批）持续验证；主智能体自做 |
| 2026-10-01 | v09-review-defects 修复批（确认门伪造 + 加固门直推绕过） | 一次通过 | incident 2026-10-01-v09-review-defects（L2，spec/plan 同族）；修复 7e6bc39 + P2 收口 b1237ce；独立复核 0 P0 / 0 P1 / 3 P2，P2-2/P2-3 顺手收口；套件 solidify 16/16 + pre-push 6/6 真仓端到端 + verify 全绿；主智能体自做 |
| 2026-10-01 | gate-script-test-coverage：引擎脚本测试覆盖门（检查 20 + trust-mode 补测 + 豁免机制） | 一次通过 | intent 2026-10-01-gate-script-test-coverage（L2）；检查 20 四场景 fixture + trust-mode 8/8（含 --auto e2e 双向）+ 6 行豁免登记（零存量告警）+ gate-checklist 0 断档；独立复核两轮 0 P0/0 P1/2 P2，P2-1 收口 2fd70ae；npm test 全绿；主智能体自做 |
| 2026-10-02 | caliber-convergence：口径收敛批（plan 单源 + 泳道方案 C 分歧双严 + check2 样例豁免 + 7 P2） | 返工×1 | intent 2026-10-02-caliber-convergence（L2）；实现 6d0e9fb（36 文件）；复核初判「修复后放行」——P1×2（加固门 suspect 逃逸 spec / 5 宿主交付面未 sync）+ P2×2 全收随 2989d9c；真仓占位符误报 8→2（余 2 真阳性）；check-loop 187/0（含 H7）+ confirm-doc 48/0（含 S31b/c）+ sync-hosts 76 对；顺手修 solidify 测试跨天脆断；主智能体自做 |
| 2026-10-02 | ledger-ci-invariant：台账提交不变量（CI 历史全扫 + pre-commit --staged + 行级校验） | 一次通过 | intent 2026-10-02-ledger-ci-invariant（L2）；实现 0a11893 + P2 收口 6ad4446（删除台账即 hard fail）；预检 90 提交前缀零违例（append-only 事实成立）；fixture 12/12 真 git 仓六类篡改全检出 + 三正例防误拦；CI 五道门 + fetch-depth:0；README 硬规则 6；复核 0 P0/0 P1/1 P2 建议放行；主智能体自做 |
| 2026-10-02 | ledger-funnel-metrics：台账炼漏斗（机器口径一次通过/返工/周期入 metrics.md 双表） | 一次通过 | intent 2026-10-02-ledger-funnel-metrics（L2）；实现 dcb7d1f + P2×3 收口 ad42ca8（incident 确认阶段按件型=fixed、终态≥2 入返工定义、边界声明——重推导 108=96 完整链+12 协议前、2 返工）；fixture 七形态 24/0 + 体量零回归 + 检查 16 零接触；双月回填 09/10；复核 0 P0/0 P1/3 P2 建议放行；主智能体自做 |

## 返工归因回溯判定留痕（2026-10-08 rework-attribution-split）

> 背景：`2026-10-08-selfmeasure-and-modularize` 引入「门禁噪声」档后，用户指示回溯标注存量。2026-10-08 对本表**全部 29 行含返工记录逐行审计**，结论如下。留痕的目的是**让「没标」也可对质**——否则下一个人会重复做同样的逐行审计。
>
> **判据**：门禁噪声 = 返工根因在门禁面（规则面预算 / 双源纪律 / 节名契约 / 门禁自身误报），且该改动本身合规；设计返工 = 实现有真实缺陷（复核抓出的逻辑错 / 漏改 / codemod 缺陷 / 测试 fixture 错误）。
> **标注纪律**：只标**能逐点对质**的行——每个噪声点必须在备注列写明「哪一点、依据是什么」；混合行按点拆，**不整行标噪声**。

### 审计结论总览

| 分类 | 行数 | 说明 |
|---|---|---|
| 可精确拆分并已标注 | **1** | `2026-10-07-adopter-ci-github`（2 个返工点，一条噪声一条设计） |
| 不可精确拆分 | 3 | 结果列记录数 < 备注列返工点数，无法确定那 N 次记的是哪几点（L31 / L33 / L77） |
| 全为设计返工，不标 | 25 | 每行至少一个复核抓出的实现缺陷 / 漏改 / 测试 fixture 错误 |

### 为什么只有 1 行可标

29 行中每行**至少含一个设计面返工点**（独立复核抓出的 P1/P2、codemod 缺陷、测试断言写错、正则解析 bug 等）。真正的高频门禁面摩擦集中在两处——**规则面预算**（`adopter-ci-github` ①、`backflow-loop-audit-remediation` ②）与**双源纪律**（`adopter-ci-github` ②、`backflow-loop-audit-remediation` ①、`p2-batch1`、`wf-runtime`）——但它们**全部以混合形态存在**：同一行里既有门禁拦的合法改动，也有门禁正确拦下的真实违约。

严格口径下「整行含噪声即整行标」会洗白同行的设计返工（正是本节要防的滥用），故只有返工点数与记录数**一一对应**的行才能精确拆分——全表仅 L29 符合。

### 附带发现的数据质量问题（不掩盖，待后续处理）

以下行的**结果列返工总数小于备注列列出的返工点数**，即记录数与实际发生数不一致，使「精确拆分」在这些行上不可能（不是不愿标，是标不出）：

| 行 | 结果列 | 备注列返工点数 | 说明 |
|---|---|---|---|
| `2026-10-06-template-downstream` | `返工×1` | 3 | ① doctor 新节未登记 PAIRS 被 S10 拦 ② 复核 P2-1 前缀翻译 ③ debug 误跑 sync 落仓 amend 出历史 |
| `2026-10-06-backflow-loop-audit-remediation` | `返工×1` | 2+ | ① 双侧复制漏刷台账 ② 单篇预算超限 ③ sync-hosts 漂移收口 |
| `2026-09-30-stage-gate-machine` | `返工×3` | 7 轮复核各 1 项 P1 | 三轮复核各有 P1，计数口径与「复核轮次」不对齐 |

**本单不回填这些行**——无据补数即造数，违反「宁可让指标红也不要掩盖真问题」。后续若要回填，须先定义「记录数 = 返工发生次数」的记法纪律（当前记法允许只记部分返工点），属独立事项。

### 为什么这件事仍然值得做

单值格式下，混合归因**只能整行倒向某一侧**：倒向设计 = 噪声被计入指标（指标红但不可诊断）；倒向噪声 = 洗白设计返工。`返工×N + 门禁噪声×M` 让两个归因各落各的列，且保持「一行 = 一个任务」（`total` / `passRate` 分母不变）。存量只有 1 行用得上，但**机制对未来的混合返工有效**——尤其是规则面预算在改动面扩大时会持续产生合法增长被拦的场景。

---

## 月度聚合快照

（`node .agents/scripts/agg-delegations.cjs` 输出的可粘贴快照行落这里，每月一行）

| 月份 | 有效任务 | 一次通过率 | 平均返工 | 主兜底 | incident | 扩容门 | 备注 |
|------|----------|-----------|----------|--------|----------|--------|------|
| 2026-09 | 40 | 55% | 0.57 | 0% | 22 | ❌ 未达标（连续性中断）：2+3+5 | 样本含待修0 |
| 2026-10 | 15 | 73% | 0.33 | — | 9 | ❌ 未达标（连续性中断）：1+2+3+5 | 样本含待修0、未知1 |

## 并发扩容门槛

连续两个月一次完成率 ≥ 90%、**月度设计返工次数**为 0 且无主兜底信号，才考虑扩大并发委派；任一不达标维持单并发。门禁噪声返工不计入本项（2026-10-08 起拆分单列，见头部记法）。门槛判定由聚合脚本输出，两处同步修改。
