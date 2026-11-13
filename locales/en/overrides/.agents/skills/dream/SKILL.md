---
name: dream
description: "Offline Dreaming — periodic memory maintenance modeled on Anthropic's memory architecture: run the dream-run audit, read the report, delegate independent-reviewer to check AI Judge samples, write back papercuts/correction notes, and dispose of cold-data candidates; for use by the main agent when executing the Dreaming continuous-run loop within a session."
---

# dream — Offline Dreaming continuous-run loop

## Triggers

- A `[dream]` advisory appears post-commit (≥7 days since the last audit, or no report).
- A session-resume rebuild finds `tmp/dream-report-*.md` or `tmp/dream-judge-brief-*.md`.
- The user explicitly asks to "run the dream audit / Dreaming".

## 1. Run the audit

```bash
flow-kit run dream-run.mjs              # dry-run: read-only audit + AI sampling brief (default)
flow-kit run dream-run.mjs --execute    # execute safe fixes (terminal-state artifact archiving + index regeneration only)
```

- The report lands in `tmp/dream-report-<date>.md` (gitignored); the AI Judge brief lands in `tmp/dream-judge-brief-<date>.md`.
- `--execute` only performs "terminal-state artifact archiving + index regeneration" and rewrites no document content.
- Does not auto commit / push (root AGENTS.md prohibition).

## 2. Read the report

Read the latest `tmp/dream-report-*.md`, focusing on:

- A terminal-state artifact archiving (archive-sweep, 21-day window);
- B index drift and three-way wiki consistency;
- C full reconciliation (check-loop, hard 6 segments);
- D error-class candidates (agg-judgments --retire-candidates);
- E resident-surface budget (rule-budget --all);
- E2 cold-data candidates (agg-kb-usage --stale-days 90)—access/hit telemetry + confidence decay, see §5;
- F AI Judge sampling audit brief.

## 3. Verify AI Judge samples

1. Read `tmp/dream-judge-brief-*.md`;
2. Copy the "Judge delegation template" at the end of the brief to the independent-reviewer role for verification;
3. Handle the verification conclusion as BLOCK / WARN / OK:
   - **BLOCK**: correct the workflow document claims against the original evidence (do not auto-commit after the fix);
   - **WARN**: record a papercut or add evidence;
   - **OK**: no action.

## 4. Write back

- Error-class candidates: handle via the recurring-error loop in `.agents/skills/papercut-fix/SKILL.md` (≥3 occurrences → establish a rule; placement ladder: type→gate→test→smoke→prompt).
- Verification findings: correction notes / record in `workflow/papercuts.md`.

## 5. Dispose of cold-data candidates

- Cold-data candidates come from `agg-kb-usage.mjs` (telemetry basis: neither hit by kb-search nor content-updated in the last 90 days).
- Disposal ladder (adjudicated by the main agent/user):
  1. Archive: `flow-kit run archive-sweep.mjs --execute` (terminal-state artifacts, 21-day window);
  2. Update: update the knowledge via the wiki skill;
  3. Delete: **requires an explicit user instruction** (root AGENTS.md irreversible-operation red line).

## Red lines

- `--execute` only archives + regenerates indexes; it does not rewrite document body text.
- No auto commit / push; deleting wiki files requires an explicit user instruction.
- This skill is the execution loop: the AI performs judgment, and deterministic scripts only sample and collect evidence ("deterministic scripts own facts, the model owns judgment").