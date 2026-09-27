# workflow — agentic-flow-kit 自身开发闭环留痕

本目录用包所承载的同一套闭环协议（intents → specs → plans → incidents）管理 agentic-flow-kit 自身的开发任务（M3 sync / M4 dogfooding / M5 发布等后续任务在此立档）。

> 移驻说明：M1+M2 首个任务（`2026-09-23-agentic-flow-kit-npx-package`）于 2026-09-23 经用户拍板自任务发起仓库 Shipyard.Material 迁入——该仓库不留此任务留痕。文档内「本仓库」如无特别说明均指发起仓库 Shipyard.Material。

> 已完成（2026-09-24）：Shipyard.Material 引擎增量已收包（intent `2026-09-24-shipyard-increment-port`，commit 97a52ca）；回流迁移已完成（Shipyard 侧 L2 三件套 `2026-09-24-flow-kit-backflow`，迁移提交 908bbfc + 关单 0b9b85d——kit.json 台账 76 份 managed、4 项目门禁经 local-pre-commit 接线、前置双备份 tag `pre-flow-kit-backflow` + 171MB 文件快照）。遗留：builds 按扩展名全局触发会因 wiki html 跑前端构建（Shipyard papercuts 在案，包侧 path 过滤增强待立）。

## 审计边界（2026-09-27 audit-gate-hardening 声明）

- **确认台账起算**：`.agents/confirmations.jsonl` 自 2026-09-27 入账；此前 2026-09-23~26 的 6 份文档经「draft 直跳 done」关单（check-loop 检查 14 恒 advisory，不追认、不回填）——该段历史不可机器审计，为已接受事实。
- **台账 schema 演进**：首批 2 行（sync-hosts-adapter-backlog 的 approved 行）无 `source` 字段，当日才引入；check-loop 配对判据（doc/stage/fingerprint）与 source 无关，仅阅读时需知。
- **生效日判定信任自报日期**：各门禁生效日以文件名前缀 / frontmatter `日期:` 为准——把文档日期写成生效日之前可整体绕过当日门禁，属本地信任边界内（与「伪造台账本地不可机器防」同一边界），事后对质靠台账与 git 历史。
- **done 内容绑定自 2026-09-28 起**（生效锚 = 台账 done 行确认时刻 `ts`，UTC——2026-09-27 gate-hardening-p2-batch 自文档自报日期改锚，旧日期文档晚关单也纳入绑定）：绑定要求 confirm-doc done 是关单最后一次写入；2026-09-27 当天按旧顺序（done 落态后再回填确认结果行）完成关单的 3 份文档（sync-hosts-adapter-backlog 的 plan、confirm-gate-delegated 的 intent+plan）内容与台账指纹不符——不回改、不逐份豁免，以生效锚切换吸收（3 份 ts 均为 2026-09-27，天然豁免）；自生效锚起遵守新约定：关单编辑（勾验/回填确认结果）先于 done 确认。
