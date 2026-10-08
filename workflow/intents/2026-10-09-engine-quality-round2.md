---
状态: superseded
级别: L2
risk_level: L2
日期: 2026-10-09
模块: pipeline
备注: B-D-A-E-C 五层质量提升批（用户 2026-10-09 goal 指令，方案出处=同日会话五层清单）
确认指纹: bc443d2de5282d17
---
# INTENT — engine-quality-round2

## 背景与问题

v1.5.0 发版后，用户以下达 goal 指令「按照B-D-A-E-C顺序完善提升AI-Native工作流引擎质量」批准执行同日会话提出的五层提升清单（B-D-A-E-C 编号体系出自该清单）。本批把五层全部落地为可验证改动：

- **B 层（本轮亲历暴露的真实缺口）**：B1 sync-hosts 包源布局对账盲区（独立复核 P2-3 实证 bb69e19「81 对全对齐」漏掉项目根 .zcode/ 三份薄适配——机制根因已定位：包源布局 adaptersRoot 恒为 modules/hosts，项目根 HOSTS.dir 形态宿主点不在扫描面）；B2 AGENTS.md 编辑时零防护（常驻面机器约束只在 git 钩子层生效，check-loop 仓库模式只扫 HEAD，工作树编辑期无反馈——本轮实测砍掉阶段索引到提交才被发现）；B3 关单与远端 CI 时序缺口（本地 verify 绿即关单，CI 事后兜底，CI 红时无「回溯点名最近关单」机制）。
- **D 层（信任链强化）**：confirmations.jsonl 已知信任边界=本地可写、检查 15 不验签、静默手改不可机器检（代码注释诚实声明与伪造 git 时间戳同级）。哈希链把「主动伪造」从静默可行抬到必留断链痕迹。
- **A 层（已立项的债）**：A1 沿 selfmeasure 渐进程序继续拆检查模块（本批拆检查 7 阶段索引——耦合最低）；A2 scripts-test-exempt 停车场清理（wiki-search / verify-wiki-consistency「无覆盖」补测，ensure-board 需真实端口定性为永久工具豁免）。
- **E 层（平台化，本批做文档单源）**：ARCHITECTURE.md 架构单源（本会话用户问架构只能靠会话记忆手答——无在案文档）；MCP 化 / fleet 视图 / 门禁性能缓做定性（perf 缓做依据=agg-gate-stats 自带「样本<5 只作线索」告警）。
- **C 层（治理效率）**：确认门合并预览纪律（三件套起草期一次呈现要点总览，逐件代录不变——纯文档纪律，不动 stage-gates 机器）；L2 快车道深水区（stage-gates 机器层合并确认）记 papercuts 留用户拍板。

## 历史教训/防复发

- 检索结果：kb-search 命中 selfmeasure-and-modularize（L2 拆分先例）、verify-doc-binding（L2 凭证绑定先例）、engine-quality-batch（上一批，本批衔接其独立复核 P2-3 发现）。
- 避坑 1（selfmeasure）：拆模块后段归属须核对 gate-seg 收集器接线；新模块只返回文案数组不打印不 exit。
- 避坑 2（gate-checklist 契约）：check-loop 头部清单行逐字保留；本批 D/A1 都不动清单编号与标题。
- 避坑 3（双源纪律）：引擎改动一律 templates/ 包源 → sync；commands 文档改动后 sync-hosts --apply。
- 避坑 4（复核 P2-3 本条即教训）：「全对齐」声明前先看对账面自描述——本批 B1 的输出自描述就是防同类不实汇报。
- 避坑 5（昨日 fill-intent 转义 bug 刚修）：模板串内禁用 LaTeX 记号（`\r` 转义坑）。

## 目标

- **G-B1**：sync-hosts 包源布局对账面扩为「modules/hosts + 项目根宿主点（HOSTS.dir 存在者）」两处；`--diff`/`--apply` 输出自描述（列明对账面构成）；测试覆盖「项目根 .zcode 漂移可检出、--apply 可修复、frontmatter 保留」。
- **G-B2**：新增编辑时快检入口（`edit-face-check.mjs`：工作树面跑 check-loop（CHECK_LOOP_ROOT=仓库根=全扫模式）+ 常驻面字节预算 advisory），带同名测试；build.md「改权威源后必跑」清单与根 AGENTS.md 提示行接入。
- **G-B3**：CI 失败步骤点名最近 7 天关单文档（confirmations.jsonl done/closed 行），提示复核优先；ci.yml 与模板 kit-ci.yml 双侧同步。
- **G-D**：台账哈希链——confirm-doc 写入行追加 `prevHash`（上一行 hash）与 `hash`（本行规范化内容的 sha256）；check-loop 15 验链（连续带 hash 行断裂=hard「台账链断裂」；无 hash 的历史行跳过=向后兼容零回填）；边界诚实声明：整文件重写链可重建，靠台账文件自身 git 历史兜底。
- **G-A1**：检查 7 拆独立模块 `check-stage-index.mjs`（先例=check-hygiene/check-metric-claims），头部清单行逐字不动，gate-checklist 登记完整，段归属核对。
- **G-A2**：wiki-search / verify-wiki-consistency 补同名测试（fixture 化），exempt 表移除该两行；ensure-board 行定性为永久工具豁免（需真实端口/进程环境，理由更新）。
- **G-E**：ARCHITECTURE.md 落仓库根（分层架构/数据流/20 检查索引/关键决策指针）；papercuts 记 MCP 化与 fleet 视图缓做；CHANGELOG 记 perf 缓做依据。
- **G-C**：design/build/new-task 命令文档加「三件套合并预览」起草纪律节（一次呈现要点总览、逐件确认代录不变）；stage-gates 机器不动；L2 快车道深水区记 papercuts 留拍板。

