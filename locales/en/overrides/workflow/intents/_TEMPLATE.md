---
状态: draft
级别: L1
日期: YYYY-MM-DD
模块: <one of the vocabulary entries; see .agents/config/workflow-modules.txt>
备注: <optional free-text note; check-loop does not parse>
---
# INTENT — <topic>
<!-- Copy this template to YYYY-MM-DD-<topic>.md and fill it in; a same-named file under plans/ pairs with this file -->
<!-- frontmatter restricted subset (2026-09-13): one `key: value` per line; status ∈ draft/approved/done/superseded/cancelled (strict enum; put annotations in the note key); level ∈ L1/L2/L3; check-loop scans only frontmatter for machine fields, so do not repeat status/level lines in the body -->

## 背景与问题
<Why do this; state the requirement source (ticket / communication record / to-do item)>

## 目标
- <Verifiable goal>

## 非目标（L1 微改动无实质内容可删本节，不硬填）
- <What is explicitly out of scope, to prevent scope creep>

## 约束（L1 微改动无实质内容可删本节，不硬填）
- <What to reuse; what must not be touched>

## 影响面
- 模块：shared / material (Domain / Application / Infrastructure / API)
- 数据库：none / <table name> (schema changes → L3; runtime / pipeline structural surfaces without schema are also L3; for criteria see `.agents/commands/new-task.md` §level determination)
- 前端页面：<route or component; delete this line if none>

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）
- [ ] Application must not reference Infrastructure / DbContext (exemption only for native LINQ in the category tree)
- [ ] Code-generation logic (FormulaEngine / CategoryPrefix) → level at least L2
- [ ] Cross-caller contract changes (shared-layer base classes / DTO shape / interface signatures / existing parameter semantics / global response and pagination validation semantics) → level at least L2
- [ ] schema / migration SQL / DI chain → level L3
- [ ] Frontend: always Drawer / no a-select for large datasets / unified styles in style.css

> Touching any red line makes it L2 / L3. You must create ../specs/YYYY-MM-DD-<topic>.md explaining how it is satisfied before drafting a plan.

## 验收标准（可测试）
<!-- Give each item a stable ID A1..An (anchor coverageSince 2026-10-22; the spec confirmation gate checks coverage by ID); add/remove using new numbers, never reuse old ones. -->
- [ ] A1 <Each item must be testable; if you cannot write a testable criterion, it is not thought through yet>

> **Closed-loop reconciliation**: closeout happens in the test stage (not dependent on deploy). Before setting intent to done, check and verify each item, and append evidence after each checked item — `- [x] <criterion>（证据：<commit SHA / test case name / smoke script output>）`.
> A done intent with unchecked items is blocked by check-loop (new intents are hard-block since 2026-09-12; legacy intents only get a warning); checked items without "证据：" produce a warning.
