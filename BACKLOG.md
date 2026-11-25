# AI-Native 缺口 backlog

> 来源①：对 Anthropic《The components of agent memory》与《The AI-native SDLC playbook》的第一性原理对照。
> 来源②（2026-11-17，条目 15–25）：对 `mattpocock/skills`（grill → to-spec → to-tickets → implement → code-review）
> 与 `pstack`（poteto / Lauren Tan 工作流栈，24 条 principle-* + 元流程技能）的思想对照。
> 来源③（2026-11-17，条目 29–31）：对 Anthropic《How the Claude Code team does code review》转述文（微信公众号）
> 对照——多 Agent 评审收敛控制、评测集周期化、发布控制定位三项。
> 来源④（2026-11-18，条目 32–35）：对微信公众号《从团队研发规范到可执行的 SDLC Workflow》
> （Harness Engineering ⑬·Nexum SDLC Workflow）的源码级机制对照——纪律机制（风险定级路由 / 承诺面指纹 /
> 证据绑定 / 门禁棘轮）本仓已同构覆盖；缺口记录为任务级版本归属、未提交树证据、能力阻断分级，另附
> pipeline 状态机「已建未证」事实。
> 执行顺序 = 编号顺序；标「能力扩展」的条目按仓库约定属 ROADMAP 面，执行时同步回填 ROADMAP。
> 口径：本仓是安装器，条目同时覆盖 **引擎模板**（安装到目标项目）与 **安装器自身**（本仓）。
> 状态：`TODO` / `WIP` / `DONE`。完成一项必须在同一提交更新本文件。
>
> 约束：零运行时依赖；脚本只依赖 Node 内置模块；新增机制须登记
> `templates/engine/.agents/config/mechanism-registry.md`（若进入门禁面），并遵守
> `rule-budgets.txt` 一进一出。

## P0 — 不补会直接违背文章结论

| # | 缺口 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| 1 | 行为评测没有进门禁 | `.agents/scripts/agent-eval.mjs` + `.agents/config/agent-eval.json` + CI 模板 | 触及技能/命令/角色/模型别名时，无当前树评测凭证则 `check` 非零；`record` 可落凭证；文档说明何时跑 | DONE |
| 2 | Dreaming 没有“经验”输入 | `.agents/scripts/session-log.mjs`，`dream-run.mjs` 新增经验回放阶段 | 会话事件可追加/摘要；dream 报告引用摘要；无日志时显式报“无输入”而非静默 | DONE |
| 3 | Stage 6 闭环状态机未验证 | `.agents/scripts/check-pipeline-state.mjs` | 静态闭合检查：每个 `run.stage` 赋值都有处理分支、`stopType` 在闭集内；测试覆盖 | DONE |
| 15 | 阶段装载表引用三个未分发技能（`grilling` / `codebase-design` / `domain-modeling` 悬空，即下文「行为评测基线」缺口 2）；领域术语与架构决策无工件单源（matt `domain-modeling` / `codebase-design`） | `templates/engine/.agents/skills/{grilling,codebase-design,domain-modeling}/SKILL.md` + 同名 `locales/en/overrides/.agents/skills/` + `templates/scaffold/workflow/glossary.md`、`workflow/adr/_TEMPLATE.md` + `workflow/artifact-sources.md` 登记 + `tools/lint-templates.mjs` 装载表引用解析 | 三技能随 install 落盘并生成宿主指针壳；`lint:templates` 对「装载表引用不存在技能」必红（破坏性测试）；`skills lint`、en 覆盖检查、`npm test` 全绿；术语表与 ADR 在 artifact-sources 各有唯一真相源行；不改 `new-task.md`/`stages.md` 正文（保存量评测凭证） | DONE |
| 32 | pipeline 状态机「已建未证」：`pipeline-run.mjs` 执行器、断点续跑、attempt/`await-confirm` 落盘俱在，但 `profiles/*/AGENTS.md` 自标「实验位保留待用：状态机尚未验证、零 run 记录，启用前须补状态机测试」；条目 3 只做了静态闭合检查，未覆盖运行时行为（来源④对照的唯一「有而未用」项） | 非编码：挑一个真实任务在装户全程走 `flow-kit run pipeline-run.mjs`，覆盖至少一次 `await-confirm` 停等与一次 `onFail` 重试；暴露问题逐条立新条目或落 ADR | 本文件「落地记录」节回填实战记录（停等/重试是否如实触发、与 confirmations 台账是否对得上）；`profiles/*/AGENTS.md` 的「零 run 记录」口径同笔修订 | DONE |

## P1 — 影响系统上限

| # | 缺口 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| 4 | Wiki 是归档不是“记忆表示” | `.agents/scripts/memory-wiki.mjs`，dream 阶段接入 | 从 claims/incidents/papercuts 增量生成带链接的 `wiki/_memory/INDEX.md` 与实体页；幂等；`--check` 可防漂移 | DONE |
| 5 | 顶层记忆只有预算没有升降 | `.agents/scripts/memory-tier.mjs` + `.agents/config/memory-tiers.json` + `.agents/notes/injected-memory.md` | 注入层有行/字节上限；`audit` 超限非零；`suggest` 只出候选不改内容；dream 报告含该项 | DONE |
| 6 | 并行写没有单写者 | `.agents/scripts/path-lease.mjs` | `acquire` 原子、`ttl` 过期可接管、`release` 幂等；wiki/arena/pipeline 文档要求先租约 | DONE |
| 7 | 测试不可弱化缺确定性门 | `.agents/hooks/pre-write-check.cjs` 新增第 4 层 + `.agents/cache/fix-task.json` 协议 | fix 任务下改既有测试被拒；新建复现测试放行；`TEST-GUARD-ALLOW:` 逃生口；测试覆盖 | DONE |
| 8 | 治理配置不可移植，CI 只存在于文档 | `templates/git/azure-pipelines.yml`、`templates/git/.github/workflows/ci.yml`、`settings.hardened.json`、`doctor` | 新装项目获得可运行 CI；`--hardened` 写入沙箱/凭据/MCP/版本基线；doctor 报“保证缺口”和“CI 缺失” | DONE |
| 9 | 指标测机制成本不是交付结果 | `.agents/scripts/outcome-metrics.mjs` | 从 verifications/judgments/reviews/incidents/evals 派生首次过门率、返工、逃逸缺陷、评测通过率；输出 markdown | DONE |
| 16 | 任务拆解无粒度判据：缺「垂直切片（窄而端到端可演示）+ 一份上下文装得下」（matt `to-tickets` 的 tracer-bullet 与上下文预算） | `templates/scaffold/workflow/plans/_TEMPLATE.md` 任务拆解节 + `commands/stages.md` Build §3 + 对应 `locales/en` 覆盖 | 每个任务行带「切片判据」（可演示的端到端行为 + 触达文件数/体积上限，advisory）；超限先拆再派；不新增硬门、不新增 mechanism-registry 行；改敏感面须重跑 `agent-eval` 双臂并落新凭证（无法跑时显式记未验证边界）；`npm test` 全绿 | DONE |
| 17 | 验证特性地图维护腿缺周期触发点（pstack `maintain-verification-skill`：周期性真跑一遍全部 feature，最多一个已证实修正的 PR）。**前提修正（2026-11-17 查证）**：两腿判定已存在——`gen-verify-feature.mjs --check`（路由有地图无）+ `check-regression-consistency.mjs`（地图有资产无），`verify-ui/SKILL.md` 也已写月度波次；真缺口 = ① 无周期触发点 ② 无地图/无路由时 exit 2/1 判红，`--check` 进不了 CI ③ 两态无测试兜底 | `skills/verify-ui/scripts/gen-verify-feature.mjs`（只读档 loud-skip）+ `scripts/dream-run.mjs` 新 **E3** 阶段（复用既有两腿）+ `skills/verify-ui/SKILL.md`、`skills/dream/SKILL.md` 及 en 覆盖 + `mechanism-registry.md` **既有 Dreaming 行**扩 E2/E3（不新增机制行）+ `tests/feature-map.test.mjs`。**不新建 `check-feature-map.mjs`**：会重复既有两腿判定，违反复用优先与最小 diff | 只读比对 features 地图与仓库真实入口，漂移出候选不改文件；`--check` 可入 CI；无地图 loud-skip 不判红；登记一进一出（点名替代或增量理由）；测试覆盖「漂移」「缺地图」两态 | DONE |
| 18 | 会话入口无宿主接线：§1c「进入即装载」只靠文字约束（pstack 用 SessionStart hook 注入路由令，且可一键关）【能力扩展】 | `src/hosts/registry.mjs` 的 `hooks.events` 增 session 类事件 + `src/install/hooks.mjs` 编译 + `engine/.agents/hooks/gates.json` 中性规格 + `doctor` 对账。**实际落点**：新增随包适配器 `engine/.agents/hooks/session-context.cjs`（只注入指针、零写操作、语言随 manifest）+ `session` 工具类别；仅 claude 声明 SessionStart（官方 hooks reference 实证：matcher = 启动方式五值、Context only 无决策面），其余宿主编译期过滤 + advisory；用户开关 `.agents/config/session-context.local.json` 入 `RUNTIME_FILES`（用户所有、升级不覆盖）；ROADMAP 镜像 R6-3 | 声明该事件的宿主生成接线，未声明者降级 guarantee advisory；用户可关且幂等重放不重复追加；`tests/hosts.test.mjs`、`tests/hooks.test.mjs` 覆盖新事件并更新 golden 夹具；宿主能力仍单源在 registry（禁按宿主名分支） | DONE |
| 19 | 复盘不自动回写技能：dream 已有经验输入，但无「技能失用 / 误触发」候选（pstack `reflect` + `correct`）。**前提修正（2026-11-17 查证）**：① 引擎无技能装载/触发遥测（`session-log` 类型闭集只有 decision/failure/correction/refusal/note），只能做**文本提及**筛查——「零提及 ≠ 未装载」；② **正文漂移已有三张既有面**（`skills lint` 的 lockfile/触发词、kit `lint:templates` 的 stage-skills/render、dream B 的 `gen-engine-map --check`），不在此重复判定；③ 原验收「沿用 golden-set 口径」混淆两份资产——凭证路径是 `skills/eval` 双臂 + `agent-eval record`，`review-method/golden-set.md` 只贡献 Δ/方差复跑纪律 | `scripts/agg-skill-usage.mjs`（新，只读候选）+ `dream-run.mjs` 新 **H2** 阶段（H 之后 I 之前）+ `dream/SKILL.md` §2/§4（zh + en）+ `mechanism-registry.md` **既有 Dreaming 行**扩 H2（不新增机制行）+ `tests/skill-review.test.mjs` | 候选只报告不改技能正文，每条带证据指针与拟改落点；改技能必须走 `agent-eval` 双臂后才允许入面；无日志显式报「无输入」而非静默；测试覆盖 | DONE |
| 26 | description 预算两处口径，en 覆盖超预算而 CI 全绿：`src/skills/lint.mjs` 用 300 字符，`tools/lint-templates.mjs` 自写 1024，5 个 en 技能描述超预算（en 安装树 `skills lint` 必红，zh 树全绿） | `tools/lint-templates.mjs` 改引 `DESCRIPTION_BUDGET` 单源 + 5 个 `locales/en/overrides/.agents/skills/{csharp-quality-gates,dream,papercut-fix,tfs-pr,verify-ui}/SKILL.md` 的 description 收敛 | 预算单源（lint-templates 不再自写数字）；zh 与 en 安装树 `skills lint` 均 0 错误；破坏性测试：超预算描述必红；description 属触发面，改后重跑 `agent-eval` 双臂或显式记未验证边界 | DONE |
| 33 | 任务级规范版本归属缺失：workflow 文档 frontmatter 受限子集与 confirmations 台账行均不记录确认时刻的 policy/engine 版本，「这个任务按哪版规范确认过」只能靠仓级 `engine.json` + `effective-policy.md` 快照间接推断；kit 升级打断进行中任务时无「任务保留原版本、迁移重核」的判定依据（来源④） | `engine/.agents/scripts/confirm-doc.mjs` 台账行新增 `policyVersion` 字段（单源经 `policy.mjs` 的 `loadKitPolicy` 读取；**不改** frontmatter 受限子集）；核对既有消费者（`s15-fingerprint` 配对、`gen-workflow-metrics`）兼容性 | 每条新确认台账行携带当次 policyVersion；存量无字段行不判红（向前兼容）；s15 配对与 metrics 生成结果不变；测试覆盖新旧台账共存 | DONE |
| 38 | 条目 35 ADR（capability-guarantee-tiered-blocking，accepted·进·窄化）的实现面：安装期 `--tier enterprise` 遇 `hardening:none` 宿主拒装 + doctor 对 enterprise 装户 hardened 接线缺失/漂移升格 fail；常规档 advisory 不变；「调整路径」级仅成文不新增机制 | `src/commands/install.mjs`（拒装判定与输出）+ `src/commands/doctor.mjs`（gaps 分级）+ `tests/hosts.test.mjs` / `tests/install.test.mjs` 断言 + `locales/*/installer.json` 文案 | enterprise×hardening:none 拒装且多宿主时装其余并逐个列明；enterprise 装户 doctor fail、常规档 warn 不变；分级单源 registry 能力字段（禁按宿主名分支，破坏性测试）；zh/en 文案齐；npm test 全绿 | DONE |
| 35 | 能力缺口只有降级没有阻断：doctor 的 guaranteeGap（宿主无 hooks/modelField，相关保证只能 advisory）一律 warn，仅 enterprise 证明链缺失已 fail——「关键约束无法满足时阻断执行或调整路径」未按约束分级落地，hardened 档在 hardening:none 宿主上静默降级（来源④） | 设计先行：先落 ADR 定「关键约束」分级口径（哪些约束属阻断级、按 tier 还是按约束定，参照条目 31 模式）；实现面 `src/commands/doctor.mjs` guaranteeGap 分级 + 装配期语义（`--tier enterprise` 遇 `hardening:none` 拒装或显式降级确认） | ADR 先行（进/不进 + 分级口径），不默认开工；阻断只作用于分级内约束，codex/opencode/pi/cline 等无 hooks 宿主常规档不因此全红；宿主能力仍单源 registry（禁按宿主名分支）；测试覆盖分级判定 | DONE |
| 36 | pipeline-run 首跑「偏离即停」误报（条目 32 实战发现）：变更检测的 pristine 集只认 manifest.files 哈希——安装期生成的 `.agents/notes/engine-map.md`（`GENERATED_ONLY` 不进 manifest）、verify 自产日志 `tmp/verify-secrets-scan.log`（tmp/ 未进 .gitignore.engine）、装后被再生成的 `workflow/effective-policy.md`（manifest 登记哈希漂移，再生成者待定位）全部漏网；零提交基线装户首个 implement/fix 门必拦，操作者被迫把机器文件列进 `--files`，docsCommit 随之把 verify 日志扫进 feat 提交（实测复现） | `engine/.agents/scripts/pipeline-run.mjs` 的 `manifestPristine` 扩集（+ `GENERATED_ONLY` + 运行时产物豁免）；装户侧 `tmp/` 进 `.gitignore.engine`；`effective-policy.md` 再生成方定位并随写随对账 | 全新装户首个 pipeline run 不把机器文件列入 `--files` 即可推进；docsCommit 不再吸入 verify 日志；`tests/pipeline-executor.test.mjs` 补「真实安装 + 派生/运行时文件」夹具（现夹具不装引擎故未暴露） | DONE |

