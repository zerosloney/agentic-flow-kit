---
状态: approved
级别: L2
日期: 2026-09-27
模块: pipeline
备注: 同名 intent：../intents/2026-09-27-audit-gate-hardening.md（外部审查复核 6 项门禁加固批）
确认指纹: f153bee086983a6d
---
# SPEC — audit-gate-hardening

## 功能行为

### P1 确认门 done 内容绑定（check-loop #15 扩展）

现状：#15 对 approved/done 文档只验「frontmatter `确认指纹:` 16 位 ↔ 台账行 64 位前缀」配对（doc/stage/fingerprint 三键），不重算内容。新增第二段判定——**仅对 `状态: done` 的文档**：

- 从台账取该 doc 的 **stage=done 行（多行取末次）**，要求含 `prev` 字段；
- 用当前文件内容**复原跳转前文本**：CRLF 归一 → 首个 frontmatter `状态:` 行值替换为台账 `prev` 值 → 剔除 `确认指纹:` 行（与 confirm-doc.mjs `computeFingerprint` 同口径）；
- sha256 后与台账 64 位指纹**全量比对**，不等 → hard-block（`[确认内容漂移]`），消息提示「done 文档内容与确认台账不符——若确需修订，走 superseded 或新 intent 引用，不直接改已关单文档」。

边界与异常：
- 复原规则仅在 frontmatter 区（首 `---` 至闭合 `---`）替换首个 `状态:` 行——防正文误命中（与 confirm-doc 取状态键同口径）；
- 台账 done 行缺 `prev`（schema 演进前的行）→ 该文档降级为仅配对判定，记 warning 不 hard-block（fail-open 仅限无 prev 可复原的存量行）；
- approved 状态文档**不**做内容绑定（关单前允许编辑是既有工作流——勾验补证据即发生在 approved 期）；生效日与 #15 相同（2026-09-27），存量豁免口径不变。

### P1 文案改口（三处命令 + 边界声明）

`templates/_agents/commands/{plan,design,test}.md` 中「AI 不得直接改状态代确认，check-loop 15 对账拦截」改为如实三段：「缺记录/指纹不配对 → hard-block 拦截；伪造台账本地不可机器防——留痕供事后对质（quote/source）；done 后改动正文 → 内容绑定 hard-block」。

### P2 source-sync-check 接入 pre-commit

`templates/_githooks/pre-commit` 在「常驻面体积预算」之后新增「双源一致性（增量）」门禁：

- 触发条件：本次暂存触及 `templates/_agents/**` 或 `.agents/**` 任一侧（`.agents/cache/` 由 source-sync-check 自身排除）；
- 动作：跑 `node .agents/scripts/source-sync-check.mjs --diff`，非零即阻断；阻断文案提示「双源单边提交——包源与装副本须同提交成对（双源纪律），跑 node bin/flow-kit.mjs sync 后重试」；
- exit 语义先核实：若 orphan（装副本独有）不计入失败（只报告），门禁文案注明只拦缺失/漂移两类；`confirmations.jsonl` 等装户侧运行态是否落 orphan 白名单按核实结论处理（在 RENDER_OUTPUT_FILES 或排除清单补齐，双处同步：source-sync-check.mjs + 其测试）。

### P3 引用有效性收窄活跃态（check-loop #4 扩展）

#4 扫描的 `workflow/{intents,specs,plans,incidents}` 文档增加状态过滤：仅扫**活跃态**（doc: draft/approved；incident: open——枚举单源 `doc.status.active` + `incident.status.active`）。终态文档的引用是历史叙述（提及已改名/已废文件），不再产生 advisory。AGENTS.md、workflow 根级 *.md、`.agents/commands/*.md` 扫描面不变（活文档）。

### P4 配对门禁补 spec（check-pairing-incremental.sh）

循环内补读 frontmatter `级别:`（与既有 `流程: legacy` 豁免同读法）：级别为 L2/L3 的暂存 intents 入口，要求 `workflow/specs/<同名>.md` 存在于工作区（口径与 check-loop #1 一致：同 commit 携带 spec 合法）；缺失即阻断，提示语与 pre-push 同口径。

### P5/P6 声明

- `templates/_agents/workflows/_TEMPLATE.md` 纪律节补一句：「run journal 由执行者（宿主 AI）自记——是自报状态而非验证态；续跑/重试保证取决于记账纪律，中止续跑时对已 pass 结论保留人工核对权」。
- `workflow/README.md`（owned，手改即权威）补「审计边界」小节：#14 恒 advisory 的历史豁免（2026-09-23~26 六份 draft 直跳 done 不可追认）、台账 schema 演进（首批行缺 source 字段，配对判据与 source 无关）、生效日判定以文档自报日期为准的边界声明。

