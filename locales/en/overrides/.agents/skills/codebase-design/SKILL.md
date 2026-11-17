---
name: codebase-design
description: Deep-module design vocabulary and tests — judge interface shape with depth / information hiding / seams / the deletion test; use for multi-option comparison in the Design stage, or when reviewing whether a layer should exist at all.
---

# codebase-design — How to judge interface shape

## Triggers

- The Design stage must choose between two or more interface / layering options.
- Review suspects "this layer is a pass-through / this abstraction hides nothing".
- Tasks need seams drawn first, otherwise parallel dispatch steps on itself.

## Core

**Complexity = dependencies + obscurity.** A deep module hides a lot of implementation knowledge behind a small interface; a shallow module has a wide interface, hides little, and merely moves complexity onto its callers. Judge shape with the four decidable questions below, not with taste.

## Vocabulary (use these words when comparing)

| Term | Meaning |
|---|---|
| deep module | Small interface, large capability; callers need no internal facts |
| shallow module | Interface large relative to implementation; typically pass-through layers and thin wrappers |
| information hiding | Internal decisions (format, ordering, storage, retries) do not leak to callers |
| seam | A boundary where the implementation can be swapped: test doubles, parallel implementations, cross-host adapters all hang off it |
| deletion test | Delete it — does complexity concentrate in one place or spread across N call sites |
| leverage | A position where one change benefits many places |
| pass-through | A function or class that only forwards / renames / adds a try-catch |
| temporal decomposition | Splitting modules by execution order ("read, then write, then validate") instead of by knowledge — the same fact ends up in several places |

## Four tests (each gets a conclusion plus evidence)

1. **Deletion test**: delete it — does complexity concentrate or spread? Spread → it hides something (deep, keep it); concentrate → pass-through (shallow, consider merging into caller or callee).
2. **Interface surface**: how many internal facts must a caller know to use it correctly? More than 3 → the interface is too wide; pull those facts into the implementation.
3. **Seam**: can the implementation be swapped without changing callers (double / alternative implementation / another host)? No → draw the seam before splitting tasks; frontier parallel dispatch in `.agents/commands/stages.md` Build §3 depends on it.
4. **Leverage**: does this change benefit several consumers at once? Only one consumer, now and later → do not build the abstraction (AGENTS.md minimal change / YAGNI).

## Steps

1. **Draw the current state**: list callers and callees of the candidate module (`grep` for references is enough) and mark the internal facts that leak.
2. **Mark shallow modules**: use tests 1 and 2 to find pass-through layers and wide interfaces; write down "what happens if it is deleted".
3. **Give two candidate shapes**: interface signatures + who hides what + where the seam is. Never present one option and call it "obviously better".
4. **Score and compare**: conclusion plus evidence for each of the four tests, written into the spec "option comparison table (trade-offs + recommendation)".
5. **When reasoning cannot decide**: the fork is real (contract shape / data flow / performance trade-off) → run `arena` (capped at 2 arms, read-only on the repo, artifacts in chat or `tmp/`).
6. **Record the change surface**: the chosen shape goes into the spec "system changes" and the plan change surface; seam positions go into the dependency rows of the task breakdown.

## Placement in this repo

- Loading point: `.agents/commands/new-task.md` §1c (on demand in Design).
- Review: the smell walkthrough on the Standards axis of `review-method` (Feature Envy / Shotgun Surgery / Primitive Obsession) shares these tests; conclusions land in the review checklist, and no merge verdict is issued here.
- Single source: before comparing, confirm "where is this fact written today" — in a target project the semantic single sources are the root / directory-level `AGENTS.md` and `.agents/config/policy.json`. A second copy of the same fact is logged as a papercut, not hidden behind a new layer.

## Boundaries

- Deepening is not rewriting: prefer pulling a leak into an existing module over adding a layer.
- No merge verdict (`review-method` / the user), no implementation (`implementer`), no "why does it look like this" (`why`).

> Idea source: codebase-design from `mattpocock/skills` (deep-module vocabulary, from Ousterhout's *A Philosophy of Software Design*). This file is a rewrite for this repo, not a copy of upstream text.
