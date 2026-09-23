# workflow — agentic-flow-kit 自身开发闭环留痕

本目录用包所承载的同一套闭环协议（intents → specs → plans → incidents）管理 agentic-flow-kit 自身的开发任务（M3 sync / M4 dogfooding / M5 发布等后续任务在此立档）。

> 移驻说明：M1+M2 首个任务（`2026-09-23-agentic-flow-kit-npx-package`）于 2026-09-23 经用户拍板自任务发起仓库 Shipyard.Material 迁入——该仓库不留此任务留痕。文档内「本仓库」如无特别说明均指发起仓库 Shipyard.Material。

> 待办（2026-09-23 用户对话内定序）：Shipyard.Material 的引擎增量**先收进包源**（templates/，走双源纪律→sync），**再整体回流**（其改为包消费者）。现 blocked——该仓库并行业务会话仍在改动引擎路径（已见：`56a1eed` 确认口径、`17ae8e6` check-loop advisory 裁定两笔引擎相关提交，另有未提交的 `.agents/scripts/check-loop.sh` 工作区改动）；其收口后另立 intent 推进。
