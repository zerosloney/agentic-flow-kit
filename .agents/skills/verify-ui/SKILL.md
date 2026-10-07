---
name: verify-ui
description: 启动本地服务并用浏览器实测 UI 改动（只读验证、不留脏数据）；项目无测试基建时靠实测兜底。当用户要求"实测 / UI 验证 / 浏览器验证"时使用。
---

# verify-ui — UI 实测引导

无测试基建时，UI 改动必须浏览器实测。步骤：

## 1. 起服务

启动命令**不写死在本文件**（本文件是 managed 件，随包升级覆盖——项目特定值写这里会丢）：以 `.agents/notes/runtime-env.md`「本地端口与进程」节的记录为准；该节无记录时，先起服务并把命令补记进该文件再继续。

进程清单记进 `.agents/notes/runtime-env.md`，实测结束必须关闭。

## 2. 浏览器验证

- 优先 `browser` 工具；不可用时用 `.agents/scripts/e2e/harness.mjs`（如项目已装；封装 `launch`/`seedSession`/`goto`/`hardGoto`/`clickText`/`pressKey`/`ensureClean`/`screenshot` + 网络/控制台/toast 采集器）；自写脚本优先复用其常量与函数。
- 浏览器首选**较新的 Chromium 内核 headless**（如 Edge `--headless=new`）——旧版 Chrome 会把 antd 图标字体渲染成方框、表格 `waitFor` 超时（见下「浏览器选择」）。
- 登录态：先调 API 登录拿 token，注入前端约定的 localStorage 键，**并整页重载**让前端状态库重读 token（仅改 hash 的导航不重建文档，会被路由守卫弹回登录页）。
- 路由为 hash 模式时：`goto` 用 hash；深链接（query 变化）用 `hardGoto`（about:blank 中转强制新文档）。

## 3. 实测步骤

1. 打开目标页面，按改动点逐项操作：正常路径一条 + 失败路径一条（校验/空态/权限）。
2. 证据落盘：截图或关键控制台/网络报文，路径写在任务文档「验收标准」勾验项后。
3. **不留脏数据**：验证产生的临时数据当场删除或还原；清理**只按本次创建的 ID 精确删除**（ID 取自网络捕获的 POST 响应），**禁止按文案/字段模糊匹配**——模糊匹配会误删用户手建数据；清理脚本一律先备份再删；不确定可回滚的操作先停下问用户。

## 4. 收尾

- 关闭本次起动的全部进程（按 §1 清单逐个停）。
- 结论按「页面 / 步骤 / 期望 vs 实际 / 证据」回报；发现缺陷只记录定性，不修代码（修复走 build/maintain 流程）。

## 关键坑

- API 用 **HTTP** 避开自签证书问题（HTTPS 自签证书会让浏览器/脚本报错或需额外信任配置）。
- MCP 报「browser is already running」是残留实例占 MCP 专用 profile 锁（`~/.cache/chrome-devtools-mcp/`），清掉对应 chrome 进程重试即可，勿误判为 MCP 不可用。
- 布局类修复用 `getBoundingClientRect` 程序化检测，比截图肉眼更可靠。
- 后台任务生命周期不可依赖（实测可长可短）：长命服务一律独立进程起（如 PowerShell `Start-Process`）。
- 用 shell 工具起长命服务时**勿在命令末尾接管道**（`| tail` 等）——子进程继承 stdout 句柄会让命令永不返回，直到被工具超时杀掉（并可能连带杀掉服务）。

### 浏览器选择

- 旧版 Chrome（实测 83）内核太旧 → antd 图标字体全渲染成方框、表格 `waitFor` 超时。**优先较新的 Chromium 内核**（如 Edge `--headless=new`）；harness 的 `CHROME` 常量按本机实际安装路径改。

### antd 交互（JS `.click()` 不够）

- 按钮文本内含空格（`确 定` / `保 存` / `取 消`）→ 匹配须去空白，勿用 `innerText === '确定'`。
- Select / Picker / Dropdown 的 `.click()` 打不开弹层 → 须 `Input.dispatchMouseEvent`（mousedown+mouseup 序列）；普通按钮用 `clickText` 够用，弹层控件须补 `realClick`。
- `new KeyboardEvent('Escape')` 关不掉弹层 → 须 `Input.dispatchKeyEvent`（rawKeyDown+keyUp）。
- **关弹层慎用 Esc**：antd Drawer 同样响应 Esc，会连带关闭抽屉并 reset 表单（表现为「保存后列表无新行」，易误判为保存链路故障）——改点遮罩/关闭按钮。
- 表格行常无 `tr[data-row-key]` 属性 → 用 `.ant-table-tbody > tr.ant-table-row` + textContent 过滤业务键（如单号）定位行。
- 宽表 `:scroll="{x:N}"` 截图前把 `.ant-table-content` scrollLeft 置底，露出右侧列。
- 虚拟滚动下拉（a-select）DOM 只渲染约 10 个节点 → **勿按 DOM 节点数断言选项条数**，按接口响应条数断言。

### CDP 采集（SPA hash 导航不重建文档）

- Log/Console 采集不随导航重置 → 每次导航前重置采集器，防上一页错误泄漏成后续页面的「控制台错误」。
- toast 观察器须**导航前**安装；导航后装会漏首屏 toast。
- 首屏无 token 被路由守卫落登录页：写 localStorage 后仅 hash 变化的 `Page.navigate` 不整页重载、前端状态库仍持空 token → 须 `about:blank` 中转强制新文档，或写后 `Page.reload`。
- 同路由 hash query 变化不重挂载（`#/x?k=A` → `#/x?k=B`）→ 深链接用例走 `about:blank` 中转。
