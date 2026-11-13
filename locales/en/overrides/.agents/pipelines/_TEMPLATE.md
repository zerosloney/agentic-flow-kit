# Workflow Orchestration Mechanism — Orchestration Scripts + steps Extension Point

> The kit's cross-host orchestration mechanism: orchestration scripts under `.agents/pipelines/` carry the orchestration semantics (dependency layering / parallelism / retries / gates / user confirmation gates / run journal). **Host AI loads them automatically through the persistent AGENTS.md instructions and executes them according to the semantics** — hosts with subagents fan out in parallel, those without do the work sequentially; acceptance stays the same. Zero host protocol adaptation: the mechanism relies only on the four capabilities shared by all hosts (read AGENTS.md, read repository files, run terminal commands, subagents).

## Auto-load (persistent AGENTS.md instruction)

> Multi-work-package orchestration — when the user wants to run orchestration, or a plan executes multiple work packages: read the orchestration scripts under `.agents/pipelines/` and execute them according to this document's semantics; custom steps live in `steps/`.

## Orchestration script (`.agents/pipelines/<topic>.md`)

frontmatter (`name` / `description` / `concurrency`, default 2) + a stages table (the `human` column is optional — omit it when no confirmation gate is used, keeping 9 columns):

```md
---
name: Parallel fix two domains
description: Backend + frontend implemented in parallel → converge and pass tests → deploy verification (step) → independent review
concurrency: 2
---
| id | after | role | step | task / params | files (authorization) | accept (acceptance criteria) | gate | human | retries |
|----|-------|------|------|---------------|--------------|-------------------|------|-------|---------|
| backend | — | implementer | — | Implement backend X | src/api/** | Project tests pass | | | 1 |
| frontend | — | implementer | — | Change frontend Y | web/** | Build passes | | | 0 |
| gate-all | backend,frontend | — | — | — | — | — | flow-kit run verify.mjs | | |
| confirm-deploy | gate-all | — | — | Confirm within the user conversation that staging deployment is allowed | — | One-line "OK" | | User confirmation | |
| deploy-check | confirm-deploy | — | Deploy verification | env=staging | | Deploy command exit 0 | | | 0 |
| review | deploy-check | independent-reviewer | — | Review changes in both domains | | Conforms to plan and criteria | | | 0 |
```

**Four stage forms** (mutually exclusive; fill exactly one):

| Form | Criterion | Execution |
|------|------|------|
| role dispatch row | `role` non-empty | Dispatch a subagent (`task` goal / `files` authorization list / `accept` acceptance criteria are written into the dispatch header + red-line row) |
| step row | `step` non-empty | Host AI reads `steps/<step>.md` and executes per its guidance; the `task / params` columns pass arguments |
| gate row | `gate` non-empty (role/step/human empty) | Terminal runs the command; non-zero aborts |
| human confirmation gate row | `human` non-empty (all other form columns empty) | Host AI **stops and asks the user** (`task` column = what to ask, `accept` column = pass criteria); only after passing are the next layers dispatched; rejection → abort with summary. **Does not dispatch a subagent** (enforces "subagents do not cross confirmation gates" at the machine-criteria level, replacing the earlier style where role rows disguised confirmation gates) |

**Orchestration semantics** (execution standard, identical across hosts): empty `after` = layer 0; a layer is dispatched only when all stages in the layer it depends on are ok; within a layer, batch by `concurrency` — hosts with subagents fan out in parallel, those without do the work sequentially (acceptance criteria unchanged); failure with `retries` > 0 → re-dispatch (fresh context); retry limit exceeded / non-zero gate / human rejection → abort subsequent stages and summarize the failed items in a report. Human rows have no retry semantics (retries treated as 0).

**run journal** (resume from checkpoint and retry accounting): each stage records one line as soon as each attempt produces a result (pass / fail / blocked); after an abort, inspect status first on rerun — stages already marked pass are not rerun, and execution resumes from the ready layer:

```bash
flow-kit run wf-journal.mjs add --wf <orchestration-name> --stage <id> --status pass --form human   # fail/blocked use the same form; --form ∈ role|step|gate|human
flow-kit run wf-journal.mjs status --wf <orchestration-name>                                        # done / ready (including retry-ready×N) / pending
```

The journal is written to `.agents/cache/orchestration-runs.jsonl` (local runtime state, discardable; multiple lines for the same run and stage take effect by the last one, attempts are counted automatically; `--new-run` starts a new round).

## steps extension point (`.agents/pipelines/steps/<name>.md`)

The extension mechanism defined by the kit: the filename is the step name (the steps directory is the registry); projects register their own domain actions (deployment / migration / audit reporting…) and reference them in orchestration script step rows to use them.

```md
---
params: env (target environment); timeout-min (optional, default 10)
---
# Step — Deploy Verification

1. Run terminal command: `npm run deploy -- --env <env>`; non-zero means the step fails and reports the tail of stderr
2. Run smoke check: `curl -fsS https://<env>.example.com/healthz`
3. Report: deployed version number + smoke result
```

- frontmatter `params`: parameter conventions (free text listing names and meanings); callers pass arguments in the orchestration script's `task / params` columns (`k=v`, multiple separated by spaces).
- Body: execution guidance (numbered steps) — may direct commands, subagents, and check actions; step failures are retried according to the orchestration script row's `retries`.

## Discipline (read first)

- **The declaration may be executed only after the plan is confirmed**: an orchestration script is the executor for plan task breakdown and must be reviewed in full together with the plan draft.
- Subagents do not cross confirmation gates and do not commit / push (dispatch red-line row: modify only authorized files; missing input or need to deviate → `BLOCKER:` stop). Confirmation gates are always expressed as human-form rows; never dispatch a subagent to act on the user's behalf.
- Convergence review: after a dispatch returns, verify the diff against the authorized file scope (same standard as the delegation convention in the Build chapter of stages.md); on BLOCKER, stop and await disposition.
- **Three run journal rules**: ① record one line via `wf-journal.mjs add` whenever each stage attempt produces a result (including retries and human gate conclusions); ② after an abort, run `status` first on rerun — stages already pass are not rerun, resume from the ready layer; ③ at wrap-up, the run's status summary may be pasted into `workflow/delegations.md` for the record (the aggregation script does not read the journal).
- **The journal is self-reported state, not verified state**: the run journal is recorded by the executor (host AI) itself — guarantees for concurrency / retry / resume semantics depend on bookkeeping discipline; the orchestration layer has no runtime dispatcher to enforce it (wf-run is deprecated; execution follows this mechanism document's semantics); when resuming after an abort, humans retain the right to manually verify "already pass" conclusions (audit-gate-hardening boundary statement).
- Record keeping: after each dispatch / step stage completes, append one line to the delegation results table in `workflow/delegations.md` (`一次通过` / `返工×N` / `返工待修`, aligned with the agg-delegations.mjs standard).
- Parsing validation comes first (machine gate): `flow-kit run workflows-check.mjs` — role ∈ `.agents/roles/`, step ∈ `steps/`, after references exist and are acyclic, exactly one of the four forms is filled, retries/concurrency values are valid; any failure → reject, do not execute.
