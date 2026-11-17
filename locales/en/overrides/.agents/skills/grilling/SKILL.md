---
name: grilling
description: Requirement grilling — one question at a time until a vague ask becomes decidable items, with answers written back into the six intent sections and the spec ambiguity checklist; use before drafting in the Plan/Design stages, or when the user asks to stress-test a plan.
---

# grilling — Ask until it is decidable

## Triggers

- Before the Plan stage files an intent: background / goals / non-goals are still "roughly what I want".
- Before the Design stage drafts a spec: the six ambiguity dimensions have no conclusion, or the solution needs a stress test.
- The user says "grill me / is this idea sound".

## Core

**One question at a time; wait for the answer before the next.** A batch questionnaire pushes the judgment back onto the user, and its answers cannot be grounded one by one.

**Search before asking.** Anything that can be run or looked up (behavior, ordering, layout, output, existing data, eval-distinguishable) gets a prototype, a query, or an eval first — never a question (single source: `.agents/commands/new-task.md` §1 question typing). Only product trade-offs and preference judgments escalate to a question. Being experimentable does not exempt a red line.

**Ask on the irreversible side.** Priority: data semantics and identity → contract shape → failure paths → existing-data migration → testability of acceptance. Getting these wrong costs a rework; getting wording wrong costs one line.

## Steps

1. **Search for existing answers**: `flow-kit run kb-search.mjs "<keyword>" --scope workflow --type intents,specs,incidents` plus `wiki/INDEX.md` and `workflow/glossary.md`. Cite a hit instead of asking again.
2. **List the open decisions**: turn the ask into decidable questions (answerable as yes/no or one concrete semantic), ordered by the priority above.
3. **Ask one by one**: one question per round, with "why this is irreversible" and the evidence already known; after the answer, restate it as a decidable item and have the user confirm.
4. **Write to documents, not to chat**: backfill the six intent sections / the spec "ambiguity checklist" (columns `dimension | conclusion | basis | status`); every basis must be pointable (section number / `path:line` / query result / experiment output).
5. **Route the sediment**: terminology disputes → `domain-modeling` records them in `workflow/glossary.md`; irreversible trade-offs → record an ADR under `workflow/adr/`; inferred conclusions → the spec "assumptions and inferences" section.
6. **Close out**: enter the confirmation gate only when open clarifications reach zero. Bounds follow the spec convention: ≤2 lines per dimension, ≤12 total, ≤5 questions per round (`.agents/commands/stages.md` Design §2).

## Output format

- **Decided**: item + basis pointer (ready to backfill).
- **Open**: which items remain and why only the user can decide them.
- **Experimented**: what was run and what it concluded (the part that replaced a question).

## Placement in this repo

- Loading point: `.agents/commands/new-task.md` §1c (loaded on entry to Plan / Design).
- Confirmation gate: `confirm-doc.mjs` rejects "open clarifications ≠ 0 / empty basis / missing dimension"; unfinished grilling is bounced back.
- Premise challenge: interpretive premises (e.g. "display semantics vs storage rewrite") go through the spec "premise challenge" table, each answered against the opposite reading — grilling surfaces them, the premise gate blocks confident wrong thinking.

## Boundaries

- Read-only search + conversation + document backfill; no code changes, no deciding for the user, no status transitions.
- If the user answers "you decide", record it as an authorized inference under "assumptions and inferences", never as confirmed.
- No solution bake-off (`arena`), no interface-shape assessment (`codebase-design`), no implementation (`implementer` role).

> Idea source: grill-with-docs from `mattpocock/skills` (one-question interview loop plus in-place domain documentation). This file is a rewrite for this repo, not a copy of upstream text.
