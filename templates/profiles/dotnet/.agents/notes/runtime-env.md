# 运行时环境注记（按需读取）

> 本文件收纳与阶段无关的、**跨机通用**的环境操作细节（终端取码 / 编译输出锁 / 本地端口与进程 / UI 实测环境 / 门禁跑法）。
> **本机绑定事实**（绝对路径 / 本机版本 / 浏览器选型）登记 `.agents/notes/runtime-env.local.md`
> （git-ignore，各机自登记，入库模板同目录 `runtime-env.local.example.md`）——入库的他机不可复用，消费方运行时解析（§6.3）。
> 新装户按项目实际填写各节：`<在此登记…>` 行与空表格数据行均为待填占位；端口 / 进程 / 库名等具体事实由项目登记，模板不预设。

## 1. 终端与退出码（Windows / PowerShell）

- 终端默认 PowerShell（各机 shell 配置差异登记 runtime-env.local.md）：`bash` / `sh` 是否在 PATH 因机而异；门禁脚本已 `.mjs` 化（node 直跑），唯一仍以 POSIX sh 书写的是 `.githooks/` 五个 git 钩子（git 机制要求），其内部一律转发 node，不依赖系统 PATH 上的 `sh`。
- 取真实退出码必须包 `bash -c`（pwsh 的 `$?` 是布尔值；`<bash>` = 本机登记的 bash 路径）——`$LASTEXITCODE` 假绿陷阱见 §6.4：
  `& "<bash>" -c 'flow-kit run check-loop.mjs; echo EXIT=$?'`
- 长命服务一律独立进程起；对长驻服务的启动命令勿接管道（子进程继承 stdout 句柄、命令永不返回，见 §6.4）。

## 2. 编译输出锁与多会话并行

- **仅当用 `dotnet run` 起 API 时**（占用 dev 输出目录 `bin`）：`dotnet build` / `dotnet test` 会报文件锁错误 **MSB3026 / MSB3027 / MSB3021**（运行中的进程占用输出 DLL，与代码无关，看着像编译失败）。处置见 §6.4「编译锁」行。
- 推荐口径：API 从**发布目录**运行（`dotnet publish` 到独立输出目录后运行），dev `bin` 不被占用，构建 / 测试 / 提交可与 API 并行，无需先停。仍用 `dotnet run` 起服务时沿用旧约定：谁跑静态门或提交，谁先停 API，完成后按需起回。
- **按名还原的备份文件带旧 mtime** → `dotnet build` 判 up-to-date 跳过重编 → 仍运行变异前 DLL（假红，反向可假绿）。处置与判据见 §6.4「假红/绿」行。
- 多会话 / 多 worktree 并行的端口冲突按 §6.1b 端口槽约定处理；数据库与发布目录等共享面不随端口隔离，须另行规划。

## 3. 本地端口与进程（服务与端口）

- 服务清单 / 端口 / 协议 / 槽位以 **§6.1 权威表**为准（不复制端口值）。
- 从发布目录跑 API：`dotnet publish -o <独立目录>` 后运行该目录入口 DLL，dev `bin` 不被占用（见 §2）；直起替代 `dotnet run --project <项目目录> --urls "http://localhost:<API 端口>"`。
- 引擎看板：`flow-kit run ensure-board.mjs` 幂等、只起不关、不 kill（端口 {{boardPort}}，槽位偏移见 §6.1b，仅绑 127.0.0.1）。
- **进程清单即 §6.1**，实测结束逐个停。

## 4. UI 实测环境（headless 浏览器 / CDP）

- **浏览器可执行文件（跨机自适应）**：运行时按 §6.3 解析序解析，本机选型登记 runtime-env.local.md。headless 一律 `--headless=new`。
- 启动：`<browser> --headless=new --no-sandbox --disable-gpu --remote-debugging-port=<CDP 端口>`（端口按槽位派生，见 §6.1b）。
- 浏览器驱动按**宿主是否配置并连通 chrome-devtools MCP** 选择：可用即优先（navigate / evaluate_script / take_screenshot / resize 覆盖实测需求）；未配置或连不通时退化自写 node CDP 脚本（node ≥22 全局 `WebSocket` 连 CDP）。
- 布局类修复用 `getBoundingClientRect` 程序化检测，比截图肉眼可靠。
- 用法细节见 `.agents/skills/verify-ui/SKILL.md`。

## 5. 门禁与 fixture 回归速查

- 按改动对象跑对应生成器 / 检查器（如 `flow-kit run gen-workflow-index.mjs --check`）；闭环绿凭证直跑 `flow-kit run verify.mjs`；hard 段回归跑 `flow-kit run check-loop-rev-semantics.mjs`。

## 6. 环境事实登记处 (Environment Fact Registry)

> 环境事实（端口 / 版本 / 绝对路径 / 工具缺陷）**只登记本节**，别处引用不复制原文。行内只留结论+判据，过程细节留提交记录；本机性事实入 runtime-env.local.md，不入本文件。
> `<在此登记…>` 行与空数据行 = 待项目按实况填写；不适用的小节保留标题、清空数据即可。

