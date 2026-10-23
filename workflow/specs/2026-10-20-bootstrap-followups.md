---
状态: approved
级别: L2
模块: infra
确认指纹: f31a31f5085f7434
---
# SPEC — 自举连带修复批

对应入口：../intents/2026-10-20-bootstrap-followups.md

## 功能行为
① 提取过滤：路径不含 `/` 即弃——行文裸文件名（反引号/引号内 tool.mjs 形态）是高误报面
（可能指任意目录、脚本同级或纯举例）；仓库相对路径判据须含路径分隔符（源仓「刻意不含裸
标识符」同判据哲学）。② S14 baseline：锚「全量 errorCount===0 且 files≥1」，不锚件数
（件数随包源 workflows/ 目录演化）。③ kit-ci 持久化 `LEDGER_HISTORY_BASELINE: "5ca9e8c2"`。

## 验收场景

### S1 裸名不抓
- GIVEN 清单行文含反引号内裸文件名
- WHEN extractRefs
- THEN codePaths 为空（不判悬空）

## 系统改动清单
- 后端：check-regression-consistency.mjs（提取过滤）+ 其 test（断言）；workflows-check.test.mjs（S14 锚）；.github/workflows/kit-ci.yml（env）；engine-lock（--update --note）
- 数据库：无
- 前端：无

## 约束遵守映射（对照 AGENTS.md 触达红线 / 工程原则）

| 红线 / 工程原则 | 本 spec 如何满足 |
|------|------------------|
| 门禁判据变更（L2 触达面） | 收窄有实证误报（自举首拦实录）；三断言测试钉住；append-only 红线不动 |

## 验收判据

| 判据（可观察行为） | 证据（测试文件 / 命令 / 证据文件） | 状态 |
|---|---|---|
| consistency 套件全绿（含裸名断言） | npm test | 覆盖 |
| 本仓七门全绿 | node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-20-bootstrap-followups.md | 覆盖 |

## 风险评估
- 判据收窄漏检真悬空裸名 ｜ 应对：清单规范引用带路径（regression-checklist 维护规则 7 执法者列写全路径）

## 确认与复核
- 确认结果 / 确认时间写在文件头 frontmatter。
