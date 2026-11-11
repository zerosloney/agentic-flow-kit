---
description: "Code review standard (graded by risk: machine backstop + AI self-check produces the list, the user decides classification and merge)"
stage: review (cross-cutting: used before merge, not one of the 6 stages)
triggers:
  - "review it"
  - "go through the review standard"
  - "run through the review standard once"
delegation:
  - role: independent-reviewer
    instructions: .agents/roles/independent-reviewer.md
    when: machine gates are complete and the review target and diff baseline are fixed (L2 / L3 mandatory independent review: independent subagent or new session; cannot fall back to main-agent self-check)
    required: true
approval_required: true
next: while P0/P1 are uncleared, L1 → .agents/commands/new-task.md §L1 Fast Track to change code; L2/L3 → .agents/commands/stages.md Build chapter. After clearing, merge with user confirmation
---

# Review · Graded Review

> **Three-way division**: machine gates block automatically (no human guard needed) $\rightarrow$ AI review produces a graded list $\rightarrow$ the user classifies/merges; they may not substitute for each other (AI may not make the merge decision, the user may not be judged on their behalf).
> **Independence**: L2/L3 must use an independent subagent or a new session; the original author's self-check may not masquerade as one.

## P0 Must-Block (Block)

| Check item | Criterion (Invariant) | Machine backstop | AI self-check |
|---|---|---|---|
| **Architecture red line** | Layered dependency direction constraints (domain/application layers must not reference infrastructure implementations) | `.agents/hooks/` architecture gate | References outside the exemption list |
| **Audit fields** | Public audit fields are written automatically by shared infrastructure; business code must not write them by hand | Audit-field gate (compares newly added values) | None |
| **Deletion interception** | Before deleting, check child/business references; when referenced, error per the shared policy | Deletion gate (call sites vs allowlist) | Verify delete-time reference checks at each call site |
| **Input validation** | Required-field null checks, range validation, illegal input rejected per the shared policy | Project validation tests | Self-check coverage blind spots |
| **L2/L3 without spec** | Reject; first return to `workflow/specs/` to file and confirm a spec | `confirm-doc` →done gate (L2/L3 intent must have a same-named confirmed spec) | None |

## P1 Should-Block (Self-check)

| Check item | Criterion (Invariant) | Note |
|---|---|---|
| **DB naming and migration** | Follow table/field/foreign-key naming conventions and the schema change process | Do not introduce an unused migration mechanism arbitrarily |
| **Frontend form** | New/edit and large-volume selection follow component conventions | Overlay vs page navigation, selector form, table style |
| **Forms** | Submit after normalizing empty values for optional fields | Do not change backend DTOs to evade validation |
| **State management** | Store calls the API; components call only the store | None |
| **API input boundary** | Write operations must not bind domain entities via `[FromBody]` (always DTOs) | Input DTOs must not contain primary keys or audit fields |
| **Import trust boundary** | Import endpoints fully re-validate server-side; never trust the client | Parse failures go into the error-row summary; never silently drop |
| **Create/Update same policy** | Create validation must apply the same policy to Update | Referenced identifier fields must not be changed |
| **Pagination and state semantics** | Pagination parameter range validation + service-layer clamping | Separate illegal state from non-existent (400/404) |
| **Spec commitment landing** | spec §test cases must actually land in tests or verification scripts | Persistent assertions must not be written as row-count constants that grow over time |
| **Thin-adapter drift** | Host `agents/`, `commands/` remain pointer shells; the body lives only in `.agents/roles/` and `.agents/commands/` | Manually verify shells reference the authoritative paths and the body is not too thick |
| **Impact-surface proof** | For a small diff, "safe because X" must be proven by running code, not by assertion | Follow `.agents/skills/blast-radius/SKILL.md`; proof scripts ship with the PR or land in `tmp/` |

## P2 Advisory (Advisory)

