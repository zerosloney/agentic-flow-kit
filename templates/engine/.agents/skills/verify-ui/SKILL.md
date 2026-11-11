---
name: verify-ui
description: UI 改动实测（只读验证、不留脏数据）。第一选择 chrome-devtools MCP：take_snapshot 探形 + 单步驱动 + 截图取证；harness .mjs 脚本只作回归/无人值守的降级路径，降级须在实测报告记一行原因。
---

# verify-ui — UI 实测引导

## 分工
- 本文件只载方法（环境 / 选点 / 证据 / 清理）；执行契约（环境安全 / 禁自修 / HALT 礼仪 / 交付物形态）单源在 `.agents/roles/ui-verifier.md`。
- 委派子代理以契约为准；主智能体自测按本文件执行。

## 触发条件
- 用户要求：`实测` / `UI 验证` / `浏览器验证`。

## 工具路径优先级
- 交互式 UI 实测默认走 chrome-devtools MCP：浏览器实例全程复用；先 `take_snapshot` 探形，再单步驱动、局部重试。
- harness 脚本只用于：回归 / 防复发资产；批量断言汇总 + 退出码门禁（`makeRecorder`）；无人值守 / 流水线批次。
- 降级阶梯（2026-11-04 立，2026-11-11 修订）：chrome-devtools MCP 是第一选择，harness 探针只是降级路径。**宿主无 chrome-devtools 工具（MCP 未安装 / 未连接）**：有人值守时 HALT 并提示用户安装 / 启用 chrome-devtools MCP，不自动降级（探针太慢）；无人值守 / 过夜批次才直接降级 harness headless 探针。**MCP 已装但不通**（浏览器起不来且按 runtime-env §6.4 处置后仍失败 / 关键步骤被 MCP 报错阻断）：降级 harness headless 探针。凡降级须在实测报告记一行「降级原因」——无降级原因的探针实测 = 路径违规，报告不收口。
- 脚本技术细节单源 = `scripts/verify/e2e/harness.mjs`（导出清单：`grep '^export' scripts/verify/e2e/harness.mjs`）；写脚本 import 其导出，禁手写等价逻辑。

### 能力映射（harness ↔ MCP）

| 目标 | MCP | harness |
|---|---|---|
| 会话播种 | API 取 token → `evaluate_script` 写 `auth_token` / `auth_user` → `navigate_page reload` | `getToken` + `seedSession` |
| 导航 / 等待 | `navigate_page` + `wait_for` | `goto` / `hardGoto` / `reload` |
| 探形 | `take_snapshot`（a11y 树 + uid） | `inventory` / 一次性探针 |
| 驱动 | `click` / `fill` / `press_key` | `clickText` / `setInput` / `pressKey` |
| 网络采集 | `list_network_requests` | `installNetCapture` + `apiCalls` |
| 控制台采集 | `list_console_messages` | `installConsoleCapture` + `consoleErrors` |
| 度量 / 截图 | `evaluate_script` / `take_screenshot` | `ctx.evaluate` / `ctx.screenshot` |

### 会话与采集规则（两路径同口径）
- 注入前先到达 FE origin；同文档 hash 切换不重载文档，播种后必须整页 reload。
- 缺省身份 = 所播 token 的 JWT claims；仅测「与 token 不同身份」才手工播种 `auth_user`（取登录响应的 `jobNo` / `displayName` / `dept`）。
- 合成 JWT 只适用于零授权 API 调用的页面：`exp = Math.floor(Date.now()/1000) + 1800`，禁写远期；注入后经 about:blank 中转再硬导航。
- 页面发出带 token 的 API 且 401 即被清会话弹回 `/login`：有真实数据依赖走账号池登录（账号池单源 `.agents/notes/runtime-env.md` §6.1a）。
- 请求计数剔除 OPTIONS 预检；断言取数以接口响应为准，禁数 DOM（虚拟滚动 / 虚拟列只渲染可视窗口）。
- 断「控制台零错误」前先滤应用自身噪声（AG Grid license banner、API 未起的 Network Error）；过滤按内容特征，禁用 `^` 行首锚。

