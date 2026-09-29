---
状态: approved
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 intent。开工句「WP-A 与 WP-B 开干」只授权实现。
确认指纹: 9079562ff167f7e4
---
# INTENT — 技术栈构建门认脚本、帮助文本列全门禁

## 背景与问题

`init --stack node` 把 `npm run build` 写进提交门，没有 `scripts.build` 的仓库每次暂存 JS 都会被拦住。`init --stack python` 把 `python -m pytest` 放进 `builds`，和「测试不放提交门」的口径相反。`flow-kit --help` 仍写 add-gate 当前只有 dotnet-ca，目录里已经有四套门禁。

## 目标

- node 栈的构建门只在 `package.json` 的 `scripts.build` 为非空字符串时执行，否则 SKIP 且退出码 0。
- python 栈的提交门不再运行 pytest；lint 仍只在 ruff 配置存在时执行。
- `flow-kit --help` 列出 `modules/gates/` 下的全部目录名。
- 已有的 `when` 文件存在性判断保持原行为。

## 非目标

- 不改写已装项目里 owned 的 `commit-check.config.json`（sync 不覆盖）。
- 不把 pytest 从 settings.json 的 allow 里删掉（test 阶段仍要能跑测试）。
- 不改 dotnet / go 栈的构建命令。

## 约束

- `when` 是 commit-check 与四套技术栈配置共用的契约，本变更定 L2。
- 引擎脚本改 `templates/_agents/`，再经 sync 回装副本，不手工双写。
- 零新增运行时依赖。

## 影响面

- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2

## 验收标准（可测试）

- [ ] 临时目录 `init --stack node` 且没有 `scripts.build`，暂存一个 `.js` 后 `commit-check` 输出 SKIP 且退出码 0
- [ ] 同一钩子在 `scripts.build` 为非空字符串时执行构建命令
- [ ] 临时目录 `init --stack python`，暂存 `.py` 后 `commit-check` 输出不含 pytest
- [ ] `flow-kit --help` 同时含 dotnet-ca、node-layer、py-import、generated-readonly
- [ ] 已有 `when` 文件不存在则跳过、存在则执行的用例仍通过
