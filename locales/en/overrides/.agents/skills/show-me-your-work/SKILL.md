---
name: show-me-your-work
description: Decision trail for long/unattended runs — append-only TSV, one row per decision (what/why/evidence/result), evidence is pointers not paragraphs; use for overnight, multi-stage, or post-departure review.
---

# show-me-your-work — Decision trail

## Triggers

- Unattended / overnight / multi-stage long runs (`autonomous-run`, `pipeline-run`).
- The user says "I'm leaving / I'll trust it when I'm back / show me when it's done".
- Changes span multiple units and afterwards need a reviewable decision chain.

## Format

A single TSV, one row per decision. Keep cells single-line; evidence is a pointer, not a paragraph.

```
ts	phase	decision	why	evidence	result
```

- **ts**: ISO8601.
- **phase**: phase or workflow.
- **decision**: what was chosen/done, one line.
- **why**: the reason, in plain language; if it is principle-driven, say so plainly, do not pile on jargon.
- **evidence**: a provable pointer—commit SHA, PR number, `file:line`, artifact/trace/screenshot path. Paragraphs forbidden.
- **result**: the outcome or predicate state—`tests green` / `reverted` / `pixel-diff 0` / `INCONCLUSIVE` / `open`.

Template: `.agents/skills/show-me-your-work/references/decision-log-template.tsv`.

## Recording rules

- **append-only**: do not delete bad rows; append a supersede row; never edit/delete history.
- Record only decision points and checkpoints: which fork was chosen, unit completion and its verification result, pivot/revert and its trigger, exposed blockers, gates fixed. Do not record trivial actions.
- Loop runs: one row per round.
- One run = one agent session (including follow-up rounds). Takeover / switching sessions / a new chat = a new run; the first row's phase of a new run is `start`, and name this run in evidence (e.g., agent id).
- Prefer evidence produced by **committed scripts** over hand-rolled one-off commands ("raise the ladder before writing prose").

## Storage

- By default this is a work product, not committed: `decisions.tsv` or `.audit/<task-slug>.tsv`, kept outside git.
- Commit only when "the reviewer needs this trail to trust the result" (large changes / unattended / spanning multiple PRs).

## Wrap-up audit

Before handing back, reconcile against this run's transcript: does each row correspond to a real decision/action; can the evidence be resolved and does it prove that row; forks/pivots that affected work but were not recorded are gaps—add them. The audit does not change the story—supersede bad rows with a new row.

## Cross-model review

Before handing back, have a subagent on a **different model tier** read the trail + transcript and flag what the user should notice: weak/missing evidence, verification skipped or only verbal, decisions that look risky in hindsight, gaps a casual scan would miss. End the reply with an `Attention` section whose first line is `reviewed by <model>`; `No flags` is a legal value.

## Where it lives in this repo

- `autonomous-run`: add a "decision trail" clause when establishing the contract.
- `pipeline-run`: record one row per work-order sign-off.
- `workflow/delegations.md`: delegation results still go in the ledger; this TSV is the per-run decision chain and does not replace the ledger.
- Append a row: `node .agents/skills/show-me-your-work/scripts/decision-log.mjs <logfile> <phase> <decision> <why> <evidence> <result>` (auto ts, header on first use, sanitize tabs/newlines, escape a leading `=+-@`).