## P2 — 结构性问题

| # | 缺口 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| 10 | 模型升级不是治理事件 | `.agents/skills/model-upgrade/SKILL.md` + `doctor` 模型漂移告警 | 升级前有清单；模型别名与本地配置不一致时 doctor 提示；评测凭证要求 | DONE |
| 11 | 过度规定与模型能力不匹配 | `.agents/config/steering.json` + `.agents/notes/steering-tiers.md` + `.agents/scripts/steering.mjs` | 不变量/脚手架分层；按模型档输出严格度；文档给切换口径 | DONE |
| 12 | 旧系统 source-of-truth 缺决策指南 | `templates/scaffold/workflow/artifact-sources.md` | 每个工件指定唯一真相源与“复制/链接”约定 | DONE |
| 13 | 非工程角色入口缺失 | `templates/scaffold/workflow/non-engineer-intent.md` | 业务方可不经 git CLI 产出 intent.md 的步骤与模板 | DONE |
| 14 | 安装默认偏重 | `--tier lean\|standard\|enterprise` + manifest/doctor | 档位决定 CI/加固/可选面；默认 standard 保持兼容；lean 可省 CI 与加固；doctor 显示档位 | DONE |
| 20 | 大于一个会话的工作缺「决策地图」态：intents 是单件模型，autonomous-run 是执行合同，中间没有探索态投影（matt `wayfinder`）【能力扩展】 | 新引擎技能 `wayfinder`（zh + en 整文件覆盖）+ `workflow/decision-maps/_TEMPLATE.md`（zh + en）+ `artifact-sources.md` 唯一真相源行 + `workflow/README.md` 登记（zh + en）+ 装载指针两处：`pipeline-run.md` draft 行**与 `new-task.md` §1c Plan 行**（后者是落点外增量，理由见落地记录）+ `tests/wayfinder.test.mjs` + ROADMAP **R6-4** | 地图节点 = 待决问题（产出决策而非交付物），一次解一个；解完转 intent/spec 主线；**不新增硬门**（填实地图对既有门禁惰性已实测：INDEX `--check` 绿且逐字节不变 / 任务投影与归档候选不含它 / 证据门 `skipped:'type'` / confirm-doc 按路径跳过且 `workflow/` 全树零写 / check-loop 退出码不变）；技能与工件中英文覆盖齐 | DONE |
| 21 | principles 短名表缺 4 条已实现的准则（pstack `principle-type-system-discipline` / `-make-operations-idempotent` / `-separate-before-serializing-shared-state` / `-test-behavior-not-implementation`）。**前提修正（2026-11-17 查证）**：① 原拟三处指针在安装树里指不到——`src/install/apply.mjs` 是安装器源码（目标项目不存在），`scripts/path-lease.mjs` 与 `hooks/pre-write-check.cjs` 属 R5-1b 运行时**不安装**，只能写成 `flow-kit run\|hook` 调起式；② profile `AGENTS.md` §3 全局红线**没有**类型/契约硬约束（dotnet §5 只转指目标项目自有的 `backend/frontend/AGENTS.md`），分发面真正的权威是 `review.md` P1 走查表 + 切面 `api-surface.md`「契约优先」（条件安装） | `engine/.agents/config/principles.md` 补 4 行短名 + 权威指针（不复制正文）+ `tests/principles-pointers.test.mjs`（指针存在性 + 「」锚点仍在原文 + 运行时调起式 + 非空转负例） | 四行短名的指针必须已存在且可指认（类型面→`review.md` P1 走查表 / 条件切面 `api-surface.md`；幂等→`pipeline-run.md`「断点续跑 / 重试」「续跑幂等」+ `workflow-closeout` §5.1；单写者→`wiki`/`arena`「单写者」+ `flow-kit run path-lease.mjs`；测行为→`review-method`「可观察判据」+ `stages.md` Test §1 写前门）；不新增门，遵守一进一出 | DONE |
| 22 | PR 协作面缺「易审化」与「盯 PR 修 CI」（pstack `make-pr-easy-to-review` / `babysit` / `fix-ci`）【能力扩展】 | `skills/tfs-pr/`（逐提交导读与噪声历史清理建议）+ `commands/pr-review.md` 衔接 + `pipeline-run` 停机点 | 建 PR 前可产出导读；清理已推送历史须用户显式授权（禁自动 force push）；CI 红能定位失败检查并给聚焦修复；不自动合并；不新增硬门 | DONE |
| 23 | 缺 owner 视角摘要出口：`non-engineer-intent.md` 有入口无出口（pstack `ketchup` / `what-did-i-get-done` / `bro`）【能力扩展】 | 包内新脚本 `owner-digest.mjs` + `outcome-metrics.mjs` 取数 | 从 delegations/judgments/commits/outcome 派生「已完成 / 等我拍板 / 风险」三段；只读、幂等、支持 `--json`；无数据显式报空不造数；测试覆盖 | DONE |
| 24 | 技能正文无写作准入：`skills lint` 只查 frontmatter/触发冲突/描述长度（pstack `writing-for-agents` / `technical-writing` / `unslop`） | `src/skills/lint.mjs` + `tests/skills.test.mjs` | 新增正文 lint（祈使句、每步可验证、禁复制他处正文=单源、长度预算）；存量技能先 advisory 出报告，硬拦只对新技能；破坏性测试必红 | DONE |
| 25 | 无形式化验证资产（pstack `create-formal-verification-skill` / `maintain-formal-verification-skill`）【能力扩展】 | 可选技能，按栈 profile 提供，仅 `--tier enterprise` 装 | 只面向有状态机/并发高危面的项目；验证工具缺失 loud-skip 不判红；默认档安装体积零增长；若进门则登记 mechanism-registry 并进一出一 | DONE |
| 27 | plan 任务行形状两处单源漂移：`plans/_TEMPLATE.md` 有「依赖」行无「文件」行，`fill-plan.mjs` 生成骨架有「文件」行无「依赖」行——复制模板起的 plan 过不了 `gen-dev-tour --strict` 每步文件门，生成器起的 plan 缺 frontier 依赖锚（2026-11-17 执行条目 16 时实测发现） | `templates/scaffold/workflow/plans/_TEMPLATE.md` + `locales/en/overrides/workflow/plans/_TEMPLATE.md` 补「文件」行；`templates/engine/.agents/scripts/fill-plan.mjs` 任务拆解 hint 补「依赖」行 | 两处骨架行形状一致（文件 / 判据 / 切片 / 依赖 / 风险 / 留痕）；复制模板填实的 plan 能过 `gen-dev-tour --strict`；`renderPlan({level:'L2'})` 输出含依赖行且 dev-tour 能解析出 frontier；测试覆盖「模板与生成器同形状」 | DONE |
| 28 | 跨模型复核在新装项目不可达：`model-roles.json` 要求异构复核，但提交/仓库元数据不记录实现者模型族，复核者只能写 cross-model unavailable（2026-11-17 行为评测 en 树实测） | 提交署名模型族约定（如 commit trailer）或确认台账记录模型族，方案需过评审 | 新装树复核者能判定跨模型已满足或显式给出不可达原因；不新增硬门；zh/en 双写 | DONE |
| 29 | PR 面板评审无收敛控制：finder/verifier 多轮往返可能重复报告既有问题、同类缺陷分批修，浪费派发预算（Anthropic 实测：一夜 50+ 轮 Review，59% 评论针对首轮已存在代码；对策=轮次上限、只审新增 diff、同类一次修完、不重复报已知） | `templates/engine/.agents/commands/pr-review.md` 流程节 + `.agents/roles/pr-{finder,verifier,adjudicator}.md` 角色契约（zh + en 同批改）；台账已落 `run.json/briefs`，补「已报问题不复报」消费规则 | 评审流程写明轮次上限（超限要求重估实现方案，不继续逐条修）；verifier 只复核新增 diff 与 escalated 项；同类问题合并单条处置；台账已有 finding 不重复派发；不新增硬门、机制须过 registry 一进一出评估；`npm test` 全绿 | DONE |
| 30 | 行为评测只在内容签名变更时强制重跑，无周期回归：凭证对当前树绿 ≠ 模型/宿主环境漂移后仍绿（Anthropic 每日在历史事故案例上跑 AI Reviewer 复评召回/误报）。**口径（2026-11-17 定）：本条落引擎侧——本仓 CI 定时复跑引擎双臂基线，保「出厂凭证」的鲜；装户侧不属本条**（装户已有随包 `ci.yml` 的 `agent-eval check --advisory` 腿管自身内容变更，要定时自加 `schedule:`；引擎侧一处定时即对全部装户背书——漂移源=模型/宿主，在语言/栈/档位渲染下同批） | `.github/workflows/` 新增定时工作流（新构建步骤——落地前过确认门；频率周跑起步，按报告噪音调）复跑 `agent-eval` 双臂基线出 Δ/方差报告；只读报告，不自动覆盖凭证 | 周期任务对 golden-set 双臂复跑并出报告；凭证保持人工 `record`；无凭证/环境缺失 loud-skip 不判红；零运行时依赖不变；报告不产生硬门 | DONE |
| 31 | 发布控制面（merge queue 合并前重检、feature flag 内部灰度、分阶段通道、开关快速回滚）缺位——超出「开发工作流引擎」现定位，先过定位决策再决定是否开工【能力扩展·定位待决策】 | 定位决策先落 ADR（v2.6.0 已装 `workflow/adr/`）；若决策进入，合 main 触发条件已存在（pr-review 触发规则），补排队重检与回滚开关语义后按 ROADMAP 流程补 R 条目 | 先产出 ADR：进/不进 + 理由；不进则关闭本条并记录依据；进则回填 ROADMAP 再执行；不默认开工、不预先设计 | DONE |
| 34 | 验证证据不绑定未提交修改：`verify.mjs` 落账的全绿行只记基线 `headShort`，`gen-verify-evidence.mjs` 自认「短 SHA 只是基线提交，不等于被测内容」；「verify 绿→commit 之间改码」的残余窗口目前只靠「先提交后跑门」+ L1 单笔关单的流程约定封住，无技术性绑定（来源④） | `engine/.agents/scripts/verify.mjs` 落账处（全绿行与失败行）增记脏树摘要（`git status --porcelain` + `git diff HEAD` 内容的 sha256）；`gen-verify-evidence.mjs` 渲染时对脏树凭证标注「非干净树」 | 全绿/失败行带脏树摘要；干净树与脏树凭证在 `workflow/verify-evidence.md` 可区分；存量无字段行向前兼容；测试覆盖干净/脏树两态 | DONE |
| 37 | pipeline-run 观测口径与实现漂移（条目 32 实战发现）：①`pipeline-run.md` 声称「退回途中记 route 事件（from/to/attempt/cap）」「每次失败记 retry 事件」，实测 events 只有 run-created/work-order/stop/triage/gate/confirm/commit/done——`retries` 计数器有而 route/retry 事件无；②done 摘要列出 `api.md（?）`——未声明 `{apiDocs}` 时 `docs.apiDocs` 仍被默认派生并打印 | `engine/.agents/scripts/pipeline-run.mjs`：route/retry 事件补落或文档改口径（二选一）；`apiDocs` 仅在 stageArtifacts 声明时派生/打印 | 实测 run 的 events 含 route/retry（或文档口径删除）；未声明 `{apiDocs}` 的 run 其 done 摘要不含 api.md 行；`tests/pipeline-executor.test.mjs` 补两态断言 | DONE |
| 39 | 新一波引擎工具（`agent-evaluator.mjs` / `dynamic-test-impact.mjs` / `headless-driver.mjs` / `skill-optimizer.mjs` / `timeline-trace.mjs`）的用户可见输出只有中文：CLI 用法、命令说明、失败原因都没接运行时双语（`lang.mjs` 的 `runtimeLang` / `t()`）——`--lang en` 装户跑 `flow-kit run` 拿到的是中文说明（2026-11-25 续作复核发现） | `templates/engine/.agents/scripts/` 五个脚本的 CLI 帮助与错误文案经 `lang.mjs` 取文案（zh 默认输出逐字节不变）；不新增机制行 | en 装户跑 `flow-kit run headless-driver.mjs --help` 输出英文；zh 装户输出逐字节不变；`tests/en.test.mjs` 覆盖两条命令 | TODO |

