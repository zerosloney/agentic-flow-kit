---
状态: done
级别: L1
日期: 2026-09-24
模块: pipeline
备注: 需求来源：2026-09-24 用户指出「ensure-board.ps1 只支持 Windows，Linux/macOS 没法用」。定性：看板拉起入口跨平台化——node 零依赖单入口取代 ps1，探活身份/陈旧判定改为服务端自报（pid/startedAt），彻底摆脱 OS 专属 API。属上一任务（board-port-autodetect）的直接延续，L1。
---

# INTENT — 看板拉起入口跨平台化（ensure-board.mjs 取代 ps1）

## 背景与问题
看板编排入口 `ensure-board.ps1` 依赖 PowerShell 与 Windows 专属 API（`Get-NetTCPConnection` 拿端口属主 PID、`Get-Process` 拿进程启动时间），Linux/macOS 完全无法使用。而本包所有逻辑脚本均为零依赖 node（node ≥18 是硬前提），且「端口属主 PID / 进程启动时间」在 POSIX 上各发行版命令不一——真正根因是这两项信息本可由看板服务端自己在 `/api/board` 里自报。

## 目标
- 新增 `ensure-board.mjs`（跨平台单入口）：完整继承 ps1 语义——基端口（`--port` 显式 > kit.json `boardPort` > 8933）上探 10 端口窗口、root 比对识别本项目、旧代码自动 kill 重启、全新启动弹浏览器、输出实际链接；不碰任何 OS 专属 API（端口探活 net.connect、身份/陈旧用 `/api/board` 自报 `pid`/`startedAt`）
- `workflow-board-server.mjs` 的 `/api/board` 响应增加 `pid` + `startedAt`（加法字段，前端与旧启动器不受影响）；旧版服务端（无 `startedAt`）被识别时提示手动重启、不误动
- 删除 `templates/_agents/scripts/ensure-board.ps1`（被 mjs 取代，逻辑双份维护是长期负债）；文档口径统一切到 `node .agents/scripts/ensure-board.mjs`

## 非目标
- 不做 ensure-board 的单元测试（纯 I/O 编排：端口/进程/浏览器，实测六态覆盖优于 mock 单测；与 ps1 时期口径一致）
- 不改 server 直跑入口与参数面；不动 `/api/board` 既有字段语义
- 不追平 ps1 输出里的占用者进程名（跨平台拿不到，报 pid 即可）

## 约束
- 零依赖纪律：仅 node 内置模块（net/fs/path/url/child_process）
- 弹浏览器为 best-effort（win: cmd start / mac: open / linux: xdg-open），失败不打扰
- 同机无法真实验证 Linux/macOS：以纯可移植 API + Windows 实测兜底，报告如实标注

## 影响面
- 模块：pipeline
- 数据库：无

## 验收标准（可测试）
- [x] 全新启动：基端口段首个空闲端口起服务，输出实际链接，`/api/board` 含新增 `pid`/`startedAt` 且 `root` 为本项目（证据：8933 被他项目看板占用跳过后 `fresh start -> http://127.0.0.1:8934`；接口返回 `root=E:\Demo\cli-tools\agentic-flow-kit pid=70980 startedAt=1790252726157 cards=39`）
- [x] 幂等复用：二跑 already up-to-date（root + startedAt 判新）（证据：输出 `board: already up-to-date at http://127.0.0.1:8934 (pid 70980)`）
- [x] 他项目看板占用：跳过不 kill，上探下一端口（证据：8933 为 `E:\Git\Shipyard.Material` 看板 pid 26460——输出「跳过：端口 8933（pid 未知）」（旧版服务端无自报，预期口径）→ 8934 起本项目；事后 26460 alive=True）
- [x] 非看板占用：跳过不 kill，上探下一端口（证据：dummy http server 占 9000 → `--port 9000` 输出跳过 → `fresh start -> http://127.0.0.1:9001`）
- [x] 旧代码重启：代码文件 mtime 晚于 `startedAt` 时同端口 kill+重启（证据：间隔超 2s 容差后 touch index.html → `restarted (stale code detected) -> http://127.0.0.1:8934`，pid 70980 → 39560）
- [x] `npm test` 全绿；sync 后装副本 ps1 被移除、mjs 就位、台账无漂移（证据：npm test 合计 PASS 34 / FAIL 0；sync「新增安装 ensure-board.mjs + 包内已移除 ensure-board.ps1」，盘上旧 ps1 已删；doctor 8 PASS / 0 WARN / 0 FAIL；check-loop exit 0）
