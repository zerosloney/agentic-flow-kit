# 运行时环境登记（本机专用模板——复制为 `runtime-env.local.md` 后按实况填写）

> **本文件是入库模板；真身 `runtime-env.local.md` 已 git-ignore，各机自登记、不提交、不共享。**
> 机理与解析顺序见 `runtime-env.md` §6.3。消费方（运行时自动读取「工具」表行）：
> 5 个 dwf 工作流（`.zcode/workflows/*.dwf.ts`）、`scripts/verify/e2e/browser-resolve.mjs`、`.agents/scripts/check-local-gates.mjs`。
> 未登记的工具有内置标准安装位置探测（node/dotnet/git 逐候选 `--version` 试跑、浏览器 fs 存在性探测）；
> **登记仅用于覆盖非标准安装位置**——clone 后先跑 `node .agents/scripts/check-local-gates.mjs`，
> 按其回显判断哪些工具需要登记。

| 工具 | 本机路径 | 备注 |
|---|---|---|
| node | <例：D:/Program Files/NodeJs/node.exe> | 标准安装（C:/Program Files/nodejs）无需登记 |
| npm-cli | <例：D:/Program Files/NodeJs/node_modules/npm/bin/npm-cli.js> | 可省：dwf 未登记时随 node 目录自动派生 |
| dotnet | <例：C:/Program Files/dotnet/dotnet.exe> | 标准位置无需登记 |
| git | <例：C:/Program Files/Git/cmd/git.exe> | 标准位置无需登记 |
| bash | <例：C:/Program Files/Git/bin/bash.exe> | 仅 `bash` 不在 PATH 的机器需要；取退出码 `& "<此路径>" -c '…; echo EXIT=$?'` |
| browser | <例：C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe> | 仅浏览器装在非标准位置时需要；或用环境变量 `CHROME_PATH` |

## 其他本机事实（供 agent 阅读，无机器消费方）

- <例：终端默认 PowerShell；本机 Chrome 83 内核过旧禁用；CPU 核数等实测口径>