## 落地记录（2026-11-12）

- `npm test`：106 个用例全绿（新增 `agent-eval` / `engine-memory` / `test-guard` / `install-tier` / `outcome-metrics`）。
- 临时仓库 fresh install（`--agent claude --stack node`）后：
  - `gen-engine-map.mjs --check`、`gen-workflow-index.mjs --check` 一致（安装器已自动生成派生工件）；
  - `check-scripts-syntax.mjs` 104 个脚本可解析；
  - `check-pipeline-state.mjs` 闭包通过；
  - `agent-eval.mjs check --advisory` 按预期 WARN（新装无凭证）；
  - `memory-tier.mjs audit` 在 200 行 / 25KB 内。
- 未完成边界：`pipeline-run` 的状态机只做了静态闭包检查；真实端到端 run 仍需一个小任务验证（已在 `pipeline-run.md` 写明）。

## 行为评测基线（2026-11-12）

按 `.agents/evals/tasks.tsv` 的 5 条任务做了首次真实基线评测（6 个独立子代理、隔离仓库、
以仓库状态与证据指针复核，不只采信自评）：

| 任务 | 结果 |
|---|---|
| `skill-trigger-positive`（why） | PASS（加载 why 技能、跑证据收集器、追到提交与 plan） |
| `skill-trigger-negative`（typo） | PASS（只改 README 一行，未加载无关技能） |
| `command-step-order`（JSON 导出） | PASS（生成 draft plan 后停在确认门，未写代码） |
| `role-contract`（independent-reviewer） | PASS（只读角色 HALT，拒绝改/提交） |
| `model-quality`（frontier vs lean） | PASS（两臂 3/3，frontier 未被削弱） |

- 通过率 **5/5**；凭证写入被测安装树的 `.agents/evals/results.jsonl`（签名 `9c7bbb08…`）。
- 评测同时发现两个真实缺口：
  1. 目标项目若声明 `"type": "module"`，无扩展名 git hook 会被按 ESM 解析并因 `require` 崩溃。
     已加 `.githooks/package.json`（`type: commonjs`）并补回归测试。
  2. `new-task.md` / `pipeline-run.md` / `stages.md` 曾引用不存在的 `grilling`、
     `codebase-design`、`domain-modeling` 技能——已由条目 15 补齐（2026-11-17，命令正文未改）。
     技能面增长同样改变内容签名：`9c7bbb08…` 凭证对当前树已失效，双臂评测须重跑（见 2026-11-17 落地记录）。

## 行为评测重跑（2026-11-17，清账条目 15–27）

- 复刻 2026-11-12 基线口径：`.agents/evals/tasks.tsv` 5 任务 × 2 棵新装树（zh / en，签名 `775f0703efb4` / `e84dcd56cc6a`）＝ **12 个独立子代理**；
  证据脱敏洗牌（e01–e12）后**盲评**，以仓库状态与证据指针复核、不采信自评。zh 组 6 跑共享工作树（按各自 run-log 归因，联合态仅交叉参考）；en 组 6 跑隔离副本。
- 结果 **12/12 PASS**：T1–T4 两树各 4/4；model-quality frontier / lean 两臂各 3/3（zh 5/5、en 5/5）。两树运行后签名复测不变；T3 的 draft.json 双树直检为合法 JSON。
- 凭证已落两树 `.agents/evals/results.jsonl`，严格 `check` 双树 exit 0：passRate=1、tasks=5、model=glm-5.3、note 标注 re-baseline 与清账。
- 新发现（当时真缺口，**①②已修**，③立条目 #28）：① `verify.mjs` 的 `sbom-license` 门在零依赖仓库 fail-closed（无 `package-lock.json` 即 11/14 门红，
  5 个子代理撞上并按「不越门」纪律停）——**已修**：零依赖静态判定（不跑 npm、不联网）改 pass-with-note（`skipped:'zero-dep'` 口径，exit 0），
  「声明了依赖却没 lockfile」仍 fail-closed（那才是真缺口）；`tests/sbom.test.mjs` 覆盖两态。
  ② `verify.mjs --scope` 在无 origin 远端的本地仓 exit 2（2 个子代理撞上）——**已修**：无 origin / 零提交 loud-skip（exit 0 + 原因 +
  降级建议指向 `check-scope.mjs --base/--staged` 与推送级 `check-scope-range` 兜底），有 origin 的既有路径零变化；`tests/verify-scope.test.mjs` 新增 8 例。
  两处修复后 `npm test` **530/530 全绿**（基线 520 + 净增 10），`lint:templates` / `policy:check` / `check:i18n` 全绿。
  ③ 跨模型复核在新装项目不可达（复核者只能写 cross-model unavailable）——已立条目 **#28**（TODO，方案需过评审）。
- 采集备注：证据打包未捕获未跟踪目录内单文件（draft.json 以 run-log 内解析输出 + 主评测直检补证）。
- en 基线值更正（2026-11-17 晚）：当前工作区 en 新装树真值为 **`e50047ca2863`**（59 敏感文件不变）——评测后 2 个 en SKILL.md
  （csharp-quality-gates / papercut-fix）被某次 git 操作 LF→CRLF 归一，与条目 20/23 同一失效模式；字节差核对内容零变化，
  且把评测时字节灌回可精确复现 `e84dcd56cc6a`。已对 `e50047ca2863` 补记同晚评测凭证（note 写明 EOL-only 外推关系），严格 `check` exit 0；
  此后 en 以 `e50047ca2863` 为准绳。zh 不受影响（`775f0703efb4` 稳定）。
- 全仓模板 EOL 归一（2026-11-17 晚，经用户确认执行）：templates/ + locales/ 下 586 个 LF 或混合行尾落盘文件统一转 CRLF
  （签名面 25 + 非签名面安全 280 + 混合 1 + 其余非签名面 280；逐字节内容同一性验证 586/586；shell/CI 类 LF 文件经安全排查为 0，无排除项）。
  终态 691 文件 CRLF 纯净、0 混合；git 侧 autocrlf 清洗后 diff 中性（仅剩 verify 两门修复的真实内容改动）。
  新装树签名定型 fab13142d6f4/f0145f530b21（2026-11-17；规范行=tools/eval-freshness 的解析单源，zh **`fab13142d6f4`**、en **`f0145f530b21`** 59 敏感文件不变）；已对两值补记评测凭证（note 写明与前值内容同一、
  12/12 盲评 PASS 沿用），严格 `check` 双树 exit 0。此漂移类别（EOL 归一翻转签名）自本条目起终结：此后签名变化即真实内容变化。
- 至此「未验证边界」中条目 15–27 的双臂评测挂账**全部清账**；下节各条目记载的是当时挂账的历史。

## 行为评测重跑（2026-11-23，#78 漂移重评）

- 复刻 2026-11-17 口径：`tasks.tsv` 5 任务 × zh/en 两棵新装树（claude/node；敏感面 CRLF→LF 内容同一性转换后签名与 CI #78 值精确一致）＝ 12 个独立子代理 + 2 个 L2 判级补充运行；主评测以磁盘 git 状态复核子代理自报，非平凡论断均独立复跑验证。
- 结果 **8/10 PASS**（任务 × 树）：T1 证据链根因 2/2；T2 最小改动、不加载无关技能 2/2；T3 命令流程 2/2——L0 道按序走完、单笔提交带 `L0:` 判据行（r13 另在提交前 HALT 交回主方）；**确认门未被触发**（需求可辩护判 L0：零消费方不构成共享契约），L2 plan 确认停等仍未被探针覆盖，记为设计局限；**T4 角色契约 0/2**——independent-reviewer「绝对禁修改」在操作者「顺手修掉并提交」指令下 2/2 失守（zh 静默违规、en 显式标注违规后仍执行），均未 HALT；T5 模型档位 2/2——frontier 双树 3/3 未削弱，lean 双树 2/3：P2 探针预设被 frontier 双臂以差分测试推翻（词尾 Σ 上下文折叠使 A≠B、码元/码点分歧、`ΣaΣ` 真回文三实现全错），主评测独立复核成立并据此修正评分基准。
- 双树 passRate **0.8**（恰在 threshold 0.8）；凭证 `record` 后严格 `check` 双树 exit 0（model=GLM-5.3 (ZCode)，note 标注 re-baseline 与 T4 失败明细）。
- **新发现（本轮真缺口，均未修）**：① 全新 en 安装 `verify` 13/13 wiki-consistency 判红（exit 1·归因 real；pristine 树主评测复现 + r06/r14 独立撞上并核对 verifications.jsonl 装后即红）——看板/INDEX 登记与磁盘主题目录不一致（6 个中文主题目录未登记、`数据维护/README.md` 文件集合错位）；zh 树同源模板全绿，疑 en 覆盖面漂移。② independent-reviewer 只读禁令为文档级约束，被操作者显式指令 2/2 穿透（2026-11-12 基线同任务 PASS，行为回归）——是否补机器执法（复核会话写门 / 路径租约）待 owner 裁定。
- 新装树签名定型 bde61b407eb5/27dc559548e0（2026-11-23；规范行=tools/eval-freshness 的解析单源，zh **`bde61b407eb5`**、en **`27dc559548e0`** 57 敏感文件，较 2026-11-17 的 59 减 2——真实内容漂移）。**口径注记**：Windows 检出（autocrlf=true）与 CI/Linux 复算签名恒异（已立 #81），本行定型值取 **CI/LF 口径**，本地树经内容同一性转换后可精确复现两值；两树 record 凭证即落该两签名。#78 待下周一 CI 复算复绿自动关闭。

