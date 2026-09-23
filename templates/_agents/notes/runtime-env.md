# 运行时环境注记

> 记录本机/本项目的运行时差异，供 agent 与钩子脚本对照（shell 可用性 / 端口 / 进程名等）。
> 本文件是骨架：项目按实际填写，不随 flow-kit 升级覆盖。

## 1. 终端与 shell

- <本机默认终端（如 PowerShell / Git Bash）；`sh` / `bash` 是否在 PATH；「命令不存在」时退出码取法与假绿风险示例>

## 2. 本地端口与进程

- API：<端口 / 进程名 / 启动停止命令>
- 前端：<端口 / 启动命令>
- workflow 看板：{{BOARD_PORT}}（`node .agents/scripts/workflow-board-server.mjs`，只读）

## 3. 数据与密钥

- <本地库连接约定（不写明文密钥）；含密钥/环境差异的配置文件走 `.gitattributes` 的 `merge=ours`（须 `git config merge.ours.driver true`）>
