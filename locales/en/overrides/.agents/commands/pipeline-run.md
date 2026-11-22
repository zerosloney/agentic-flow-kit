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

> **Battle-tested 2026-11-18**; cold-start self-healing: fresh installs without commits have engine-generated files under controlled exemption; clean zero-commit workspaces can run directly.

> **Division of labor**: deterministic parts are driven by the `pipeline-run.mjs` state machine (fill-* $\rightarrow$ confirm-doc $\rightarrow$ verify.mjs $\rightarrow$ git, all exit codes recorded); the AI slot executes per the work-order protocol; human gates stop on arrival and their words are recorded verbatim; the host must not change state on its own.
> **Artifact directory**: pipeline artifacts are collected into `workflow/tasks/<date>-<topic>/` (`intent.md`/`incident.md`/`spec.md`/`plan.md`), isolated from the manual path (`intents/`, `plans/`, `specs/`) — manual scanners do not scan `tasks/`; the two document families never interfere.

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

> CI red and PR conflicts add no new stop type: they always go through the existing `gate-fail` / `await-confirm` stops; `tfs-pr checks` is a read-only locating aid only and takes no part in gates; automatic merge and automatic force push are forbidden.

### Work-Order Type Execution Matrix

| Work-order type | Execution requirement | Load on entry (coupled, see new-task §1c) |
|---|---|---|
| **triage** | Backfill `next --triage "kind=… level=… module=… topic=<English kebab>"`. A closed-set term requires that level. Too low stops. | Do not load a skill. |
| **draft** | Draft the specified document | Load the same `new-task.md` §1c row (with `wayfinder` decision map): intent→Plan, spec→Design, plan→Build. |
| **implement / fix** | Edit only paths listed in the plan change section. `--files` must match git status. Paths outside the plan stop at `await-confirm`. Do not self-approve. | Load the same `new-task.md` §1c row: implement→Build, fix→Maintain. |
| **review / closeout** | Produce per the order and write to the specified location (after review-only reporting, finish with `--done`) | Load the same `new-task.md` §1c row: review→Review, closeout→Test. |

3. **Abort**: the user explicitly declines $\rightarrow$ `abort --run <id> --to superseded|cancelled --delegated "<verbatim words>"` (approved documents go through confirm-doc --to one by one)
4. **Observe** (optional): `status [--run <id>] [--json]` full event stream / `watch` (or `dashboard`) TUI view / `inspect [target]` terminal artifact view

### Terminal Artifact Inspection and TUI Dashboard Integration (inspect / dashboard -v)

- **Terminal Artifact Inspection (`inspect [target]`)**: Formatted preview of workflow artifacts, work-orders, gate failures, or risk reports:
  - `inspect`: Smart inspect of current core artifact or work order; `--json` outputs raw structure;
  - `inspect intent|spec|plan|api`: Inspect specific intent, spec, plan, or API contracts;
  - `inspect work-order` (or `wo`): Inspect current work order details and failure logs;
  - `inspect problems`: Inspect gate failure reasons; `inspect risk`: Inspect risk intercept report;
  - `inspect <path>`: Direct formatted preview for any relative Markdown file (e.g. `workflow/intents/risk-intercept.md`).
- **TUI Dashboard Shortcuts (`dashboard` / `watch`)**:
  - `V` toggles between stage flow and artifact inspect view; `W` jumps to work-order; `P` jumps to gate failures;
  - In inspect view: `1-5`/`Tab` cycles artifact tabs, `▲/▼`/`j/k` scrolls content, `Esc`/`B` returns to main dashboard.

### Single-Step Debugging and Gate Isolation (--step / gate / --gate)

- **Single-Step Debugging (`--step`)**: Pauses at stage transition boundaries (`PIPELINE-STOP step <runId> <stage>`, exit 0) for inspecting documents before entering next stage; rerun `next --step` to keep single-stepping, or `next` to resume full speed.
- **Standalone Gate Debugging (`gate <script.mjs>`)**: Executes a single gate script directly on the current run (`flow-kit run pipeline-run.mjs gate <script.mjs> [--run <id>] [--retry <0-5>]`), recording debug events without altering stage routing.
- **Targeted Gate Re-run (`next --gate <script.mjs>`)**: Selectively runs a specific gate in the verify stage; `--interactive-gate` prints diagnostic prompts during verification.

