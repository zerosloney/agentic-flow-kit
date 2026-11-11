# Ordering Red Line: Classify First → Three-Piece Set → Confirm → Then Act

Source: the 2026-11-03 process-inversion incident (incident `workflow/incidents/2026-11-03-po-pml-outbound-guards.md`; same-day entry in `workflow/papercuts.md`). `new-task.md` keeps only a one-line pointer on its first screen; the body details live here.

## Rules

1. **Before acting**, run the two-question classification in `new-task.md` §1 (structural surface → L3; contract or shared convention → L2; neither → L1). When multiple defects are reported at once, **classify each item and take the highest**.
2. If L2 / L3 is hit: first land a document in `workflow/incidents/` (defect type) or `workflow/intents/`, then `spec`, then `plan`, and **only after `confirm-doc` passes for each document in turn may code be changed**. L1 must also have a plan first (with explicit criteria).
3. **No "change first, document later"**: the confirmation gate means "the plan the user approved must exist before the implementation". Backfilling documents afterwards cannot restore the time order = bypassing the confirmation gate; if it happens, it must be registered in both the incident's "gate-failure analysis" section and `workflow/papercuts.md`, and called out in the commit message.
4. When classification is uncertain, default to **treating it as one level higher and documenting first**; do not write code first and backfill the level afterwards.

## Why the document-status gate cannot stop this, and which gate can now

- The level is a judgment, not a machine-detectable signal: the same change may be a "purely additive read-only field" (L1) or a "tightening of existing semantics" (L2), and a hook cannot infer the level from the diff.
- The confirmation fingerprint validates only document status and the commitment surface, not the order of occurrence. If `confirm-doc` is called after implementation, the document gate still passes.
- The machine signal for order is at commit time: `.agents/hooks/check-confirm-order.mjs` (invoked by `.githooks/commit-msg` since the 2026-11-08 tier 2-D — pre-commit cannot read the commit message; merge skipping is instead detected by the script probing the `MERGE_HEAD` status file). Staged `backend/` source, `frontend/src` vue/ts, `tests/**/*.cs`, and data-maintenance SQL must each appear in the body of a `workflow/plans/` document whose **status is approved**, or hit an exemption: (1) the L0 lane (message body contains a non-empty `L0:` line and ≤3 product files); (2) a coverage plan staged in the same batch (L1 single commit; `done` is also acceptable). A **historical** plan marked `done` does not count as coverage; `draft` does not either. squash, rebase, and cherry-pick skip this.
- Classification itself still rests with the executor. If "change first, document later" bypasses this gate (paths not written into the plan, or commits not going through the git hook), it is still double-registered in incident + papercuts.

## Reproduction trace (2026-11-03)

- The implementation commit `302226b8` preceded the three-piece-set backfill in `83b7015f`; nothing blocked during check-loop (because the gate only looks at status), showing there is no machine protection on the ordering surface.
