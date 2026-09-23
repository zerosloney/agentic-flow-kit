# workflow — agentic-flow-kit 自身开发闭环留痕

本目录用包所承载的同一套闭环协议（intents → specs → plans → incidents）管理 agentic-flow-kit 自身的开发任务（M3 sync / M4 dogfooding / M5 发布等后续任务在此立档）。

> 移驻说明：M1+M2 首个任务（`2026-09-23-agentic-flow-kit-npx-package`）于 2026-09-23 经用户拍板自任务发起仓库 Shipyard.Material 迁入——该仓库不留此任务留痕。文档内「本仓库」如无特别说明均指发起仓库 Shipyard.Material。

> 已完成（2026-09-24）：Shipyard.Material 引擎增量已收包（intent `2026-09-24-shipyard-increment-port`，commit 97a52ca）；回流迁移已完成（Shipyard 侧 L2 三件套 `2026-09-24-flow-kit-backflow`，迁移提交 908bbfc + 关单 0b9b85d——kit.json 台账 76 份 managed、4 项目门禁经 local-pre-commit 接线、前置双备份 tag `pre-flow-kit-backflow` + 171MB 文件快照）。遗留：builds 按扩展名全局触发会因 wiki html 跑前端构建（Shipyard papercuts 在案，包侧 path 过滤增强待立）。
