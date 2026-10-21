# ARCHITECTURE — AI-Native 工作流引擎架构（单源速览）

> 本文件是引擎架构的在案单源（2026-10-09 engine-quality-round2 E 落地）。定位：新读者 10 分钟理解骨架，
> AI 会话免于「靠会话记忆手答架构」。变更随引擎演进更新；门禁判据的权威面仍在 `.githooks/` /
> `check-loop.mjs` 头部注释（本文件只做索引，不复制判据——防双源漂移）。

## 1. 一句话定位

把软件工程治理（门禁、确认、溯源）编译成「机器可执行的文件系统协议」：AI 干活，机器把门，
用户只在风险决策点出现。引擎零运行时依赖纯 JS（node ≥18）；引擎本体约 **1.55 万行**
（口径：`src/` + `templates/_agents/scripts/` 的非测试 .mjs；随演进变动，**不是判据**）。
测试套件数是盘面派生量
（`src/` + `templates/_agents/scripts/` 两面 glob 枚举），随套件增删变动——权威数见 `npm test` 的
机器可读汇总行 `[run-tests] 合计: SUITES n / FAILED m`，不在此硬编码（硬编码必漂移：2026-10-10
实测 48 而本处停在 46）。

## 2. 三层分发（引擎如何到达宿主）

```
templates/（包源，唯一改这里）
   │ flow-kit sync（三态覆盖 + kit.json managed 台账）
   ▼
.agents/（装副本 —— 装户仓才有；本仓为纯包源，不持装副本）
   │ flow-kit add-host（写入宿主文件；--force 刷新）
   ▼
装户项目根宿主点（.zcode/ 等）

包源仓内另一条：templates/_agents/{commands,roles}
   │ flow-kit sync-hosts --apply（只在包源仓；单向正文段对齐，frontmatter 保留）
   ▼
modules/hosts/{claude,codex,cursor,omp,opencode,trae,zcode}/
```

- 直改装户 `.agents/` → doctor 台账漂移告警（检查 §6.6）。装户薄适配正文漂移由 doctor §6.7 报告，刷新走 `add-host <宿主> --force`（`sync` 不更新宿主适配）。
- 包源命令/角色正文与 `modules/hosts` 由 `sync-hosts --diff` 对账（输出「对账面：」行）。

## 3. 闭环模型（任务如何流动）

**唯一真相源 `workflow/`**：`intents`（为什么）→ `specs`（怎么设计）→ `plans`（怎么做）→
`incidents`（学到了什么），同名配对即闭环。

**风险泳道**（判据机器单源 `level-criteria.mjs`）：三档 **L1/L2/L3**（L0 已退役）——L1 协作道
（**一份 plan 即入口**，不另立 intent；勾触达红线即「红线判低」hard，就高不就低）｜L2/L3 防御道
（同步确认门：spec 确认才能起草 plan，plan 确认才能动手；L3 加新会话独立复核）。

**预判键**（可选字段）：intent frontmatter「预判: kind= level=」把定级时的结构化预判如实留账，
与实际落位不符由路由预判一致性检查（编号以 check-loop.mjs 头部清单为准）出 WARN——advisory 灰度，
缺字段零告警、不做强制前置。

**归档**：终态同名家族滚动归档至 `workflow/archive/<月>/<类型>/`，关单即归档、kb 检索覆盖归档件
（防复发不丢历史；详见 §4 归档体系）。

**确认门 `confirm-doc.mjs`**：全部状态流转唯一入口。两跳闭环禁单跳；TTY / `--delegated "<原话>"`
双形态（台账记 source+quote 供对质）；内容绑定（关单即冻结，编辑触发检查 15 hard）；approved
留痕前置。

## 3.1 台账并发与授权修剪（2026-10-12）

台账 `.agents/confirmations.jsonl` 是**尾部追加**形态，天然撞三种正常协作：多人/多 worktree 并行 append、
`git merge`、分片归并。引擎把这三件事拆成各自独立的机制，判据一律按「正常协作不报红、篡改照拦」设计。

