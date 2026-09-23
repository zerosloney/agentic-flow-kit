---
状态: approved
级别: L1
日期: 2026-09-24
模块: pipeline
备注: 与同名 intent 一同确认；按新移植口径（确认后立即 docs 提交留痕）单独提交 approved 状态。
---
# PLAN — Shipyard 引擎增量收包

## 改动面
- `templates/_agents/scripts/check-loop.sh`：检查 14 头注与体注加裁定演进两段（advisory 恒定 + 留痕必做）；循环体在 git log 判定前加「存量确认态豁免（」grep 出账行。
- `templates/AGENTS.md`：提交条目尾接「确认（approved）后立即 `docs(*)` 单独提交留痕」。
- `templates/_agents/commands/plan.md` / `design.md`：「确认后」节 `不单独 commit` → `立即 docs(workflow)/docs(design) 单独提交留痕`；`build.md` 第 4 步尾接同口径。
- 落地：`flow-kit sync`（managed 4 份）+ 本仓根 `AGENTS.md` 手工同步（owned）。
- 引用通用化：Shipyard 的「第 5 条 / §5」节号 → 「门禁与提交」节（包内无固定编号）。

## 验证方式
- `bash templates/_agents/scripts/check-loop.test.sh` 34 例 + `npm test` 7 套全绿。
- grep 断言：新口径关键词就位、旧口径「不单独 commit」清零。
- doctor 7 PASS；提交穿真钩子。