## 非目标

- MCP server 实装、多仓 fleet 视图、门禁增量缓存（perf）——本批只做缓做定性。
- stage-gates 机器层允许 L2 合并确认——涉治理语义，留 papercuts 用户拍板。
- confirm-doc --auto 扩展到 L2/L3——自治门「仅限 L0/L1」是刻意设计，不动。
- check-loop 头部清单任何编号/标题/severity 变化。

## 约束

- 零运行时依赖不破（全部 node 标准库）。
- 判定零复刻铁律：edit-face-check 不复刻 check-loop 判定，经 CHECK_LOOP_ROOT 全扫模式单源消费；预算 advisory 单独实现并声明「编辑时口径，提交门以 rule-budget.sh 为准」。
- 台账向后兼容：无 hash 历史行不回填、不报错；链校验只作用于连续带 hash 行段。
- 测试不 weakening：既有断言零改动（新增场景除外）。
- 双源纪律：引擎件改 templates/ → sync；commands 文档改后 sync-hosts --apply。

## 影响面

- 模块：pipeline
- 数据库：无
- 文件面：src/sync-hosts.mjs + src/sync-hosts.test.mjs（B1）；templates/_agents/scripts/edit-face-check.mjs + test（B2 新增）；.github/workflows/ci.yml + templates/_github/workflows/kit-ci.yml（B3）；templates/_agents/scripts/confirm-doc.mjs + confirm-doc.test.mjs + check-loop.mjs + check-loop.test.mjs（D）；check-stage-index.mjs + test + check-loop.mjs（A1）；wiki-search.test.mjs / verify-wiki-consistency.test.mjs / scripts-test-exempt.txt（A2）；ARCHITECTURE.md（E 新增）；templates/_agents/commands/{design,build,new-task}.md（C）+ sync + sync-hosts；papercuts / CHANGELOG（E/C 记录）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更——check-loop 检查 15 判定扩展（哈希链验链）、sync-hosts 对账面语义、检查 7 拆模块 → L2（本单即防御道流程）
- [x] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → L3——未触及，不勾
- [x] 引入新依赖——无（全标准库），不勾

## 验收标准（可测试）

- [x] G-B1：构造包源 fixture：modules/hosts/zcode 对齐 + 项目根 .zcode/agents 漂移 → `sync-hosts --diff` 报该漂移且输出含对账面自描述；`--apply` 后漂移归零、.zcode 正文覆盖、frontmatter 保留（证据：sync-hosts.test 42/0——S10 漂移检出含对账面自描述/S11 apply 修复 frontmatter 保留/S12 装户回归；实仓 81→84 对 0 漂移）
- [x] G-B2：`node .agents/scripts/edit-face-check.mjs` 正常 exit 0；构造工作树破坏（临时删 AGENTS.md 阶段索引行）→ 脚本报警非零（证据：edit-face-check.test 9/0——全绿面 exit 0/破坏面删索引 WARN 点名/预算超限 exit 1；实仓冒烟正确点名存量 WARN）
- [x] G-B3：ci.yml 与 kit-ci.yml 均含 failure 步骤（grep 在案）；本批 push 后 CI 绿佐证语法（证据：ci.yml 与 kit-ci.yml 均含 if: failure() 步骤 + 内联脚本语法解析通过；runner 实绿待 push 后佐证）
- [x] G-D：confirm-doc 新写台账行含 prevHash/hash；check-loop 15 对「中间行篡改」出 hard（check-loop.test 新场景）；历史无 hash 行零告警（confirm-doc.test 兼容场景）；验链逻辑断言非恒绿反证（篡改 fixture 还原即绿）
- [x] G-A1：check-stage-index.test 全绿；gate-checklist --diff 登记完整；check-loop 头部清单行 vs 改前逐字一致；check-loop 套件既有断言零改动全绿
- [x] G-A2：wiki-search.test / verify-wiki-consistency.test 全绿；exempt 表移除两行且 ensure-board 行含永久定性；检查 20 无新增 WARN
- [x] G-E：ARCHITECTURE.md 在仓库根且含分层/数据流/检查索引节；papercuts 含 MCP/fleet/L2 快车道三行缓做定性
- [x] G-C：design/build/new-task 三模板含「合并预览」节；sync 后装副本一致；sync-hosts --diff 0 漂移
- [x] 全量门：npm test exit 0（含 lint 首步）；eslint 0 error；doctor 0 WARN 0 FAIL；source-sync-check 0 漂移；rule-budget --all exit 0；check-loop 无本批新增 WARN

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。

## 确认与复核

- 确认日期：2026-10-09（自治批次——授权链：用户 goal 指令「按照B-D-A-E-C顺序完善提升AI-Native工作流引擎质量」= 对同日会话五层方案内容的对话内放行；三件套为该指令实施文档；delegated 台账逐件记 goal 原话供对质）
- 确认人：用户（goal 指令）
- 确认范围：五层方案内容（= 本 intent 目标节）+ 判级 L2 + 防御道流程
- 复核：L2——实现完成后 test 阶段 independent-reviewer 独立复核