```
写入 confirm-doc.appendLedger ── 取前驱（doc 链见下）──▶ confirmations.d/<doc>.jsonl   ← 默认（分片）
                              └─ --no-shard / CONFIRM_SHARDED=0 ──▶ confirmations.jsonl（主台账，回退口径）
读   ledger-loader ─▶ readLedgerRows / readLedgerLines / readLedgerEntries（带 rel:行号）
合并 git-merge-jsonl ─▶ .gitattributes: .agents/*.jsonl merge=jsonl-union（并集去重）
收敛 compact-ledgers ─▶ 分片并回主台账（保序追加），再删分片
删除 特许修剪 ─▶ .agents/ledger-prune-manifest.json（逐行 sha256 + 授权 + 理由）
```

- **哈希链的域是「按 doc 的逻辑序」**，不是文件物理序（`policy.ledgerDocChainSince` 生效日锚，缺键则回退
  旧物理链口径，存量零变化）。同 doc 内的先后有语义，doc 之间的先后没有语义——把「文件里恰好排在前面」
  当语义，会让并发 append / 并集合并 / 分片归并这三种**正常协作**持续撞 hard 门，而门禁被自己的误拦逼出
  `--no-verify` 时，治理即失效。就地改行 / 删行 / 插行三类篡改在 doc 链下一律仍被抓住（重算失配 /
  后继 `prevHash` 失配）。
- **并集合并**：`.gitattributes` 关联 `merge=jsonl-union`，合并降级为确定性并集去重，两侧行全保留、无冲突
  可解。此前人工解冲突的常见错法是「整取一侧」——静默丢掉另一侧的确认行，门禁事后无从发现。
  **故意不给 `.jsonl` 加 `text eol=lf`**：加 text 规则会让下次提交 git 重新规范化换行 → 台账 blob 字节变化
  → append-only 前缀不变量判为「台账重写」而硬拦自己的提交。换行归一由 driver 自身负责。
- **分片写入 `--shard`**：只解决「单机多 worktree 并行 append」（git 并集要到 push 才介入，管不到 push 之前）。
  2026-10-13 起分片升为**默认写入口径**（`--no-shard` / `CONFIRM_SHARDED=0` 显式回退主台账）。分片与主台账是
  不同文件，**只有 doc 链能跨来源接续**，故缺锚时参数期直接拒。分片内的行同样受
  检查 15 链校验与行级校验——否则分片等于开一个防伪盲区。
- **三活文档月分片（ledger-shards.mjs）**：`workflow/{regression-checklist,delegations,papercuts}.md`
  三个 append-only 活台账按月分片 `workflow/<ledger>.d/<YYYY-MM>.md`——每次追加全量重写整文件的 blob 膨胀与
  合并冲突面从「全历史」缩到「当月」。读侧 = 主台账 ∪ 全部分片（月序），写侧 = 当月分片；主台账保留头部
  说明/维护规则/表头等人类阅读面。消费方读侧自动合并，无分片时等价原读法。
- **台账不变量深水区（check-ledger-invariant）**：合并感知删片（分片删除的合法性对账取分片内容**各父提交
  并集**——分片可能只在第二父侧）、终态补登追认（缺失行已原样回 append 到终树主台账，补偿行 = 新 ts +
  note 引原 ts → 视为丢失已追认）、补登语义身份比对（等价判定用 `{doc, stage, fingerprint}` 三元组，
  非逐字节）、DAG 感知与历史基线（多父提交不按线性链假设）。无凭据的删/改/重排仍全拦。
- **冲突自愈（resolve-merge-conflicts.mjs）**：并集 driver 漏配退化成文本冲突、或 INDEX.md 类派生生成物
  仍要人工解时，一键消化派生面——INDEX 冲突全量重生成；`.agents/*.jsonl` 台账冲突（主台账 + 分片同判据）
  双方内容都在则并集合并；删除/改删型不自动写入（防复活被删文件），仅提示人工裁决。
