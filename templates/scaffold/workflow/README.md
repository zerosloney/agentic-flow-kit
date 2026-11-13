# workflow — AI 驱动闭环流程（唯一真相源）

本目录是 AI 工作流引擎的唯一载体。L1 新需求以一份 plan 为入口；L2/L3 新需求走 intent → spec → plan；修复走 incident。微观任务层采用「任务责任人（Task Owner）+ AI 结对闭环」，确认在对话内一句话完成（TTY / 委托代录）；宏观主干层支持多人协作协同，主干（main）合并由 TFS PR 分支策略（Peer Review 团队评审 + 与本地脚本同源的 Azure Pipelines CI 门禁）把关，追溯靠 git（commit + PR 记录 + release tag）。

> 闭环新增记录一律写在本目录。

## 目录结构

| 目录 | 放什么 | 命名 |
|------|--------|------|
| `intents/` | L2/L3 新需求入口：背景、目标/非目标、验收标准、级别、触达红线。L1 新需求不建 | `YYYY-MM-DD-<主题>.md` |
| `specs/` | L2/L3 设计规格：功能行为、数据流、系统改动、约束遵守映射。L1 不建 | 与 intent / incident 同名 |
| `plans/` | L1 新需求入口（来源 / 目标 / 红线 / 改动方案 / 约束与风险 / 验证计划 / 验收标准）。L2/L3 与修复仍与 intent / incident 同名 | `YYYY-MM-DD-<主题>.md` |
| `incidents/` | 事故复盘：时间线、根因、为什么没拦住、复盘三件套 | `YYYY-MM-DD-<主题>.md` |

**命名一律英文 kebab-case**（如 `2026-09-07-supplier-rating-field.md`），**禁中文文件名**——原 check-loop §9 非 ASCII 文件名 warning 已随 2026-10-28 引擎减重退役，命名约定不变。文档内容（标题/正文）不受此限。

**文档协议（2026-09-13 结构化）**：四类文档头部一律为 YAML frontmatter（受限子集，每行 `键: 值`，附 check-loop 机器字段唯一来源）——`状态`（intent/spec/plan：draft/approved/done/superseded/cancelled；incident：open/fixed/closed，**严格枚举**，附注写 `备注:` 键）、`级别`（L1/L2/L3）、`日期`/`发现`（YYYY-MM-DD）、`模块`（**2026-09-22 起新建文档必填**，取值见 `.agents/config/workflow-modules.txt` 词表，单值取主导模块；存量不回填，AI 触碰时顺手补）、L3 spec 的 `确认结果`/`确认时间`、回填件 `流程: legacy`。**`日期` 兜底口径（2026-10-27 修）**：plan 由 `fill-plan.mjs` 与 `plans/_TEMPLATE.md` 生成，**2026-10-27 起 frontmatter 写入 `日期`**（此前 renderPlan 收了 date 参数却不落盘）——凡以 frontmatter `日期` 为适用前提的门（委派台账在场门；检查 18 已随 2026-10-28 引擎减重退役），日期缺省时仍**回落文件名前缀** `YYYY-MM-DD` 作为第二道保险（沿检查 15 既有口径；检查 19 已退役）；frontmatter 与文件名皆无日期 → 不可判定 → 跳过。旧口径「无日期即整段跳过」曾使委派门对绝大多数 L2/L3 plan 静默失效（实测 52 份锚后 L2/L3 终态件从未被对账）。**`状态` 迁移须经 `approved`**（确认环节的机器可见态，`done` 只在关单出现）：2026-09-23 起新建的 spec/plan 若已 done 而 git 历史中从未出现行首 `状态: approved`，check-loop 报「确认态缺失」warning。check-loop 只扫 frontmatter 取机器字段（`fm_get` 字段断言），正文不再写「状态：/级别：」行；叙述性字段（独立复核/复盘三件套/验收勾验）仍留正文按节锚定。协议变更与存量迁移见 2026-09-13 `docs(workflow)` 提交。**模糊点显式阻断（2026-10-16，NEEDS-CLARIFICATION 标记）**：spec/plan 起草或修订遇无法自行决策的模糊点（多种解释 / 口径缺失 / 依赖外部事实）**禁止脑补**——原地插入 `[NEEDS CLARIFICATION]: <一句话问题>` 向用户求澄清，澄清后删除标记并把决策落为正文；状态推进 approved 前标记须清零（自检纪律；活跃件 grep 该标记即待澄清清单。跨产物断层自动体检延后——与「暂缓加门」取舍的冲突已显式登记，D6 度量补齐后再议）。**承诺面绑定（2026-10-27 新增）**：用户在 approved 那一刻点头的是**承诺面**（判据文本 / 红线 / 目标 / 改动方案 / 约束与风险）——承诺在确认后被改写而未重新点头 = 用户点头的不是关单时兑现的那一份。关单期合法动作（勾验收 + 证据回填、`确认结果`/`确认时间` 回填、复核行改锚）**不改承诺面**，经归一后不误伤；承诺判据被改写则 hard 拦（检查 15）+ 关单时刻拒收（confirm-doc 承诺面绑定门）。改承诺的**唯一出路** = 用户重新点头后跑 `confirm-doc <doc> --reconfirm --delegated "<原话>"` 重录承诺面指纹（不推进状态，状态行仍由 confirm-doc 写，不手改 frontmatter）；存量（上线前确认、台账行无 `commit` 字段）不追溯。**改已关单正文须同笔重录指纹（2026-11-10，incident 2026-10-26-workflow-confirmation-drift-hard-block）**：改已关单（done/superseded/closed/cancelled/fixed）文档正文 = 须同笔重录确认指纹（`confirm-doc` / `--reconfirm`）或走补偿行（`append-compensation.mjs`），否则 check-loop 判「确认内容漂移」；提交期有 `check-doc-body-drift.mjs` advisory 可见性（不合门）。

