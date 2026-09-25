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

**文档协议（frontmatter 受限子集）**：四类文档头部一律为 YAML frontmatter（每行 `键: 值`，机器字段唯一来源）——`状态`（intent/spec/plan：draft/approved/done/superseded/cancelled；incident：open/fixed/closed，**严格枚举，单源 `.agents/workflow-enums.txt`**——check-loop / 看板 / 检索 / fill-* 一律读它，改枚举改那边；附注写 `备注:` 键）、`级别`（L0-L3，同单源）、`日期`/`发现`（YYYY-MM-DD）、`模块`（**新建文档必填**，取值见 `.agents/workflow-modules.txt` 词表，单值取主导模块；存量不回填，AI 触碰时顺手补）、L3 spec 的 `确认结果`/`确认时间`、回填件 `流程: legacy`。**`状态` 迁移须经 `approved`**（确认环节的机器可见态，`done` 只在关单出现）：新建的 spec/plan 若已 done 而 git 历史中从未出现行首 `状态: approved`，check-loop 报「确认态缺失」warning。check-loop 只扫 frontmatter 取机器字段（`fm_get` 字段断言），正文不再写「状态：/级别：」行；叙述性字段（独立复核/复盘三件套/验收勾验）仍留正文按节锚定。

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

## 执行模型

- 默认宿主主智能体负责阶段路由、用户确认、关键判断和最终验收，不注册为额外角色。
- 阶段命令仅在边界明确时委派 `.agents/roles/implementer.md`、`.agents/roles/independent-reviewer.md`、`.agents/roles/ui-verifier.md`。
- 各 agent 宿主（OpenCode / Trae / ZCode 等）通过其适配目录（`.opencode/agents/`、`.trae/agents/`、`.zcode/agents/` 等）下的薄 Adapter 注册角色；角色行为只维护在 `.agents/roles/`。
- 宿主不支持子智能体时按命令 frontmatter 的 `fallback` 执行；L2 / L3 独立复核不得回退为原主智能体自查。
- 子智能体不得跨越用户确认门，也不得自行提交、合入或上线；所有结果由主智能体复核后交用户决策。

## 闭环规则

1. L1 以上新需求始于已确认的 intent；L1 以上修复始于已确认的 incident 草稿（作为 intent 等价入口）
2. L2 / L3 变更必须先有与入口文档同名的 spec 确认通过（L3 加新会话独立复核），方可起草 plan；L1 用极简 plan——改动面 + 验证方式两节起步，多文件多步骤再加任务拆解/执行顺序
3. 实现产物必须通过静态门（构建 + 测试 + 项目门禁）
4. 线上 / 实测缺陷回落到 `incidents/`，复盘三件套（新 intent、防复发验证、规范条目）缺一不可；**根因属「门禁缺位 / 规范未落地 / 系统性问题」时，即使结构性修复已完成也必须立新 intent** 追踪系统性改进，禁止以「修复已完成」为由绕过 intent 回路
5. 关单在 test：逐条勾验入口文档「验收标准」并补证据后 intent → done（不依赖是否上 prod）。done 仍有未勾项会被 check-loop 拦（新建 intent hard-block）。上 prod 另走 deploy（tag / 回滚 / 观察）
6. 放弃留档：方案曾确认后不做 → `superseded`；未完成即取消 → `cancelled`。二者均为已确认终态，check-loop 不按「状态未确认」拦截；L3 放弃件豁免「确认结果必须为 approved」
7. 后续回归清单与周检清单也归档本目录
