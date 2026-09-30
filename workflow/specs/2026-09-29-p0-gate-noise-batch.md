---
状态: approved
级别: L2
日期: 2026-09-29
模块: pipeline
备注: p0-gate-noise-batch 同名配对（intent / plan）
确认指纹: 5298d124dc953049
---
# SPEC — p0-gate-noise-batch

## 功能行为

五个改动面，各自「现行为 → 目标行为」：

**C1 check18 委派台账判据对齐**（装副本 .agents/scripts/check-loop.mjs；包源 templates/_agents/scripts/）
- 现行为：`delegationResultRows` 只解析 `## 委派结果` 一节（遇第二个 `## ` 即 break），check18 匹配 `r.line.includes(base)`（base = 带 .md 全文件名）→ 自做表行永不命中 + 备注不带 .md 的委派表行不命中
- 目标行为：
  - 解析两张结果表：`## 委派结果` 与 `## 自做任务结果`（节标题识别，遇其他 `## ` 停止）；数据行仍按「首列为 YYYY-MM-DD」过滤（表头/分隔行/月度快照行（首列 YYYY-MM）自然排除）
  - 匹配放宽：`r.line.includes(base) || r.line.includes(base 去 .md)`
  - 告警文案更新为「委派结果 / 自做任务结果两表中没有该文件名」
- 边界：两表均无命中 = 真缺行，仍告警（不假阴性）；`delegations.md` 不存在时 `delegationResultRows` 返回 []（既有语义，行为不变）

**C2 check14 生效日后移**（装副本 .agents/scripts/policy.mjs；包源 templates/_agents/scripts/）
- 现行为：policy v2 `check14Since='2026-09-23'`，早于确认门（两跳状态机）实际上线日 2026-09-26
- 目标行为：v2 `check14Since='2026-09-26'`（v1 历史基线不动——已装仓库按 v1 行为不受影响）；注释同步（「版本 2 = 版本 1 的日期 + 检查 17 approved 锚 + check14Since 后移至确认门实际上线日（2026-09-23 → 2026-09-26）」）
- 残余：2026-09-28-adopter-derivers spec 的 check14 告警保留（两跳确认同批提交、git 历史无中间态 = 判据盲区而非门禁失效，台账可证两跳均走）；记 papercuts，不改「git 历史 或 台账」判据（P1 再议）

**C3 doctor §6.5 快照新鲜度 + test.md 回写步骤**
- doctor（src/doctor.mjs）：§6.5 块内在既有 agg 结构检查之后追加新鲜度判定——新增独立 export 纯函数 `checkDelegationSnapshotFreshness(target)`，返回 `{stale, ledgerMonth, snapshotMonth, skipped, note?}`：
  - 台账数据行月份 = 全部 `^\|\s*(\d{4}-\d{2})-\d{2}\s*\|` 首列之集合（两张结果表）；快照行月份 = 全部 `^\|\s*(\d{4}-\d{2})\s*\|` 首列之集合（月度聚合快照表，与数据行正则互斥）
  - `delegations.md` 不存在 / 无数据行 → `{skipped:true}`（doctor 记 PASS「跳过」，不误报 fresh 装户）
  - 有数据行、无快照行 / 快照最新月 < 台账最新月 → `{stale:true}` → doctor 记 **WARN**「月度快照陈旧（台账至 X，快照至 Y/缺失）——跑 agg-delegations.cjs 更新 §月度聚合快照」
  - 否则 PASS「delegations 月度快照最新（Y）」
  - 不新增编号小节（gate-checklist 登记表 §6.5 条目 note 更新为「delegations 台账结构 + 快照新鲜度」，节号不变）
- test.md（包源 templates/_agents/commands/test.md）：「关单」清单在「主智能体自做的 L1+ 新需求…记一行」之后追加一步：
  `**委派快照回写**：关单后若 workflow/delegations.md §月度聚合快照缺当月行或 doctor §6.5 报陈旧 → 跑 node .agents/scripts/agg-delegations.cjs 并回贴当月快照行`

**C4 pre-push 头注释对齐**（包源 templates/_githooks/pre-push）
- 现行为：L8「CI 配置为本地未入库件（.gitignore 排除），不构成跨环境保证」——本仓 ci.yml 自 4652309 已入库，措辞失实
- 目标行为（通用措辞，对包源与装户均成立）：「本地钩子是唯一本地机器门；服务端兜底（如有）= 项目自有 CI——本 kit 不附带 CI 配置，裸装无跨环境保证（本仓：.github/workflows/ci.yml 于 push main / 全部 PR 复跑 check-loop / doctor / source-sync-check --gate / workflows-check 四道门）」

**C5 台账数据补缺**（workflow/delegations.md，项目工作文件）
- 自做任务结果表补缺：对 check18 判据修正后仍告警的每个唯一主题名（intent/spec/plan 同名共一行），追加一行 `| 关单日期 | 任务一句话（取 intent 标题） | 结果 | 备注（回填 2026-09-29；结果按文档「确认与复核」节证据判定：无 P0/P1 返工=一次通过，有=返工×N） |`；关单日期取该主题 confirmations.jsonl done 行 ts 的日期（无则取文档 frontmatter 日期）
- 月度聚合快照：删旧 2026-09 行，回贴 `agg-delegations.cjs` 实时输出的可粘贴行

