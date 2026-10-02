# workflow — AI 驱动闭环流程（唯一真相源）

本目录是个人 AI 工作流引擎的唯一载体：**intents（为什么做）→ specs（怎么设计）→ plans（怎么做）→ incidents（学到了什么）**。单人 + AI 协作：唯一决策人与授权人是用户本人，多人评审暂缓，确认都在对话内一句话完成，追溯靠 git（commit + release tag）。

> 闭环新增记录一律写在本目录。

## 目录结构

| 目录 | 放什么 | 命名 |
|------|--------|------|
| `intents/` | 意图文档：背景、目标/非目标、验收标准、级别、触达红线 | `YYYY-MM-DD-<主题>.md` |
| `specs/` | 设计规格：功能行为、数据流、系统改动、约束遵守映射 | 与入口文档（intent / incident）同名 |
| `plans/` | 计划文档：与入口文档同名配对，任务拆解 + 判据 + 风险 | 与入口文档（intent / incident）同名 |
| `incidents/` | 事故复盘：时间线、根因、为什么没拦住、复盘三件套 | `YYYY-MM-DD-<主题>.md` |

**命名一律英文 kebab-case**（如 `2026-09-07-<主题>.md`），**禁中文文件名**——check-loop 对非 ASCII 文件名给 warning。文档内容（标题/正文）不受此限。

**文档协议（frontmatter 受限子集）**：四类文档头部一律为 YAML frontmatter（每行 `键: 值`，机器字段唯一来源）——`状态`（intent/spec/plan：draft/approved/done/superseded/cancelled；incident：open/fixed/closed，**严格枚举，单源 `.agents/workflow-enums.txt`**——check-loop / 看板 / 检索 / fill-* 一律读它，改枚举改那边；附注写 `备注:` 键）、`级别`（L0-L3，同单源）、intent 的 `risk_level`（=级别，混合治理风险泳道选道字段，fill-intent 落）、`日期`/`发现`（YYYY-MM-DD）、`模块`（**新建文档必填**，取值见 `.agents/workflow-modules.txt` 词表，单值取主导模块；存量不回填，AI 触碰时顺手补）、L3 spec 的 `确认结果`/`确认时间`、回填件 `流程: legacy`。**`状态` 迁移须经 `approved`**（确认环节的机器可见态，`done` 只在关单出现）：新建的 spec/plan 若已 done 而 git 历史中从未出现行首 `状态: approved`，check-loop 报「确认态缺失」warning。check-loop 只扫 frontmatter 取机器字段（`fm_get` 字段断言），正文不再写「状态：/级别：」行；叙述性字段（独立复核/复盘三件套/验收勾验）仍留正文按节锚定。

各子目录内 `_TEMPLATE.md` 为起步模板，复制后填写，不直接改动模板本身。

根目录 `regression-checklist.md` 为**活文档回归清单**：deploy 回归必过条目与 incident 防复发验证的统一落点，随模块上线补充、随 incident 追加。

## 使用方式