- **特许修剪**：append-only 之上唯一的合法删行出口。场景是所有者明令删除某批 workflow 文档——台账对应行
  不删则行级「doc 在当前树存在」持续报红，退路只剩手改台账（即 `--no-verify`）。判据逐行对账四条
  （`ledger-prune.mjs#matchPrune`）：manifest 存在且 `removes` 非空；每哈希恰命中一行；新内容 ==
  旧内容 − manifest 所列行（保序）；被删行 `doc` ∈ `manifest.docs`。**无 manifest 的删/改/重排仍全拦。**
  删行会让该 doc 的链断裂，故链校验同时认「本行 `prevHash` ∈ manifest 声明的被删哈希」为合法链段重启。
- **诚实边界**：manifest 是可写文件，**刻意伪造即可让任意删行合法化**——与「台账本地可写」同级信任边界
  （见 README 确认门段）。本通道不宣称防伪，只把「顺手手改」抬到「提交一份带授权与理由、可被 git 历史
  对质的凭据」。另：driver 是本机态配置不跨机共享（漏配退化为文本冲突，**不静默丢数据但要人工解**）；
  `merge=jsonl-union` 属 `.gitattributes`，而该文件是 **owned**（`sync` 永不覆盖）→ **存量装户需手动补一行**。

## 4. 门禁体系（26 项检查 + 3x + 三层布防）

```
.githooks/pre-commit（node 化门序，门脚本缺失 fail-closed；前六道按暂存面增量触发）：
   闭环配对 → 泳道完整性 → wiki 台账 → 索引漂移（暂存触 workflow 面跑 gen-workflow-index --check）→
   常驻面体积预算 → 确认台账不变量（暂存触主台账 ∪ confirmations.d/ 分片）→ 项目门禁挂载点 → 敏感扫描+条件构建
   ↓
check-loop.mjs（26 项检查 + 3x，断言数随演进变动、不在此硬编码——权威判据看该文件头部清单）——闭环完整性总裁判
   ├─ check-hygiene.mjs（2/9/11/12/13）        ├─ check-stage-index.mjs（7）
   ├─ check-metric-claims.mjs（16）             ├─ 模块化检查件：21 spec 验证落地 / 22 机制台账 / 23 收敛对账
   │                                             （advisory+hard 两档）/ 24 归因 / 25 预判一致 / 26 漏斗阈值
   └─ policy.mjs（policyVersion 生效日锚表，v1–v12；缺键 → 对应消费段整体跳过，存量零噪声）
   分道（机读单源 LANE_OF，判据零变化只归属运行面）：缺省只跑硬门（关单/pre-push 面）；
   --hygiene 只跑卫生段（WARN 面不进关单）；--all 两段都跑
   ↓
verify.mjs（七门 GATES 编排：scripts-syntax → engine-tests → workflows-check → rule-budget --all →
   effective-policy --check → check-loop → ledger-invariant；逐门 pass/fail、fail-fast、尾部输出未执行门清单；
   全绿落绿凭证 verifications.jsonl + 自动重生成 workflow/verify-evidence.md，--doc 绑单）
   ——关单与装户远端门（kit-ci.yml）跑同一条命令，本地/远端单源
   ↓
CI（.github/workflows/ci.yml，纯包源仓的**唯一**机器门——本仓无本地钩子，故每道门都在编排里点名）：
   ├─ `test`：四宫格矩阵（node 18/22 × ubuntu/windows）跑 `npm test`（eslint + 全量套件）
   ├─ `engine-integrity`：门禁本体完整性门（入库基线 + 跨提交锚，见 §8）+ 跨宿主薄适配漂移门（--strict）
   └─ `jscpd-drift`：**手动触发**的 advisory 报告器，恒 exit 0，不在 push/PR 路径上
```

- **检查索引**：编号空间 1–26 + 3x（编号承重，被引侧按 id 消费）。1 配对（hard；L1 直达 / 红线判低 /
  状态+L3 复核随 1 同遍实现）2 占位符 3 复盘三件套+回路 4 引用 5 状态+L3复核 6 角色契约 7 阶段索引
  8 验收对账（凭证/SHA/场景覆盖） 9 文件名 10 迁移一致 11 生成物漂移 12 模块词表 13 体积预算 14 确认留痕
  15 指纹+台账+哈希链（hard） 16 量化签名 17 发版收口（hard） 18 委派对账 19 逐阶段审计 20 测试覆盖；
  21–26 与 3x（incident 防复发验证证据门，hard）为 2026-10-13 B6b-2 自源仓回灌段。
  **权威清单 = check-loop.mjs 头部**——段数/断言数是派生量，不在此硬编码。
