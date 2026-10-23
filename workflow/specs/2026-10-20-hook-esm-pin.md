---
状态: approved
级别: L2
模块: infra
确认指纹: 2723893ec95b420d
---
# SPEC — 钩子 ESM 作用域钉（type:module 仓修复）

对应入口：../intents/2026-10-20-hook-esm-pin.md

## 功能行为
`.githooks/` 与 `.agents/hooks/` 各置一份 `package.json`（`{"name":"...","private":true,"type":"commonjs"}`）。
Node 的模块格式解析按**最近 package.json** 逐级向上——仓库根标 `type:module` 时，这两个目录内的
无扩展名可执行件（pre-commit/pre-push/commit-msg/post-commit/pre-merge-commit、local-pre-commit）
被钉回 CommonJS，`require` 恢复可用。`.mjs`/`.cjs` 后缀件不受影响（显式后缀优先级更高）。

## 验收场景

### S1 ESM 标注仓钩子可执行
- GIVEN 仓库根 package.json 标注 `"type": "module"`，`.githooks/` 与 `.agents/hooks/` 各有钉子
- WHEN 执行 `node .githooks/pre-commit`（钩子内部 require）
- THEN 门禁序正常输出，无 `require is not defined in ES module scope`

### S2 无 type:module 的普通装户零变化
- GIVEN 装户仓库根无 type:module（既有大多数）
- WHEN init 安装钉子后执行钩子
- THEN 行为与安装前逐字一致（钉子只是显式化既有默认）

## 系统改动清单
- 后端：`templates/_githooks/package.json`、`templates/_agents/hooks/package.json`（产品模板新增）+ 本仓装户副本两份
- 数据库：无
- 前端：无

## 约束遵守映射（对照 AGENTS.md 触达红线 / 工程原则）

| 红线 / 工程原则 | 本 spec 如何满足 |
|------|------------------|
| 门禁系统执行语义变更（L2 触达面） | 钉子零代码变更、仅显式化 Node 默认解析；S1/S2 双态验证 |
| 简洁优先、直接用平台能力不另包一层 | 用 Node 官方的最近-package.json 作用域规则，不改一行钩子代码 |

## 验收判据

| 判据（可观察行为） | 证据（测试文件 / 命令 / 证据文件） | 状态 |
|---|---|---|
| S1 钩子在本仓正常执行无 ESM 崩溃 | `node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-20-hook-esm-pin.md` | 覆盖 |
| 钉子随模板下发（模板件在库、装户副本对齐） | templates/_githooks/package.json | 覆盖 |
| bootstrap 时序缝已留痕 papercuts | workflow/papercuts.d/2026-10.md | 覆盖 |

## 风险评估
- npm 对嵌套 package.json 的告警（无 name 字段会 WARN）｜ 应对：钉子带 name+private

## 确认与复核
- 确认结果 / 确认时间写在文件头 frontmatter；本节留叙述性复核记录。
