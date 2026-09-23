---
状态: approved
级别: L1
日期: 2026-09-23
模块: pipeline
备注: 2026-09-23 用户对话内确认推进 M5（含发布前清两笔账：cache 残留 + spec 模板 papercut）。npm 登录态缺失（ENEEDAUTH）——发布执行依赖用户 npm login，其余全部就绪。
---
# INTENT — M5：npm 发布（v0.2.0 首发）

## 背景与问题
- 包能力齐备（init/doctor/sync/add-host/add-gate，v0.2.0，143 例测试），但从未发布——`npx agentic-flow-kit` 不可用，分发依赖本地路径。
- 两笔发布前欠账：`templates/_agents/cache/kb-index.json` 为 v0.1.0 误提交的测试残留（跑测试即脏、会进 tarball）；spec 模板红线表残留 Shipyard 项目行（papercuts.md 在案）。

## 目标
- 清账①：`git rm` cache 残留 + 包仓 `.gitignore` 加 `templates/_agents/cache/`（测试产物不再进版本库与 tarball）。
- 清账②：`templates/workflow/specs/_TEMPLATE.md` 约束遵守映射表通用化（按项目 AGENTS.md 红线填的指引行，去 Shipyard 专行）；本仓 owned 装副本手工同步。
- 补 `LICENSE`（MIT，与 package.json 声明一致）。
- 发布验证：`npm pack --dry-run` 内容审查（bin/src/templates/modules/README/LICENSE，无 cache/无 workflow 留痕）；tarball 安装到临时目录冒烟（npx flow-kit doctor 全绿）。
- `npm publish`（公开 registry，包名已确认可用；执行需用户先 `npm login`）。

## 非目标
- 不动 src/ 实现与既有测试；不加 repository/author 字段（本仓无远程仓库，不造假——后续建远程后补）。
- 不做 npm CI/OSS 自动化（后续需要再立）。

## 影响面
- 模块：pipeline；改动：templates 两文件 + 包仓 .gitignore + 新增 LICENSE + workflow/ 留痕两份。
- 数据库：无；前端页面：无。

## 触达红线
- 不触及（模板文档内容修复走 papercut 升级路径；引擎逻辑零改动）。

## 验收标准（可测试）
- [ ] `git ls-files templates` 无 cache 文件；`.gitignore` 含 `templates/_agents/cache/`；npm pack 干跑清单无 cache、无 workflow/、无 .agents/
- [x] 模板红线通用化（grep 零残留）——范围较原验收略扩：intents/_TEMPLATE 影响面与红线节、new-task.md L2 触达面与先例行一并清理（同类残留一次清完）；本仓 owned 副本 cp 同步
- [x] LICENSE 存在且 package.json license=MIT（tarball 含 1.1kB LICENSE）
- [x] tarball 临时安装冒烟：npm install tgz → npx flow-kit version=0.2.0 / init → doctor 7 PASS 0 WARN
- [x] npm publish 成功（npmjs 公共 registry，账号 master0071，本机模式=token 全局 .npmrc + 显式 --registry，默认镜像 npmmirror 只读）；npm view = 0.2.0；真实 npx -y agentic-flow-kit@0.2.0 拉取冒烟（version/doctor）通过