各子目录内 `_TEMPLATE.md` 为起步模板，复制后填写，不直接改动模板本身。

根目录 `regression-checklist.md` 为**活文档回归清单**：deploy 回归必过条目与 incident 防复发验证的统一落点，随模块上线补充、随 incident 追加。

**三份 append-only 台账已分片**（2026-10-13 ledger-shard-ledgers）：`regression-checklist` / `delegations` / `papercuts` 的数据行按月存 `workflow/<台账>.d/<YYYY-MM>.md`，主台账只留说明、表头与 GENERATED 区——消除「每次追加全量重写整文件」的体积与合并冲突面。读写单源 = `.agents/scripts/ledger-shards.mjs`（读侧自动合并主台账 ∪ 全部分片，既有消费者无需改动）；追加一行用 `flow-kit run ledger-shards.mjs --append <台账> --row "<行>"`。（第四份 `deploy-observations` 已随 deploy 仪式退役删除——2026-10-29 owner 拍板：实际发布不走 tag/24h 观察仪式，合入 = PR 创建→审查→回归→合并→归档，见 `deploy.md` 头注。）confirmations.d 分片始于 2026-10，2026-09 无分片（该月确认仅 git 口径可溯，历史缺口不回补）；jsonl 各台账 schema 代际以字段有无自描述（如 quoteGrounding 自 2026-10-24 起），不设版本字段（2026-11-05 决策）。

**门禁判定月度分片**（2026-10-22 gate-metrics-shard）：`workflow/gate-metrics.d/<YYYY-MM>.jsonl` 每月一行（规则 × WARN/BLOCK），由 `flow-kit run agg-judgments.mjs --emit-month` 生成、随提交入库；pre-push 月检自动补生成上月分片。退役判据（连续 N 月 = 0）读「本地 `.agents/judgments.jsonl` ∪ 分片」取 max——换机/换 worktree 不再归零，多机并集（`.gitattributes` 复用 `jsonl-union`）。

**主张账**（按月追加）：`workflow/claims.d/<YYYY-MM>.jsonl` 记「未来会话可能当真的一句话」及其在仓库里的原文。追加用 `flow-kit run claims.mjs add`；`recheck` 只报告原文还在不在，退出码恒 0，不是门，也不改账里的历史行。合并走 `jsonl-union`。

## 使用方式

