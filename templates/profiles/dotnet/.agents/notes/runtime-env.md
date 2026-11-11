# 运行时环境注记（按需读取）

> 本文件收纳与阶段无关的、**跨机通用**的环境操作细节（终端取码 / 编译输出锁 / 本地端口与进程 / UI 实测环境 / 门禁跑法）。
> **本机绑定事实**（绝对路径 / 本机版本 / 浏览器选型）自 2026-10-10 起登记 `.agents/notes/runtime-env.local.md`
> （git-ignore，各机自登记，入库模板同目录 `runtime-env.local.example.md`）——入库的他机不可复用，消费方运行时解析（§6.3）。
> 各阶段命令只留一行指针（操作细节单源本文件，2026-09-21 自阶段命令下沉）。端口与联通的**权威事实**仍是根 `AGENTS.md`「运行时联通」一行。

## 1. 终端与退出码（Windows / PowerShell）

- 终端默认 PowerShell（各机 shell 配置差异登记 runtime-env.local.md）：`bash` / `sh` 是否在 PATH 因机而异；门禁脚本已 `.mjs`/`.cjs` 化（node 直跑，`.sh` 门禁归零），唯一仍以 POSIX sh 书写的是 `.githooks/` 五个 git 钩子（git 机制要求），其内部一律转发 node，不依赖系统 PATH 上的 `sh`。若某脚本确需 shell 跑：用 Git Bash 绝对路径包装（本机路径登记 runtime-env.local.md 的 bash 行）
- 取真实退出码必须包 `bash -c`（pwsh 的 `$?` 是布尔值；`<bash>` = 本机登记的 bash 路径）——`$LASTEXITCODE` 假绿陷阱见 §6.4「假绿陷阱」行：
  `& "<bash>" -c 'node .agents/scripts/check-loop.mjs; echo EXIT=$?'`
- 长命服务一律独立进程起（如 `Start-Process`）；shell `&` 作业生命周期不可依赖——**但 Bash `run_in_background` 的完成通知是可靠的**，别退化成轮询：有限命令前台直跑（`timeout` 上限 600000ms），已起后台的用 `TaskOutput(block=true)` 或等通知。

## 2. 编译输出锁与多会话并行

- **仅当用 `dotnet run` 起 API 时**（占 dev `bin`）：编译输出锁 `Shipyard.Material.API/bin/**/*.dll` → `dotnet build` / `dotnet test` 报 **MSB3027 / MSB3021**（与代码无关，看着像编译失败）。推荐口径（发布目录运行）不撞锁，见下条。
- 处理：先停 API 再跑静态门，跑完按需重启——`Stop-Process -Name Shipyard.Material.API -Force`；或 `-p:BaseOutputPath=<临时目录>` 重定向输出。
- 两个判定：① `dotnet build` 只在**后端确有改动需重编**时才撞锁（无改动即 up-to-date，不报锁）；② pre-commit 的 `commit-check.cjs` 命中锁冲突时会直接打印「停 API 后原路重试」指引与锁冲突行，看到该提示即无需再猜是不是编译错误。
- **多会话 / 多智能体并行**：同机只有一份 `bin`。**现已采用「从发布目录运行 API」**——`scripts/verify/business/dev-local.ps1 start`（一个脚本同时起 API + 前端，见 §3），dev `bin` 不再被占用，构建 / 测试 / 提交可与 API 并行，**无需先停**。仅在仍用 `dotnet run` 起 API（占用 dev `bin`）时，沿用旧约定：谁跑静态门或提交，谁先停 API，完成后按需起回。
  - **集成套件跨会话互斥**：多 worktree 共用 dev 库会互相压库（偶发红被 fail-fast 放大）→ `tests/Shipyard.Material.IntegrationTests/TestDb.cs` 静态构造持 `sp_getapplock`（`@LockOwner=Session`，退出自动释放）串行化测试之间；`TEST_DB_LOCK_TIMEOUT_MS`（默认 600000）/ `SKIP_TEST_DB_LOCK=1` / `PERF_BUDGET_MS`（默认 2000）可调，失败只响亮提示不阻断；自证 `TestDbLockTests`。偶发红先隔离复跑定因（同树单跑即绿 = 环境抖动）。
- **变异校验还原后须强制重编**：按名还原的备份文件带旧 mtime → `dotnet build` 判 up-to-date 跳过重编 → 仍跑变异版 DLL（假红，反向可假绿）。处置与判据见 §6.4「假红/绿」行。

## 3. 本地端口与进程（服务与端口）

- 服务清单 / 起停脚本 / 端口 / 协议 / 槽位以 **§6.1 权威表**为准（不复制端口值）。
- **从发布目录跑 API**：`dev-local.ps1 start` 用 `%TEMP%\shipyard-api-<端口>`，dev `bin` 不被占用，可与 build / test / commit 并行；`-Mode debug` 改 `dotnet watch`（本机强制 `--no-hot-reload`，见 §6.4），只对本次 start/restart 生效且占 dev `bin`——跑门禁/提交前先 `stop`。直起替代 `dotnet run --project backend/material/Shipyard.Material.API --urls "http://localhost:<API 端口>"`（占 `bin`，见 §2）。
- `dev-local.ps1` 子命令 `start|stop|status|restart`（`restart` = 停前端→停 API→publish→起 API→起前端，）；`-Port` / `-FePort` 覆盖，不传按 `SHIPYARD_SLOT` 派生、`-Port` 非槽位形态时前端按固定偏移推导；**勿接管道**（`| tail` 让服务继承 stdout 句柄、命令永不返回，见 §6.4）。看板 `ensure-board.mjs` 幂等、只起不关、不 kill（strict 见 §6.1）。前端直起 `node frontend/node_modules/vite/bin/vite.js --port <槽位前端口> --strictPort`（`start` 已注入 `VITE_API_BASE_URL=http://localhost:<API 端口>`，无需改 `.env.local`）。
- API 走 HTTP 避自签证书；前端默认连 `http://localhost:<API 端口>`，`VITE_API_BASE_URL` 可覆盖。**进程清单即 §6.1**，实测结束逐个停。