### 6.1 端口与服务 (Ports & Services)
> 多 worktree 并行时按**端口槽**偏移（机制见 §6.1b）——下表登记槽位 0 基线。

| 服务 | 端口 | 槽位偏移 | 协议 | 探活/启动脚本 | 备注 |
|---|---|---|---|---|---|
| API | <在此登记 API 端口> | `+slot×10` | HTTP | <在此登记启动/探活命令> | 权威联通口径；换端口须同步各消费方 |
| 前端 | <在此登记前端端口> | `+slot×10` | HTTP | <在此登记启动/探活命令> | dev server 显式固定端口，防静默漂移 |
| 流程看板 | {{boardPort}} | `+slot×10` | HTTP | `flow-kit run ensure-board.mjs` | strict：槽位口被他人进程占即失败，不静默漂移 |

### 6.1b worktree 端口槽约定 (Port Slots for Parallel Worktrees)

- **机制**：多棵 worktree 并行实测时互抢端点 → 以环境变量 `<在此登记槽位变量名>`（非负整数，缺省 0）把各组端口整体偏移 `slot×10`：

| 槽位 | 用途 | API | 前端 | CDP | 看板 |
|---|---|---|---|---|---|
| 0 | 主仓 / 缺省 | <基线端口> | <基线端口> | <基线端口> | {{boardPort}} |
| 1 | worktree A | `<基线+10>` | `<基线+10>` | `<基线+10>` | `<基线+10>` |
| 2 | worktree B | `<基线+20>` | `<基线+20>` | `<基线+20>` | `<基线+20>` |

- **每棵 worktree 执行序**：会话内设槽位变量 → 按 §6.1 登记的命令起服务（端口随槽位派生）→ 实测脚本读同一变量自动连本槽位（显式参数仍可覆盖）。
- **残留风险（明示）**：端口隔离不解决数据库与共享输出目录面——并行 worktree 共享同一数据库 / 同名发布目录时仍互相污染；写用例按项目登记专用测试库（见 §6.5）。

### 6.2 工具链版本 (Toolchain Versions)
| 工具 | 版本口径 | 备注 |
|---|---|---|
| Node.js | <在此登记 CI 锚定版本> | 引擎要求 ≥ 22；本机版本见 runtime-env.local.md（check-local-gates ⑥ 回显） |
| .NET SDK | <在此登记目标框架 / SDK 版本> | SDK 版本可用仓根 `global.json` 固定；本机 SDK 见 runtime-env.local.md |
| 浏览器 | — | 本机浏览器选型登记 runtime-env.local.md |
| gitleaks | <在此登记版本> | 解析序与降级口径见 §6.3；基线 `.gitleaks-baseline.json` 随仓走 |

### 6.3 可执行文件解析 (Executable Resolution)

> 绝对路径不入库（他机不可复用）：一律「消费方运行时解析 + 本机文件登记（`runtime-env.local.md`）」：

- **解析顺序**（`check-local-gates.mjs` ⑥ 等消费方）：① 环境变量（仅浏览器 `CHROME_PATH`）→ ② `runtime-env.local.md`「工具」表登记行（git-ignore 自登记，模板 `runtime-env.local.example.md`）→ ③ 标准安装位置探测（node / dotnet / git 逐候选 `--version` 至 exit 0，浏览器按候选路径 fs 探测）→ ④ 按名回退（PATH 查找）。
- **登记格式**：`| 工具 | 本机路径 | 备注 |` 表行，工具名限 `node` / `npm-cli` / `dotnet` / `git` / `bash` / `browser`（行首整词匹配）。登记仅用于覆盖非标准安装位置——全部标准安装则零登记。
- **新机上手**：clone 后跑 `flow-kit run check-local-gates.mjs`——⑥ 回显各工具解析结果，缺什么登什么。
- **gitleaks 解析序**：`GITLEAKS_BIN` 环境变量（`.mjs`/`.js` 经 node 直跑）→ PATH 上 `gitleaks` → `.agents/tools/gitleaks(.exe)`（git-ignore，机器本地）。消费方 = `check-secrets.mjs`。
- **gitleaks 三处皆缺 = 降级纯 Node 兜底 `check-secrets-lite.mjs`**：零二进制零网络，同一基线做文件级豁免；`--lite` / `SECRETS_SCAN_LITE=1` 强制；`SECRETS_SCAN_REQUIRE_GITLEAKS=1` 缺二进制 fail-closed（exit 2）。降级事实在输出首行标明。

