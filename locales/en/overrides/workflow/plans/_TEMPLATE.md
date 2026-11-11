---
状态: draft
级别: L1
日期: <YYYY-MM-DD creation date>
模块: <one of the vocabulary entries; see .agents/config/workflow-modules.txt>
---
# PLAN — <same topic as the entry document>
<!-- Pairs with the same-named entry document under intents/ or incidents/; L2/L3 must first have a confirmed ../specs/ spec with the same name; AI drafts it, and work starts after the user confirms in the conversation -->
<!-- frontmatter restricted subset (2026-09-13): status ∈ draft/approved/done/superseded/cancelled (strict enum; put annotations in the note key); level ∈ L1/L2/L3; do not repeat status/level lines in the body -->
<!-- L1 (2026-10-10): for new tickets use fill-plan.mjs --level L1; this file is the entry document and no separate intent is created. Sections: entry / change plan / constraints and risks / verification plan / acceptance criteria. The "change surface / verification method" sections retained below are the legacy minimal form; do not copy these two section titles for new tickets. -->
<!-- ambiguity discipline (2026-10-16): when drafting/revising, do not guess at ambiguities you cannot decide yourself (multiple interpretations / missing semantics / dependence on external facts) — insert [NEEDS CLARIFICATION]: <one-sentence question> in place in the relevant section and keep the document in draft while asking the user; after clarification, delete the marker and record the decision as body text. Markers must be cleared before approval (see workflow/README.md document protocol "explicit ambiguity blocking"). -->

对应入口：L1 = this plan. For fixes, also keep ../incidents/YYYY-MM-DD-<topic>.md. L2/L3 = ../intents/YYYY-MM-DD-<topic>.md
对应 spec：../specs/YYYY-MM-DD-<topic>.md (L2/L3 only)

## 改动面（L1 极简形态主节；L2/L3 可作任务拆解的汇总或删本节）
- <file/component>: <what to do; put criterion details directly in the item, e.g. "L771 message.success changed to 'Update succeeded'">
<!-- Backfill this section to disk after the change list in stages.md Build §2 is confirmed (conversation traces apply only to that session) — change surface + task checkbox state + git status = the three session-reentry anchors (2026-10-11 session-context) -->

## 任务拆解（L2/L3 必填；L1 仅多文件多步骤时用，单任务微改动删本节）
<!-- Tasks are checkbox state (2026-10-11 session-context): check off each item immediately when done and backfill the trace; when resuming after compaction / in a new session, first read this table's checkbox state + git status to rebuild progress; never backfill checkmarks from memory -->
<!-- Dependency rows (blocking edges, isomorphic to matt to-tickets): once blocking relations are declared explicitly, work may start as soon as "the tasks named in the dependency row are checked" — the task set with no unresolved blockers = frontier, which can be dispatched in parallel (multiple worktrees / delegate "new session + merge scope"); a purely sequential chain degrades the dependency row to "task N-1" at zero extra cost -->
- [ ] 1. <Task>
   - 判据：<what counts as done; preferably corresponds to one test or a reproducible operation>
   - 依赖：none (can start immediately) / blocked by task <N>
   - 风险：low / medium / high (<reason>)
   - 留痕：(backfill commit SHA / test name / measured output when checking off)
- [ ] 2. <Task>
   - 判据：…
   - 依赖：…
   - 风险：…
   - 留痕：…

## 执行顺序（L2/L3 必填；L1 单文件微改动删本节）
<1 → 2 → 3; when dependencies are already explicit in the "依赖" rows above, write only "see the task-breakdown dependency rows; frontier = tasks with no unresolved blockers"; for a purely sequential chain write 1 → N>

## 验证方式
- Build: <project build command> (+ <test command>)
- Frontend: cd frontend && npm run build (vue-tsc)
- UI: .agents/commands/stages.md Test chapter (required when page changes are involved; verify with headless Chrome)
- L2 additional: <contract / rule-surface comparison: coding-result sampling / API contract assertions / semantics reconciliation>
- L3 additional: <schema changes: execute after backup + rollback SQL are ready; runtime / pipeline only: fall back to the previous release tag + configuration-switch contingency>

## 确认与复核
> Confirmation = the user approves in one sentence in the conversation; after confirmation this plan moves `draft → approved` and this section is backfilled (the machine-visible state of the confirmation step); `done` appears only at closeout — jumping directly from `draft` to `done` is forbidden (2026-09-22 papercut).
- Confirmation result: approved (YYYY-MM-DD confirmed in the user conversation); done (YYYY-MM-DD closeout, set together with the entry document's terminal state)
- Confirmation-gate record: full plan draft reviewed + change list confirmed (`stages.md` Build two gates, one at a time, not merged)