## 4. UI 实测环境（headless 浏览器 / CDP）

- **浏览器可执行文件（跨机自适应）**：`harness.mjs` 的 `CHROME` 常量由 `browser-resolve.mjs` 运行时解析（解析序见 §6.3，内核版本判据见 §6.2）；business verify 脚本同源复用。headless 一律 `--headless=new`。
- 启动：`<browser> --headless=new --no-sandbox --disable-gpu --remote-debugging-port=<CDP 端口>`（端口按槽位派生，单一权威 `scripts/verify/e2e/ports.mjs`；槽位 0 = 9333；浏览器可执行文件解析见 §6.3）
- harness：`scripts/verify/e2e/harness.mjs`（`launch` / `seedSession` / `goto` / `hardGoto` / `clickText` / `pressKey` / `ensureClean` / `screenshot` + 网络 / 控制台 / toast 采集器）；自写脚本优先复用其常量与函数。
- 浏览器驱动按**宿主是否配置并连通 chrome-devtools MCP**选择（判据与宿主名无关，2026-09-23 实测）：可用即优先（navigate / evaluate_script / take_screenshot / resize 覆盖实测需求）；未配置或连不通时退化自写 node CDP 脚本：node ≥22 全局 `WebSocket` 连 CDP；先调 API 登录拿 token，注入 localStorage（键 `auth_token` / `auth_user`），前端为 hash 路由。
- MCP 报「browser is already running」**≠ MCP 不可用**——残留 Chrome 实例占 MCP 专用 profile 锁，处置见 §6.4「chrome-devtools MCP profile 残留锁死」行。
- 布局类修复用 `getBoundingClientRect` 程序化检测，比截图肉眼可靠。
- 技能侧细节（antd + hash 路由的必踩坑等）见 `.agents/skills/verify-ui/SKILL.md`。

## 5. 门禁与 fixture 回归速查

- 引擎面测试不入库、仓内无 fixture 套件（`*.test.mjs` 已 gitignore）：按改动对象跑生成器 `--check` / `--dry-run`（如 `gen-workflow-index.mjs --check`、`gen-workflow-metrics.mjs --dry-run`）；需绿凭证直跑 `node .agents/scripts/verify.mjs`（无根 `package.json` 的仓给 `--test-cmd`）。hard 段回归手动跑 `node .agents/scripts/check-loop-rev-semantics.mjs`。

## 6. 环境事实登记处 (Environment Fact Registry)

> 环境事实（端口 / 版本 / 绝对路径 / 工具缺陷）**只登记本节**，别处引用不复制原文（AGENTS.md「环境事实单源」纪律）。带日期的实证记录与代码内字面量不受此限。
> **行文纪律（2026-10-31 立）**：行内只留结论+判据，过程细节留提交信息；已根治条目与退役机制行随确认提交删除（历史查 git，不留「机制史记录」行）；本机性事实入 runtime-env.local.md 不入本文件。

### 6.1 端口与服务 (Ports & Services)
> 多 worktree 并行时按**端口槽**偏移（`SHIPYARD_SLOT`，见 §6.1b）——下表为槽位 0 基线；起停/发布目录口径见 §3。
| 服务 | 端口 | 槽位偏移 | 协议 | 探活/启动脚本 | 备注 |
|---|---|---|---|---|---|
| API (Kestrel) | 8932 | `+slot×10` | HTTP | `scripts/verify/business/dev-local.ps1` | 权威联通口径，前端实际连接地址；`-Port` 可换端口（发布目录随端口派生，支持多实例）；`-Mode debug` = `dotnet watch`（占 dev bin；`--no-hot-reload`，仅重编+重启） |
| 前端 (Vite) | 5203 | `+slot×10` | HTTP | 同 API 脚本（`dev-local.ps1` 一并起停） | 直起 Vite 并带 `--port --strictPort`（禁静默漂移）；注入 `VITE_API_BASE_URL`，无需改 `.env.local` |
| 流程看板 | 8933 | `+slot×10` | HTTP | `.agents/scripts/ensure-board.mjs` | 仅绑 127.0.0.1；strict（槽位口被他人进程占即失败不漂移，2026-10-22 board-slot-strict）；看板槽位口与同槽 API 口恒差 1（8933↔8932），族内无碰撞 |
| 冒烟探活 | — | 随所测端口 | — | `scripts/verify/business/regression-smoke.mjs` | 6 个端点任一非 200 即 fail |

### 6.1a UI 实测登录账号 (UI Test Accounts)
| 账号 | 用途 | 密码 |
|---|---|---|
| JAMTC017 戴晨 / JAMTC018 王桦 / JAMTC019 施鹏 | UI 实测 / 冒烟 / 集成用例取数（2026-10-27/10-31 用户口径：测试仅用这三号，替换原 JAMTC001–012 池，其余账号已删除；造数 / 种子 / 用例取人限此三号；勿用于 POC 库） | `1`（代码缺省消费点：`scripts/verify/e2e/harness.mjs` SMOKE_ACCOUNTS 池无参随机取号） |


