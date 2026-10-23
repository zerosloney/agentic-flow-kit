---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-20
模块: infra
备注: bootstrap 后续——钩子 ESM 作用域钉 + bootstrap 时序缝 papercut 留痕
确认指纹: 579a59d2117beb5b
---
# INTENT — 钩子 ESM 作用域钉（type:module 仓修复）

## 背景与问题
本仓自举（982d8fa）后首个受治提交暴露：仓库根 `package.json` 标注 `"type": "module"` 时，Node 把
无扩展名的 git 钩子（`.githooks/pre-commit` 等）与 `.agents/hooks/local-pre-commit` 按 ESM 解析，
其 CommonJS `require` 直接 ReferenceError——本地门在 ESM 标注的装户仓全部失效（静默：钩子非零
退出被 git 视为 hook failure，但门禁逻辑一行未跑）。普通装户（无 type:module）不触发，属潜伏缺陷。

## 目标
- [x] `.githooks/` 与 `.agents/hooks/` 各下发 `package.json`（`{"type":"commonjs"}` 作用域钉），钩子在 ESM 标注仓正常执行（证据：本仓 bootstrap 后受治提交过钩子）
- [x] 产品模板同步（templates/_githooks/ + templates/_agents/hooks/），未来装户 init 即带钉（证据：模板文件在库）
- [x] bootstrap 时序缝 papercut 留痕（workflow/papercuts.d/2026-10.md）

## 非目标
- 不改钩子本体代码（作用域钉零代码变更）
- 不处理 `.mjs` 钩子化方案（更大的判据面变更，另行立项）

## 约束
- 复用既有安装面：钉子经 templates/ 目录遍历自动进 managed 清单，无 init/同步代码改动

## 影响面
- 模块：infra
- 数据库：无
- 前端页面：无

## 触达红线（对照 AGENTS.md）
- [ ] 规则 / 契约变更（门禁系统执行语义——钩子模块格式作用域）→ L2

## 验收标准（可测试）
- [x] 本仓受治提交通过 pre-commit（泳道完整性 C 检查有活跃 L2 入口覆盖）（证据：提交 8187d68 过泳道 C + 索引漂移两道增量门；verify 绿凭证 verify-evidence.md 2026-10-20 行）
- [x] `node .githooks/pre-commit` 在本仓不再 ReferenceError（证据：pre-commit 门禁序完整执行至逐项裁决，无 ESM 崩溃；verify --doc 本单七门全绿）