### 6.4 已知工具缺陷与陷阱 (Known Issues)
| 缺陷项 | 现象 | 根因 | 处置/避坑 |
|---|---|---|---|
| pwsh 退出码 | `$?` 返回布尔值 | PowerShell 机制 | 取码包 `bash -c '…; echo EXIT=$?'`（bash 路径登记 runtime-env.local.md） |
| 假绿陷阱 | `$LASTEXITCODE` 不更新 | 命令不存在时保持上一次值 | 断言通过前先确认命令实际执行 |
| 编译锁 | `dotnet build` / `dotnet test` 报 MSB3026 / MSB3027 / MSB3021 | 运行中的 API 进程占用输出目录 DLL | 停进程后原路重试；或 `-p:BaseOutputPath=<临时目录>` 重定向输出 |
| 假红/绿 | 还原备份后单测结果不符 | mtime 旧 → dotnet 判 up-to-date 跳过重编 | 还原后 `touch` 源文件或 `--no-incremental` 强制重编 |
| watch 热重载崩 | `dotnet watch` 启动应用即崩（热重载管道连接异常） | 新 SDK 的热重载客户端与旧目标框架应用不兼容 | `--no-hot-reload`（退化为重编+重启）；或 `global.json` 钉齐 SDK 与目标框架 |
| ASPNETCORE_URLS 未覆盖 appsettings | `dotnet run --no-launch-profile` 设了 `ASPNETCORE_URLS` 仍绑 `appsettings.json` 的 urls | minimal hosting 下环境变量不覆盖应用配置 `urls` | 显式传 `--urls http://localhost:<端口>`；`dotnet watch` 用 `-- --urls …` 转发 |
| netstat 状态列过滤恒不命中 | `netstat -ano \| grep -E "LISTENING.*:<port>"` 恒无输出 → 误判服务未起 | Windows netstat 列序 = `协议 本地地址 外部地址 状态 PID`，端口在状态之前 | 按端口侧过滤 `netstat -ano \| grep -E "[:.]<port>"`；或探活 `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>` |
| 管道阻塞 | 服务启动命令接 `\| tail` 后永不返回 | 子进程继承 stdout 句柄 | 长驻服务的启动命令勿接管道 |
| MSYS 斜杠开关被当路径 | `robocopy … /E` 被转成 `E:/`，退出码 0 且无声 | git-bash 把单斜杠开关按 POSIX 路径转 | `MSYS_NO_PATHCONV=1` 直调 exe；事后核对目标目录真实存在 |
| MSYS 非 ASCII 路径传参 | bash 循环把含中文的相对路径传给外部工具时被转义破坏 → 假失败 | git-bash(MSYS) 对含非 ASCII 的相对路径参数做 POSIX→Windows 转换 | node 脚本用 `execFileSync` 直传 Windows 路径；或 `find` 取路径 |
| 工作区 CRLF：字面串替换恒不命中 | 脚本多行 needle 字面替换判「未找到」，编辑器里文本一致 | `core.autocrlf` 开启：工作区检出 CRLF、索引存 LF | needle 按文件自身 EOL 构造（或用单行 needle） |
| <在此登记…> | | | |

### 6.5 CI 门禁面事实 (CI Gate Registry)
| 事实 | 口径 | 备注 |
|---|---|---|
| <在此登记 CI 触发与分支策略> | | 以项目 CI 文件为权威 |
| <在此登记三档门禁（本地 / PR / main）> | | 各档跑什么、何处执法按项目登记 |
| <在此登记测试库 / 环境入口> | | 写用例走专用测试库：入口环境变量与守卫按项目登记 |

### 6.6 会话连续性事实 (Session Context & Compaction)
> 压缩 / 截断行为、上下文窗口上限、恢复手段等会话连续性事实**只登记本节**。

| 事实 | 口径 | 备注 |
|---|---|---|
| 长会话自动压缩 | 对话超限时宿主自动摘要压缩，压缩后以摘要延续、**工作区文件不受影响**；恢复靠 plan 重入锚点（改动面 + 任务勾选态 + git status），不靠对话记忆 | 其他宿主的压缩行为遇实即登记本表 |
| <在此登记…> | | |

## 7. clone 必做配置机理（独立维护口径）

- **`git config core.hooksPath .githooks`**：仓库自带钩子不随 clone 传播，须本机挂载，否则全部门禁静默失效。
- **钩子职责单源 = `.githooks/*` 头部注释**（pre-commit / commit-msg / pre-merge-commit / pre-push / post-commit）；`flow-kit run check-local-gates.mjs --fix` 可一并补齐下列 git config。
- **`git config merge.ours.driver true`**：让 `.gitattributes` 的 `**/appsettings.json merge=ours` 生效——连接串等本机配置不参与分支合并，恒保留当前分支版本。仅护 `git merge`：**`rebase` 时 ours=上游，本侧改动被静默丢弃**；`cherry-pick` 冲突可见。
- **`git config merge.jsonl-union.driver "flow-kit run git-merge-jsonl.mjs %O %A %B"`**：让 `.gitattributes` 对 `.agents/*.jsonl` 等追加式台账的 `merge=jsonl-union` 生效——多人并发或多 worktree 并行时，尾部追加行自动并集去重合并。**漏配后果**：追加式台账在 Git 文本合并下产生冲突，须手工解。