- **生效日锚**：机制上线前的存量单不被新机制追责（`verifySince`/`verifyDocSince`/`delegationSince` 等）——
  「不追溯」与「不伪造」是门禁可信度的两根柱子。
- **编辑时防护**：`edit-face-check.mjs`（工作树面 CHECK_LOOP_ROOT 全扫 + 预算 advisory）——
  常驻面约束左移到编辑期（check-loop 仓库模式只扫 HEAD，编辑期原为零反馈）。
- **判定流水落账**：check-loop 每次真实运行经 `judgment-ledger.mjs` 向 `.agents/judgments.jsonl`
  （本地 gitignore）追加一行 per-rule 计数——机制月度对账（`mechanism-registry.md`）与 advisory→hard
  升格、机制退役的数据底座；fail-open，观测面不挡裁决面。
- **归档体系**：`archive-sweep.mjs` 同名家族滚动归档（终态时间三级锚：台账终态行 ts → 内容 last-touch →
  文件名日期；`workflow/archive/<月>/<类型>/`）；关单即归档（confirm-doc 接线，判定单源 archive-sweep.analyze，
  只归档本次确认涉及的家族）；kb-search 语料面覆盖归档件——退出活跃目录、不退出检索面。

## 5. 双入口执行器

| 入口 | 形态 | 包 CLI 转发面 |
| :- | :-- | :-- |
| 手动路由 `new-task.md` | AI 读阶段索引 + 级别判据，逐阶段走命令文档 | `flow-kit route`：定级机器面（判据单源 + 路径下限 + 泳道单源）+ 该读的 md 路径 |
| 自动化 `pipeline-run.mjs` | 状态机六阶段，AI 槽位走工单协议，人件门 `PIPELINE-STOP` 停机 | `flow-kit run`：薄壳转发五子命令，参数与退出码原样透传 |

内部三层单向：CLI 编排 → `pipeline-run-run.mjs`（run 存储）→ `pipeline-run-docs.mjs`（文档纯函数）；
契约（五子命令输出/exit/四注入点）逐字节稳定。

**`route` 的接线强度与它的天花板（2026-10-13 B3 诚实记录）**：`route` 是**流程强制**（`new-task.md` §2
第 0 步必跑，跳过须写明理由）＋**提交面兜底**（`check-lane-surface` 按 `.agents/level-hints.txt` 的路径下限
要求活跃入口级别达标，命中无合格入口即拦）。但机器**无法发现它没被调用**——定级发生在改动面确定之前，
盘面没有可比对的记录面，所以不存在「跑没跑 route」这件事的一手事实（判据原则：只用一手事实）。
换句话说：**路径下限在提交面是硬约束，在定级时刻只是流程纪律**。B6b-2 回灌的**预判键**给了它一个轻量的
事后对账面：定级时把结构化预判如实写进 intent frontmatter（「预判: kind= level=」），与实际落位不符由
路由预判一致性检查出 WARN 留账——advisory 灰度、缺字段零告警，路径下限在定级时刻仍不是机器约束。

**执行代码全部留在装户**（`templates/_agents/scripts/` 随模板下发、随 `sync` 升级），包 CLI 不复制、不改写、
不解释装户正文（决策：executor-home = shell）。薄壳纪律三条：不 spawn AI 会话、不伪造用户原话、
不带 `--no-verify`；装户缺脚本时 **fail-loud 指向 `init`/`sync`**，不静默装一遍（那会改用户盘面）。

