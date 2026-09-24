---
状态: done
级别: L1
日期: 2026-09-24
模块: pipeline
备注: 需求来源：2026-09-24 用户反馈「workflow 看板端口固定 8933，多个项目并行时端口会被占用」，要求自动检测可用端口。定性：ensure-board 拉起脚本的端口选择策略改造 + server 绑定失败明确报错，不改 CLI 参数面、不改安装产物结构、无数据面，L1。
---

# INTENT — 看板端口自动检测可用端口（多项目并行不冲突）

## 背景与问题
看板端口固定 8933（`ensure-board.ps1` 默认 `-Port` + server 默认 `--port`），多个项目各自拉起看板时后来者撞端口。更糟的是旧探活逻辑只认「是看板」不认「是不是本项目的」：他项目的看板占着 8933 会被误判为已运行（打开看到的是别的项目的数据），代码比它新时还会把他项目进程 kill 掉抢端口。kit 台账 `options.boardPort` 已存在（init 询问、sync 渲染进命令文档），但 `ensure-board.ps1` 并不读它。

## 目标
- `ensure-board.ps1` 以基端口（`-Port` 显式指定 > kit.json `boardPort` > 8933）向上探测首个可用端口（窗口 10），实际链接以脚本输出为准
- 端口被占时探活 `/api/board` 并比对返回的 `root` 与本项目根：本项目看板才复用 / 旧代码重启；他人进程（其他项目看板、非看板服务）不动手不 kill，跳过试下一端口
- server 对 EADDRINUSE 输出明确错误后退出（替换裸堆栈），直跑 `node workflow-board-server.mjs` 的失败可读

## 非目标
- 不做端口持久化 / 注册表（不记「上次用过的端口」，每次现探）
- 不改 server 直跑入口的默认端口与参数面；不做 server 端自动改绑（端口选择收敛在 ensure-board 一处）
- 不动 init / sync 的 `--board-port` 语义（仍是基端口默认值）

## 约束
- 保持零依赖（PowerShell 内置 cmdlet + node 内置模块）
- 复用既有幂等骨架（探活 / 旧代码重启 / 全新启动才弹浏览器），只重排端口选择段

## 影响面
- 模块：pipeline
- 数据库：无

## 验收标准（可测试）
- [x] 端口空闲 → 全新启动成功，输出实际链接；`/api/board` 可访问且 `root` 为本项目根（证据：实测 `fresh start -> http://127.0.0.1:8934`——基端口 8933 被现场真实他项目看板占用跳过后首个空闲口；`GET :8934/api/board` 返回 `root=E:\Demo\cli-tools\agentic-flow-kit`、37 cards）
- [x] 幂等复用：再次运行输出 already up-to-date，不重复起进程（证据：二跑输出 `board: already up-to-date at http://127.0.0.1:8934 (pid 49580)`，root 比对命中本项目）
- [x] 端口被他项目看板占用：跳过、上探下一端口全新启动本项目看板；他项目进程未被 kill，两看板并行各回各的 root（证据：现场 8933 即 `E:\Git\Shipyard.Material` 看板 pid 26460——脚本输出「基端口段他人进程已跳过：端口 8933（pid 26460 node）」→ 8934 起本项目看板；事后 `Get-Process 26460` alive=True）
- [x] 端口被非看板进程占用：不动手，跳过试下一端口（证据：dummy http server 占 9000 → `ensure-board -Port 9000` 输出跳过 pid 68048 → `fresh start -> http://127.0.0.1:9001`）
- [x] 本项目看板代码更新：同端口自动重启（证据：touch `.agents/board/index.html` 后重跑输出 `restarted (stale code detected) -> http://127.0.0.1:8934`，重启后 `/api/board` root 仍本项目）
- [x] `npm test` 全绿；sync 后装副本与模板一致（证据：npm test 合计 PASS 34 / FAIL 0；sync「覆盖更新 4」后 doctor 8 PASS / 0 WARN / 0 FAIL——managed 48 份校验通过、INDEX 无漂移；另测 server 直跑撞 8933 输出「workflow 看板启动失败（端口 8933 已被占用）：EADDRINUSE」exit 1）
