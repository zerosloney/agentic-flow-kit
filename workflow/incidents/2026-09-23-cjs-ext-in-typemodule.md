---
状态: closed
级别: L1
发现: 2026-09-23
模块: pipeline
备注: M4 自装 dogfooding 首个提交即被真钩子拦下所发现——e2e 临时仓库无 package.json 故未暴露。
---
# INCIDENT — CJS 语法脚本用 .js 扩展名，在 type:module 项目下崩溃

## 现象
自装仓库（`package.json` 含 `"type": "module"`）首次 commit 被 pre-commit 拦截：
`ReferenceError: require is not defined in ES module scope`（`.agents/hooks/commit-check.js:23`）。

## 根因
引擎与宿主层 5 份 CommonJS 脚本用 `.js` 扩展名：在无 `type` 声明的项目里 Node 默认按 CJS 解析（正常），但在 `"type": "module"` 的 Node 项目里 `.js` 按 ESM 解析——`require` 直接崩溃，门禁 fail-closed 拦截一切提交。受影响：commit-check、agg-delegations、trae 宿主 3 钩子（pre-shell-check / post-edit-check / resolve-shell）。

## 修复
- 扩展名消歧：5 份 `git mv` 改 `.cjs`（CJS 内容不动，`.cjs` 在任何 package.json 下都按 CJS 解析）；trae 内部 `require('./resolve-shell')` 显式写 `.cjs`。
- 引用点同步：`.githooks/pre-commit`（调用行+注释）、`src/doctor.mjs` 布局清单、模板 `AGENTS.md` / `workflow/README.md` / `workflow/delegations.md`、trae `hooks.json` 与 `agents/implementer.md`。
- 落地走双源纪律：改 `templates/`（包源）→ `flow-kit sync` 更新 `.agents/`（装副本）→ 手动删除 sync 报告的「包内已移除」旧 `.js`；本仓库 owned 文档（AGENTS.md / workflow 两份）手工同步改引。

## 验证
- 本仓库（type:module）真钩子 pre-commit 通过、commit 落库——即回归验证。
- `npm test` 7 套全绿（引擎套件不受改名影响，测试无对这两个脚本名的引用）。