**级别判据的机器单源** `templates/_agents/scripts/level-criteria.mjs`（2026-10-13）：把此前只以散文存在于
`new-task.md` 的三档级别判据（**L1** 实现级——一份 plan 即入口；L2 四类触达面 / L3 结构面 / 判低负例 /
自查句）代码化，md 改为引用而非承载判据。分工诚实声明——机器只兜**就高不就低**（混档取高）与**路径下限**
（`.agents/level-hints.txt`，owned、默认空、内容项目私有）；「一处定义、多处消费」是语义性质，机器不裁决，
只输出判据清单与自查句；未配 hints 时按 L1 起步并提示补配置，不假装判得出。非法 hints 配置 fail-loud
（写错配置比没配置危险：没配置会提示，写错会误判）。
判低纪律最终仍由 lane-surface 触达面门在提交面兜底。

## 6. 自我度量

gate-seg 插桩（按段计时/计数）→ `agg-gate-stats`（噪声率 top/死检查）；`delegations.md`
双归因（返工×N / 门禁噪声×M）→ 月度一次通过率（门槛 ≥90%）；DASHBOARD/metrics 生成物带
`--check` 漂移门。判定流水：check-loop 真实运行自动落账 `.agents/judgments.jsonl` →
`agg-judgments`（月度×规则聚合）+ `mechanism-registry.md`（机制使用量台账：一进一出、退役阈值、
月度对账——机制该升格还是该退役从此查账不查印象）。papercut 债务回路（`papercut-debt-sensor` →
`papercut-debt-controller` → `skills/papercut-fix` 技能，口径单源 `loop/papercut-debt/DESIGN.md`，
对话内手动触发）把 `workflow/papercuts.md` 未消债驱动到 0。

## 7. 质量底座

`npm test` 按 `src/` 与 `templates/_agents/scripts/` 两面 glob 盘面枚举测试套件（新增测试文件不会被静默漏挂——套件数是派生量，不在此硬编码，权威值见编排器汇总行）；eslint 9 入 npm test 首步（裸 checkout 显式 skip）；零运行时依赖；scripts-test-exempt
登记制（登记 ≠ 免责，评估定性在案）。

## 8. 已知边界与缓做项（诚实声明）

- 台账可伪造的完整边界见 §3 与 policy.mjs 注释（本地信任边界的诚实口径）。
- 缓做（papercuts 在案）：MCP server 化、多仓 fleet 视图、门禁增量缓存（样本<5 不决策）、
  stage-gates 机器层 L2 快车道（治理语义留拍板）；verify 的 lane-surface-ci 门（第八门候补——kit 侧
  `--ci` 支持核实后评估）；跨提交锚只比硬拦单位数、不比 sha（「保计数改语义 + `--update`」两层全绿，
  补法 = 锚层也比对 sha，代价是每次合法演进付一份显式凭据，改判据面未决）。

### 8.1 不回灌清单（2026-10-13 B11 收口评估）

自 Shipyard.Material 参考仓回灌（B1–B10b）时，下列源件评估后**不回灌**（源件名 + 一句不适用理由）：

| 源件 | 不回灌理由 |
|---|---|
| `check-query-contract` / `check-schema-residue` / `check-audit-fields` / `check-delete-guard` / `check-notify-guard` / `check-local-gates` | dotnet 工具链专用守卫——kit 的 doctor + add-gate 生态承担等价职责 |
| `ci-push-before` | Azure DevOps 编排件——kit 远端门形态 = kit-ci.yml + 「同入口命令 + 服务端分支策略」等价接入 |
| `gen-narrative-claims` + `check-narrative-incremental` | 实践手册承重面、kit 无消费方——等价覆盖 = 检查 11/16 + index-incremental 门 + effective-policy 门 |
| `skills/shipyard-workflow-closeout` | 源仓品牌关单序列——kit 关单核对面由 test.md §6 关单链承担 |
| CodeBuddy 宿主适配 | kit 七宿主清单（claude/codex/cursor/omp/opencode/trae/zcode）不含该宿主，无适配基面 |
| `check-loop-sections` 目录化拆分 | kit 保持单体 check-loop.mjs + 模块化检查件形态——分道由 LANE_OF 承担，不搬目录结构 |
| `engine.json` | kit 的 `kit.json`（policyVersion 台账）已承担等价职责，双台账即双源 |
