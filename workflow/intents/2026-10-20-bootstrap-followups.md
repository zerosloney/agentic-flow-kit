---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-20
模块: infra
确认指纹: b21f075dca062c23
---
# INTENT — 自举连带修复批（活文档门裸名误报 / S14 baseline / CI 台账基线）

## 背景与问题
自举关单环撞出三处连带：① 活文档一致性门把清单行文裸文件名（反引号内 tool.mjs 形态）误判为
仓库相对路径悬空引用——B 批门首拦实录即误报；② workflows-check S14 baseline 锚件数 ≥3 过期
（包源 workflows 目录演化后为 2 份可执行件）；③ CI 缺 LEDGER_HISTORY_BASELINE，重自举跨代
台账边界（上一代台账终结于 5ca9e8c）使历史全扫误红。

## 目标
- [x] 裸名不抓（提取路径须含分隔符），+1 断言钉住
- [x] S14 baseline 改锚 0 error 不锚件数
- [x] kit-ci env 持久化台账基线 5ca9e8c2

## 非目标
- 不改 append-only 红线与基线机制本身

## 约束
- 判据单源不动（check-regression-consistency.mjs 内修提取过滤）

## 影响面
- 模块：infra
- 数据库：无
- 前端页面：无

## 触达红线（对照 AGENTS.md）
- [ ] 规则 / 契约变更（门禁判据收窄——有实证误报）→ L2

## 验收标准（可测试）
- [x] consistency 套件 10 断言全绿（含裸名新断言）（证据：verify --doc 本单七门全绿，verify-evidence.md 绿凭证 2 行）
- [x] 本仓七门全绿（证据：verify --doc workflow/intents/2026-10-20-bootstrap-followups.md 🎉 全绿 7 项）
