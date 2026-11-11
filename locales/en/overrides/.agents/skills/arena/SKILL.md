---
name: arena
description: Design-selection bakeoff — give N independent arms the same brief (different models/architectures/data shapes), pick a base by acceptance criteria and graft the best parts; use when two options are too close to call / a design has no precedent.
---

# arena — Parallel comparison selection

## Triggers

- A design fork has no precedent and two or more options are plausible.
- The user says "compare them / build one each / pick one".
- The choice locks in the shape of subsequent implementation, and choosing wrong is expensive to rework.

## Core

**Same brief, independent arms, a judge picks the base + grafts.** This is not implementing the same file in parallel; it is proposing in parallel, then choosing one base. Arms do not share context (to prevent anchoring).

## Steps

1. **Fix the brief**: goal, constraints, acceptance criteria, non-goals, evidence requirements. Each arm receives a **verbatim identical** brief.
2. **Choose arms**: 2–3, with genuinely different axes—different models / architectures / data shapes. Do not run N homogeneous arms.
3. **Dispatch in parallel**: one `task` batch; each arm returns: approach, trade-offs, risks, minimal proof (runnable prototype/test/pseudocode).
4. **Judge**: score item by item against the acceptance criteria; choose **one base**; list the concrete parts to **graft** from the other arms; write one sentence on why each rejected option lost.
5. **Land it**: implement the base + grafts; run `.agents/skills/blast-radius/SKILL.md` on the chosen design; then `verify --scope`.
6. **Record it**: one row per arm in `workflow/delegations.md` plus the judge's conclusion; for long runs add one row to `decisions.tsv`.

## Output

| Arm | Approach | Strengths | Risks | Minimal proof | Verdict |
|---|---|---|---|---|---|
| A | … | … | … | … | base / graft X / reject |
| B | … | … | … | … | … |

- **Base**: who was chosen and why.
- **Grafts**: which blocks are taken from other arms and how they are merged.
- **Rejections**: one sentence of rationale per rejected option.
- **Open**: product/preference calls that need the owner to decide.

## Where it lives in this repo

- Dispatch: the `tasks[]` batch of `task`; the `judgment` role in `model-roles.json`.
- Review: after choosing the design, take it apart with multiple lenses per `.agents/skills/interrogate/SKILL.md`.
- Proof: `.agents/skills/blast-radius/SKILL.md` (the reason it is safe is X, so run code to prove it).
- Record: `workflow/delegations.md`; aggregate with `node .agents/scripts/agg-delegations.mjs`.

## Boundaries

- Arms do not share conclusions; sharing the brief is enough.
- Do not merge all N options—pick one base, and grafts must be concrete down to file/function.
- Do not use arena for coupled implementation (same file/contract); use serial instead.
