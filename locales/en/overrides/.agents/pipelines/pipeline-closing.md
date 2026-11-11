---
name: pipeline-closing
description: Rollout stage closing loop — for L1, draft only one plan → confirm within the user conversation → implement per the plan's change surface → 2 static gates → closeout record (plan → done). L2/L3 still dual-write intent + spec + plan. Reusable for this project's L1 rollout stages (new tooling / minor changes / protocol fixes)
concurrency: 2
---
# workflow — pipeline-closing (6-stage rollout closing loop)

> Codify the standard cadence of 5 already-closed rollout stages (E/A/D/C/F/B) into a reusable orchestration. Stages use three forms — role dispatch / gate terminal / human confirmation gate — without introducing new steps (`_TEMPLATE.md` parsing validation requires `step ∈ steps/`; new steps are left for subsequent project registration).

| id | after | role | step | task / params | files (authorization) | accept (acceptance criteria) | gate | human | retries |
|----|-------|------|------|---------------|--------------|-------------------|------|-------|---------|
| author | — | implementer | — | Draft one L1 plan (fill-plan.mjs --level L1 + AI fills it in), status draft. Do not create a separate intent | workflow/plans/<date>-<topic>.md | plan contains entry point / change approach / constraints and risks / verification plan / acceptance criteria, status draft | | | 1 |
| gate-doc | author | — | — | — | — | — | node .agents/scripts/workflows-check.mjs | | |
| confirm | gate-doc | — | — | Review the full plan draft, one "OK" within the user conversation → plan status draft → approved + backfill the `「确认与复核」` section | — | plan status approved + "Confirmation result: approved (YYYY-MM-DD confirmed within user conversation)" | | User confirmation (plan confirmation gate) | |
| plan-commit | confirm | implementer | — | Commit the plan initiation commit (docs(workflow)) | workflow/plans/, workflow/INDEX.md | pre-commit hooks all pass; commit message contains a summary of the plan's change surface | | | 0 |
| build | plan-commit | implementer | — | Execute per plan `§改动面` | see plan | all plan change surface completed | | | 1 |
| gate-test | build | — | — | — | — | — | project test command (must be all green) | | |
| gate-loop | build | — | — | — | — | — | node .agents/scripts/check-loop.mjs (EXIT=0 and no HARD-BLOCK) | | |
| feat-commit | gate-test,gate-loop | implementer | — | Commit feat commit (feat(module-name)) | all changed files in the workspace | pre-commit hooks all pass; commit message contains a summary of the build change surface | | | 0 |
| closeout | feat-commit | implementer | — | Tick plan acceptance + plan → done + closeout docs commit for the record; sync INDEX.md (if applicable) | workflow/plans/<date>-<topic>.md, workflow/INDEX.md | plan status done; acceptance checklist contains commit SHA evidence | | | 0 |

**Orchestration semantics**: layer 0 author → layer 1 gate-doc + confirm (confirm is the human confirmation gate form — the host AI stops and asks the user; no subagent is dispatched; only after passing are the next layers dispatched) → layer 2 plan-commit → layer 3 build → layer 4 two static gates (parallel fan-out) → layer 5 feat-commit → layer 6 closeout. Failure with retries > 0 → re-dispatch (fresh context); non-zero gate / human rejection → abort subsequent stages and summarize the failed items in a report. Record each stage attempt result via `wf-journal.mjs add`; when resuming after an abort, run `wf-journal.mjs status --wf pipeline-closing` first (stages already pass are not rerun).

**Discipline** (read first):
- The declaration may be executed only after the plan is confirmed — this workflow is the executor for plan task breakdown; the plan draft is confirmed within the user conversation first.
- Subagents do not cross confirmation gates and do not commit / push (dispatch red-line row: modify only authorized files; missing input or need to deviate → `BLOCKER:` stop). Confirmation gates are always expressed as human-form rows (the confirm row is one), and a subagent must never act on the user's behalf.
- Record keeping: after each dispatch stage completes, append one line to the delegation results table in `workflow/delegations.md` (`一次通过` / `返工×N` / `返工待修`).
- Parsing validation comes first (machine gate `node .agents/scripts/workflows-check.mjs`): role ∈ `.agents/roles/`, after references exist and are acyclic, exactly one of the four forms is filled — any failure → reject, do not execute.
