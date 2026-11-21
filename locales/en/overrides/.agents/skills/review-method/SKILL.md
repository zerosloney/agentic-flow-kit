---
name: review-method
description: Code review walkthrough method (Standards×Spec dual axis + bad-smell checklist + merge bar). Used by independent-reviewer or the main agent when reviewing a diff; it is the method-layer single source for the .agents/commands/review.md execution flow and does not depend on host global skills.
---

# review-method — Review walkthrough method

## Positioning and division of labor
The three review layers each have their own single source; this file only handles "how to walk through":

| Layer | Single source |
|---|---|
| What to block (invariants) | `.agents/commands/review.md` P0/P1 table |
| In what capacity to check (evidence discipline) | `.agents/roles/independent-reviewer.md` Constraints |
| How to walk through (this file) | dual-axis framework + bad-smell checklist + merge bar |

When the host has global `code-review` / `review-verification-protocol` skills they may be layered on; otherwise this file is the fallback.

## Calibration set (golden-set.md)
The `golden-set.md` in the same directory is a known-answer sample library for independent review quality (positive = defect should be reported, negative = should pass; each with this repo's context points). Before reviewers/new sessions go on duty they may blind-evaluate samples then compare answers to self-check calibration difference; monthly reconciliation sampling (registered in mechanism-registry) uses it as a comparison baseline, must run **both arms** (A = with this skill loaded / B = clean session given only inline sample context; Δ is the effect of context injection) and run **variance reruns** for suspicious judgments (flippers count as question ambiguity, not calibration difference). When hit difference exceeds 20% for two consecutive months, register calibration debt in papercuts; samples' answers are finalized when the anchor loop closes; later code evolution does not change answers.

## Dual-axis framework (report by axis; merged sorting forbidden)
| Axis | Question asked | Basis |
|---|---|---|
| **Standards** | Does it comply with this repo's written standards | Root/directory-level `AGENTS.md` + review.md P0/P1 table |
| **Spec** | Does it faithfully implement the entry document's commitments | intent/plan "acceptance criteria" + spec §test cases |

The two axes stand independently: compliant but doing the wrong thing (Standards pass, Spec fail) and doing the right thing but breaking standards (Spec pass, Standards fail) both exist — report separately to prevent one axis masking the other. The Spec axis reports three finding classes: missing/partially landed commitments, scope creep, implementation distortion.

### Pre-dispatch self-check and axis isolation
- **Baseline self-check first**: before dispatching review (or self-review) `git rev-parse <baseline>` resolves + `git diff <baseline>...HEAD` non-empty — bad refs/empty diff fail before dispatch, not midway through the two-axis walkthrough.
- **Spec source discovery order**: workflow reference in commit message → path given by user → same-named family of entry document (intent/spec/plan) → if none ask the user; when not found the Spec axis explicitly reports "no spec available", silently skipping the whole axis is forbidden.
- **Dual-axis dispatchable isolation**: when the host supports subagents, dispatch the two axes to two read-only subagents in parallel (context isolation prevents mutual contamination), and present each axis as-is when aggregating — the cross-axis reordering prohibition is not relaxed.

## Bad-smell walkthrough checklist (Standards axis supplement)
Judgment items outside the P0/P1 table. Constraints: repo written standards prevail (written acceptance suppresses this checklist); always judgment items, not hard violations; skip what gates/tooling already catch. Each entry = what it is $\rightarrow$ how to fix:

| Bad smell | What it is $\rightarrow$ how to fix |
|---|---|
| Mysterious Name | Name does not reveal purpose $\rightarrow$ rename; if you cannot find an honest name = design is murky |
| Duplicated Code | Same-shaped logic appears in multiple places $\rightarrow$ extract shared implementation, call from both |
| Feature Envy | Method uses another's data more than its own $\rightarrow$ move the method onto the data it envies |
| Data Clumps | Several fields/parameters always travel together $\rightarrow$ bundle into one type and pass it |
| Primitive Obsession | Raw value replaces a domain concept $\rightarrow$ build a dedicated small type for the concept |
| Repeated Switches | switch/cascading if on the same type recurs $\rightarrow$ polymorphism or shared mapping |
| Shotgun Surgery | One logic change forces scattered edits across files $\rightarrow$ gather into the same module |
| Divergent Change | One module changed for multiple unrelated reasons $\rightarrow$ split by single reason to change |
| Speculative Generality | Adding abstraction/parameters/hooks for requirements not in spec $\rightarrow$ delete and inline, wait for the real requirement |
| Message Chains | Long `a.b().c().d()` navigation $\rightarrow$ hide one method on the first object |
| Middle Man | Class/function almost only forwards $\rightarrow$ delete, call the real target directly |
| Refused Bequest | Subclass ignores/overrides most inherited members $\rightarrow$ drop inheritance for composition |

Performance three (beyond the P1 pagination clause): N+1 queries, unbounded fetches/loops, large objects on hot paths.

### Spec half-landing verification (added 2026-11-02, source batch three)

Before reviewing a spec/plan `done` declaration, check each "observable criterion": can each criterion be pointed to code, a test, or an executable script? If not pointable = half-landing; half-landing must not be marked `done`; add tests or downgrade to a registered item and leave a pointer in incident/notes.

**Why a human/review agent must actively check**: static gates can only prove compilation/structure, not that "the promised behavior actually landed"; when implementation and tests share a source, half-landing can still be all green.

## Structured fix actions
When reporting structural problems give named actions, do not just say "this is complex" and let the author guess: remove condition chains by building a type/dispatcher, fold duplicate branches, separate orchestration from business, move feature logic back to its owning layer, reuse authoritative helpers instead of near-copies, explicit type boundaries to remove downstream branches, delete pass-through wrappers with no clarification value, extract helpers or split large files.

## Merge bar (prevent P2 entanglement)
When it clearly improves overall code health, recommend merging; do not block because "I wouldn't write it that way" — perfection does not exist, continuous improvement is the goal. Style preferences and hypothetical risks must not be reported (evidence discipline see role contract Constraints).

## Provenance
- Dual-axis framework and bad-smell checklist: distilled from the host global `code-review` skill (Fowler, Refactoring ch.3 baseline).
- Structured fix actions and merge bar: borrowed from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (MIT).