- **发起新任务**：执行 `.agents/commands/new-task.md`（定级 + L0 极简道 / L1 快速道总入口）；L2/L3 进 `.agents/commands/stages.md` 四章（Plan → Design → Build → Test，2026-11-08 档 2-F 四并一）
- **看板（可选，默认不拉起）**：需要时手动跑 `flow-kit run ensure-board.mjs`（幂等：探活 / 旧代码自动重启 / 全新启动弹浏览器），实时只读 http://127.0.0.1:8933；**预警层，非门禁；告警口径对齐 check-loop 硬断档**。「旧代码」＝`board/index.html` 或 `workflow-board-server.mjs` 的 LastWriteTime 晚于看板进程启动 2s（任一更新即重启）；端口被占用时先探活 `/api/board`——响应不含 `cards` 即判为他人进程，不动手不 kill、跳过试下一端口
- **检索**：活跃流程读 `INDEX.md`（生成物，`flow-kit run gen-workflow-index.mjs` 重生成、`--check` 校验漂移）；跨语料检索 `flow-kit run kb-search.mjs "<词>"`（workflow 按节级定位 + wiki 全文，`--type/--module/--status/-n` 过滤；`--status all` 显式全量）
- **归档**：关单即归档（2026-10-13 archive-on-close）——`confirm-doc.mjs` 落终态后自动把**本次确认涉及的家族**（同名 intent/spec/plan/incident 整族）`git mv` 进 `workflow/archive/<终态月>/{类型}/`，活跃目录不再累积终态件。**特性分支默认不归档**（2026-10-15 起，防 CI 泳道门拦合法合并）——合并后由 main/develop 关单或 sweep 承接，未满 21 天窗的滞留属正常态。历史积压用 `flow-kit run archive-sweep.mjs [--window 21] [--execute]`（缺省 dry-run）手工批次清理；归档件仍可被 `kb-search` 检索（`archive/<批次>/<type>` 已覆盖），check-loop 配对门与内容绑定只扫四目录直下、对归档件不触发。终态件积压时人工月度跑一轮 archive-sweep（dry-run 先看候选，`--execute` 执行）。
- **spec 生命周期口径（2026-10-16 owner 拍板，Böckeler 三层分类取 spec-anchored + 长期维护）**：spec 是**持续对照的事实源，交付后不失效**——代码改动触及某 spec 覆盖的行为时须对照该 spec（含归档件）：行为漂移要么改代码回到 spec，要么同一提交回改 spec；有争议立 incident 裁决。**归档是容量治理不是失效**：归档只把终态件移出活跃扫描面（INDEX 活跃行 / check-loop 四目录扫描 / 月度再生），事实源地位与修订权不变——归档 spec 可原地修订，修订不改归档位置。体积治理先观察后设限：spec 行数/验收条数分布由 metrics.md 观察列采集（advisory 上限与「暂缓加门」取舍冲突，显式延后至 D6 度量补齐后再议）。
- **同功能续作（先查后建，2026-10-22）**：动工前按「模块 + 功能关键词」检索 `workflow/specs/`、`workflow/archive/**/specs/`、`.agents/skills/verify-ui/features/`、`workflow/regression-checklist.md`。命中覆盖同一行为 → 在原件上修订（spec 按上条口径原地改，不新建）；确属新特性才新建。新建任务文档时 topic 带特性键，便于后续检索。
- **验证**：`.agents/commands/stages.md` Test 章（静态门 + UI 实测）；切库探活与 API 防复发断言跑 `node scripts/verify/business/regression-smoke.mjs`（默认只读；`--writes` 自建自清探针，仅 dev 库）
- **评审**：`.agents/commands/review.md`（按 P0 / P1 / P2 分级：机器兜底 + AI 自查出清单，用户决策定性与合入）
- **PR 面板评审**：面板已退役为**手动工具**（2026-11-09 自动门退役）——pre-push / CI / pr-create 不再强制评审台账，需要时按 `.agents/commands/pr-review.md` 手动编排；建 PR 走 `flow-kit run pr-create.mjs ...`（先 gate 再调 `tfs-pr create`）
- **上线**：`.agents/commands/deploy.md`（上线前必跑清单）
- **量化**：委派/自做结果记 `delegations.md`，聚合跑 `flow-kit run agg-delegations.mjs`（**并发扩容门槛见该文件——数字达标前不扩并发**）；语料与常驻面体积的**月度快照**跑 `flow-kit run gen-workflow-metrics.mjs`（每月一行落 `metrics.md`，同月重跑即更新；明细看 stdout）
- **追溯**：git 即审计。两条驱动路径二选一、禁混用——手动阶段路由（确认后的 workflow 文档用 `docs(workflow)` 收成一笔，代码提交另笔；L1 普通需求只有 plan，修复为 incident+plan，L2/L3 为入口+spec+plan）或 `pipeline-run` 状态机（按阶段 `docsCommit` 落同形态提交，驱动协议单源 `.agents/commands/pipeline-run.md`）。上线不走 tag/24h 观察仪式（release tag 与发布观察台账已退役，2026-10-29）。本地开发依靠 Independent Reviewer 做认知隔离自查，主干合并通过 TFS PR 团队评审与 git 历史形成完整审计证据
- **级别**：L1 实现级（未命中 L2/L3；新需求的入口是 plan）｜ L2 规则 / 契约（编码权威 / 共享契约 / 既有接口语义 / 全局横切口径，触达面闭集见 `.agents/commands/new-task.md`）｜ L3 数据与运行时结构（schema / 迁移 SQL / DI 链 / 认证与中间件管线）。混合改动就高不就低