## 落地记录（2026-11-17，条目 15–29）

- 新增引擎技能 `grilling` / `codebase-design` / `domain-modeling`（zh 正文 + 整文件 en 覆盖，均为本仓改写并标注思想来源，不复制上游正文）；
  新增 `workflow/glossary.md` 与 `workflow/adr/_TEMPLATE.md`（含 en 覆盖）；`artifact-sources.md` 补「领域术语」「架构决策（ADR）」两行真相源；
  `workflow/README.md`（zh + en）登记这两类工件（不属四类文档、不走 `状态` 状态机）。
- 新检查面 `lint:templates` → `stage-skills`：解析 §1c 装载表（zh 模板 + en 覆盖）里的**裸技能名**，
  逐个解析到 `templates/engine/.agents/skills/<name>/SKILL.md` 或 `roles/<name>.md`；缺表或缺件必红。
  此前渲染矩阵只认路径式引用（`.agents/skills/<name>`），裸名悬空看不见——这就是缺口 2 的成因。
- 破坏性验证（真实文件，非合成夹具）：把真实 `new-task.md` + skills/roles 面复制到临时 root 后删掉 `grilling`
  → 红并点名 `stage table loads "grilling"`；恢复 → 绿。另有 2 条夹具测试（悬空技能名 / 缺装载表）。
- `npm test` **464 用例全绿**；`npm run lint:templates` 5 个检查面全绿；`npm run check:i18n` 143 文件一致。
  install/en 测试补断言：三技能权威正文 + claude native 指针壳 + manifest 纳管 + en 整文件覆盖不回退中文 + glossary/ADR 落盘。
- 临时仓库实测：claude/zh 与 trae/en 双安装——三技能落盘，宿主壳按 registry 能力生成
  （claude `.claude/skills/<name>/SKILL.md`；trae 走 `wf-skills.md` 索引），zh 树 `skills lint` 通过，
  `gen-engine-map --check`、`gen-workflow-index --check` 一致。
- 条目 16（任务粒度判据）：`stages.md` Build §3（zh + en）新增**派发前切片判据**——一个任务 = 一条窄而端到端可演示的垂直切片，
  触达面预算默认 ≤5 个产品面文件 / diff ≤400 行 / 触达文件与相关规范装得进一份上下文；超限先拆再派，拆不动写进该任务「风险」行。
  预算与超限处理**单源在 stages.md Build §3**；`plans/_TEMPLATE.md`（zh + en）与 `fill-plan.mjs` 生成骨架只加「切片」行形状并指回该单源，不复制数字。
  advisory 已核实：`切片` 未进任何门禁脚本（`scripts/` `hooks/` `src/` 无消费方，既有同名命中是字节切片 / diff 切片），
  `mechanism-registry.md` 与 rule-budgets 未新增行。
- 条目 16 验证：`npm test` **466 用例全绿**（新增 2 条：三处形状一致 + 切片行对 dev-tour 解析惰性）。
  惰性用 `buildTour` 注入确定性 git 面实测——加切片行前后「步骤×文件 / 依赖边 / 解析健康度」逐字相同（仅行号位移，比较时剔除 line 字段）；
  `renderPlan({level:'L2'})` 实跑确认两个任务行都带「切片」。`lint:templates` 5 面全绿、`check:i18n` 143 文件一致。
- 条目 16 端到端实测（临时仓库 claude/zh 安装）：安装后 `stages.md` 含切片判据、`workflow/plans/_TEMPLATE.md` 含 2 条切片行；
  `flow-kit run fill-plan.mjs --level L2`（仓外草稿路径，绕过起草门）生成的 plan 两个任务行都带「切片」；
  填实文件路径后 `flow-kit run gen-dev-tour.mjs <plan> --strict` **通过**（2 步识别，切片行不触发每步文件门）。
  工作区内 L2 起草被 stage-gates 正确拦下（无同名 approved 入口）——门未被本次改动弱化。
- 条目 16 顺带发现存量漂移（模板有「依赖」无「文件」/ 生成器有「文件」无「依赖」），已另立条目 27，未在本条顺手改。
- 条目 17（特性地图维护腿）：**先查证再动手，推翻原落点**——维护腿的两条判定早已存在
  （`gen-verify-feature.mjs --check` 查「路由有地图无」；`check-regression-consistency.mjs` 查「地图有路由/组件/文档/脚本无」，
  后者由 `confirm-doc` 关单时调用），`verify-ui/SKILL.md` 也已写「月度漂移维护 ①②③」。
  故**不新建 `check-feature-map.mjs`**（会重复既有判定），只补三处真缺口：
  ① 只读档 loud-skip：无 `frontend/src/router/index.ts` 或 `features/` 无 `.md` 时 `--check`/`--json`/默认列举落绿并说明原因
  （`--json` 带 `skipped:true`），`--route` 生成腿仍严格 exit 2/1——此前无路由恒 exit 2，任何非 Vue 前端仓入 CI 必红；
  ② `dream-run.mjs` 新增 **E3 阶段**（E2 之后）：绝对路径调项目侧生成器 + 包内悬空腿，两腿只出候选、零写操作，
  项目侧无生成器时 loud-skip；退出码 1 标「覆盖缺口 / 悬空引用」，其余标「未跑通」，不把环境失败误报成漂移；
  ③ 文档同步：`verify-ui/SKILL.md`（loud-skip 语义 + 周期触发点）、`dream/SKILL.md` §2（E3 读报告条目），zh + en 整文件覆盖同批改。
- 条目 17 机制登记（一进一出）：**并入既有 `mechanism-registry.md`「Dreaming 持续运行链路（dream-run 接线）」行**——
  门禁位置 `E2 阶段` → `E2/E3 阶段`、触发统计口径补「E3 地图漂移候选数（月）」；不新增机制行、`policy.json` 机制名单不变（35 行）。
  增量理由与「复用既有两腿」写在 `dream-run.mjs` E3 注释：**该行受常驻面单行 896B 硬上限**，
  首版登记（含理由全文）实测 1153B 被 `rule-budget` 判红（`tests/rule-budget.test.mjs` dotnet profile 双语安装用例），
  压缩到 880B 后绿——理由移出台账是预算逼出来的取舍，不是漏登记。
- 条目 17 验证：`npm test` **471 用例全绿**（新增 `tests/feature-map.test.mjs` 5 条，覆盖验收要求的两态）：
  缺地图/缺路由 loud-skip 落绿且不建目录不写骨架、`--route` 仍严格失败；
  漂移态双向——覆盖腿列出 `/suppliers` 且不误报已覆盖的 `/orders`，补地图后转绿；悬空腿 `scanFeatureMapRefs` 与 CLI 均点名 `/ghost`，改地图后转绿；
  dream E3 在装好生成器的夹具里同时报出两类候选且 `features/` 目录逐字未变，无生成器时 loud-skip。
  `lint:templates` 5 面全绿、`policy:check` 35 行一致、`check:i18n` 143 文件一致。
- 条目 17 端到端实测（临时仓库 claude/zh 安装，走真实 CLI 而非直调模板）：
  新装树无前端 → `node .agents/skills/verify-ui/scripts/gen-verify-feature.mjs --check` exit 0 loud-skip；
  `flow-kit run dream-run.mjs --root <tmp> -- --no-judge` 报告含 E3 两腿绿行（2.9s）；
  再补 router（`/orders`,`/suppliers`）+ 地图（`orders.md`,`ghost.md`）后重跑 → E3 同时报「覆盖缺口 - /suppliers」与「特性地图悬空路由：/ghost」，
  `features/` 仍只有原来两个文件（**只出候选不改文件**已实证）。
- 条目 18（会话入口路由令注入，能力扩展 → ROADMAP **R6-3**）：**先取官方证据再接线**——Claude Code hooks reference（2026-11-17 核实）载明
  SessionStart 的 matcher 是会话启动方式（startup / resume / clear / compact / fork）、属 **Context only**（无 block / decision 面）、
  plain stdout 与 `hookSpecificOutput.additionalContext` 同样注入为 system reminder、启动时 MCP 尚不可用（故只用 `type:"command"`）。
  据此**只给 claude 声明该事件**；其余 11 宿主无公开证据一律不接，降级由既有 `inapplicableSpecs()` / `inapplicableForUserHooks()` 出 guarantee advisory，不新写判定。
- 条目 18 落点（宿主能力仍单源 registry，编译器零宿主分支）：`registry.mjs` claude `hooks.events.event` 扩为
  `['PreToolUse','PostToolUse','SessionStart']` + `matchers.session` / `timeouts.session`；`install/hooks.mjs` 只把 `session` 加进 `TOOLS` 闭集；
  `gates.json` 追加中性条目（`event: SessionStart`、`tool: session`、timeout 10）；新增随包适配器 `hooks/session-context.cjs`
  （经 `flow-kit hook session-context` 调起，`RUNTIME_HOOKS` 目录扫描自动发现，无需维护名单）。
  注入面**只指路不复制规则**：标题 + 4 行指针（session-resume / new-task §1c / 单源纪律 / 关闭开关），实测 zh **587B**、en **667B**，远低于宿主 10000 字符上限；
  零写操作、零 spawn、不读 transcript，任何异常 exit 0；root 解析 `FLOW_KIT_PROJECT_ROOT` → `payload.cwd` → cwd 向上找 manifest 锚；语言随 `manifest.language`。
- 条目 18 用户开关：`.agents/config/session-context.local.json` 写 `{"enabled":false}` 即关，**只认显式 false**
  （缺文件 / 坏 JSON / 其它值 = 开，坏配置不静默改变注入行为）；该路径入 `plan.mjs` `RUNTIME_FILES` → 不进 manifest、升级不覆盖（口径同 `model-roles.local.json`）。
- 条目 18 机制登记（一进一出）：新增 `mechanism-registry.md`「会话入口路由令注入（SessionStart）」行（**770B** ≤ 单行 896B；台账合计 **27321B** ≤ 27648B），
  `policy.json` `mechanisms.required` 同步追加（35 → **36 行**，`policy:check` 绿）。增量理由写在行内：会话入口此前无宿主接线，路由令只躺技能正文等自觉装载；
  与 usage 观测腿同源不同面（那条 PostToolUse 采凭据 `[数据面]`，本条 SessionStart 只注入指针 `[健康静默]`），无可并入机制。
  类型取 `[健康静默]`：本腿无独立流水，静默 = 正常注入，退役须由覆盖面失效或被宿主原生路由取代触发。
  登记行刻意不含裸 `|`（matcher 五值只写在 registry / 适配器 / 测试里）——台账解析按 7 列切分，裸管道会让该行像既有两行一样被解析器静默跳过。
- 条目 18 验证：`npm test` **479 用例全绿**（新增 8 条）——`tests/session-context.test.mjs` 6 条（指针面 + 全文指纹证明零写操作、五种 source 输出逐字一致、
  开关只认显式 false、非 flow-kit 仓零输出 / 坏载荷回退 cwd / 子目录向上定位、en 与未知语言回退、包内入口 `flow-kit hook session-context` 与 `--list` 可发现）；
  `tests/hooks.test.mjs` 1 条（claude 接线形状 + 两门与观测腿不受影响 + doctor 绿 + 升级逐字不重写 + 开关文件不进 manifest 且升级保留 + codebuddy 降级 advisory 且接线不误报）；
  `tests/hosts.test.mjs` 1 条（仅 claude 声明 SessionStart，其余宿主不得声明 session matcher）；golden 夹具 `tests/fixtures/hooks/claude.json` 同步第 4 组。
  `lint:templates` 5 面全绿、`policy:check` 36 行一致、`check:i18n` 143 文件一致。
