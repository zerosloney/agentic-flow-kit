---
状态: approved
级别: L1
日期: 2026-09-23
模块: pipeline
备注: 同名 incident 的配对 plan（闭环配对门禁要求）；方案与验证详见 incident 文档。
---
# PLAN — CJS 扩展名消歧（.js → .cjs）

## 改动面
- `git mv` 5 份 CJS 脚本改 `.cjs`：templates 的 commit-check / agg-delegations，trae 宿主的 pre-shell-check / post-edit-check / resolve-shell（内容零改动，纯改名）。
- 引用点同步：`templates/_githooks/pre-commit`（调用行 + 注释）、`src/doctor.mjs` 布局清单、模板 `AGENTS.md` / `workflow/README.md` / `workflow/delegations.md`、trae `hooks.json` / `agents/implementer.md`、trae 钩子内部 `require('./resolve-shell.cjs')` 显式扩展名。
- 装副本落地：`flow-kit sync`（覆盖 pre-commit、新增两个 .cjs）+ 手删 sync 报告的两个旧 .js + 本仓库 owned 文档手工改引。

## 验证方式
- 本仓库（type:module）真钩子 pre-commit 通过且 commit 落库（即回归验证：改名前 require 崩溃拦截）。
- `npm test` 7 套全绿；残留引用全仓 grep 为空。
