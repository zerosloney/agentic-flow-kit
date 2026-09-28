# workflow — agentic-flow-kit 自身开发闭环留痕

本目录用包所承载的同一套闭环协议（intents → specs → plans → incidents）管理 agentic-flow-kit 自身的开发任务（M3 sync / M4 dogfooding / M5 发布等后续任务在此立档）。

> 移驻说明：M1+M2 首个任务（`2026-09-23-agentic-flow-kit-npx-package`）于 2026-09-23 经用户拍板自任务发起仓库 Shipyard.Material 迁入——该仓库不留此任务留痕。文档内「本仓库」如无特别说明均指发起仓库 Shipyard.Material。

> 已完成（2026-09-24）：Shipyard.Material 引擎增量已收包（intent `2026-09-24-shipyard-increment-port`，commit 97a52ca）；回流迁移已完成（Shipyard 侧 L2 三件套 `2026-09-24-flow-kit-backflow`，迁移提交 908bbfc + 关单 0b9b85d——kit.json 台账 76 份 managed、4 项目门禁经 local-pre-commit 接线、前置双备份 tag `pre-flow-kit-backflow` + 171MB 文件快照）。遗留：builds 按扩展名全局触发会因 wiki html 跑前端构建（Shipyard papercuts 在案，包侧 path 过滤增强待立）。

## 审计边界（2026-09-27 audit-gate-hardening 声明）

- **确认台账起算**：`.agents/confirmations.jsonl` 自 2026-09-27 入账；此前 2026-09-23~26 的 6 份文档经「draft 直跳 done」关单（check-loop 检查 14 恒 advisory，不追认、不回填）——该段历史不可机器审计，为已接受事实。
- **台账 schema 演进**：首批 2 行（sync-hosts-adapter-backlog 的 approved 行）无 `source` 字段，当日才引入；check-loop 配对判据（doc/stage/fingerprint）与 source 无关，仅阅读时需知。
- **生效日判定与确认门准入（2026-09-28 收窄）**：检查 15 的**受管准入**改为两条件取或——① 台账（`.agents/confirmations.jsonl`）中该 doc 有合法跳转行；② 文档自报日期 ≥ 生效日（docs 2026-09-27 / incidents 2026-09-28）。① 独立于自报日期成立，故「确认过却把日期写早以逃掉对账」这条路径已被堵死（此前仅靠 ②，写早即整段跳过判定——incident `2026-09-28-confirm-gate-effective-date-anchor` 实证）；② 保留以兜住「新档完全没跑 confirm-doc」的漏网面。两条件皆不满足 = 存量豁免（生效日前既有、从未走确认门，不追溯）。
  **仍未收窄的面**：检查 8（验收对账，按文件名）、12（模块字段，frontmatter 日期）、14（确认态留痕，frontmatter 日期，恒 advisory）三处仍以自报日期 / 文件名为生效日锚——把文档日期写成生效日之前可绕过当日判定，属本地信任边界内（与「伪造台账本地不可机器防」同一边界），事后对质靠台账与 git 历史。这三处已在上述 incident 中登记为后续可立项面。
- **台账 schema 演进：新增调用事实字段（2026-09-28 batch-ledger-audit）**：`confirmations.jsonl` 每行新增 `batch` / `seq` / `of` —— 记「本次 `confirm-doc` 调用落了几份态」这一**写入时确定已知的事实**（`batch` = 本次调用生成的短随机串，无时间语义；`seq` = 该次调用内件序，从 1；`of` = 本次调用总份数）。检查 15 的**并录审计**据此直读判定（同 batch 且 `of > 1` 的 delegated 行 → warning「确认并录」），**不再**用旧判据「同 quote + 相邻 ts 差 < 2s」——后者是拿两个间接信号反推调用次数，已实证假阳性（合规逐件调用复用同句必然误报）与假阴性（并录时换不同 quote 即零告警，等于引导伪装），已整段退役。
  **历史行（本仓全部 67 行均无 `batch` 字段）→ 静默跳过**（无判定依据的行不产出不可消除的噪声，沿 audit-gate-hardening P3 教训）；台账为 append-only、check-loop 对坏行容忍跳过、配对判据与新增字段无关，故**纯增字段向后兼容、不回填、不改写**。`quote` 字段归还单一职责：只记用户原话供事后对质。详见 incidents/2026-09-28-batch-ledger-audit.md。
- **done 内容绑定自 2026-09-28 起**（生效锚 = 台账 done 行确认时刻 `ts`，UTC——2026-09-27 gate-hardening-p2-batch 自文档自报日期改锚，旧日期文档晚关单也纳入绑定）：绑定要求 confirm-doc done 是关单最后一次写入；2026-09-27 当天按旧顺序（done 落态后再回填确认结果行）完成关单的 3 份文档（sync-hosts-adapter-backlog 的 plan、confirm-gate-delegated 的 intent+plan）内容与台账指纹不符——不回改、不逐份豁免，以生效锚切换吸收（3 份 ts 均为 2026-09-27，天然豁免）；自生效锚起遵守新约定：关单编辑（勾验/回填确认结果）先于 done 确认。
