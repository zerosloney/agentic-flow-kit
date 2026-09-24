---
状态: approved
级别: L1
模块: pipeline
---

# PLAN — 看板端口自动检测可用端口（多项目并行不冲突）

对应入口：../intents/2026-09-24-board-port-autodetect.md

## 改动面（L1 极简形态主节）
- `templates/_agents/scripts/ensure-board.ps1`：基端口解析（`-Port` 显式 > kit.json `boardPort` > 8933）+ 10 端口窗口上探循环；探活升级为 `/api/board` 身份 + `root` 比对（本项目看板才复用 / 旧代码重启，他人进程跳过）；输出实际链接
- `templates/_agents/scripts/workflow-board-server.mjs`：`server.on('error')` 对 EADDRINUSE 明确报错退出
- 文档真值维护（随行为改）：`templates/AGENTS.md`、`templates/workflow/README.md`、`templates/_agents/commands/plan.md`、`templates/_agents/commands/maintain.md` 的看板链接 / 探活描述改为「基端口 {{BOARD_PORT}} 起自动上探，实际链接以输出为准」
- `node bin/flow-kit.mjs sync` 同步装副本（.agents/ 四处 + 根 AGENTS.md）

## 验证方式
- 实测五态：空闲全新启动 / 幂等复用 / 他项目看板占用 → 上探 8934 且原进程不 kill / 非看板占用 → 跳过 / 旧代码自动重启
- 静态门：`npm test` 全绿；sync 后 doctor 台账无漂移
- 闭环：本任务自己走 verify + 关单勾验

## 确认与复核
- 确认结果：approved（2026-09-24 用户明确要求「看板端口自动检测可用端口，固定 8933 多项目会被占用」，需求即确认）；done（2026-09-24 关单，验收 6/6 勾验带证据见 intent）
- 确认门记录：改动面 = 该需求的直接展开；方案要点（端口选择收敛 ensure-board、root 比对识别本项目、不动 server 直跑参数面）随 intent 记录
- 复核留痕：五态实测全过（空闲全新启动 / 幂等复用 / 他项目看板占用上探且不 kill / 非看板占用跳过 / 旧代码重启），另测 server 直跑 EADDRINUSE 明确报错；测试进程已清理，现场他项目 8933 看板（pid 26460）保持原样运行