## 执行模型

- 默认宿主主智能体负责阶段路由、用户确认、关键判断和最终验收，不注册为额外角色。
- 阶段命令仅在边界明确时委派 `.agents/roles/implementer.md`、`.agents/roles/independent-reviewer.md`、`.agents/roles/ui-verifier.md`。
- OpenCode、Trae、ZCode 分别通过 `.opencode/agents/`、`.trae/agents/`、`.zcode/agents/` 下的薄 Adapter 注册角色；角色行为只维护在 `.agents/roles/`。
- PI 通过 `.pi/agents/` 注册 7 篇角色薄壳（契约同 `.agents/roles/`）；`.pi/extensions/` 把 tool_call 接到 `.agents/hooks/` 两门，判据单源不复制。`.pi/` 为本机私有目录（`.gitignore`），不随 clone 传播；阶段命令按根 `AGENTS.md` §4 路由表由主 Agent 直读 `.agents/commands/*.md`（pi 无 wf-* 命令壳），接线实态由 `check-local-gates.mjs` advisory 对账，机理见 `runtime-env.md` §6.4。
- Cline 通过 `.cline/workflows/`（7 篇指针壳 → `.agents/commands/`）与 `.cline/agents/`（7 篇角色定义，**YAML** → `.agents/roles/`）接入；Cline 原生读 `AGENTS.md` 与 `.agents/skills/`，故规则面与技能面零改动生效。`.cline/` 为本机私有目录（`.gitignore`），不随 clone 传播；**两道门未接线**（Cline hook 协议与仓库 `.agents/hooks/*.cjs` 不兼容，接入需协议适配层），机理见 `runtime-env.md` §6.4。
- 宿主不支持子智能体时按命令 frontmatter 的 `fallback` 执行；但**独立复核项不设 fallback**——L2 / L3 的 `independent-reviewer` 一律 `required: true`，宿主不支持子智能体时另开新会话，不得回退为原主智能体自查。
- 子智能体不得跨越用户确认门，也不得自行提交、合入或上线；所有结果由主智能体复核后交用户决策。

## 闭环规则

1. L1 新需求始于已确认的 plan，不另立 intent。L2/L3 新需求始于已确认的 intent。修复始于已确认的 incident；L1 修复再立同名 L1 plan，走 `.agents/commands/new-task.md` §L1 快速道（常态不打开 `stages.md`）
2. L2/L3 必须先有同名 spec 确认通过（L2/L3 一律强制独立复核，见 `stages.md` Design §3），方可起草 plan。L1 plan 在 `new-task.md` §L1 快速道起草并确认（`stages.md` 只管 L2/L3），节为入口 / 改动方案 / 约束与风险 / 验证计划 / 验收标准
3. 实现产物必须通过静态门（架构红线 + build + test）
4. 线上 / 实测缺陷回落到 `incidents/`，复盘三件套（新 intent、防复发验证、规范条目）缺一不可；**根因属「门禁缺位 / 规范未落地 / 系统性问题」时，即使结构性修复已完成也必须立新 intent** 追踪系统性改进，禁止以「修复已完成」为由绕过 intent 回路
5. 关单在 test，不依赖是否上 prod。L1 勾验 plan「验收标准」并补证据后 plan → done。L2/L3 勾验 intent「验收标准」后 intent → done，同名 plan 一并 done。修复类 incident 走 open → fixed → closed，同名 plan 一并 done。done 仍有未勾项会被 check-loop 拦（2026-09-12 起新建文档 hard-block，存量仅提示不回填）。上 prod 另走 deploy（PR 合入清单，不走 tag/24h 仪式）
6. 放弃留档：方案曾确认后不做 → `superseded`；未完成即取消 → `cancelled`。二者均为已确认终态，check-loop 不按「状态未确认」拦截；L3 放弃件豁免「确认结果必须为 approved」
7. 后续回归清单与周检清单也归档本目录
8. **检查 17（发版草稿门）已于 2026-10-21 退役删码**：本仓根 `package.json` 无 `version` 字段，版本锚条件永不成立（2026-10-06 盘点）；发版不走 tag 仪式（见「追溯」节）。该 hard 门已不存在，勿再按「恒跳过」理解

## 历史归档（只读，不增量）

- 新需求设计文档一律写进 `workflow/specs/` 或 `workflow/plans/`；关键路径提炼进 `workflow/regression-checklist.md`。