### 6.1b worktree 端口槽约定 (Port Slots for Parallel Worktrees)

> 多 worktree 并行实测抢端点（2026-10-12 立）。端口字面量**单一权威** = `scripts/verify/e2e/ports.mjs`（消费方 import，勿硬编码）。**例外**：① `dev-local.ps1`（PowerShell 无法 import ESM）内独立实现槽位解析与派生 `8932 + slot*10` / `5203 + slot*10`（`-Port`/`-FePort` 优先，`^\d+$` 同口径）；② `frontend/vite.config.ts` 的 `port: 5203`（既有字面量，业务面未动）。改任一侧口径或基线端口须同步 `ports.mjs`。

- **机制**：环境变量 `SHIPYARD_SLOT`（非负整数，缺省 0）→ 四组端口整体偏移 `slot*10`：

| 槽位 | 用途 | API | 前端 | CDP | 看板 |
|---|---|---|---|---|---|
| 0 | 主仓 / 缺省（= 历史行为） | 8932 | 5203 | 9333 | 8933 |
| 1 | worktree A | 8942 | 5213 | 9343 | 8943 |
| 2 | worktree B | 8952 | 5223 | 9353 | 8953 |

- **每棵 worktree 执行序**（以槽位 1 为例）：
  1. `$env:SHIPYARD_SLOT=1`（同一 shell 会话内，实测脚本会据此派生全部端口）。
  2. 起服务：`powershell -NoProfile -File scripts/verify/business/dev-local.ps1 start`（API 发布目录 = `%TEMP%\shipyard-api-8942`，与 8932 实例互不撞锁；前端 5213，脚本注入 `VITE_API_BASE_URL=http://localhost:8942`，无需改 `.env.local`）。槽位不成形时才需显式 `-Port 8942 -FePort 5213`。
  3. 实测：`node scripts/verify/...`（脚本读 `SHIPYARD_SLOT` 自动连本槽位；`--base`/`--fe` 仍可显式覆盖）。
- **覆盖优先级**：显式 `--base`/`--fe` > 环境变量 `E2E_API_URL`/`E2E_FE_URL` > 槽位派生 > 槽位 0 缺省。env 层目前仅 `harness.mjs` 实现（`FE`/`API` 常量）；`argOf`/`regression-smoke` 家族不读 env，为「显式参数 > 槽位派生 > 缺省」三层。
- **自验**：`node scripts/verify/business/verify-slot-isolation.mjs`（派生算术 + 跨槽不重叠 + 现场并存探测 + 探活可达，ALL PASS 即机制正确）。
- **残留风险（明示）**：端口隔离**不解决数据库面**——并行 worktree 共享 dev 库 `DEVE_CSS_YZGY`，条数/新建类实测互相污染；写用例走 `TEST_DB_CONN` 专用库（§6.5，未设/指向 dev 库被 fail-loud 守卫拦，`TEST_DB_ALLOW_DEV=1` 逃生）。另：`vite.config.ts` 未设 `strictPort`——并行前端必须显式传 `--port --strictPort` 防静默漂移。

### 6.2 工具链版本 (Toolchain Versions)
| 工具 | CI Agent 版本 | 备注 |
|---|---|---|
| Node.js | v22.17.0 (NodeTool) | 本机版本见 runtime-env.local.md（check-local-gates ⑥ 回显） |
| .NET | 目标框架 net6.0（CI 未声明 SDK 版本，池 JAMTC 镜像自带） | 本机 SDK 见 runtime-env.local.md |
| Chrome/Edge | — | 本机浏览器选型登记 runtime-env.local.md；内核 <100 渲染异常（antd 图标方框） |
| gitleaks | 8.30.1（CI 装机尽力而为，装不上降级 lite 兜底——机理单源 §6.3 gitleaks 条） | 基线 `.gitleaks-baseline.json` 随仓走 |

### 6.3 可执行文件解析 (Executable Resolution)

> 绝对路径不入库（他机不可复用）：一律「消费方运行时解析 + 本机文件登记（`runtime-env.local.md`）」：

- **解析顺序**（dwf / `browser-resolve.mjs` / `check-local-gates.mjs`）：① 环境变量（仅浏览器 `CHROME_PATH`）→ ② `runtime-env.local.md`「工具」表登记行（git-ignore 自登记，模板 `runtime-env.local.example.md`；dwf 仅消费 npm-cli 行）→ ③ 标准安装位置探测（node/dotnet/git 逐候选 `--version` 至 exit 0，浏览器 fs 探测 Edge/Chrome）→ ④ 按名回退（仅 dwf）。`browser-resolve.mjs` 全空返回 null，`harness.mjs` launch 抛指导性报错。
- **登记格式**：`| 工具 | 本机路径 | 备注 |` 表行，工具名限 `node` / `npm-cli` / `dotnet` / `git` / `bash` / `browser`（行首整词匹配，`npm-cli` 不会误中 `node`）。dwf 的 npm-cli 未登记时随 node 安装目录自动派生（官方发行版固定相对布局 `node_modules/npm/bin/npm-cli.js`）。
- **新机上手**：clone 后跑 `node .agents/scripts/check-local-gates.mjs`——⑥ 回显各工具解析结果，缺什么登什么；全部标准安装则零登记。
- **gitleaks 解析序**：`GITLEAKS_BIN` 环境变量（`.mjs`/`.js` 经 node 直跑）→ PATH 上 `gitleaks` → `.agents/tools/gitleaks(.exe)`（**git-ignore，机器本地**；装机 = GitHub releases 官方 zip 解压，版本锚 8.30.1——与 CI 装机版本、基线生成口径一致）。消费方 = `check-secrets.mjs`（verify 安全段 `secrets-scan`——关单/CI）。
- **gitleaks 三处皆缺 = 降级纯 Node 兜底 `check-secrets-lite.mjs`**：零二进制零网络，同一基线做**文件级**豁免；强特征规则（私钥块/AWS/GitHub/JWT/Square/云前缀）无豁免，宽泛 key=value 仅对基线外文件执法；首行标 `执法者=lite`，绿行记 `secretsEnforcer=lite`。`--lite` / `SECRETS_SCAN_LITE=1` 强制；`SECRETS_SCAN_REQUIRE_GITLEAKS=1` 缺二进制 fail-closed（exit 2）。基线 `.gitleaks-baseline.json`（豁免 owner 拍板）随仓走，缺基线 exit 2。实测：gitleaks 全史 14–18s，lite 全树 0.9s / 增量 0.3s。

