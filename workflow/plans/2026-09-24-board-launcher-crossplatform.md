---
状态: approved
级别: L1
模块: pipeline
---

# PLAN — 看板拉起入口跨平台化（ensure-board.mjs 取代 ps1）

对应入口：../intents/2026-09-24-board-launcher-crossplatform.md

## 改动面（L1 极简形态主节）
- `templates/_agents/scripts/ensure-board.mjs`（新增，跨平台单入口）：net.connect 探端口占用；fetch `/api/board` 拿身份（cards/root/pid/startedAt）；陈旧判定 = 代码文件 mtime > startedAt + 2s；`process.kill` + `spawn detached` 重启/拉起；基端口解析（`--port` > kit.json `boardPort` > 8933）；弹浏览器 best-effort 三平台分流
- `templates/_agents/scripts/workflow-board-server.mjs`：`/api/board` 响应加 `pid` + `startedAt`（顶层常量记启动时刻）；头注释 ps1 指引改 mjs
- `templates/_agents/scripts/ensure-board.ps1`：删除（被 mjs 取代）
- 文档口径切换：`templates/AGENTS.md`、`templates/workflow/README.md`、`templates/_agents/commands/plan.md`、`templates/_agents/commands/maintain.md`、根 `AGENTS.md`（不受 sync 管理，手动镜像）、`src/doctor.mjs` 信息行——拉起命令统一为 `node .agents/scripts/ensure-board.mjs`
- `node bin/flow-kit.mjs sync` 同步装副本（新增 mjs / 移除 ps1 / 更新四处文档）

## 验证方式
- 实测六态（Windows 本机）：全新启动（含 /api/board 新字段）/ 幂等复用 / 他项目看板占用跳过 / 非看板占用跳过 / 旧代码重启 / sync 后 ps1 移除 + mjs 就位
- 静态门：`npm test` 全绿；doctor 8 PASS 台账无漂移
- 闭环：本任务自己走 verify + 关单勾验

## 确认与复核
- 确认结果：approved（2026-09-24 用户明确指出 ps1 仅限 Windows，跨平台化即需求本身，需求即确认）；done（2026-09-24 关单，验收 6/6 勾验带证据见 intent）
- 确认门记录：改动面 = 该需求的直接展开；「删除 ps1」为取代式替换（非清理死代码），单用户 pre-release 包无外部兼容负担，随 intent 非目标/约束留痕
- 复核留痕：实测中揪出并根因修复两个 Windows 缺陷——① `process.exit` 强退 + undici 连接池触发 libuv 断言崩溃（改 http.get 显式 Connection: close + `process.exitCode` 自然排水）；② 裸 TCP 手工 HTTP 解析不了 server 的 chunked 响应致误判非看板（改 `http.get` 正规解包）。另证：陈旧判定的 2s 容差语义正确（touch 距启动 <2s 时判定不陈旧，属预期防误判）。Linux/macOS 无法本机实测，入口仅用可移植 API（net/http/fs/path/child_process），如实留痕。
