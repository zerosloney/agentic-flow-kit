---
状态: closed
级别: L1
发现: 2026-09-23
模块: pipeline
备注: M4 自装 dogfooding 首个提交即被真钩子拦下所发现——e2e 临时仓库无 package.json 故未暴露。
---
# INCIDENT — CJS 语法脚本用 .js 扩展名，在 type:module 项目下崩溃

## 时间线
- 2026-09-23：M4 自装后首次 commit 被 pre-commit 拦截（require is not defined in ES module scope，`.agents/hooks/commit-check`（时为 .js 扩展名）第 23 行）
- 同日：全仓排查同类 → 5 份 CJS `.js` 定位 → 改 `.cjs` + 引用点同步 → `flow-kit sync` 落地装副本 → 真钩子通过、commit 落库

## 影响面
- 所有 `"type": "module"` 的 Node 项目装包后门禁崩溃、提交被阻（fail-closed，不丢数据但完全不可用）；无 `type` 声明的项目（dotnet/python/go/普通 JS）不受影响

## 根因
CJS 语法的引擎脚本用了依赖解析上下文的 `.js` 扩展名；e2e 临时仓库没有 package.json，从未在 type:module 环境下验证过门禁链。

## 为什么之前没拦住
- e2e 用临时裸 git 仓库，无 package.json——验证环境单一性盲区；dogfooding（真装到 type:module 的本仓库）第一次暴露。

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：6829585（`git mv` 5 份 `.js`→`.cjs`；引用点：`templates/_githooks/pre-commit`、`src/doctor.mjs`、模板 `AGENTS.md`/`workflow/README.md`/`workflow/delegations.md`、trae `hooks.json`/`agents/implementer.md`/钩子内 `require('./resolve-shell.cjs')`；装副本经 `flow-kit sync` 落地）
   - 影响环境：dev（包尚未发布，无 staging/prod 用户）
   - 是否需要新 intent：
     - 否 → 理由：根因属实现缺陷（扩展名选择），单点修复已完成且覆盖全仓 5 份；无门禁缺位（门禁本身 fail-closed 行为正确）

2. 防复发验证（必须落到自动化用例或回归清单条目，禁止只写「已人工验证」）
   - 回归清单条目：workflow/regression-checklist.md（防复发验证节已追加）
   - 常驻哨兵：本仓库自身即 type:module + 真钩子常开——每份提交都重跑 `commit-check.cjs`，同类回归会在 commit 时直接崩回可见

3. 规范条目（必须有可追溯的落点）
   - 落点：AGENTS.md「引擎双源纪律」条目（改 templates → sync，保证包源修复可达装户）
   - 引用：commit 6829585 / AGENTS.md「项目适配区」
   - 新增约定：包内新增脚本一律用无歧义扩展名（CJS→`.cjs`、ESM→`.mjs`；`.js` 仅用于与目标项目 type 无关的场景）