- Comment completeness (add comments at complex logic)
- Conventional Commits in Chinese (feat / fix / docs / style / refactor / perf / chore)
- Whether the retrospective trio for historical incidents of the same kind is complete
- **Purely stylistic issues are discarded outright and not listed as P2**; only "naming/comments that cause wrong calls or contract misreading" are reported as behavioral issues.

## Process

**Input**: diff to review + fixed baseline (SHA/branch)
**Process**:
1. **Machine gates**: pre-commit / pre-push / `stages.md` Test static gates all pass (no human guard needed)
2. **AI review**: delegate `independent-reviewer` $\rightarrow$ focus on items not covered by P0 + all P1 (P2 subject to capacity); independence, persistence, and cross-model policy follow `.agents/roles/independent-reviewer.md` "Review Policy" (this section's scenario = merge review; not restated here)
   - **Method**: `.agents/skills/review-method/SKILL.md`
   - **False-positive prevention**: every finding goes through `review-verification-protocol`
   - **Model selection**: take `model-roles.json` (local override `.local.json` takes precedence; both empty = host default); cross-model ladder and downgrade follow `.agents/roles/independent-reviewer.md` Constraints. Before switching models, run 3 already-classified bug regressions per `delegations.md`
   - **High-risk diff**: additionally apply `.agents/skills/interrogate/SKILL.md` (does not replace the single independent review above)
3. **User decision**: issue classification (reject as false positive / P0 must-fix / P1,P2 discretionary) + merge timing
**Output**: graded issue list + fix suggestions $\rightarrow$ user confirms merge
**Next**: while P0/P1 are uncleared, L1 returns to `.agents/commands/new-task.md` §L1 Fast Track to change code; L2/L3 return to `stages.md` Build chapter. After clearing, merge with user confirmation.

## PR Panel Review (pr-review, created 2026-11-06; automated gate retired 2026-11-09)

> The panel is retired as a **manual tool** (owner instruction): pre-push / CI / pr-create no longer enforce a review ledger; the trigger policy follows `.agents/commands/pr-review.md`. The tiers Important/Nit/Pre-existing and the discard-purely-stylistic policy are unchanged.

## PR Body Trio (Merge Narrative Convention)

When opening a PR, the body has three fixed sections, each answering one merge-decision element and none may be omitted (Azure DevOps has no skill hook, so this section is the single source for the convention):

| Section | Answers | Format |
|---|---|---|
| **Summary** | What change is this | 1-4 items: why change, what changed, pointing at key modules/files — must come from the actual diff; write actual behavior, not intent rhetoric |
| **Evidence** | Where is the evidence | Actually run tests/builds/manual verification (Before/After contrast: red-before/green-after test pairs, same-viewpoint before/after screenshots); attach green credentials or measured-evidence paths that can be opened and re-checked; if not run, explicitly write "not run" and why; fabrication is prohibited. When a panel review was run, append one line: `面板评审：<runId>（Important n / Nit n / Pre-existing n；全部 fixed/waived/deferred/recorded）` |
| **Merge Danger** | How big is the risk | **Door**: impact surface (API / DB / config / permission / compatibility), write "none" if no risk, do not omit; **Blast Radius**: one word (local / module / global); **Rollback**: rollback method and risk, required |

If size exceeds budget (pre-push advisory; override requires `PR_SIZE_OK=1` and a reason in Tradeoffs), the diff is large, overlap is non-empty, or the change is irreversible → add a **Tradeoffs** section to the body: real diff size + why it is still done this way.

If you cannot write "Door=none + local", this triggers one grading re-check.

> Distribution skills (e.g. `tfs-pr`) come with an identical template; that is their **default for hosts without this convention**; this repository follows this section.

## 🚫 Prohibitions
| Operation | Consequence / machine behavior | Exception |
|---|---|---|
| L2/L3 main-agent self-check | $\rightarrow$ independence fails | Must delegate `independent-reviewer` or a new session |
| Merge with P0 uncleared | $\rightarrow$ blocked | Must be zeroed and confirmed by the user |