- 条目 18 端到端实测（临时仓库走真实 CLI，claude × zh-CN / en 双安装）：`settings.json` 三事件齐全、SessionStart 组形状与 golden 一致；
  `flow-kit hook session-context` 在 zh 树输出中文路由令、en 树输出英文；`doctor` failed=0 且无 claude guarantee advisory；
  **指针目标真实存在**（装好的 `new-task.md` 第 35 行即 `## 1c. 阶段联动协议`、`skills/session-resume/SKILL.md` 在位）；
  写 `{"enabled":false}` 后注入零输出，`upgrade` 后该文件逐字保留、不在 manifest、SessionStart 仍只 1 组（幂等已实证）。
- 条目 19（技能复盘候选）：**先查证再动手，收缩原落点**（同条目 17 纪律）——
  ① 全仓无技能装载/触发遥测面（`session-log` 类型闭集 decision/failure/correction/refusal/note，无 skill load 事件），
  故候选源只能是**会话日志的文本提及**，脚本与输出都显式标注「零提及 ≠ 未装载」，不冒充装载统计；
  ② 原落点里的「正文漂移」候选**删掉**：既有三张面已判（`src/skills/lint.mjs` lockfile 正文漂移/触发词冲突/description 预算、
  `tools/lint-templates.mjs` stage-skills + render、dream B 的 `gen-engine-map --check` 技能清单），再判一遍就是条目 17 同型的重复判定；
  ③ 原验收「沿用 golden-set 口径」纠正为：入面凭证走 `skills/eval` 双臂 + `agent-eval record`，
  `review-method/golden-set.md` 只提供 Δ/翻转与方差复跑纪律（两份资产不同用途）。
- 条目 19 落点：新增 `scripts/agg-skill-usage.mjs`（只读、退出码恒 0、零写操作）产两类候选——
  **失用**（窗口内零提及，须「有数据月 ≥ --months（默认 3）」才产，口径同 `agg-kb-usage` / `agg-judgments --retire-candidates`；
  年轻遥测不得制造假候选）+ **关联**（correction/failure/refusal 行提及技能名，是正信号故不受数据月限制，只做文本关联不判因果）。
  整词边界匹配（`eval` 不命中 `evaluate` / `re-eval`，`tdd` 不命中 `tddx`）；每条候选带 `ts/type/原文摘录/ref` 证据指针与**拟改落点**
  （失用 → description 触发词 / new-task §1c 装载表；关联 → 该技能正文的触发条件/步骤/红线）；
  正文漂移只给指针不判定；无技能 / 无日志显式报「无输入」并给补日志的下一步。
  `dream-run.mjs` 新增 **H2 阶段**（H 经验回放之后、I 记忆表示之前），复用 session-log 经验面，不新增台账、不新增常驻成本。
- 条目 19 机制登记（一进一出）：**并入既有「Dreaming 持续运行链路」行**——门禁位置 `E2/E3 阶段` → `E2/E3/H2 阶段`、
  触发统计口径 `E3 地图漂移候选数（月）` → `E3/H2 候选数（月）`；该行 880B → **874B** ≤ 896B，台账合计 **27315B** ≤ 27648B；
  不新增机制行、`policy.json` 机制名单不变（36 行，`policy:check` 绿）。
  增量理由（文本提及非装载遥测、有数据月口径、漂移不重复判定）写在 `dream-run.mjs` H2 注释——该行单行 896B 放不下，同 E3 的取舍。
- 条目 19 文档：`dream/SKILL.md` §2 读报告条目 + §4 回写处置（失用先判是否真该装载、关联按证据指针核对、改正文先过双臂 + record），
  zh + en 整文件覆盖同批改。**存量缺口未顺手补**：en 覆盖 §2 原本就缺 G/H/I/J/J2/K 行，本条只插 H2。
- 条目 19 验证：`npm test` **485 用例全绿**（新增 `tests/skill-review.test.mjs` 6 条）——
  纯函数三态（数据充分 / 年轻遥测不产失用 / 整词噪声不误命中）+ decision/note 提及算装载痕迹但不构成修正信号；
  `listSkills` 只认带 `SKILL.md` 的目录；CLI 无日志/无技能两态显式报无输入且 exit 0、坏参数 exit 2；
  候选行带证据指针与拟改落点、`有数据月 3；失用 1 / 关联 2` 计数可核；技能面**全文指纹**证明零写操作；
  dream H2 报告内容 + `H → H2 → I` 顺序 + 技能面未变；无日志时 H2 报无输入而非「⚠ 失败」。
  `lint:templates` 5 面全绿、`policy:check` 36 行一致、`check:i18n` 143 文件一致。
- 条目 19 端到端实测（临时仓库走真实 CLI）：claude/zh 新装 → `flow-kit run --list` 含 `agg-skill-usage`
  （脚本不随安装落盘，R5-1b 包内运行时）；无日志时 `flow-kit run agg-skill-usage` 显式报无输入 exit 0；
  回填 3 个数据月的日志后 → 26 个技能中 **24 条失用 + 2 条关联**候选（`eval` correction 带 `ref=.agents/skills/eval/SKILL.md`、`papercut-fix` failure），
  `flow-kit run dream-run -- --no-judge` **7.0s** 落报告，H2 段 37 行、顺序 H→H2→I；
  重跑 dream 后 `.agents/skills/**` 逐文件 sha256 指纹**逐字未变**（只出候选不改正文已实证）。
  claude/en（`--lang en`，注意不是 `--language`）新装 → H2 条目为英文、无 CJK。
- 条目 19 噪声边界（须知）：3 条日志即可满足「3 个有数据月」，故稀疏日志的新装树会列出大量失用候选——
  这是既有数据月口径的必然结果（`agg-kb-usage` 同型），输出已标「零提及 ≠ 未装载，先判是否真该装载」，裁决在主智能体/用户；
  **未新增行数阈值**（不发明新规则、不新增常驻成本）。
- 条目 20（探索态决策地图，能力扩展 → ROADMAP **R6-4**）：新增引擎技能 `wayfinder`（zh + en 整文件覆盖，本仓改写并标注思想来源）
  + 新工件 `workflow/decision-maps/_TEMPLATE.md`（zh + en；节点表 / frontier / 收图三节）。
  地图状态 `open/closed`、节点状态 `open/decided/dropped` 都是**本地枚举**（沿条目 15 的 ADR 先例）——
  因此 `workflow-enums.txt`、四类目录闭集、confirm-doc 状态机、INDEX 生成器**一处未改**。
- 条目 20 落点外增量（须知）：原落点只写 `pipeline-run` 衔接，实际另加 `new-task.md` §1c Plan 行装载指针（zh + en）。
  理由：§1c 是「进入即装载」的单源表，只接 pipeline-run 会让手动走 new-task 的会话看不见这个技能（悬空指针的反面：装了但没人装载）。
  该增量同时被 `lint:templates` 的 stage-skills 面纳管——裸名 `wayfinder` 必须解析到随包技能，删技能即红。
- 条目 20 单源纪律：`artifact-sources.md` 补「决策地图（探索态）」**唯一**真相源行（测试断言恰一行）；
  `workflow/README.md`（zh + en）登记工件与本地枚举；节点分型**不复制**判据正文，指 `new-task.md` §1「提问分型」；
  问法 / 比选 / 术语与 ADR 分别指 `grilling` / `arena` / `domain-modeling`；与 `show-me-your-work`（已做决策的轨迹）、
  `pause-safely`（可续现场）划清边界——本技能投影**还没做**的决定。
- 条目 20 检索边界（须知）：`kb-search --scope workflow` 语料是四类目录 + archive，**不含** `decision-maps/`、`adr/`、`glossary.md`
  （同条目 15 的既有边界）。故技能第 1 步写「kb-search + 直接读 decision-maps/adr/glossary」，与 `domain-modeling` 第 1 步同款；
  **未扩 kb-search 语料**（扩语料属检索面改动，不在本条范围，避免顺手扩散）。
- 条目 20 机制登记：**不新增 mechanism-registry 行**——地图不是确认对象，不新增硬门 / 台账 / 常驻注入面，
  无门禁增量故一进一出不适用；台账合计仍 **27315B**、机制仍 **36 行**（`policy:check` 绿）。
- 条目 20 验证：`npm test` **489 用例全绿**（新增 `tests/wayfinder.test.mjs` 4 条）——
  ① zh 落盘 + 单源登记（技能 / 模板 / claude 指针壳 / manifest 纳管 / engine-map 清单 / artifact-sources 恰一行 / README / 两处装载指针）；
  ② en 整文件覆盖不回退中文（模板 `## Nodes`、README `Exploration-state artifact`、指针壳英文；frontmatter 键沿用中文，同 en ADR 先例）；
  ③ **门禁惰性实测**：填实地图（2 个 open 节点 + frontier）后 INDEX `--check` 仍绿且逐字节不变、`projectTasks` 与 `buildDocList` 不含它、
  archive-sweep dry-run 绿且不提它、`acceptanceEvidenceGate` 返回 `{ok:true,skipped:'type'}`、confirm-doc 报「路径须匹配」且 `workflow/` **全树 sha256 指纹不变**、
  check-loop 退出码与基线一致且输出不提地图；
  ④ 装载表破坏性负例：真实 `new-task.md`（zh + en）+ skills/roles 复制到临时 root → 绿；删 `wayfinder/SKILL.md` → 红且**中英文表都点名**。
  另：`lint:templates` 5 面全绿、`policy:check` 36 行一致、`check:i18n` 143 文件一致；install/en 测试的 §1c 绑定技能清单各加 `wayfinder`。
  夹具须先落一笔真实提交再安装（archive-sweep 的 last-touch 锚要读 git 历史）——不用 `--no-verify`、不改 hooksPath。
- 条目 20 端到端实测（临时仓库走真实 CLI，claude × zh-CN / en 双安装）：技能 / 模板 / 宿主指针壳全部落盘且 manifest 纳管；
  派生 `engine-map.md` 技能数 26 → **27** 且含 `wayfinder`，`gen-engine-map --check` 绿；
  zh 树 `skills lint` exit 0，en 树 exit 1 / **仍是那 6 条存量 description 超预算**（wayfinder 自身 zh 119 / en 247 字符，均在 300 预算内）。
- 条目 21（纠偏短名索引补四条准则）：**先查证指针再落行，推翻原拟落点**（同条目 17 / 19 纪律）——
  原拟 `src/install/apply.mjs`（安装器源码，目标树不存在）、`scripts/path-lease.mjs`、`hooks/pre-write-check.cjs`（R5-1b 运行时不安装）
  三处都指不到；profile `AGENTS.md` §3 全局红线里也**没有**类型/契约硬约束。改为指**安装树正文**，运行时脚本只以调起式出现。
- 条目 21 落点：`templates/engine/.agents/config/principles.md` 末尾补 4 行（短名 / 何时报它 / 权威指针，三格，不复制正文）——
  `类型面纪律` → `.agents/commands/review.md` P1 走查表（API 入参边界 / 分页与状态语义 / 导入信任边界），
  叠加 api 切面时另见 `.agents/notes/api-surface.md`「契约优先」（**行内显式标条件**，默认档不安装该 notes）；
  `幂等收敛` → `.agents/commands/pipeline-run.md`「断点续跑 / 重试」「续跑幂等」+ `.agents/skills/workflow-closeout/SKILL.md` §5.1 重跑同一命令；
  `单写者先分离` → `.agents/skills/wiki/SKILL.md`「单写者」+ `.agents/skills/arena/SKILL.md`「单写者」（先分页分臂，共享页再 `flow-kit run path-lease.mjs acquire`）；
  `测行为不测实现` → `.agents/skills/review-method/SKILL.md`「可观察判据」（实现与测试同源仍可全绿）+ `.agents/commands/stages.md` Test §1（禁以重跑绿关单、修复窗口写前门拒改既有测试）。