### MCP 会话差异
- MCP 用持久 profile（跨轮保留 localStorage）：先清 localStorage 再播种，或 `new_page` 传 `isolatedContext`。
- 报「The browser is already running for …chrome-profile」→ 按命令行含 `chrome-devtools-mcp` 杀残留进程（处置登记 runtime-env §6.4）。
- `take_screenshot` 的 `filePath` 受 MCP 工作区白名单限制（部分宿主连仓库路径与会话目录全拒，2026-10-31 实测）：落盘被拒时不反复试路径，改**无 `filePath` 内联截图**留档；证据效力以 `.md` 报告的 DOM/接口断言为准（spec 验收判据本就不认图片路径）。
- `upload_file` 触发 `input[type=file]` 时仓库/会话路径同样可被白名单全拒（2026-11-07 实测）：不试路径，改页面内注入——临时只读 HTTP 服务（如 `npx serve` 随机口）伺服夹具，`evaluate_script` fetch 成 File 塞 `DataTransfer` 再 `dispatchEvent(new Event('change', {bubbles:true}))` 给 antd 上传 input；注入前 `modalCount` 记 1 防旧弹窗 DOM 残留错位（MTO 弹窗关闭后残留曾致 PML 注入错位，reload 清残留）。验证：上传项 tag/预览接口收到文件行数与夹具行数一致。

## 工作流

### 1. 环境准备
- 按 `.agents/notes/runtime-env.md` 启动 API / 前端；记录所有启动进程。
- 多 worktree 并行：设 `SHIPYARD_SLOT` 使 API / 前端 / CDP 三组端口整体偏移（端口字面量单源 `scripts/verify/e2e/ports.mjs`，端口表见 runtime-env §6.1b）。
- 仅 harness / 降级路径自建浏览器：较新 Chromium 内核 headless（如 Edge `--headless=new`）；MCP 路径浏览器实例由 MCP 自管，禁手动另起。
- 长命服务以独立进程启动（如 PowerShell `Start-Process`）；启动命令末尾禁接管道。

### 2. 执行验证
- 选点取特性地图（`features/`）；至少各执行一条正常路径与一条失败 / 边界路径（校验 / 空态 / 权限）。
- 导航：hash 模式用 `goto`；深链接（Query 变化）用 `hardGoto`（about:blank 中转）。
- 弹窗内分页表格的数据条件断言：点 `.ant-pagination-item` 逐页扫全量后合并断言，禁只看首屏。
- 布局类断言先探真实 DOM（快照 / 探针读 `outerHTML` + `getComputedStyle`），禁从 CSS 源码反推期望值；拿不准用与规范数值解耦的不变量，规范对账降为 NOTE。
- 证据采集：截图、网络报文、控制台日志；路径记入任务文档「验收标准」项后。

### 3. 清理收尾
- 按 POST 响应返回的 ID 精确删除临时数据；禁模糊匹配删除。
- 关闭本流程启动的所有进程。
- 按 `页面 / 步骤 / 期望 vs 实际 / 证据` 汇报；末行附「特性地图覆盖 M/N」（M = 本次覆盖特性数，N = `features/` 条目总数），未覆盖项逐一留名。
- 仅记录缺陷，禁直接修代码。
- UI 实测报告写 `workflow/evidence/<YYYY-MM-DD>-<主题>.md`：头部记环境 / 复现命令，断言表每行带「对应验收 An」列（形态对照 `workflow/evidence/2026-10-24-purchase-contract-template-print-ui.md`）。报告留在会话或 `tmp/` = 实测未收口。

## 特性地图（features/）
- `features/` 每核心特性一文件，四段缺一不建：到达路径 / 驱动 / 可观察终态 / Gotchas。
- 实测与关单抽验按地图取覆盖面；当前覆盖面以 `features/` 目录为准。
- 新页面或新主链上线时同步建文件；以 `frontend/src/router/index.ts` 路由为源波次：路由有、地图无 = 待补；地图有、路由无 = 待删或改写。
- 覆盖缺口 / 骨架：`node .agents/skills/verify-ui/scripts/gen-verify-feature.mjs --check`（或 `--json`）列未覆盖路由；`--route <path>` 只写四段 H2 + TODO 骨架，禁编造驱动步骤。
- 月度漂移维护：① 取路由 / 组件近月 diff 作源波次；② 只对触及特性跑一次实测；③ 修正最多一笔提交。
- 每个失败先判定「地图漂移」或「代码缺陷」：前者改地图，后者进 incident，禁混写。
- 前置条件缺失 → 按失败记录并把原因写进该特性 Gotchas；禁为通过而弱化验证路径。
- 发现页面 / 行为与地图不符 → 先修地图再出结论。
- 关单前置跑 `check-regression-consistency.mjs`：地图引用的 `#/路由` / `frontend/src/*` / `workflow/*.md` / `scripts/verify/*.mjs` 悬空即红；代码符号悬空只 advisory。

## 技术要求与约束

