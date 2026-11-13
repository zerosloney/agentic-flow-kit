---
description: pipeline-run automated driver entry — single command drives the six-stage closed loop (work-order protocol + machine gates + verbatim recording); mutually exclusive with manual stage routing, do not mix
stage: entry
triggers:
  - "pipeline-run"
  - "run the executor"
  - "run fully automated"
approval_required: true
fallback: the main agent personally fills the AI slot (work orders are completed by the main agent, with no dependency on subagents)
next: loop and advance to done according to the run's stop points
---

# pipeline-run · Fully Automated Closed-Loop Executor Entry

The stage machine is aligned with the commands manual. Mutually exclusive with manual stage routing; do not mix.

> **Reserved for later use**: currently zero runs (`cache/pipeline-runs/` empty) but not retired; before enabling, run a small task once to validate the state machine.

> **Division of labor**: deterministic parts are driven by the `pipeline-run.mjs` state machine (fill-* $\rightarrow$ confirm-doc $\rightarrow$ verify.mjs $\rightarrow$ git, all exit codes recorded); the AI slot executes per the work-order protocol; human gates stop on arrival and their words are recorded verbatim; the host must not change state on its own.

## 1. Protocol

**Input**: raw requirement text
**Process**:
1. **Start**: `flow-kit run pipeline-run.mjs start "<raw requirement text>"` (may pre-judge and add `--hint "kind=… level=… module=…"`)
2. **Loop reading stop points**: the last stdout line is the machine marker `PIPELINE-STOP <type> …` $\rightarrow$ branch by type:

| Stop type | Action | Re-run command |
|---|---|---|
| `work-order <runId> <work-order id>` | Read the full work order $\rightarrow$ **work by the order** (see the table below) | `next` (implement/fix requires `--files "a,b"`) |
| `await-confirm <runId> <doc>` | **Human gate**: relay key points and request confirmation $\rightarrow$ after the user gives the go-ahead | `next --delegated "<user's verbatim words>"` (verbatim words) |
| `gate-fail <runId> <stage>` | Read the problems reason $\rightarrow$ fix, then rerun the same path | `next` (no gate bypass / no `--no-verify`) |
| `done <runId>` | Report a summary (stage bar / gate count / commit chain) | Flow ends |
| `aborted <runId>` | Report the abort state and archive location | Flow ends |

### Work-Order Type Execution Matrix

| Work-order type | Execution requirement | Load on entry (coupled, see new-task §1c) |
|---|---|---|
| **triage** | Grade and backfill `next --triage "kind=… level=… module=… topic=<English kebab>"` (choose the higher level when unsure) | None; kb search same as new-task §L1 Fast Track step 2 |
| **draft** | Draft the specified document | intent→`grilling`; spec→`stages.md` Design §2 "Required Inputs" + `grilling` (branch comparison `arena`); plan→none |
| **implement / fix** | Implement per the authorized files $\rightarrow$ **stop on deviation** (public interface / unplanned files / new dependencies $\rightarrow$ stop and report, do not self-approve) | No mandatory skill; for fix-type with an unclear root cause, run `why` first |
| **review / closeout** | Produce per the order and write to the specified location (after review-only reporting, finish with `--done`) | review→`review-method` (high-risk diff +`interrogate`); closeout→`shipyard-workflow-closeout` (§0 closeout self-check) |

3. **Abort**: the user explicitly declines $\rightarrow$ `abort --run <id> --to superseded|cancelled --delegated "<verbatim words>"` (approved documents go through confirm-doc --to one by one)
4. **Observe** (optional): `status [--run <id>] [--json]` full event stream / `watch` terminal polling view

### Resume / Retry / Parallel Branches (R3-5)

- **Resume**: before running a gate the script marks the run `inFlight` and persists it. If the process is killed (CI timeout / interruption), `next` re-enters that gate automatically and `resume --run <id>` does it explicitly. Recovery records a `resume` event; `status` shows "↻ interrupted at …".
- **Retry**: `next --retry <0-5>` applies only to the verify gate; failures are re-run up to N times and each attempt records a `retry` event. Only after the budget is exhausted does it enter the fix loop / `gate-fail`; retries never skip the `--files` authorization check.
- **Parallel branches**: `next --parallel "check-a.mjs,check-b.mjs"` runs extra gates concurrently with `verify.mjs`; any non-zero makes the whole gate non-zero and events carry a `parallel` group id. Only gate script names are accepted (paths are rejected).
- **Stage artifact contracts**: `stageArtifacts` in `.agents/config/pipeline.json` declares products with `{entry}/{spec}/{plan}`; a missing or empty product stops with `gate-fail` before the gate runs (the template covers `spec-confirm` / `plan-confirm` / `verify` / `closeout`).
- **Resume idempotency**: if HEAD already carries the same subject, `docsCommit` does not commit again (a commit event with `resumed: true` is recorded).

## 🚫 Hard Discipline (violation breaks the protocol)

| Operation | Consequence / machine behavior | Exception |
|---|---|---|
| Directly modify workflow status | $\rightarrow$ bypasses the only migration entry (confirm-doc) | The host never edits frontmatter directly |
| Fabricate/reuse verbatim words | $\rightarrow$ exposed by cross-check against the ledger `confirmations.jsonl` | `--delegated` must be the current conversation's verbatim words |
| Advance while broken | Fix loop exceeds the limit (3 times), stop and hand over to a human | Do not close out while verify is not green |
| Write run files | $\rightarrow$ conflicts with machine facts | The host is read-only |
| Auto-approve human gates | `await-confirm` must relay key points and only `next --delegated` after receiving the user's verbatim go-ahead | Auto-triggering only means stage chaining and skill loading (new-task §1c coupling protocol); human gates are never crossed automatically |