## 数据流

- P1：check-loop 运行时读 `.agents/confirmations.jsonl`（逐行 JSON.parse，坏行容忍）→ 取 doc+stage=done 末次行 → 读文档当前内容复原跳转前文本 → sha256 比对。纯只读，无写入。
- P2：git pre-commit（暂存区 name-only）→ 触发判定 → spawn source-sync-check（读 templates/_agents/ 与 .agents/ 双侧文件树 + sha）→ exit 码裁决。无状态。
- P3/P4：check-loop / check-pairing-incremental 既有读路径上收窄/增补，无新数据源。
- 全部改动经 templates/ → `flow-kit sync`（刷装副本 + kit.json 台账 sha）→ `flow-kit sync-hosts --apply`（commands 正文同步至 opencode/trae 薄适配）下发。

## 系统改动

| 件 | 改动 | 对应 plan 任务 |
|---|---|---|
| `templates/_agents/scripts/check-loop.mjs` | #15 增内容绑定段；#4 增活跃态过滤（头注释检查项清单同步补口径，不改编号） | T1 / T3 |
| `templates/_agents/scripts/check-loop.test.mjs` | 新增场景：内容绑定（篡改拦/复原过/无 prev 降级）×3、引用收窄（终态不报/活跃报）×2 | T1 / T3 |
| `templates/_agents/commands/{plan,design,test}.md` | 确认门文案三段式改口 | T1 |
| `templates/_githooks/pre-commit` | 新增「双源一致性（增量）」门禁段 | T2 |
| `templates/_agents/scripts/source-sync-check.mjs`（如需） | orphan/运行态白名单按核实结论补齐（+ 对应测试） | T2 |
| `templates/_agents/hooks/check-pairing-incremental.sh` | 补 L2/L3→spec 配对档 | T4 |
| `templates/_agents/workflows/_TEMPLATE.md` | journal 自报语义边界一句 | T5 |
| `workflow/README.md` | 「审计边界」小节（owned 手改） | T5 |
| 装副本 `.agents/**`、`.githooks/**`、`modules/hosts/**` 薄适配 | 经 sync / sync-hosts --apply 下发，无手改 | T6 |

## 约束遵守映射

- **双源纪律（根 AGENTS.md 项目适配区）**：引擎改动一律改 `templates/`，随后 sync 刷装副本——本 spec 全部引擎件遵守（见系统改动表）；改后跑 `source-sync-check --diff` 须 0 差异。
- **跨宿主适配层同步（B-b）**：改权威源 commands 正文后跑 `sync-hosts --apply`，frontmatter 不动——T1/T6 遵守。
- **检查项编号不增删改号**：#15 只在既有编号下扩判定段，头注释清单文字同步；gate-checklist 登记表 PAIRS 不需改（id 不变）。
- **常驻面预算**：plan/design/test 改口为替换不增量，`.agents/commands/` 预算内；_TEMPLATE.md 不在预算表。
- **`--no-verify` 禁令**：新增门禁被拦时按提示修完原路重试，文案中明示。
- **提交约定**：L1+ 入口文档/spec/plan 随代码同一提交；确认后立即 `docs(workflow)` 单独提交留痕。

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| 内容绑定误伤合法的 done 后修订（如 INDEX 再生成误触文档——不会，生成器只写 INDEX.md；但人工小改错字会触发） | 中 | 阻断消息给出明确出路（superseded / 新 intent）；生效日起仅新关单文档受约束，存量按验收标准 2 逐份验证；如个别存量不绑定，拍板豁免并声明，不静默 |
| P2 拦截正常中间态提交（先提包源、再提装副本的两段式工作习惯） | 中 | 双源纪律本就要求同提交成对（papercut 2026-09-26 原文）；门禁文案直接给出修复命令（flow-kit sync）；`.agents/cache/` 等运行态已排除 |
| P3 收窄后真断链漏报（活跃时引用错路径，关单后文件被删） | 低 | 活跃期即可见；终态文档引用本就是历史叙述；如需回查用 kb-search 全文检索 |
| sh 门禁在无 sh 环境退化为跳过（check-pairing 增档后复杂度微增） | 低 | 沿既有 pre-commit run_gate 模式（sh 优先 bash 兜底），Windows git 自带 bash 实测可用 |
| 回滚难度 | 低 | 全部为独立小改动，git revert 单提交即回；无数据迁移 |

## 确认与复核

- 确认日期：2026-09-27
- 复核：L2 推荐独立复核（independent-reviewer 读 intent+spec+diff；复核意见采纳/驳回由用户定性）
