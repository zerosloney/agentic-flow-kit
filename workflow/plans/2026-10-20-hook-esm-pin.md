---
状态: done
级别: L2
模块: infra
确认指纹: 2a626448bafafa3d
---
# PLAN — 钩子 ESM 作用域钉（type:module 仓修复）

## 改动方案
- `templates/_githooks/package.json`（新增）：`{"name":"agentic-flow-kit-hooks","private":true,"type":"commonjs"}` 作用域钉
- `templates/_agents/hooks/package.json`（新增）：同形态钉（罩 local-pre-commit）
- `.githooks/package.json`、`.agents/hooks/package.json`（装户副本，本仓）：镜像上两件
- `workflow/papercuts.d/2026-10.md`：bootstrap 时序缝 papercut 一行（经 ledger-shards 追加，已完成）

## 验收计划
`node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-20-hook-esm-pin.md`（七门全绿，含 spec 判据表收敛）

## 确认与复核
- 确认后补「确认结果 / 确认时间」；`done` 只在关单出现。
