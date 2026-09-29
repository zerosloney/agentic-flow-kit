---
状态: approved
级别: L1
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 plan。同名 intent 已于 90d2853 approved。
确认指纹: b78e84505057f3e4
---
# PLAN — 看板按完整文件名配对

对应入口：../intents/2026-09-29-board-fullname-pair.md

## 改动面

- `templates/_agents/scripts/workflow-board-server.mjs`：`detectAlerts` 按卡片 `name`（完整文件名、不含 `.md`）聚合成一家；状态合法性改查 `doc.status.all` 与 `incident.status.all`；状态为 draft 时追加「尚未确认」。draft 的 L3 spec 不报确认三件缺失，离开 draft 且未放弃时仍查确认结果、确认时间和独立复核。导出 `detectAlerts` 供测试直接调用。
- `templates/_agents/board/index.html`：卡片仍按 slug 分组；展开后的每一行和抽屉里的相关文档带上该文件自己的日期。
- `templates/_agents/scripts/workflow-board-server.test.mjs`：补完整文件名配对、draft 文案、approved 不回退、done 入口配 draft plan 报未终态、未知状态仍报非法枚举。

## 验证方式

- 静态门：`node templates/_agents/scripts/workflow-board-server.test.mjs`，sync 后再跑装副本同名套件。
- 本项无浏览器工具时，用上述纯函数断言覆盖告警；页面日期是模板字符串，不另开服务做点击验证。

## 确认与复核

- 确认结果：approved（2026-09-29 用户对话原话「可以」，仅本份）