### Shell 与进程
- 协议优先 HTTP，避免自签证书拦截。
- 「部分改动生效」→ 重启 dev server；单文件未生效而他文件正常 → 先 touch 该文件。
- 探针必打本 worktree 的 dev server：vite 端口被占会静默漂移——起服务后确认实际端口，用 `E2E_FE_URL=http://localhost:<实际端口>` 运行；登录页导航用同一 `FE`（localStorage 按 origin 隔离）。
- 输出截断用 `| tail -N`，禁 `| head -N`（SIGPIPE 在 finally 前终止进程，残留浏览器占 CDP 端口）。
- 每次导航前重置 Console / Log 采集器；toast 观察器在导航动作前安装。
- 实测脚本三件套缺一不可：`installNetCapture(ctx)`、`seedSession(token, { reload: true })`、`hardGoto(url)`。
- 探针主体包 `try { … } finally { await ctx.close?.() }`；脚本启动前按 `--remote-debugging-port=<port>` 杀残留进程自愈。
- 用 `harness.dbQuery` 前先确认 database-explorer 技能在本机可用；不连库也能立的判据优先。

### 断言汇总
- 断言主体包 try/catch：catch 里追加一条失败断言（含错误信息）并计入汇总，退出码随之为 1；禁「跑一半 + 打印 GREEN + 退出码 0」。

### DOM 定位与交互
- 覆盖层 / 抽屉 / 弹窗内表单定位一律限定覆盖层根（如 `.pml-detail .ant-form-item`），禁全局 `querySelector` / `querySelectorAll`。
- 按 placeholder 找输入框须限定在目标容器内。
- 文本比较两侧都 `.replace(/\s+/g,'')` 归一（antd 对两字中文按钮插空格）。
- 可见性判据用 `getClientRects().length > 0` 或 `getBoundingClientRect().width > 0`；禁用 `offsetParent`（`position: fixed` 祖先下恒为 null）。
- `a-select` 清除图标悬停才渲染：先派发 mouseenter / mouseover，等一拍再点。
- antd 分页 size-changer 下拉合成事件开不了（focus + 派发 keydown Enter 亦不稳）：真实路径 = click 工具点 combobox uid；量测用不变量「每选项 `scrollWidth <= clientWidth+1` 且下拉宽 ≥ 最宽选项 scrollWidth」，下拉动画未收尾会量到 0 尺寸，等 ≥600ms 再量（2026-11-06 PML 分页实测）。
- 弹窗内小控件（如分页器）被身后大表挤出 a11y 快照（输出超限截断取不到 uid）：临时对背景表容器 `setAttribute('aria-hidden','e2e-hide')` 缩树，取 uid 完成真实点击后移除属性；注意别把弹窗自己的表一并隐掉（2026-11-06 PML 实测）。
- `a-select` 合成事件选不中 → 走真实鼠标 + 键盘：CDP `Input.dispatchMouseEvent` 点开，`ArrowDown` + `Enter` 落选；多 select 之间先 `Escape` 关上一个下拉；选项查询限定可见下拉（`.ant-select-dropdown:not(.ant-select-dropdown-hidden)`）的最后一个。
- 分段 / 单选 / tabs 按渲染形态定位（如 `.ant-radio-button-wrapper`），勿只找 `<button>`。
- 表格选择态：清空遗留勾选按 `data-row-key` 去重逐行点击，且与后续勾选分两拍执行；表头全选框在半选 / 无选态点击是「全选」而非「清空」。
- `:scroll={y}` 的 antd 表格 tbody 首行是 `.ant-table-measure-row`（高 0、无 `ant-table-cell` 类）：行高 / 单元格度量跳过它。
- `ctx.evaluate` 返回已是对象，禁再套 `JSON.parse`。
- 详情覆盖层的「返回」类按钮走 `history.back()`：实测点它会退到上一步甚至 `about:blank`（2026-11-03 采购订单详情实测踩中）——回列表改用刷新或直接重导航，禁点「返回」当关闭动作。
- 断言前先确认覆盖层内容已渲染（头部按钮组出现）：并行会话新建的单据可能详情拉不出，覆盖层只剩「返回」按钮（2026-11-03 实测）——换已知样本单，勿据此判功能缺陷。

### AG Grid 列表页
- 单元格开销 32px（padding 15×2 + 边框 2），非 16 / 24。
- 量宽用隐藏 DOM span（复制 `font` / `letter-spacing`），禁 canvas；定宽 `ceil10(max(列头需求, 内容 p90 需求) + 32 + 8)`，离群值交 `tooltipShowMode:'whenTruncated'`。
- 判截断直接比 `.ag-cell` 的 `scrollWidth > clientWidth`；量横向溢出用 `.ag-center-cols-viewport`，勿量 `.ag-body-viewport`。
- 列虚拟化下视口外列不在 DOM：`.ag-header-cell` 计数 ≠ 列总数。
- 空值经 `valueFormatter` 渲染成字面 `-`：按单元格判空须显式排除 `'-'`。
