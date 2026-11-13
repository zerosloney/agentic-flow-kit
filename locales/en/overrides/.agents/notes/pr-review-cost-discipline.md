# Review Cost Discipline: Run the Panel Only Once, Assign Slots to Concurrent Sessions

> **Retirement note (2026-11-09, owner directive)**: the automatic PR panel gate has been dismantled — pre-push / CI / pr-create no longer enforce the review ledger.
> This page is retained as the cost discipline for **manually running the panel**; the measured fast-tier data stays on record; the orchestration entry point has moved to `.agents/commands/pr-review.md`.

Source: the 2026-11-07/08 outbound header attachment delivery (four panel rounds in runs `pr-8fb73ea` / `pr-9e50909` / `pr-741f609` / `pr-6b535e0`, measured at ~2.5 hours, of which two rounds were entirely wasted). The `pr-review` script documents only "how to run"; this page documents "when to run and how many times" — **process constraints, not a repeat of tool details**.

## Rules

1. **One-review principle**: run the panel review for the same delivery batch **only once**. The fixed order is
   **all fixes landed → commit → `plan` → finder/verifier → `dispose` → `summary` → push**.
   "Review while changing" is forbidden: `run.json`'s `diffHash` binds base..head; once head changes the ledger is invalidated and the whole round must be rerun.
2. **After receiving findings, finish all changes before reopening**: apply this round's confirmed items (`confirmed`) in one pass and commit, then start a new round against the **new head**;
   "change one → re-review → change another" is not allowed (3 lenses per round, reduced under the 2026-11-08 tier 3).
3. **Check the dispose verdict before deciding whether to change anything**: items marked `waived` / `deferred` / `rejected` produce no code changes;
   do not change head for them (doing so wastes a whole round).
4. **Concurrent sessions must use separate slots**: when multiple sessions/agents run in parallel on the same machine, each sets its own `SHIPYARD_SLOT`
   (single source for port slots and derivation rules: `runtime-env.md` §6.1b). Sharing one slot collides on both "workspace files" and "branch HEAD";
   head drift during a review = ledger invalidation (in this run, another session appended `a4b347a02` / `02d269a79` / `c77f50b44` on the same branch).
5. **Engine-surface commits do not run the panel**: when the scope lands only in `.agents/` `.githooks/` `.codebuddy/` `.trae/` `workflow/` `wiki/` `docs/`
   and root config, it is not worth starting the panel (the former pre-push engine-surface exemption was retired along with the 2026-11-09 automatic gate, and is now a manual judgment);
   if you discover before manually starting the panel that the scope is purely engine/docs → that is a documentation task, do not run the panel.

## Checklist (answer each item before starting the panel)

- [ ] Are all changes for this round **already committed**? Does the working tree contain only files from other tasks unrelated to this batch?
- [ ] Are there **no** confirmed findings still pending changes? (If yes → fix first, do not start the panel)
- [ ] Does this session exclusively own the port slot / branch? (If not → set `SHIPYARD_SLOT` first or switch branches)
- [ ] Does the change scope really include the business surface? (Purely engine/docs → not worth running the panel)

If any item is "no", starting the panel is a waste.

## Cost Facts (for judgment; measured 2026-11-08)

| Action | Duration | Notes |
|---|---|---|
| Single-round panel finder (6 lenses; reduced to 3 lenses from 2026-11-08) | 8–27 min (measured with 6 lenses) | largest single brief 131 KB (embedded diff 80 KB + base 50 KB) |
| Single-round panel verifier | 12–21 min | after change: 1 vote by default, +1 vote for Important/security |
| `pre-push` local gate | before change 110–130 s / after change 15–20 s | integration tier defaults to CI (`PREPUSH_RUN_INTEGRATION=1` reproduces locally) |
| One "re-review right after changing" rework | +15–30 min | this run wasted two rounds due to inverted ordering (~33 min) |
| Fast-tier single-round panel (--fast; single lens, single vote, target ≤5 min) | **measured 377s** (zero repo reads: finder 2 tool calls 343s + script 34s; first run including queue 640s) | model latency is the floor; overruns above the hard cap are cut off by fast-timeout; criteria and orchestration contract: header-note fast-tier section of `flow-kit run pr-review` + config `fast` section |

## Related Single Sources

- Review panel mechanics and commands: `flow-kit run pr-review` (--help) + `.agents/commands/pr-review.md`
- Confirmation gate and three-piece-set ordering: `.agents/notes/process-order-rule.md`
- Port slots and concurrency: `.agents/notes/runtime-env.md` §6.1b (**this page does not restate the port values**)
- Gate checkpoint overview: `.agents/notes/engine-map.md`