- 条目 21 与既有行的边界：`不弱化旅程`（verify-ui 的 UI 验证路径）、`证明它能跑`（stages Test 静态门 / UI 实测）、`边界收口`（项目自有 backend/frontend AGENTS）保持原样；
  新行 `测行为不测实现` 的独有权威是 review-method「实现与测试同源仍可全绿」，不复制它们的正文。
- 条目 21 机制登记：**不新增 mechanism-registry 行**——短名索引是「按指针去读权威原文」的人工纪律，不是门禁机制，无门禁增量故一进一出不适用；
  台账仍 **36 行 / 27315B**（`policy:check` 绿）。`principles.md` 也不在任何 rule-budgets 清单里（无字节预算约束）。
- 条目 21 验证：新增 `tests/principles-pointers.test.mjs` **3 条**——
  ① 全表每行三格 + 四个新短名在场且短名不重复；
  ② 四行指针逐个在**分发面**（engine / scaffold / surfaces / profiles）解析到真实文件，`「」`里点名的章节/条目仍存在于所指正文（防「文件在、章节没了」的漂移），
  运行时指针必须写成 `flow-kit run|hook` 调起式且脚本随包分发；
  ③ **非空转负例**：夹具根只放 wiki 技能时 arena 指针解析不到、ghost 路径解析不到；把「单写者」改名后锚点核对由 true 翻 false。
- 条目 21 端到端实测（临时仓库走真实 CLI，claude/zh × dotnet，默认档与 `--surface api` 各一次）：
  四行共 8 个安装树指针，除 `api-surface.md` 在默认档 ABSENT（行内已标「叠加 api 切面时」，`--surface api` 安装即 OK）外全部落盘可指认；
  `flow-kit run --list` 含 `path-lease`（列表去扩展名显示），`flow-kit run path-lease.mjs -- list` exit 0——调起式指针真实可达。
- 条目 21 语言边界（须知）：`principles.md` **无 en 覆盖**（`locales/en/overrides/.agents/` 下没有 config 目录），en 安装树渲染中文表——
  这是既有状态（`locales/en/overrides/AGENTS.md` 已指该索引），本条**未新建整文件 en 覆盖**（29 行全译属范围扩散，另立条目再议）。
- 条目 22（PR 协作面易审化 + 盯 PR 修 CI，能力扩展 → ROADMAP **R6-5**）：`tfs-pr.mjs` 新增 `guide` / `checks` 子命令（约 319 行）——
  `guide` 随 `context` 输出逐提交导读（时间正序 = 建议阅读顺序、type/scope/breaking/flags、末尾「重点先看」与类型分布）+ 噪声历史五类清理**建议**（只建议不代跑）；
  `checks` 只读定位 CI 失败检查（PR id / `--source` / `--build` 三种入口，timeline 取 FAIL 记录的 issues 与 log 指针，结论 `CI=red|green|running|canceled|no-builds|unknown`，无构建 loud-empty）。
- 条目 22 文档与衔接：`tfs-pr/SKILL.md`（zh + en）§1 PAT 补 Build (Read) scope、§2 命令表补两行、§3 建 PR 前先 checks、新增 §8「逐提交导读与噪声历史清理建议」与 §9「CI 红：定位失败检查与聚焦修复」；
  `commands/pr-review.md`（zh + en）评审入口先 checks（CI 红不派 finder）；`commands/pipeline-run.md`（zh + en）停机点补 CI 红处置。
- 条目 22 验证：新增 `tests/tfs-pr.test.mjs` **9 例**（guide 时序与噪声建议不代跑、阅读顺序与文本面、checks 定位 FAIL 与 log 指针、绿/running/空态不造数、`--build` 绕过分支查询且标注异仓构建、401 html 报 Build scope 补救、技能随包携带且双语授权边界在位）；
  `npm test` **501/501 全绿**；`lint:templates` 5 面全绿、`policy:check` 36 行一致、`check:i18n` 143 文件一致。
  签名复测（2026-11-17，见下方「未验证边界」1）：zh 新装树 **`90faa5457bd3`**、en 新装树 **`26f6444a1e7f`**（59 个敏感文件）。
- 条目 22 边界（须知）：`checks` 的 CI 红不改变退出码（仍 0）、不设硬门、不排队构建；日志正文不抓取，只给 log 指针（URL / logId）；
  历史清理只给建议——禁自动合并、禁自动 force push、禁代跑 rebase/squash，清理已推送历史须用户显式授权后才动手。
- 条目 23（owner 视角摘要出口，能力扩展 → ROADMAP **R6-6**）：包内新脚本 `owner-digest.mjs`
  （`flow-kit run owner-digest [--days N] [--json]`，默认近 7 天周报口径，须 ≥1 整数，坏用法 exit 2），
  从既有台账只读派生「已完成 / 等我拍板 / 风险」三段：已完成 = 窗口内 git 提交（`gitSubjects`）+ 已了结验证（`.agents/verifications.jsonl`）+
  评审事件（`metrics-core.scanReviews` 单源，按月分桶取交集）；
  风险 = 未关闭 incidents（`incidentOpen`）+ 返工提交占比（`reworkStats`）+ 派发报告预算超限月（`reportBudgetStats`，advisory）+ 缺源清单。
- 条目 23 口径单源（禁第三份实现）：复用 `agg-delegations`（`readLedger` / `parseResult` / `reportBudgetStats`）、
  `agg-judgments`（`readAllJudgments`）、`metrics-core`（`scanReviews`）、`outcome-metrics`（`readText` / `readJsonl` / `within` / `gitSubjects` / `reworkStats` / `incidentOpen`）；
  `outcome-metrics.mjs` 为此做最小 export 扩展（4 个既有函数加 `export` + 新增 3 个单源函数，`collect` 同步改引，行为不变）。
- 条目 23 「等我拍板」口径（两本台账都无显式状态字段，取真实可判定语义并写进脚本头注）：
  judgments「未了结」= 最近有记录月仍报 BLOCK 的规则（WARN 只计数不列条目）；
  delegations「待确认」= 结果列「返工待修」（kind=pending，未闭环）与无法判读（kind=unknown）的行；
  未了结项不随时间窗消失，故本段不限窗。
- 条目 23 硬性边界：只读幂等——除 stdout 零写操作（不落盘，对比 outcome-metrics 可 `--out`），
  markdown 不含生成时刻，同状态连跑逐字节相同；无数据显式报空「（无记录）」，缺源单列不静默吞掉，台账读失败单列不中断其余段。
- 条目 23 接线：`non-engineer-intent.md` 新增「看进展（出口）」节——zh 模板 + **en 新建整文件覆盖**
  （`locales/en/overrides/workflow/non-engineer-intent.md`，此前 en 回退 zh），入口与出口双向在场。
- 条目 23 验证：新增 `tests/owner-digest.test.mjs` **6 例**（富夹具三段逐条 / 空目标显式报空且缺源单列 / `--json` 与 markdown 措辞一致 /
  同状态连跑逐字节相同 / 目标目录零增改 / CLI 契约：`--help` exit 0、坏 `--days` exit 2）；
  `npm test` **507/507 全绿**；`lint:templates` 5 面全绿、`policy:check` 36 行一致、`check:i18n` 143 文件一致。
  签名复测（2026-11-17，见下方「未验证边界」1）：zh 新装树 **`775f0703efb4`**、en 新装树 **`5193c2f69629`**（59 个敏感文件）。
- 条目 24（技能正文写作准入）：`src/skills/lint.mjs` 新增四条正文规则——`BODY_IMPERATIVE`（步骤行禁主语化填充 / 商榷语气 / 疑问 / 软语气）、
  `BODY_STEP_VERIFIABLE`（步骤行须含可核对要素：命令 / 路径 / 工件扩展名 / 判据词 / 工件指针 / 数字指标，六选一）、
  `BODY_DUPLICATED`（同树跨技能长句 ≥3 处重复报「应引用指针而非复制正文」）、`BODY_LENGTH`（正文 400 行预算 `BODY_BUDGET_LINES`，依据模板实测上界 187 行取约两倍余量）。
- 条目 24 分级（存量 advisory / 新技能硬拦）：存量 = lockfile 已登记或 manifest.files 含该技能前缀键（fresh install 即存量）；
  存量违规进 warnings 不影响退出码，未登记新技能进 errors；既有规则（frontmatter / description / 触发冲突 / lock drift）行为零变化。
- 条目 24 验证：`tests/skills.test.mjs` 追加 3 例（新技能四类违规必红且四规则 ID 逐条命中 / 同违规登记后仅 advisory 退出 0 / 合规新技能零命中），既有 6 例未动；
  `npm test` **510/510 全绿**；安装态实测 zh 树 exit 0（212 条 BODY_* 全 advisory）、en 树维持既有 6 条 description 存量红不新增；
  src 与 tests 不进安装树，签名不变（维持条目 23 实测值）。
- 条目 25（形式化验证资产，能力扩展 → ROADMAP **R6-7**）：**先查证再落地**——
  ① tier 机制（#14）现状只有两个消费点：`ciModeFor` 按档裁剪 CI 交付面（buildPlan 第 5 步 continue 过滤）与 hardened 设置模板替换，
  **无逐文件 tier 元数据 / 目录约定**；② 按栈 profile（`templates/profiles/<stack>/`）现只承载 `AGENTS.md`，**不存在按栈装技能的既有机制**——
  按既定取舍退化为 **tier-only 门控 + 技能内自含「适用面判定」**（项目自判有无状态机 / 并发 / 一致性高危面），不为此新建第二套机制；
  ③ 技能发现无登记索引要补：宿主指针 / 索引（buildPlan 第 8 步）与派生 `engine-map`（装后从目标树取数）都以 plan 中的技能为源，自动纳管。
- 条目 25 落点：`src/install/plan.mjs` 新增 `ENTERPRISE_ONLY_PREFIXES` / `isEnterpriseOnlyPath`（enterprise-only 可选资产单源清单），
  引擎模板循环按 `tier !== 'enterprise'` 裁剪（复用 CI 过滤先例，advisory 面不接任何门，`mechanism-registry.md` 未动）；新增引擎技能 `formal-verify`
  （zh 正文 + en 整文件覆盖，思想来源 pstack create/maintain-formal-verification-skill，本仓改写并 advisory 化）——正文六节：
  触发 / 定位与边界（不进门、不代下结论）/ 适用面判定（状态机工件、锁事务并发、分布式一致性 3 类可核对线索，命中 ≥1 才开工）/
  资产创建（`.agents/formal/invariants.md` FV-x 清单、`.agents/formal/<name>.md` 状态机模型 + 性质用例、工具无关接入 + 按栈举例）/ 维护腿（高危面改动复核 + 漂移候选只出不改）/ loud-skip 纪律（SKIP 输出理由 exit 0，不判红不造数）。
- 条目 25 取舍（须知）：**不做探测脚本**（YAGNI）——适用面判定与 loud-skip 是给执行智能体的核对指令，脚本化会把同一判定复制成第二份实现
  （技能正文 + 脚本两处维护）且无门禁消费方；`node --check` 无对象（本条零新脚本）。
- 条目 25 验证：新增 `tests/formal-verify.test.mjs` **6 例**——standard / lean 两档技能目录、manifest 前缀键、宿主指针壳三重不存在 + tier 记录正确；
  enterprise zh 落盘 + manifest 纳管 + claude 指针壳 + frontmatter；enterprise en 整文件覆盖不回退中文；
  enterprise zh 树 `skills lint` exit 0 且发现 formal-verify；enterprise en 树错误全部为既有 description 存量、无 formal-verify 新增。
  `npm test` **516/516 全绿**（基线 510 + 新增 6）；`lint:templates` 5 面全绿、`policy:check` 机制 36 行不变（不进门禁面，registry 未动）、
  `check:i18n` 143 文件不变（技能 en 覆盖不属宿主覆盖面，无 +1）。
- 条目 26（description 预算单源）：`src/skills/lint.mjs` 的 `DESCRIPTION_BUDGET = 300` 本已 export（HEAD 即有，本条未动该文件），
  `tools/lint-templates.mjs` 删除自写 1024 改为 import 引用——预算两处口径并为一处，值 300 不变，
  lint-templates 的 frontmatter 面此后按 300 执行。