### 6.4 已知工具缺陷与陷阱 (Known Issues)
| 缺陷项 | 现象 | 根因 | 处置/避坑 |
|---|---|---|---|
| pwsh 退出码 | `$?` 返回布尔值 | PowerShell 机制 | 交互式 pwsh 手工跑命令用 `bash -c '...; echo EXIT=$?'` 取码（引擎面审计无假绿欠账） |
| 假绿陷阱 | `$LASTEXITCODE` 不更新 | 命令不存在时保持上一次值 | 断言通过前先确认命令实际执行 |
| 编译锁 | MSB3027 / MSB3021 | Kestrel 占用 DLL | 停 API 后重启 / 重定向 BaseOutputPath |
| watch 热重载崩 | `dotnet watch` 启动应用即崩：`UnauthorizedAccessException`（`Microsoft.DotNet.HotReload.PipeListener` → `NamedPipeClientStream.Connect`） | SDK 10 的 watch 热重载客户端（StartupHook 命名管道）与 net6.0 应用不兼容（本机 2026-11-03 两次复现） | `--no-hot-reload`（`dev-local.ps1 -Mode debug` 已强制，退化为「重编 + 重启」）；要真热重载须仓级 pin SDK 6（仓根加 `global.json` 钉 SDK，构建面改动，另议） |
| ASPNETCORE_URLS 未覆盖 appsettings `urls` | `dotnet run --no-launch-profile` 设了 `ASPNETCORE_URLS` 仍绑 `appsettings.json` 的 8932 | 实测（2026-11-03）：minimal hosting 下该环境变量未覆盖应用配置 `urls` | 显式传 `--urls http://localhost:<端口>`；`dotnet watch` 需用 `-- --urls …` 转发（dev-local.ps1 已按此写） |
| 假红/绿 | 还原后单测结果不符 | mtime 导致 dotnet 跳过重编 | 还原后 `touch` 源文件或 `--no-incremental` |
| 管道阻塞 | `dev-local.ps1 restart \| tail` 永不返回 | 子进程继承 stdout 句柄 | 禁止对服务启动脚本（API / 前端）接管道 |
| netstat 状态列过滤恒不命中 | `netstat -ano \| grep -E "LISTENING.*:(8932\|5203)"` 恒无输出 → 误判「服务未启动」并重复起 Vite | Windows netstat 列序 = `协议 本地地址 外部地址 状态 PID`，**端口在状态之前**，故「LISTENING 在前」的写法永不匹配 | 按端口侧过滤 `netstat -ano \| grep -E "[:.]<port>"`；或直接探活 `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>` |
| 发布目录跨 worktree 污染 | 探活正常但接口 500（新代码却没新列/新方法） | `dev-local.ps1` 发布目录只按端口派生（`%TEMP%\shipyard-api-<port>`），多 worktree 同端口互相复用；`dotnet publish` 按 mtime 跳过，别处旧 DLL 被保留 | 换端口槽位；或先 `Remove-Item -Recurse "$env:TEMP\shipyard-api-<port>"` 再 `start`（环境假红非代码缺陷；同端口他人 `restart` 的 stop 段亦会停服） |
| AI 宿主 Bash cwd 回落主仓 | worktree 会话用**相对路径**跑仓库脚本会跑到主检出代码——服务起在旧代码上，新端点 404/401 假象（`dev-local.ps1` 的 `$repo = $PSScriptRoot`，脚本在哪仓就发布哪仓） | 每条 Bash 结束 cwd 回落会话主目录，上一条 `cd worktree` 不延续 | worktree 内跑仓库脚本一律显式 `cd <worktree> && …` 或绝对路径；起服务后用 DLL 方法名探针自证发布源（如 `buf.includes('新方法名')`） |
| 门禁编排并发膝点 | 串行编排 = 各门耗时之和；并发后 ≈ max(最长门, 和/并发) | 门自身已内部并行，档位越高越抢核 | 缺省 `clamp(2..4, floor(cpus/4))`（12 核 → 3，膝点实测 3）；`--jobs N` / `--serial`；fail-fast 保留；backend-test 待 backend-build（同 sln 并发撞 obj/bin 锁） |
| 漏洞数据源实测 | 镜像能代理包、未必代理漏洞 API——换源前必须实测该端点 | 各源实现不一（npm `/-/npm/v1/security/*`；NuGet `VulnerabilityInfo`） | 结论：**漏洞数据无内网可得源**（公网源冷缓存假红、内网源静默 0 条假绿），该族门 2026-10-16 退役；恢复前提 = 内网源提供漏洞数据，或网络失败与解析失守分流 |
| `LINENO` 关键字 | `ALTER TABLE ... DROP COLUMN LineNo` 报「关键字 'LineNo' 附近有语法错误」，批次删列**静默不生效**（`02-verify` 长期红） | `LINENO` 是 T-SQL 关键字（niladic 函数，同 `ROWCOUNT` 一类） | 含该列名的 SQL 一律加方括号 `[LineNo]`；删列前先删依赖默认约束（否则报 4922）。实证：incident `2026-10-12-outband-column-readd-recurring` |
| MSYS 非 ASCII 路径传参 | bash 循环把 `wiki/数据维护/...` 传给 sqlcmd 时路径被转义破坏 → 同批 13 例假失败（`cannot open ... 系统找不到指定的路径`） | git-bash(MSYS) 对含非 ASCII 的相对路径参数做 POSIX→Windows 转换 | 引擎脚本用 **node `execFileSync` 直传 Windows 路径**（`.agents/scripts/check-schema-residue.mjs` 即此式）；或 `find` 取路径 |
| worktree junction 穿透删包（2026-11-04 实证） | worktree 内 `mklink /j …/node_modules` 复用依赖后，`git worktree remove --force` / `rm -rf` 会**穿透 junction 递归删目标本体**（主仓 node_modules 被清到只剩 42 项） | git 不识别 NTFS junction（reparse point 按普通目录递归） | **禁 junction**：worktree 内独立 `npm install`（外网不可达时不可行），或删前先 `rmdir` 摘链接（MSYS `rmdir` 不递归）再 remove；`xlsx@0.20.3` 走 cdn.sheetjs.com 不入 registry/镜像、缓存无它，损伤只能外部补 tarball |
| git add 批量原子失败+吞错（2026-11-08 实证） | 一条 git add 里 glob 混入不可见字符、且 api.http 误写根路径（实际 `backend/material/Shipyard.Material.API/api.http`）→ 任一 pathspec 无匹配即**整条 fatal 中止**；叠加 `2>/dev/null` 吞错 → F 批次一度只提交 3 个模板（残缺提交，两次 amend 修齐） | git add 对无效 pathspec 整体退出、不执行部分匹配；吞错重定向掩盖 fatal；编辑器可注入零宽字符 | 批量暂存一律**显式路径清单**（禁 glob、禁 `2>/dev/null`）；add 后必看 `git diff --cached --stat` 条数再 commit；未 push 的残缺提交用 `git commit --amend` 收齐 |
| DDL 事后溯源 | 需查「谁/何时/何表」 | 本库默认追踪**已启用**（`sys.traces` is_default=1） | `fn_trace_gettable((SELECT value FROM fn_trace_getinfo(NULL) WHERE property=2), default)` 过滤 `EventClass IN (164,47,46)` + `DatabaseName`；记录主机/应用/时刻/对象（**不含语句文本**；曾据此定位带外 ADD 源主机） |
| schema 批次残留审计 | 「已删列仍存在 / 已加列不存在」全批次对账 | — | `node .agents/scripts/check-schema-residue.mjs [--verbose]`（只读；连接串取 `appsettings.json` 的 `DBConnParameter`；退出码 1 = 有未解释残留/缺失；`EXEMPT` 为带因豁免清单） |
| git cat-file --batch 回显完整 sha | 输入缩写 sha 时 Map 恒 miss、静默走保守回退 | `--batch` header 用**完整** sha，与输入形态无关 | 按**输入顺序**回填（键用请求时的缩写）；新增文件 oldSha 为 `0000000` 须判 `/^0+$/` |
| MSYS 斜杠开关被当路径 | `robocopy … /E` 被转成 `E:/`，**退出码 0 且悄无声息** | git-bash 把单斜杠开关按 POSIX 路径转 | `MSYS_NO_PATHCONV=1` 直调 exe（`MSYS2_ARG_CONV_EXCL='*'` 与 `cmd //c` 组合无效）；事后核对目标目录真实存在 |
| 看板服务闪 CMD 窗（2026-11-09 实证） | 看板服务（`ensure-board.mjs` 以 detached+windowsHide 拉起，**无控制台**）内 spawn 的 git/node 子进程未带 `windowsHide` → 用户每次点击看板即闪 CMD 窗 | Windows 为无控制台父进程派生的控制台子进程**新开控制台窗口** | 服务进程可达的所有 spawn/execFile/execFileSync 一律加 `windowsHide: true`（非 Windows 平台自动忽略，无副作用；已补 `workflow-board-server.mjs` ×3、`dev-tour-model.mjs` ×1） |
| 关单即归档 | 终态件不再累积于活跃目录（archive-sweep 是手工工具、无人跑） | — | `confirm-doc` 落终态后归档**本次家族**（`windowDays=-1`；`touched` 过滤防越权清理历史积压）；条件：`workflow/archive/` 已存在；`CONFIRM_DOC_NO_ARCHIVE=1` 关、`CONFIRM_DOC_ARCHIVE=1` 强制；特性分支默认不归档（防合并 diff 只剩 `archive/` 路径）；失败 fail-open |
| 三台账分片 | append-only 台账全量重写（历史 blob 29.6 MiB、并行合并冲突） | 单文件 append-only | 行按月迁 `workflow/<ledger>.d/<YYYY-MM>.md`；读写单源 `ledger-shards.mjs`（`readLedger`/`readLedgerText`/`readDelegationsText`/`splitMain`/`appendRows`/`renderShard`；CLI `--check`/`--split`/`--append --row`，delegations 双表给 `--section`）。**踩坑**：① 表归属按原节标题非列数；② 分片须「节标题+表头+行」交错（只带表头 → 检查 18 读 0 行）；③ 单元格可含转义管道符；④ `splitMain` 按行去重；⑤ `inSec` 遇重复节标题须继续 |
| delegations 读侧三口径合一 | 三个消费者各写一份分片遍历 + 表解析，靠人肉同步 | 无单源 | 统一走 `ledger-shards.readDelegationsText`（传默认主台账路径才合并分片，显式 `file` 覆盖时不合并）；`agg-delegations` 保留 fail-loud 包装 |
| 后台长任务取结果 | 取结果一步静默挂数分钟，超时才整块回放 | `job_output wait:true` 阻塞到结束 + verify 逐门缓冲 | **分段等**：`timeout_ms` 取 2–3 分钟一段，每段回报「跑到哪门 / 是否卡死」；迭代期单门或 `verify --scope`，关单再全量（时长读 verifications.jsonl 的 `wallMs`） |
| git fsmonitor 读数失真 | status/diff 先「假干净」后「现脏」；钩子高频 `fsmonitor_ipc__send_query` 错 | daemon 命名管道查询间歇无应答（多会话 + TGitCache） | 已停用；读数存疑用 `git -c core.fsmonitor=false status` 复核。多会话并行人工协调（端口槽见 §6.1b） |
| CodeBuddy 终端工具名与 hook matcher | matcher 写 `RunCommand` 时钩子永不触发（该名属 Trae 体系） | 两宿主工具名体系不同：CodeBuddy 实测 Bash（主通道）+ PowerShell（Windows 次通道），Trae 为 RunCommand；注释曾从 `.trae/hooks` 误抄 | matcher 多选 `Bash\|PowerShell\|RunCommand\|Shell\|Terminal`，**hook 内正则须同列**，否则脚本自行 `exit(0)` 放行；改 `settings.json` 不热更新，需新开会话或 `/hooks` 审核 |
| CodeBuddy `CODEBUDDY.md` 落根目录 | 根目录出现它则 `AGENTS.md` 不再被加载（不合并、无报错） | 宿主兼容层优先级 | 根目录只留 `AGENTS.md`；`CODEBUDDY.md` 仅存于 `.codebuddy/`（IDE 项目记忆位） |
| Qwen Code 宿主钩子面 | `.qwen/settings.json` 的 `hooks.PreToolUse`；matcher 用工具 id，command 走 `.agents/hooks/*.cjs`，timeout 单位秒 | 项目 hooks 变更须新会话/重载生效 | 本机宿主接线 |
| CodeBuddy 子代理 MCP | 显式 `tools:` 白名单不继承主会话 MCP；需 MCP 的角色补 `mcpServers`，agents/*.md 改动下次会话生效 | 官方 sub-agents 文档 | 本机实测 |
| 工作区 CRLF：字面串替换恒不命中 | 一次性脚本对仓库文件做字面替换（`src.includes(needle)`）恒判「未找到」，而编辑器里文本一致 | 本仓 `core.autocrlf` 开启：**工作区检出 CRLF、索引存 LF**；脚本多行 needle 写 `<CRLF>` 与工作区 `<LF>` 不匹配 | needle 按文件自身 EOL 构造（或用单行 needle）。2026-10-23 两轮一次性脚本连续踩中 |
| az devops 扩展拒 http 组织 URL | `az devops login` 报 "Refusing to attach credentials to an invalid Azure DevOps organization URL"（`az` 已装，Git Bash PATH 可能不带） | 扩展拒绝非 https（且非 localhost）组织 URL | 走 REST + PAT Basic（入口 `.agents/skills/tfs-pr/scripts/tfs-pr.mjs`；纪律单源 `.agents/skills/tfs-pr/SKILL.md`）。**web 入口 `http://101.101.118.123:8080/tfs/ASS`**（门户/REST 同源，collection=ASS）；80 端口是另一 IIS 站点对 /tfs 恒 404，443/8443 不通 |
| chrome-devtools MCP profile 残留锁死 | MCP 全工具报「The browser is already running for `…\.cache\chrome-devtools-mcp\chrome-profile`」（new_page/list_pages 全挂；上轮会话浏览器未退即锁死） | MCP 只自启并独占该持久 profile，不附着既有实例；清残留 chrome 进程即恢复 | 按命令行含 `chrome-devtools-mcp` 精确杀残留 chrome.exe 后重试（Git Bash 传 PowerShell 须整体单引号防 `$_` 被吞，见 MSYS 行）。日常浏览器用独立 profile 不受误伤 |
| PI 宿主 CJS 热载 | `/reload` 只重编译 .ts，`gates-core.cjs` 留在 require 缓存；扩展用 `createRequire` 按 cwd 强读 | 新 TS 调旧 core 会 TypeError | 本机私有 |
| PI 门禁接线（本机私有） | `.pi/` gitignore 不随 clone；扩展需 project trust；缺失时 session_start / 命令门 / 写前门静默失效 | 只剩 git 钩子兜底 | 本机私有 |
| Cline 宿主（本机私有） | `.cline/` gitignore；原生读 `AGENTS.md` 与 `.agents/skills`；**两门已接线**（`.cline/hooks/PreToolUse.cjs` 协议适配层：run_commands→pre-shell-check、editor/apply_patch→pre-write-check，输出 `HOOK_CONTROL\t{"cancel"/"review"}`）；agent 写 `tools:` 按名过滤**剔除全部 MCP 工具**（MCP 名 = server+`__`+工具） | 按名过滤，非并集 | 本机 |
| Command Code（本机私有） | `.commandcode/` 不入库；原生读 AGENTS.md/技能；PreToolUse matcher 认 tool_display_name，仅 allow/deny，plan 跳过 |
| Claude Code 宿主（本机私有） | `.claude/` 与根 `CLAUDE.md` 均 gitignore、不随 clone；根 `CLAUDE.md` 是 `AGENTS.md` 本机镜像（本构建亦直接加载 AGENTS.md） | hook 面：`.claude/settings.json` 的 `PreToolUse`，matcher `Bash` → `pre-shell-check.cjs`、`Write\|Edit\|MultiEdit` → `pre-write-check.cjs`；command 用 `$CLAUDE_PROJECT_DIR`，timeout 单位秒；项目 settings/hooks 落盘后即时生效（本机实测 2026-11-11：写入后下一次工具调用即被拦截） | 接线自检 `check-local-gates.mjs` ⑩ advisory（2026-11-11 接入） |


### 6.5 CI 门禁面事实 (CI Gate Registry)
| 事实 | 口径 | 备注 |
|---|---|---|
| CI 触发 | trigger = main + develop，直推与 PR 共用 yml：条件同认 `Build.SourceBranch` 与 `System.PullRequest.TargetBranch`（旧版只认前者 → Build validation 检出的 `refs/pull/<id>/merge` 空跑） | 策略（Azure 侧）：main = 1 审阅人 + 4 人必审 + blocking Build validation(246)；develop Build validation `isEnabled=false`（10-26 关闭） |
| 三档门禁 | **轻（本地）** 提交 ~0.2s（台账按需 + 四守卫 0.3s + commit-check）；push 3.4s + 范围构建（集成按 `test-impact-map.json` 选测，共享层/工程文件/未映射回退全量）；lint/typecheck 只在 CI 中档。**中（PR/develop）** `--mid`：product + security，backend-test `--unit-only`。**重（PR/main）** `--full` 20 门（含集成） | 中/重前置见「CI agent 环境事实」行（`ci-assert-frontend-deps.mjs` 断言；CmdLine@1 `workingFolder`）；缺口：中档无引擎段→治理门靠 pre-push 与重档；`ciSummary` 现场解析 yml（`--check`） |
| 门禁增删史 | 单源 `mechanism-registry.md` | 运行面速查：pre-commit = 台账不变量 + local-pre-commit 四门 + commit-check（--no-build）；verify `--scope`（`ledger-invariant` 本地 loud-skip；门表恒 20，跳过随 `envSkips`/`scope.skipped` 留痕）。残留风险（仅人工）：本地提交零密钥对照、NuGet High/Moderate 存量、前端 lint 首曝在 PR→develop |
| 泳道 diff 面（2026-10-09 ai-native-review-p1） | verify.mjs 内 `lane-surface-ci` 门调 `check-lane-surface.mjs --ci`：合并提交（≥2 父）自动对第一父基准（Azure PR 检出形态）；TF_BUILD main 单亲直推核末笔（多提交直推仅末笔=残留面）；本地无基准 → advisory 跳过，预检传 `--base origin/main` | 判据：product 段命中须 diff 内协伴 L2+ 入口文档（状态不限）；engine 段 CI 不执法 |
| L2 触达面段协议 | lane-surfaces.txt 以 `## engine` / `## product` 分段：product = backend/shared 全模块 + API 横切根（Program.cs/ErrorHandling/JsonConverters）+ schema变更/数据修复 SQL，无活跃入口由关单/CI 的 lane-surface-ci 硬拦（2026-10-21 起提交钩子不再跑泳道脚本） | 面单单单源；内容级权威（取号/编码内嵌服务）不可路径表达，靠级别判定纪律 |
| 生效规则视图（2026-10-09 P2-5） | `workflow/effective-policy.md` 由 `gen-effective-policy.mjs` 自 policy.mjs 渲染；verify.mjs `effective-policy` 门 --check 防漂移（policy 变更须重生成随同提交） | 规则二分（存量豁免 vs 受管）的人读面 |
| 绿凭证摘要入库（2026-10-09 P2-3） | `workflow/verify-evidence.md` 由 `gen-verify-evidence.mjs` 渲染（本地 `verifications.jsonl` 按 headShort 去重）；非 CI 门 | 短 SHA = 验证时刻基线提交、非被测内容——关单先提交后跑门（2026-10-10 实证）；摘要追加保全（仓内既有 ∪ 本地绿行，同 SHA 取新 ts） |
| 专用测试库入口（`TEST_DB_CONN`） | 优先于 appsettings 的 DBConnParameter（TestDb.cs；Factory 同源）。库 = `Deve_CSS_SuHao`（同实例 `JCJS-DEVDB02`，2881 表/278.9 万行，无业务在用；结构 ⊇ YZGY，见 wiki 台账）。**dev = `DEVE_CSS_YZGY`**（业务/POC 唯一可操作库）。用法 `TEST_DB_CONN="<Server 同 appsettings>;Database=Deve_CSS_SuHao;…"`（口令不入库） | 未设/指向 dev = 写用例被 `TestDbWriteGuard` fail-loud 拦（`TEST_DB_ALLOW_DEV=1` 逃生）；回落时 stderr 报实际目标库（Server/Database，无口令）；集成单库串行（三分区已退役）；事务回滚不变 |
| 触达面闭集审计（2026-10-09 P3-2） | `lane-surface-audit.mjs` 无自动调用点（手动跑，advisory 恒 exit 0）：L2/L3 任务反复触及（≥3 不同文档）且 ERE 未命中的目录 → 候选漏登面清单 | 首跑实证已出真信号：frontend/src/utils（pagination/listUrlQuery 契约文件）未覆盖 |
| trust-mode 审计链（2026-10-09 P3-3） | 信任等级升降级记 `.agents/trust-mode-audit.jsonl`（本地追加式，行含前行 sha256；`trust-mode.mjs --verify` 校验链） | 不进 confirmations.jsonl（行协议钉死 workflow 四目录）；删整份=审计面全失的已知边界 |
| 台账特许修剪（2026-10-09） | `check-ledger-invariant` 认领携带 `.agents/config/ledger-prune-manifest.json`（逐行 sha256 + 家族清单 + 授权事由）的台账删行——所有者明令清理专用通道，无 manifest 的删改仍全拦；首次使用：AI-Native 引擎面 18 族文档删除随剪 65 行 | 被删行哈希随 manifest 入库可对质；delegations 历史行不随剪（量化历史） |
| 确认台账分片（2026-10-12 ledger-shard-default） | 确认行默认写 `.agents/confirmations.d/<doc 基名>.jsonl`（`confirm-doc.mjs`；`--no-shard` / `CONFIRM_SHARDED=0` 回退主台账 `.agents/confirmations.jsonl`）；读侧统一视图 = `ledger-loader.mjs loadAllConfirmations`（主台账 ∪ 全部分片，同 doc/stage/fingerprint 去重取末次；check-loop 15、stage-gates、gen-workflow-metrics 等消费方均走该视图） | 同 doc 两端并发由 `.gitattributes` `merge=jsonl-union` 取并集（本地须配 `merge.jsonl-union.driver`，`check-local-gates.mjs --fix` 一并修） |
| 分片不变量门（2026-10-12 ledger-shard-invariant） | `check-ledger-invariant.mjs` 校验面 = 主台账 ∪ 全部分片：逐文件追加前缀不变量 + 行级五项（ts 单调按**单文件**判——分片并发下全局单调不可满足也不必要）+「删片须已逐字归并同提交主台账」（compact-ledgers 形态）；主台账删除恒拦，合法删片形态不外溢 | `pre-commit` 触发条件同步扩到「主台账 ∪ 任一分片」。归并工具 `compact-ledgers.mjs`（里程碑/发布前可选） |

### 6.6 会话连续性事实 (Session Context & Compaction)
> 压缩 / 截断行为、上下文窗口上限、恢复手段等会话连续性事实**只登记本节**（环境事实单源纪律同 §6；2026-10-11 session-context 立节）。

| 事实 | 口径 | 备注 |
|---|---|---|
| 长会话自动压缩（zcode 宿主实测） | 对话超限时宿主自动摘要压缩，压缩后对话以摘要延续、**工作区文件不受影响**；恢复靠 plan 重入三锚（改动面 + 任务勾选态 + git status，见 `stages.md` Build §3 步骤 1「会话重入」），不靠对话记忆 | 2026-10-11 立；其他宿主（opencode/trae/codebuddy/omp）压缩行为未实测，遇到即登记本表 |

## 7. clone 必做配置机理（独立维护口径）


- **`git config core.hooksPath .githooks`**：仓库自带钩子不随 clone 传播，须本机挂载，否则全部门禁静默失效（2026-09-16 缺档事故实证）。
- **五钩子职责单源 = `.githooks/*` 头部注释**：pre-commit（台账不变量 + local-pre-commit + commit-check）；commit-msg（Conventional Commits 类型枚举 feat/fix/docs/style/refactor/perf/chore，真实 Merge/Revert 豁免）；pre-merge-commit（转发 pre-commit 按完整合并树编译，squash 由 pre-commit 探 SQUASH_MSG 走 `--full`）；pre-push（闭环断档 hard-block = hard 6 段）；post-commit（非阻断：kb-cache evict + 推送积压提醒）。
- **`git config merge.ours.driver true`**：让 `.gitattributes` 对 `appsettings.json` 的 `merge=ours` 生效；仅护 `git merge`——**`rebase` 时 ours=上游，本侧改动被静默丢弃**（实测 exit 0、无提示）；`cherry-pick` 冲突可见。
- **`git config merge.jsonl-union.driver "node .agents/scripts/git-merge-jsonl.mjs %O %A %B"`**（2026-10-10 并发台账防冲突）：让 `.gitattributes` 对 `.agents/*.jsonl`（`confirmations.jsonl` 等）的 `merge=jsonl-union` 生效；多人并发提 develop 或单人多 worktree 并行时，自动对尾部追加行取并集去重合并，彻底消除追加式日志文件的 Git 文本合并冲突。
- **钩子维护口径**：五钩子为本仓自有维护（agentic-flow-kit 依赖已移除），无 sync / 回哺 / doctor 概念；pre-push（hard 扫描）与 post-commit（积压提醒段）等本地增强直接改直接提交。引擎配置单源为 `.agents/config/engine.json`（policyVersion / 看板端口等）。
- **CI agent 环境事实（单源登记 2026-10-08；以 `azure-pipelines.yml` 为准）**：池 `JAMTC`（自托管 Windows）；Node 锚见 §6.2；前端依赖 `npm install --legacy-peer-deps --include=dev`（须 `NODE_ENV=development` + 清 `npm_config_omit`，否则少装 devDependencies → vitest/eslint 报「不是内部或外部命令」）；agent 与 dev 库同内网（`dotnet test` 可达 `DEVE_CSS_YZGY`）；观察项：Node 22 `spawnSync` EBUSY 若现，弃 NodeTool 改系统 Node 并回改锚。
