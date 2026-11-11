---
状态: open
级别: L1
发现: YYYY-MM-DD
来源: <self | user | test | monitor — who found it; see .agents/config/workflow-enums.txt incident.source.all>
影响环境: <dev | staging | prod | none — environment the defect reached; none = did not reach a runtime environment>
模块: <one of the vocabulary entries; see .agents/config/workflow-modules.txt>
---
# INCIDENT — <date topic>
<!-- Copy to YYYY-MM-DD-<topic>.md; record every functional defect found in production or during verification, and historical bugs may be backfilled -->
<!-- frontmatter restricted subset (2026-09-13): status ∈ open/fixed/closed (strict enum; put annotations in the note key); level ∈ L1/L2/L3; backfilled items from before the closed-loop engine was enabled add one line `流程: legacy` (exempt from level/pairing checks); do not repeat status/level/discovery lines in the body -->
<!-- attribution keys (mandatory for new items since incident-attribution 2026-10-11; check-loop check 24): legacy items before the anchor are not backfilled; "source" is the defect finder (enables machine recomputation of the source × environment cross-tab instead of per-item manual reading), and "impacted environment" records the environment actually reached (write none if none) -->

## 时间线
- <discovery → localization → mitigation → recovery, with timestamps>
- 用户确认：draft reviewed and passed (<date>)
<!-- The line above is a **machine prerequisite for drafting an L2/L3 spec** (validated by fill-spec / confirm-doc): it must be a line-start item inside the "时间线" section;
     accepted forms are `- 用户确认：…` / `- **用户确认**：…` / `- <date> 用户确认：…` (bold before/after the word and a date prefix are all fine);
     narrative prose in the body (e.g. "the user confirmed the plan") does not count as a trace. The form list lives inside this comment so the sample line does not contain descriptive text. -->

## 影响面
- <pages / APIs / data scope>

## 根因
<One sentence; put the deeper cause on a separate line>

## 为什么之前没拦住
<Check gates / tests / conventions one by one: which layer could have caught it>

## 复盘三件套（缺一不可）

> Purpose: make the incident genuinely feed back into Plan, so "prevent recurrence" commitments do not remain only in documents. Modules are rolling out gradually, so incidents may come from any of dev / staging / prod.

1. 结构性修复
   - Fix commit: <SHA + list of changed files>
   - Impacted environments: dev / staging / prod (for live modules affecting prod, include affected user count / duration / whether rolled back)
   - New intent needed:
     - Yes → ../intents/YYYY-MM-DD-<topic>.md (mandatory when the root cause is "missing gate / convention not implemented / systemic problem", even if the structural fix is already complete)
     - No → Reason: <the root cause is an implementation bug, the point fix is complete, and an existing convention entry covers it>

2. 防复发验证（必须落到自动化用例或回归清单条目，禁止只写「已人工验证」）
   - Automated test: tests/<test file> (<case name / count>)
   - Or test step: .agents/commands/stages.md Test chapter + <specific operation>
   - Or regression-checklist entry: workflow/regression-checklist.md (append one line under the recurrence-prevention verification section)

3. 规范条目（必须有可追溯的落点）
   - Landing point (multiple allowed): AGENTS.md <section> / .agents/hooks/<script> / .agents/skills/<skill> / .agents/commands/<cmd> / regression checklist §<section>
   - Reference: commit <SHA> / 文件:<path>#L<line>
   - If no new entry, reason: <covered by an existing entry; state its location>