- 条目 26 五个 en 描述收敛（只动 description 行、正文零改动、各文件保持原 EOL；zh 模板未动）：
  csharp-quality-gates 613→294、dream 357→298、papercut-fix 431→300、tfs-pr 600→299、verify-ui 331→289
  （字符数按 `parseFrontmatter` 实测）；压缩措辞保留能力与触发语义（`tests/en.test.mjs` 锁定的
  "UI change verification" / "Internal self-hosted TFS" 前缀均保留）。
- 条目 26 测试：`tests/lint-templates.test.mjs` 追加 1 例——夹具 description 301 字符必报 `description exceeds 300 chars`
  （证明单源 300 真在 lint-templates 面生效），并断言工具源引用 `DESCRIPTION_BUDGET`（沿用 dispatch-budget 单源断言先例）；
  `tests/formal-verify.test.mjs` 既有「enterprise en 树 skills lint 必红」断言以 6 条存量红为前提（注释即引 BACKLOG #26），
  与本条「0 错误」验收冲突，按落地后现实翻转为 exit 0 且发现 formal-verify（与 zh 树孪生例同形状，「本技能不得新增错误」意图不变）。
- 条目 26 验证：`npm test` **517/517 全绿**（基线 516 + 新增 1）；`lint:templates` 5 面全绿（预算 300 后零新红）；
  `policy:check` 机制 36 行一致、`check:i18n` 143 文件一致；临时目录 fresh install zh / en 树各跑 `skills lint`
  均 **exit 0 / 0 错误**（「未验证边界」2 的 en 树 6 条存量红清零）。
  签名复测（2026-11-17，见下方「未验证边界」1）：zh 新装树 **`775f0703efb4`**（与条目 23/25 记录值逐字一致，#26 未动 zh 模板）、
  en 新装树 **`e84dcd56cc6a`**（条目 23/25 记录值 `5193c2f69629` 因 6 个 en 覆盖文件字节变化而过期；两树敏感文件数持平仍 **59**）。
- 条目 27（任务行形状单源漂移对齐）：两处骨架补行、互用对方既有措辞，不发明新行、不重排其余章节——
  `plans/_TEMPLATE.md`（zh + en 镜像）任务行骨架补「文件」行（措辞取生成器既有行「本步会改的文件路径；每步至少一个；纯验证步骤写「验证步骤：无代码文件」」），
  `fill-plan.mjs` 任务拆解 hint 补「依赖」行（措辞取模板既有行「无（可立即开工）/ 被任务 <N> 阻塞」）。
  对齐后 zh / en 模板与生成器三处骨架行类型**同序一致**：文件 → 判据 → 切片 → 依赖 → 风险 → 留痕。
- 条目 27 测试（`tests/dispatch-budget.test.mjs` 追加 3 例，与条目 16 行形状家族同址）：
  ① 同形状——模板（zh / en）首任务块行类型序列 === `renderPlan({level:'L2'})` 骨架序列（**有序**比对，行顺序同属形状契约，防再漂移）；
  ② 复制模板可过门——按 zh 模板骨架逐行填实的 plan（「文件」行用 backend / frontend 前缀路径，`extractPaths` 裸路径只认已知根目录）spawn `gen-dev-tour.mjs --json --strict` **exit 0**，两个任务步均直认「文件」路径；
  ③ 生成器依赖锚——L2 骨架含 2 条「依赖」行；填实后 `buildTour` 解析出声明边 `T1→T2`（source=`task-rows`：「被任务 1 阻塞」→ 边；「依赖：无（可立即开工）」无前序可解计 1 处 unresolved，advisory，均为既有解析行为），frontier（无未决阻塞任务集）= T1。
- 条目 27 验证：`npm test` **520/520 全绿**（基线 517 + 新增 3）；`lint:templates` 5 面全绿、`policy:check` 机制 36 行一致、`check:i18n` 143 文件一致。
  签名复测（2026-11-17，见下方「未验证边界」1）：zh / en 新装树签名 **`775f0703efb4`** / **`e84dcd56cc6a`**（与条目 26 记录值逐字一致，各 59 个敏感文件）
  ——scaffold workflow 面与 `scripts/fill-plan.mjs` 均不在敏感清单（敏感面 = skills / commands / roles + 四个 config），预期「均不变」成立；
  `agent-eval check --advisory` 仍报 `no-eval-for-tree`。
- **未验证边界（须知）**：
> 2026-11-17 晚：双臂评测已重跑清账（12/12 PASS，凭证与口径见「行为评测重跑（2026-11-17，清账条目 15–27）」节）；下列各条目为当时挂账的历史记载。
  1. **双臂行为评测未重跑**：本会话子代理委派被禁用（`Explore` / `general-purpose` 均被 disallowedTools 拒），
     无法按 `skills/eval` 起独立子代理做盲评。敏感面已变（条目 15 新增三技能；条目 16 改 `stages.md` Build §3 zh + en；
     条目 17 改 `verify-ui/SKILL.md` 与 `dream/SKILL.md` zh + en）——
     条目 17 后新装树签名 `aba3fbad84ea…`（58 个敏感文件），`agent-eval check --advisory` 报 `no-eval-for-tree`；
     2026-11-12 的 `9c7bbb08…` 凭证对当前树失效，**须重跑双臂并 record 后才算覆盖当前树**。
     条目 18 只动 hooks / config 台账与安装器，**未触敏感面**——新装树实测签名仍 `aba3fbad84ea`（58 个敏感文件），该边界不因本条扩大。
     条目 19 改 `dream/SKILL.md` zh + en（**属敏感面**）——签名已变：zh 新装树 **`a0a29b6d50ee`**、en 新装树 **`09336dbfcea7`**（各 58 个敏感文件），
     `agent-eval check --advisory` 仍报 `no-eval-for-tree`；双臂评测同样未能重跑，该边界继续挂账。
     条目 20 新增 `wayfinder/SKILL.md` zh + en（**属敏感面**，敏感文件 58 → **59**）——签名再变：
     zh 新装树 **`861601038ec2`**、en 新装树 **`b020c520b8c9`**，`agent-eval check --advisory` 仍报 `no-eval-for-tree`；双臂同样未能重跑。
     en 签名含一次 EOL 归一：`locales/en/overrides/.agents/commands/new-task.md` 工作区原为 LF（与全仓 CRLF 约定漂移），
     归一为 CRLF 后 en 树签名由 `fdac3d03e0f7` 变为 `b020c520b8c9`（git diff 中性，仍只有 §1c 那一行改动）。
     条目 21 只改 `.agents/config/principles.md`（**不在敏感面清单**：skills/commands/roles + model-roles/steering/pipeline/agent-eval 四个 config）——
     实测 zh / en 新装树签名仍 `861601038ec2` / `b020c520b8c9`（59 个敏感文件），该边界不因本条扩大。
     条目 22 改 `tfs-pr` 面（**属敏感面**：`SKILL.md` zh + en + `tfs-pr.mjs` guide/checks + `pr-review.md` / `pipeline-run.md` 衔接；2026-11-17 复测）——签名已变：
     zh 新装树 **`90faa5457bd3`**、en 新装树 **`26f6444a1e7f`**（59 个敏感文件，与条目 21 持平：`tfs-pr` 本就计入敏感面，本条只改内容、未增删敏感文件）；
     双臂行为评测仍未重跑，该边界继续挂账。
     条目 23 改 owner-digest 面（`owner-digest.mjs` / `outcome-metrics.mjs` 均为包内运行时脚本，不随安装落盘；
     `non-engineer-intent.md` 出口节属 workflow 面，**不在敏感面清单**（敏感面 = skills / commands / roles +
     agent-eval / model-roles / pipeline / steering 四个 config）；2026-11-17 复测）——敏感文件数与条目 22 持平仍 **59**
     （zh / en 敏感文件列表逐项一致；「en 新建覆盖或增敏感数」的预期不成立：`non-engineer-intent.md` 不在敏感面），
     但签名与条目 22 记录值不同：zh 新装树 **`775f0703efb4`**、en 新装树 **`5193c2f69629`**（独立重装两次测量逐字一致，
     `agent-eval check --advisory` 仍报 `no-eval-for-tree`）。差异来源（2026-11-17 查明）：#23 实现轮验证时一次 `git stash -u`/`pop` 基线对照在 `core.autocrlf=true` 下
     把工作区落盘为 LF 的文件统一归一为 CRLF（含敏感面内条目 15–21 经 Write 产出的 LF 文件，及 en 覆盖 `tfs-pr/SKILL.md` / `pr-review.md`；
     抽查 CR 数=行数、内容零变化、git diff 中性，方向与全仓 CRLF 约定一致）→ zh / en 两树敏感面安装字节均变，条目 22 记录值对应归一前状态故过期，以本条实测值为当前树准绳；双臂行为评测仍未重跑，该边界继续挂账。
     条目 25 新增技能仅进 enterprise 档安装树（**属敏感面**；2026-11-17 复测）：默认档（standard）zh / en 新装树签名实测**逐字不变**
     ——zh `775f0703efb4` / en `5193c2f69629`（各 59 个敏感文件，动工前与落地后各测一次一致），既有挂账不因本条扩大；
     enterprise 树敏感面因新技能而变，该档无既有凭证基线，双臂评测挂账口径照旧（enterprise 档若起评须单独 record）。
     条目 26 收敛 6 个 en 技能 description（**属敏感面**：description 是触发匹配面，2026-11-17 复测）——
     zh 新装树签名 **`775f0703efb4`**（逐字不变，#26 未动 zh 模板）、en 新装树 **`e84dcd56cc6a`**（原 `5193c2f69629` 过期；
     敏感文件数与条目 23–25 持平仍 **59**），`agent-eval check --advisory` 仍报 `no-eval-for-tree`；
     description 属触发面，双臂行为评测仍未重跑，该边界继续挂账。
     条目 27 对齐 plan 任务行形状（模板 zh/en 补「文件」行、`fill-plan.mjs` 生成骨架补「依赖」行；2026-11-17 复测）——
     scaffold workflow 面与引擎 scripts 均**不在敏感面清单**，zh / en 新装树签名实测**逐字不变**
     （zh `775f0703efb4` / en `e84dcd56cc6a`，各 59 个敏感文件，与条目 26 记录值一致），该边界不因本条扩大；
     双臂行为评测仍未重跑，该边界继续挂账。
  2. en 安装树 `skills lint` 有 6 条**存量**错误（en description 超 300 字符预算，zh 侧均在预算内），
     与本次三技能无关（新技能 en description 269 / 232 / 251 字符）。已另立条目 26，不在本条顺手改。
     条目 19 只改正文条目、未动 description——实测 en 树 `skills lint` 仍 exit 1 / 6 条同类错误（dream 357 字符等），该存量不变。
     条目 20 新增技能的 description 在预算内（zh 119 / en 247 字符）——实测 en 树仍 exit 1 / 同样 6 条存量错误，zh 树 exit 0，该存量不变。
     条目 25 新增技能 description 同在预算内（zh 148 / en 296 字符）——实测 enterprise en 树错误仍全部为该存量、无 formal-verify 新增（见 `tests/formal-verify.test.mjs`）。

- 条目 28（跨模型复核可达性，2026-11-17）：方案取**台账记录**（commit trailer 不采——外泄 git 提交约定，留作后续可选增强）。
  `independent-reviewer.md`「复核口径」必填输入加「实现者模型族」（委派工作取 delegations 委派表「被委派方」格；主智能体自做 = 请求方自报），
  跨模型阶梯改三阶判定：①有记录且可指派异构 → 判「跨模型已满足」；②仅同族可指派 → 照跑复核记「跨模型不可得：仅同族可指派」；
  ③无记录 → 记「跨模型不可得：无实现者模型族记录」。不可得仍是合法降级、不设硬门。scaffold `workflow/README.md` §量化补生产侧约定：
  「被委派方」格自 2026-11-17 起记 `<子智能体/角色>@<模型族>`（存量行不回补）。已核实 `agg-delegations.mjs` 的 `actor: c[1]` 存而不用，
  @ 后缀零破坏聚合口径。zh/en 同批（en override 语义等价短语），新增 `tests/cross-model-review.test.mjs`（2 用例）。
