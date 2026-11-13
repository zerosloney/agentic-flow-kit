---
name: papercut-fix
description: Fix a designated un-escalated papercut entry in workflow/papercuts.md (the loop executor that drives outstanding debt to 0). Locate the symptom by the line number given in the instruction/ledger, change the authoritative file per the "Planned fix" column, write back to the ledger, and run the verification gates; also used for mining recurring error classes and choosing an enforcement layer when the same mistake keeps recurring.
---

# papercut-fix — Single-papercut escalation executor

## Goal
Update the status of one designated papercut entry in `workflow/papercuts.md` to "debt cleared".

## Triggers
- User command: `跑一轮 papercut 回路` / `清 papercut 存量` / `修第 N 条 papercut`.
- User command: `跑一轮错题回路` / `同一类错又犯了` / `把这类错固化` → go through §0 first, then §1–§4 one entry at a time.

## 0. Recurring-error loop (batch mode, mutually exclusive with single-item mode)

Only treats mistakes that the **engine face** repeatedly makes (business-code debt follows the incident flow and does not enter this loop). Four sources, default window the last 3 calendar months:

| Source | How to read |
|---|---|
| `.agents/judgments.jsonl` | `flow-kit run agg-judgments.mjs --retire-candidates` (per-rule counts and candidates) |
| `workflow/delegations.md` | rework-reason enum distribution + monthly aggregate snapshot |
| `workflow/reviews.d/<YYYY-MM>.md` | per-comment accepted/rejected/false-positive, merged by root-cause direction |
| `workflow/incidents/` | root-cause enum (engine-face entries only) |

**Clustering threshold**: establish a rule only when the same error class occurs ≥3 times; for a single occurrence record only a papercut (if actionable) and do not establish a rule—avoid overfitting a single instance.

> Data-plane note: `judgments.jsonl` / `verifications.jsonl` are gitignored local runtime state; a fresh clone / new worktree may have only scattered rows. When a source is missing, use `delegations.md`, `reviews.d/`, `incidents/` as the basis; **do not fabricate an error class because a source is missing**; if there are fewer than 3 occurrences in the window, write "insufficient data" and do not establish a rule.

**Enforcement ladder** (choose the highest feasible layer; any downgrade must state why the higher layer is infeasible):

| Layer | Means | Infeasibility signal |
|---|---|---|
| 1 | Types / compile time (types, schema, enums, contracts) | Cannot express the constraint |
| 2 | Gate script or hook (check-loop segment, commit-check, verify gate) | False positives cannot be suppressed, or trigger frequency cannot sustain it |
| 3 | Automated test (dotnet test / vitest / engine `*.test.mjs`) | Environment unreachable, non-deterministic |
| 4 | Smoke script (`regression-smoke.mjs` script group) | Cannot assert (purely visual/interactive) |
| 5 | Command / skill / role text (prompt-only) | None (last resort) |

- Landing at layer 5: prefix the **symptom column** of the new row in `workflow/papercuts.d/` with `[prompt-only]`, carrying the debt until a later escalation.
- Landing at layer 2 with a new gate: must also register in `mechanism-registry.md` (including the retirement threshold) and obey the `rule-budgets.txt` one-in-one-out rule.
- Relation to existing conventions: rules 5/7 in `workflow/regression-checklist.md` are this ladder specialized for regression entries (layer 3–5 order + enforcer column); do not establish a second system.

**Output** (table first, then act): `error class | count | evidence location | current enforcer | gap | chosen layer | files to change`. After confirmation, enter §1–§4 one entry at a time; each round still handles only one.

## Constraints and red lines
- **Single target**: each execution handles only one target; do not opportunistically fix adjacent entries or bundle other changes.
- **Scope limit**: changes are limited to the documentation surface (`.agents/commands/`, `.agents/roles/`, `.agents/skills/`, `.githooks/`, `workflow/`).
- **Absolute no-go**: do not modify `backend/`, `frontend/`, `tests/`, `wiki/`, and do not connect to a database. Stop and report to the user when out of scope.
- **Verify before acting**: do not guess the current state from the ledger description. Read the authoritative file first to verify that the symptom holds.
- **Edit convention**: modify `workflow/` documents with `flow-kit run rewrite-file.mjs <file> --find <literal string> --replace <literal string>` (same as `stages.md` Build §4).
- **Debt-clearing criterion**: branch A (fix) and branch B (deferred/obsolete) **both** satisfy the `debt -1` invariant (debt = number of pending-fix
  rows in the ledger, manually counted: the touched row carries a terminal marker and no new pending row is added; the scheduled-debt sensor was retired 2026-11-08).

## Workflow

### 1. Locate and pre-check
- Extract from the given instruction: `line number` (Lxx), `location` (path), `symptom`, `planned fix`.
- Use the Read tool to read that line and its context.

### 2. Verify the current state
- Read the authoritative file specified in the "Location" column.
- **Verdict**:
    - **Defect still present** $\rightarrow$ enter branch A.
    - **Already obsolete** (fixed by another change / file deleted) $\rightarrow$ enter branch B.
    - **Opposite direction / description wrong** $\rightarrow$ re-characterize before executing.

### 3. Execute the fix
- **Branch A (defect still present)**:
    1. Apply a minimal fix to the authoritative file.
    2. Append to the end of that row in `workflow/papercuts.md`: `✅ 已升级修复(YYYY-MM-DD): <改动描述> <commit>`.
    3. If the original "Planned fix" description no longer applies, state the actual fix in the appended record.
- **Branch B (already obsolete)**:
    1. Append to the end of that row in `workflow/papercuts.md`: `⏸ 暂缓(YYYY-MM-DD): <失效理由>`. The reason must be explicit.
    2. **Verification discipline**:
        - Check user-level paths (`~/.workbuddy/skills/` etc.) to confirm whether the file was only migrated rather than deleted.
        - Distinguish "environment constraint" from "code defect".
        - For "cross-environment" symptoms, use `git worktree` to build a real checkout and run an experiment to falsify.
        - For "already landed" symptoms, use `git log -S` to trace the date of the introducing commit.
- **Branch C (out of bounds)**: stop execution, report the reason, and request authorization.

### 4. Verify and wrap up
- **Backup**: before modifying the ledger, force `cp workflow/papercuts.md tmp/papercuts.wip-backup.md`.
- **Run checks**:
    - The touched row already carries a terminal marker (`✅ 已升级修复` / `⏸ 暂缓`), and this round added no new pending row (`debt -1`, manually counted).
    - Check `workflow/papercuts.md` for total line count, column-count distribution, and any overly long rows (a line-compression signal).
- **Size check**: if `.agents/commands/` or the root `AGENTS.md` was modified, run `flow-kit run rule-budget.mjs --all` and use its exit code as authoritative.

## Reporting requirements
- Output per `references/response-template.md`.
- Include: line number, location, branch verdict (A/B/C), changed files, verification result (touched-row terminal marker / manually counted debt before and after), items awaiting decision.
- **Prohibition**: do not auto commit or push.