## 数据流

纯文档/脚本链路，无服务/表：
1. 起草：fill-* 生成三件套 draft → 用户对话逐件确认（confirm-doc --delegated）→ approved
2. 实施：改 templates/ 包源（check-loop.mjs / policy.mjs / test.md / pre-push / doctor.mjs / workflow README 两侧）→ `flow-kit sync` 刷 .agents/ + .githooks/ managed 副本 + kit.json 台账 sha → `sync-hosts --apply` 刷 .zcode/ 等薄适配
3. 验证：npm test（templates/ 侧套件）+ .agents/ 侧 shipped 套件 + doctor + check-loop 实跑 + source-sync-check --gate + workflows-check
4. 台账回填 + 快照回贴（C5）→ 复跑 check-loop 验证告警收敛 → L2 独立复核（independent-reviewer）
5. 关单：验收勾验补证据 → verify.mjs → intent/spec/plan → done（confirm-doc）→ INDEX 重生成 → 提交

## 系统改动

| 文件 | 侧 | 改动 |
|------|-----|------|
| templates/_agents/scripts/check-loop.mjs | 包源 | C1：delegationResultRows 两表解析 + 匹配放宽 + 头注释/check18 文案更新 |
| templates/_agents/scripts/check-loop.test.mjs | 包源 | C1：新增 3 场景（自做表命中 / 真缺行仍告警 / 旧误报形态消失） |
| templates/_agents/scripts/policy.mjs | 包源 | C2：v2 check14Since → 2026-09-26 + 注释 |
| src/doctor.mjs | 包体 | C3：export checkDelegationSnapshotFreshness + §6.5 接线 |
| templates/_agents/scripts/doctor.test.mjs | 包源 | C3：新增 3-4 场景（最新/陈旧/无快照行/无台账行） |
| templates/_agents/scripts/gate-checklist.mjs | 包源 | C3：PAIRS §6.5 note 文案更新（节号不变） |
| templates/_agents/commands/test.md | 包源 | C3：关单节加快照回写步骤 |
| templates/_githooks/pre-push | 包源 | C4：头注释更新 |
| templates/workflow/README.md + workflow/README.md | 包源 + 装副本（unmanaged，手动同步） | C1：委派台账判据句更新 |
| workflow/delegations.md | 装副本（项目工作文件） | C5：补缺行 + 快照行 |
| .agents/** 各 managed 副本 + kit.json | 装副本 | sync 自动刷新 sha 台账 |
| .zcode/ 等宿主薄适配（test.md 对应件） | 装副本 | sync-hosts --apply 刷新 |

## 约束遵守映射

- **AGENTS.md 引擎双源纪律**（「引擎改动一律改 templates/ 包源，随后 sync」）：C1-C4 全部先包源后 sync；workflow/README.md 属 unmanaged，两侧手动同步并在 plan 中列为显式步骤
- **跨宿主适配层同步（B-b）**：test.md 改后跑 `sync-hosts --apply`，`--diff` 0 漂移验收（G3b）
- **确认门**：三件套逐件确认（confirm-doc --delegated 逐件原话），关单前勾验补证据；不改任何 done 文档
- **文档协议**：三件套 frontmatter 5 字段 + 节结构经 fill-* 生成；英文 kebab-case 文件名
- **稳定输出契约**：check-loop banner/exit 语义不变（doctor 按 WARN 行计数、pre-push 按 exit 码判定不受影响）
- **doctor 渐进引入先例**（先 WARN 不 FAIL）：快照新鲜度首版 WARN，沿用 §6.5/§6.7/§6.8 先例
- **门禁自包含**：check-loop 不新增跨脚本 import（两表解析内联，与 agg-delegations.cjs 口径注释互引），避免门禁脚本对兄弟脚本的运行时依赖

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| check18 判据改动影响既有测试基线（111KB 套件） | 中 | 改动前 grep 现有「委派台账」场景确认范围；新增场景与既有场景同批跑绿；输出契约不变 |
| test.md 措辞波及 11 宿主薄适配 | 中 | sync-hosts --apply 单向同步 + --diff 0 漂移验收；薄适配 frontmatter 不动 |
| 补缺行结果判定失实（回填「一次通过」与史实不符） | 低 | 逐文档读「确认与复核」节 + git 历史判定；无法判定的行结果写「返工待修」并备注说明，不臆断 |
| doctor 新增项对 fresh 装户误报 | 低 | 无文件/无数据行 → skipped → PASS 跳过；fixture 场景覆盖 |
| policy v1/v2 分叉引发装户口径漂移 | 低 | v1 不动（历史基线）；v2 日期变化仅影响 policyVersion=2 装户（本仓 + 升级者），注释写明变更理由 |

## 确认与复核

- 确认日期：2026-09-30（台账 ts 2026-09-29T16:07:29Z，source=chat-delegated，原话「三件都通过」，batch d5bcc6）
- 复核：L2 独立复核已执行（independent-reviewer，独立上下文，2026-09-30）——0 P0 / 0 P1 / P2×5；spec 内部张力「两表解析口径与 agg splitTables 表头签名一致」（实现为节标题识别）按 P2 入 papercuts「两表识别机制待对齐」