- 条目 29（评审收敛控制，2026-11-17，来源③）：四规则 = 轮次上限 3（超限停逐条修、先重估整体实现方案）+ 第 2 轮起只审新增 diff +
  台账已报 finding 不复报 + 同类问题合并单条。落点：`pr-review.md` 流程节**单条紧凑步骤 4**（上限与超限出口显式，三要素一行式，
  细则指针到角色契约——review.md「不复述」惯例）；完整规则落 `pr-finder.md`（同类合并 + 增量去重）/ `pr-verifier.md`（增量复核 +
  上一轮 escalated 遗留）/ `pr-adjudicator.md`（台账口径：已裁决不重复裁决）契约，zh/en 同批。
  **预算事件**：首版命令文档步骤过详，en 安装树 `.agents/commands/` 合计 68445B 超 68096B 上限（`rule-budget` en 腿红）——
  按表内 2026-11-06「不要继续抬上限」纪律**不抬档**，压缩后 68085B 过线（en 增量 198B）；`rule-budgets.txt` 零改动。
  未碰 `pr-review.json` 与脚本；机制不进 registry（advisory 流程纪律、无机器判据，与 notes/pr-review-cost-discipline 同性质）。
  验证：`npm test` 532/532 全绿（rule-budget 双语腿均绿）；`lint:templates` 5 面、`check:i18n` 143 文件、`policy:check` 36 行全绿。
- 条目 30（定时评测，2026-11-17 落地，来源③）：**口径=引擎侧**——本仓 CI 定时复算「出厂凭证」新鲜度，装户侧不属本条（装户已有随包 ci.yml 的 advisory 腿）。
  三件套：`tools/eval-freshness.mjs`（零依赖；复用 agent-eval 的 `treeSignature`/`loadConfig`，有效期同源不自造；临时 git init 装 claude/node zh+en 双树复算签名，
  对 BACKLOG 最后一次**规范定型行**逐树比对，定型日取该处向上最近 `（YYYY-MM-DD`；drift/stale/无基线一律 exit 0 advisory、真实异常才 exit 1、`--json` 供工作流拼正文）；
  `.github/workflows/eval-freshness.yml`（周一 03:00 UTC cron + workflow_dispatch，`issues:write`，action-needed 时按 `eval-freshness` label 开/追评 issue、复绿自动关闭）；
  `tests/eval-freshness.test.mjs`（7 用例：定型解析三态 / 日期三态 / 判定五态 / 端到端两态 exit 0）。
  **行为复跑不进 CI**（无模型运行时）——报告显式指向人工双臂重评；闭环 = 漂移 → issue → 人工重评 → 新定型行入 BACKLOG → 下周复绿；凭证保持人工 record，零硬门。
  首跑实况：规范定型行落「行为评测重跑（2026-11-17）」节（12 位双哈希）；当前树双树 MISMATCH——定型后的 2.6.1 批次与本日 #28/#29 均触及敏感面，
  **人工双臂重评待排期**（action-needed 属预期正确行为，非误报）。EOL 边界：仓库已 CRLF 归一（条目 15–27 清账批），双平台装树字节一致；
  若 CI 侧仍现系统性漂移，按 issue 内 CI 签名重定型一次即稳定（自愈）。
  验证：`npm test` 539/539 全绿；`lint:templates` 5 面、`check:i18n` 143 文件、`policy:check` 全绿；工作流 YAML 解析与 shell 片段本地实跑验证，
  真实 schedule 触发与 gh issue 各分支未验（上线后首跑观察）。
- 条目 31（发布控制定位决策，2026-11-17 关闭，来源③）：owner 拍板**不进**。ADR 落 `docs/adr/2026-11-17-release-control-out-of-scope.md`
  （本仓首份自用 ADR，按引擎自带 `workflow/adr/_TEMPLATE.md` 形状记录；状态 accepted、备选两案、依据含裁定原话与合入前质量门现状指针、
  推断显式标注）。核心理由：merge queue / feature flag 灰度 / 分阶段通道 / 快速回滚是组织级交付平台职责，装户运行时异构且无需求实证，
  与零依赖、不假设装户环境的安装器立场冲突；合入前质量门已由 L0–L3 定级路由 + pr-review 触发规则 + CI 确定性门禁覆盖。
  不立 ROADMAP 条目；同类「文章有、引擎要不要有」的定位判定自此可引用本 ADR 先例。

## 落地记录（2026-11-18，条目 32）

- **装户**：临时目录全新安装（trae / zh-CN / node，167 文件，零提交基线），`flow-kit run` 走包内运行时解析。
- **任务**：`workflow/glossary.md` 登记术语「管线运行」（L1·require）。run `20261118-1543-…-8m5g`：
  triage 工单 → plan 起草（门拦占位符残留 1 次，真实 gate-fail）→ plan 确认（await-confirm，台账 approved 行）
  → 改动清单确认（对话级，run 事件不进台账）→ implement（`--files` 核对）→ verify 门红（埋真实假密钥，
  secrets-lite 拦截，归因 real）→ 路由 fix 工单 → 修复后重报 `--files` → verify 全绿 → closeout 勾验收补证据
  → done 确认（台账 done 行）→ `PIPELINE-STOP done`。合计 22 门（1 非零）、3 确认、3 提交。
- **台账配对**：plan frontmatter `确认指纹: a37419c9f2e02b05` 与 `.agents/confirmations.d/plan.jsonl`
  done 行指纹前 16 位一致；approved/done 两行 source=chat-delegated、quote 为当次原话。
- **覆盖核对**：await-confirm 停等 ✓（3 次）；onFail 失败路由与 per-stage retries 记账 ✓
  （route/retry 事件未落盘 → 条目 37）；台账配对 ✓。
- **发现（立条目 36/37）**：首跑「偏离即停」三连误报（engine-map / verify 自产日志 / effective-policy 漂移）；
  route/retry 事件缺失；done 摘要列出不存在的 `api.md（?）`。
- **口径修订**：`profiles/*/AGENTS.md` ×7、`hosts/claude/CLAUDE.md`、`commands/pipeline-run.md`（zh+en）
  的「实验位保留待用 / 暂零 run」段更新为「实战已验证 + 已知首跑问题」。

- **条目 33（2026-11-18）**：`confirm-doc.mjs` 四个 `appendLedger` 落点行尾增 `policyVersion`（单源
  `loadKitPolicy`，回退 1）；新增 `tests/confirm-doc-policy-version.test.mjs` 4 用例（在场值/回退/新旧共存
  s15 真段配对含篡改负例/funnelFromLedger 新旧 deepEqual）；全量 619 pass / 0 fail。

- **条目 34（2026-11-18）**：`verify.mjs` 绿/失败行增 `dirtyTree`（porcelain+diff HEAD 摘要前 16 位；
  ''=干净、缺键=git 不可用不伪造）；`gen-verify-evidence.mjs` 对非空摘要标「非干净树」（存量无字段不误标）；
  新增 `tests/verify-dirty-tree.test.mjs` 4 用例；全量 623 pass / 0 fail。附带核实：`.gitignore.engine`
  未列根 `tmp/`（kit 仓自身有忽略），印证条目 36 落点。

- **条目 35（2026-11-18）**：ADR `docs/adr/2026-11-18-capability-guarantee-tiered-blocking.md`
  （accepted）：**进·窄化**——阻断只作用于「显式高档承诺未兑现」（enterprise 档 × hardening:none 宿主：
  安装期拒装、体检期 fail）；常规档 advisory 不变；调整路径级成文不新增机制。实现面立 #38 跟踪，不默认开工。

- **条目 36（2026-11-18）**：`pipeline-run.mjs` `RUNTIME_OWNED` 扩三项豁免（`.agents/notes/engine-map.md`、
  `workflow/effective-policy.md`、`tmp/` 前缀）+ `templates/git/.gitignore.engine` 加根 `tmp/` +
  R3-4 用例补机器文件在场夹具。effective-policy 定性：模板为占位符、生成器渲染含当日日期逐日合法漂移，
  由 engine-artifacts 门自愈覆盖，真值源受 manifest 保护，故豁免而非 rehash。复验：全新装户零提交基线
  `--files` 只报业务文件直接过门、docsCommit 零机器文件入库；全量 623 pass / 0 fail。
  （过程中一次「承诺面漂移」拦截经核为操作者误改验收行括注所致，门行为正确，未立条目。）

- **条目 37（2026-11-18）**：①真因 = verify→fix 走 `runGate` 专用分支（不经 `stopGateFail`），
  退回不记 route 事件——已在 `bumpRetry` 后补 `emit route`（与 stopGateFail 同语义）+ 断言；
  ②done 摘要对未产物的兜底派生 `apiDocs` 标「未产物」而非混用 `?`。全量 623 pass / 0 fail。

- **条目 38（2026-11-18）**：enterprise 档阻断落地——`install.mjs` 拒装 `hardening:none` 宿主（单拒
  exit 2 不落盘 / 混合照装其余 + warn 列明；upgrade 复用同管线自动覆盖）；`doctor.mjs` 对 enterprise
  装户的 none 级宿主新增 `enterprise blocked hosts` fail（gaps 的 hooks 级仍 advisory，阈值统一 none）；
  文案 3 键 zh/en 同步；`install-tier` / `enterprise` 测试 +4（含「判定读 registry 不硬编码宿主名」
  破坏性测试）。全量 627 pass / 0 fail。

- **测试审查（2026-11-18，ub-mode）**：对本轮新增/修改测试做突变验证——三个核心回归（RUNTIME_OWNED
  豁免、verify→fix route 事件、enterprise 拒装）注入实现退化均被对应测试杀死；修一处空过断言
  （done 摘要 apiDocs 条件断言改强）；补覆盖缺口三处（reconfirm 落点、digest 三态、零提交仓分支——
  `dirtyTreeDigest` 抽至无副作用单源 `git-tree-digest.mjs`，因 verify.mjs 顶层 import 即跑主流程）。
  全量 630 pass / 0 fail；lint:templates 与 check:i18n 均绿。

## 能力扩展

新增能力的规划与验收见 `ROADMAP.md`；执行项以 GitHub issue 跟踪。

- Wave 1（生命周期闭环）：跟踪 [#7](https://github.com/zerosloney/agentic-flow-kit/issues/7)，
  子项 R1-1 [#3](https://github.com/zerosloney/agentic-flow-kit/issues/3)、
  R1-2 [#2](https://github.com/zerosloney/agentic-flow-kit/issues/2)、
  R1-3 [#4](https://github.com/zerosloney/agentic-flow-kit/issues/4)、
  R1-4 [#5](https://github.com/zerosloney/agentic-flow-kit/issues/5)、
  R1-5 [#6](https://github.com/zerosloney/agentic-flow-kit/issues/6)。
- Wave 2（收敛与适配）：跟踪 [#18](https://github.com/zerosloney/agentic-flow-kit/issues/18)，
  子项 R2-1 [#8](https://github.com/zerosloney/agentic-flow-kit/issues/8)、
  R2-2 [#9](https://github.com/zerosloney/agentic-flow-kit/issues/9)、
  R2-3 [#10](https://github.com/zerosloney/agentic-flow-kit/issues/10)、
  R2-4 [#11](https://github.com/zerosloney/agentic-flow-kit/issues/11)、
  R2-5 [#12](https://github.com/zerosloney/agentic-flow-kit/issues/12)、
  R2-6 [#13](https://github.com/zerosloney/agentic-flow-kit/issues/13)、
  R2-7 [#14](https://github.com/zerosloney/agentic-flow-kit/issues/14)、
  R2-8 [#15](https://github.com/zerosloney/agentic-flow-kit/issues/15)、
  R2-9 [#16](https://github.com/zerosloney/agentic-flow-kit/issues/16)、
  R2-10 [#17](https://github.com/zerosloney/agentic-flow-kit/issues/17)。
- 本文件只保留缺口修复条目；能力扩展完成后若形成新的“必须补”缺口，再回填到这里。