### Resume / Retry / Parallel Branches (R3-5)

- **Resume**: before running a gate the script marks the run `inFlight` and persists it. If the process is killed (CI timeout / interruption), `next` re-enters that gate automatically and `resume --run <id>` does it explicitly. Recovery records a `resume` event; `status` shows "↻ interrupted at …".
- **Retry**: `next --retry <0-5>` applies only to the verify gate; failures are re-run up to N times and each attempt records a `retry` event. Only after the budget is exhausted does it enter the fix loop / `gate-fail`; retries never skip the `--files` authorization check.
- **Parallel branches**: `next --parallel "check-a.mjs,check-b.mjs"` runs extra gates concurrently with `verify.mjs`; any non-zero makes the whole gate non-zero and events carry a `parallel` group id. Only gate script names are accepted (paths are rejected).
- **Stage artifact contracts**: `stageArtifacts` in `.agents/config/pipeline.json` declares products with `{entry}/{spec}/{plan}`; a missing or empty product stops with `gate-fail` before the gate runs (the template covers `spec-confirm` / `plan-confirm` / `verify` / `closeout`). A declarative `{apiDocs}` placeholder expands to `api.md` in the task directory (not declared by default — projects touching API contract surfaces can add it); once declared it applies to all kinds for the whole run (fix/verify short paths also check it — unlike `{plan}`, which is skipped when absent for the flow).
- **Resume idempotency**: if HEAD already carries the same subject, `docsCommit` does not commit again (a commit event with `resumed: true` is recorded).

### Failure routing / task state (R6-1 / R6-2)

- **Failure routing table**: `onFail` in `.agents/config/pipeline.json` declares `{to, retry}` per stage (`verify → fix`, `retry: 3`). Undeclared stages stop in place with `gate-fail`. Contract failures and verify-only short paths do not consume the budget.
- **Task state**: the run file records `retries` and `nextTarget`. While stopped, `stage` stays at the failure point; `next` re-enters from `nextTarget`. Routing emits a `route` event and resume emits a `resume` event (with artifact checklist).
- **Smart Fix Attribution**: On gate failure or routing to `fix`, the executor automatically attributes errors into six categories (tests, rule budget, scope deviation, missing artifacts, policy drift, lint format), attaching targeted fix advice, impacted files, and debug commands (e.g. `next --gate <gate.mjs>`).

### Review Downgrade and Work-Order Context Budget

- **Review Downgrade**: In `spec-review` and `review` stages, the executor parses review metadata (reviewer ID, model, and downgrade declaration). If an external model is unavailable or exhausted, declare a downgrade in the document (e.g. `跨模型降级: <reason>`) or run CLI `next --review-downgrade "<reason>"`. The executor records a `review-downgrade` event and highlights the warning on the dashboard without blocking the pipeline.
- **Context Budgeting**: Work-order dispatch automatically prunes context against `workOrderContextBudgetChars` (default 1200) from `.agents/config/dispatch.json`: dedupes `relatedDocs` (top 4), trims `kbHits` (top 3, max 120 chars each), collapses `stderrTail` (top 3 and bottom 5 lines, max 400 chars), and attaches a `budget` metrics section.

## 🚫 Hard Discipline (violation breaks the protocol)

| Operation | Consequence / machine behavior | Exception |
|---|---|---|
| Directly modify workflow status | $\rightarrow$ bypasses the only migration entry (confirm-doc) | The host never edits frontmatter directly |
| Fabricate/reuse verbatim words | $\rightarrow$ exposed by cross-check against the ledger `confirmations.jsonl` | `--delegated` must be the current conversation's verbatim words |
| Advance while broken | Failures reach the `onFail` budget (verify defaults to 3), stop and hand over to a human | Do not close out while verify is not green |
| Write run files | $\rightarrow$ conflicts with machine facts | The host is read-only |
| Auto-approve human gates | `await-confirm` must relay key points and only `next --delegated` after receiving the user's verbatim go-ahead | Auto-triggering only means stage chaining and skill loading (new-task §1c coupling protocol); human gates are never crossed automatically |
