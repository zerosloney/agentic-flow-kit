---
description: PR panel review — multiple subagents find bugs + independent voting + ledger
stage: review (cross-cutting)
triggers:
  - "review this PR"
  - "run the PR panel review"
  - "pr-review"
---

# PR Review · Panel Review

## Trigger Rules

If any one is met, run the panel review; if none are met, use the graded review in `.agents/commands/review.md`; do not run the panel:
- The diff touches a trust boundary / data surface / public contract
- Before merging to main
- Hard regressions requiring multi-lens cross-validation

## Flow

Script: `flow-kit run pr-review` (subcommand details via `--help`). Execute in order; do not skip steps:

1. `plan --base <ref> --head <ref>`; for high-risk quick checks add `--fast` (single-lens tier). Artifacts land in `.agents/tmp/pr-review/<runId>/` (run.json / briefs / tasks.json)
2. Dispatch finder / verifier subagents in parallel per `tasks.json`; role contracts in `.agents/roles/pr-finder.md`, `pr-verifier.md`, `pr-adjudicator.md`
3. Execute in order: `collect` → `verify` → `adjudicate` (escalated items) → `dispose` → `summary`

## Ledger

- Write the ledger artifact + a monthly line to `workflow/reviews.d/` (append-only).
- For PRs that have run a review, append one line to the PR Evidence: `面板评审：<runId>（Important n / Nit n / Pre-existing n）`.