- **发起新任务**：执行 `.agents/commands/new-task.md` 定义的流程（6 阶段总入口）
- **看板（可选，默认不拉起）**：需要时手动跑 node .agents/scripts/ensure-board.mjs（跨平台单入口；幂等：探活 / 旧代码自动重启 / 全新启动弹浏览器），端口从基端口 {{BOARD_PORT}} 起自动上探首个可用，链接以脚本输出为准；**预警层，非门禁；告警口径对齐 check-loop 硬断档**。端口被占时探活 `/api/board` 并比对 `root`——本项目看板才复用 / 旧代码重启；他人进程（含其他项目看板）不动手不 kill，自动跳过试下一端口
- **检索**：活跃流程读 `INDEX.md`（生成物，`node .agents/scripts/gen-workflow-index.mjs` 重生成、`--check` 校验漂移）；跨语料检索 `node .agents/scripts/kb-search.mjs "<词>"`（workflow 按节级定位 + wiki 全文，`--type/--module/--status/-n` 过滤；`--status all` 显式全量）
- **验证**：`.agents/commands/test.md`（静态门 + 实测；项目自有验证脚本/门禁如有，见 `.agents/hooks/local-pre-commit` 与根 `AGENTS.md`「项目适配区」）
- **评审**：`.agents/commands/review.md`（按 P0 / P1 / P2 分级：机器兜底 + AI 自查出清单，用户决策定性与合入）
- **上线**：`.agents/commands/deploy.md`（上线前必跑清单）
- **量化**：委派/自做结果记 `delegations.md`，聚合跑 `node .agents/scripts/agg-delegations.cjs`（**并发扩容门槛见该文件——数字达标前不扩并发**）；语料与常驻面体积的**月度快照**跑 `node .agents/scripts/gen-workflow-metrics.mjs`（每月一行落 `metrics.md`，同月重跑即更新；明细看 stdout）
- **追溯**：git 即审计——文档随代码同 commit、上线打 `release/<日期>` tag，`git log` 全链路可查；多人评审暂缓，git 历史即评审记录
- **级别**：L0 例行 ｜ L1 实现级（页面 / 交互 / 样式等，未命中 L2/L3）｜ L2 规则 / 契约（编码权威 / 共享契约 / 既有接口语义 / 全局横切口径，触达面闭集见 `.agents/commands/new-task.md` §级别判断）｜ L3 数据与运行时结构（schema / 迁移 SQL / DI 链 / 认证与中间件管线）；混合改动就高不就低
- **风险泳道（混合治理）**：级别即风险级（L0 最低 → L3 最高），按级选道——**L0 / L1 协作道（敏捷优先）**：L0 豁免 intent 直接 commit；L1 已确认 intent + 极简 plan 即动工，独立复核不设同步前置，审计异步补（check-loop、事后 review 兜底）；**L2 / L3 防御道（严谨优先）**：同步确认门——spec 确认通过方可起草 plan、plan 确认后方可动手（闭环规则 1-2），L3 加新会话独立复核，未确认不放行。intent frontmatter 以 `risk_level`（=级别）落机器可读标记；批量代录与 AI 自治（confirm-doc `--batch` / `--auto`，trust-mode Standard｜Trusted）均限协作道 L0/L1，协作道勾触达红线会被 check-loop 判「红线判低」hard 拦截
- **探索泳道（experiment/ 前缀分支，Explore-to-Harden，2026-09-30 hybrid-governance-explore-hardening）**：experiment/ 前缀分支上的 PoC 任务在 intent frontmatter 加 `阶段: exploring` 标记——提交/推送门降级 advisory（pre-commit 闭环配对、pre-push 闭环扫描报告不阻断）；L0/L1 的 draft intent 允许 spec/plan 起草与确认先于入口确认（stage-gates 起草门泳道豁免，「先起草后确认」）。**转正（合入 main）必须过加固门**：pre-push 对目标 refs/heads/main 以 `check-loop --hardening` 运行——exploring 任务的 intent 须为 approved/done、同名 plan 在场且收口（L2/L3 另须同名 spec），未收口 hard 阻断；探索作废走显式放弃态 superseded/cancelled（出列不加固）。诚实边界：分支名不进 commit——experiment/* 分支上暂存 intent 缺「阶段: exploring」由 pre-commit「泳道完整性」门禁拦截（2026-10-01 drift-hardening），残余暴露面仅剩绕过本地钩子的提交（`--no-verify` 禁令纪律覆盖）
- **Trusted 自动泳道（2026-09-30 hybrid-governance-explore-hardening）**：trust-mode.json = Trusted（level 2）时，confirm-doc 的非 TTY 单份调用对 L0/L1 文档**免旗标**（无需 `--delegated` 原话 / `--auto`）自动按 AI 自治放行（台账 source=ai-auto-trust-L2）；L2/L3 与 incidents 仍须人工，Standard / Strict 不隐式（fail-closed）

## 执行模型

- 默认宿主主智能体负责阶段路由、用户确认、关键判断和最终验收，不注册为额外角色。
- 阶段命令仅在边界明确时委派 `.agents/roles/implementer.md`、`.agents/roles/independent-reviewer.md`、`.agents/roles/ui-verifier.md`。
- 各 agent 宿主通过其适配目录下的薄 Adapter 注册角色（`.claude/`、`.cursor/`、`.codex/`、`.opencode/`、`.trae/`、`.zcode/`、`.omp/`）。角色行为只维护在 `.agents/roles/`。Codex 自动读取的是仓库根 `AGENTS.md` 与 `.codex/skills/`；`.codex/commands` 与 `.codex/agents` 是同形薄转发，供显式引用。Cursor 自动加载 `.cursor/commands/`。Claude Code 自动加载 `.claude/commands/` 与 `.claude/agents/`。
- 宿主不支持子智能体时按命令 frontmatter 的 `fallback` 执行；L2 / L3 独立复核不得回退为原主智能体自查。
- 子智能体不得跨越用户确认门，也不得自行提交、合入或上线；所有结果由主智能体复核后交用户决策。

## 硬规则

`kit.json` 的 `audit: false`（`init` 新装的默认值）时，check-loop 只阻断下面与文档闭环直接相关的项。`audit` 字段缺省时保持全量检查，已装仓库升级不会突然丢掉卫生警告。本字段设为 `true` 时卫生检查照常打印。豁免日期的唯一表是 `.agents/scripts/policy.mjs` 的 `policyVersion`（`kit.json` 同名字段；未知版本回退到 1）。

1. **同名配对**：L1 有 plan；L2/L3 有 spec 与 plan。incident 的回路断档同样阻断。
2. **验收勾验**：新建 intent 关到 done 时，验收标准未勾则阻断。
3. **确认留痕**：approved / done / fixed / closed 须经 `confirm-doc.mjs`，指纹与台账一致。`--delegated` 原话仅限用户对话内明确确认的当次措辞——官方脚本/门禁不得自动代录或编造 quote（2026-10-01 v09-review-defects：solidify-task 曾自动伪造原话，已修复并纳入回归）。
4. **敏感信息**：pre-commit 的 commit-check 扫描密钥。
5. **双源与台账**：doctor 核对 managed / owned 的 sha；引擎改动改包源 `templates/` 再 `sync`。

其余检查（占位符、引用、模块字段、常驻面预算、量化签名、阶段索引、适配器断线、引擎脚本测试覆盖（检查 20，包源环境——新增引擎脚本默认必须带 `.test.mjs`，库件/工具须登记 `.agents/scripts-test-exempt.txt`，2026-10-01 gate-script-test-coverage））只在 `audit` 不是 `false` 时出警告。

**发版草稿**：最近一次改动 `package.json` 的 `version` 的那次提交里，当时已经是 draft 或 approved 的 intent、spec、plan，若被扫描的树上仍是 draft 或 approved，则阻断。当时已是 draft 的不看版本锚。当时已是 approved 的，只在发版版本大于 `policy.mjs` 的 `check17UnclosedAfter` 时阻断；版本 1 没有该键。不带 `--rev` 时现在的状态读工作区，带 `--rev` 时读被推送的那棵树。那次提交之后新建的文件不在范围内。状态为 open 的 incident 不在此列。

**委派台账**：L2 或 L3 的 intent、spec、plan 状态为 done，或同级别 incident 状态为 fixed 或 closed 时，若 `workflow/delegations.md` 的「委派结果」表与「自做任务结果」表中均没有日期不早于该文档日期、且含该文件名（带 / 不带 `.md` 均匹配）的一行，check-loop 打出警告。incident 的日期取 frontmatter「发现」。`audit: false` 时这条警告与其他卫生警告一起被吞掉。退出码仍由阻断项决定。

## 闭环规则

1. L1 以上新需求始于已确认的 intent；L1 以上修复始于已确认的 incident 草稿（作为 intent 等价入口）
2. L2 / L3 变更必须先有与入口文档同名的 spec 确认通过（L3 加新会话独立复核），方可起草 plan；L1 用 Quick-Plan 极简三节——改动方案 / 约束与风险 / 验证计划起步（fill-plan.mjs 单源），多文件多步骤再加任务拆解/执行顺序。**逐阶段前置已机器强制**（2026-09-30 stage-gate-machine）：fill-spec / fill-plan / confirm-doc 校验入口与 spec 前置未过即拒；顺序审计 = check-loop 检查 19
3. 实现产物必须通过静态门（构建 + 测试 + 项目门禁）
4. 线上 / 实测缺陷回落到 `incidents/`，复盘三件套（新 intent、防复发验证、规范条目）缺一不可；**根因属「门禁缺位 / 规范未落地 / 系统性问题」时，即使结构性修复已完成也必须立新 intent** 追踪系统性改进，禁止以「修复已完成」为由绕过 intent 回路
5. 关单在 test：逐条勾验入口文档「验收标准」并补证据后 intent → done（不依赖是否上 prod）。done 仍有未勾项会被 check-loop 拦（新建 intent hard-block）。上 prod 另走 deploy（tag / 回滚 / 观察）
6. 放弃留档：方案曾确认后不做 → `superseded`；未完成即取消 → `cancelled`。二者均为已确认终态，check-loop 不按「状态未确认」拦截；L3 放弃件豁免「确认结果必须为 approved」
7. 后续回归清单与周检清单也归档本目录
