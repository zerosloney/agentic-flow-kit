# 运行时环境注记

> 记录本机/本项目的运行时差异，供 agent 与钩子脚本对照（shell 可用性 / 端口 / 进程名等）。
> 本文件是骨架：项目按实际填写，不随 flow-kit 升级覆盖。

## 1. 终端与 shell

- **本机默认终端**：PowerShell（`pwsh`）；另装 Git for Windows（`C:\Program Files\Git`）与 TortoiseGit。
- **`sh` 可用性（2026-09-28 实测并修复）**：本机 `Path` 原只含 `C:\Program Files\Git\cmd`（仅有 `git.exe`），
  **不含 `C:\Program Files\Git\bin`（`sh.exe` 所在）** → Node 的 `spawnSync('sh')` 走 PATH 找不到 → ENOENT。
  后果：`npm test` 恒有 3 项失败，且**全部是环境性、非代码缺陷**（实测确认后已修，见下）。
  - **已修**：把 `C:\Program Files\Git\bin` 追加进**用户级** PATH（不动系统级）。**新开终端即生效**；
    已开着的会话/父进程仍持旧 PATH，需显式注入 `$env:PATH += ';C:\Program Files\Git\bin'`。
  - **依赖 `sh` 的 3 处（均为设计上依赖，非迁移残留）**：
    1. `rule-budget.sh`（74 行**真 sh 实现**）——`check-loop` 检查 13 调它（advisory）、`.githooks/pre-commit` 调它（硬拦）
    2. `modules/gates/dotnet-ca/check-architecture.sh`——技术栈门禁模块产物
    3. `workflow-enums.test.mjs` S11——断言「sh sed 取键 == node 读键」（跨语言单源契约）
  - **注意区分**：`check-loop.sh` 是 **6 行 shim**（`exec node check-loop.mjs`），迁移早已完成——
    「引擎已迁 node」不等于「全仓无 sh 依赖」。`rule-budget.sh` 的不迁移是 `2026-09-26-check-loop-node`
    intent 里**明确记载的决定**（理由：git 钩子 sh 环境保证），不是欠账。
  - **无 sh 时的假绿风险**：检查 13 在无 `sh` 时**静默跳过**（advisory 层设计），
    而 pre-commit 侧的硬拦同样不生效——故「本机测试全绿」在未接 sh 时并不覆盖常驻面预算。
    接上 sh 后本机 `npm test`、`check-loop`、CI shipped 套件步骤（20 个）全部实测通过。
- **`bash` 亦经 Git 提供**：`C:\Program Files\Git\bin\bash.exe`（5.2.37）。CI 的 `shell: bash` 步骤可本机复跑。

## 2. 本地端口与进程

- API：<端口 / 进程名 / 启动停止命令>
- 前端：<端口 / 启动命令>
- workflow 看板：8933（`node .agents/scripts/workflow-board-server.mjs`，只读）
- pipeline-run 执行器：运行态在 `.agents/cache/pipeline-runs/*.json`（gitignored 缓存、非权威——权威在 workflow/ 文档+confirmations 台账；丢失后 status --adopt 重建）；watch 终端轮询 2s，Ctrl+C 退出不影响 run

## 3. 数据与密钥

- <本地库连接约定（不写明文密钥）；含密钥/环境差异的配置文件走 `.gitattributes` 的 `merge=ours`（须 `git config merge.ours.driver true`）>
