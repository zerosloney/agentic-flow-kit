---
name: eval
description: Blind evaluation of skill/prompt changes — A/B arms, same model and same context, a known-answer task set, compute hit rate and Δ; use when asking "is this skill change actually useful".
---

# eval — Blind evaluation of changes

## Triggers

- You add/modify a skill, prompt, or structure and want to know whether it actually improves behavior.
- `/reflect` landed a skill change and you need evidence to keep or revert it.
- Two options are too close to call; use a task set to adjudicate.

## Steps

1. **Define the task set**: 5–10 tasks, each with a **known answer/acceptance criterion**; include both positive and negative cases. Write it as TSV:
   ```
   task	expected	a	b
   ```
   Leave `a`/`b` empty for now; fill in `pass`/`fail` after running.
2. **Define two arms**: A = with the new skill/prompt; B = without/the old version. **Same model, same context, same tasks**; the evaluator does not know which arm is which (blind).
3. **Run**: for each task, run both arms with a **new subagent**, sharing no conclusions; record the actual result against `expected`.
4. **Compute**: `node .agents/skills/eval/scripts/eval-score.mjs <results.tsv>` → A/B hit rate, Δ, flipped tasks.
5. **Judge**: Δ is clear and flips are explainable → keep; Δ near 0 or negative → revert/adjust; many flips → task ambiguity, fix the task set first.
6. **Record it**: put the conclusion in the task document or `workflow/reviews.d/<current month>.md`; update `mechanism-registry.md` for mechanism changes.

## Task-set template

```
task	expected	a	b
bug-fix-1	Fix after reproducing the failing case; tests turn green		
bug-fix-2	Do not modify test assertions; change only the implementation		
feature-1	New behavior has boundary cases		
negative-1	Refuse to implement directly without a spec		
```

## Boundaries

- Small N is noisy; do not claim effectiveness when Δ < 20pp.
- Without blinding it is not eval—an evaluator who knows the arm assignment will self-fulfill.
- Do not run both arms with the same model and then use it as the judge; use a different model or a human judge.
- The task set must separate "the skill helps" from "the model already knew it"; negative cases are the key defense against self-deception.
