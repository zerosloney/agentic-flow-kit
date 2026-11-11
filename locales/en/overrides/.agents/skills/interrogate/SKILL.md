---
name: interrogate
description: Multi-model multi-lens adversarial review — different models/lenses independently take apart the same diff, then aggregate and dedupe; use for high-risk PRs, L2/L3 reviews, or when a single-model review leaves you uneasy.
---

# interrogate — Multi-lens adversarial review

## Triggers

- A high-risk diff (cross-boundary, concurrency, authorization, data migration, public interface).
- You want one more pass beyond the L2/L3 independent review.
- A single-model review concludes "looks fine", but you are not convinced.

## Core

**This is not another single-model review pass.** It has different models and different lenses take apart the same diff **independently**, then aggregate and dedupe. Different models catch different real bugs; the same model with a different lens can also catch what a single lens misses.

## Steps

1. **Fix the target**: base/head, spec path, risk level. Do not start until the target is fixed.
2. **Generate the plan**: `node .agents/skills/interrogate/scripts/interrogate-plan.mjs --base <ref> --head <ref> [--spec <path>]`. It outputs six lenses (correctness / security / quality / performance / tests / spec) plus file slices and prompts for each lens.
3. **Dispatch in parallel**: one subagent per lens, each reading the diff independently and sharing no conclusions.
   - Model: follow the `review` role in `.agents/config/model-roles.json` (`heterogeneous: true`); if the host supports model override, use different models; if not, use different agent personas (`reviewer` / `security-reviewer` / `code-simplifier` / `caveman-reviewer`).
   - Each subagent gets only its own lens prompt + file slice, not the other lenses' conclusions (to prevent anchoring).
4. **Aggregate**: dedupe by `file:line + issue`; classify P0/P1/P2; separate confirmed from speculative; give a one-line "why it is not an issue" for each noise item.
5. **Output**: one merged table + "must fix before merge" + "ruled out" + "not covered".

## Output format

| Severity | Location | Issue | Evidence | Fix | Source lens |
|---|---|---|---|---|---|
| P0 | `file:line` | … | … | … | security |

- **Must fix before merge**: all P0 + confirmed P1.
- **Ruled out**: items that looked like issues but checked out not to be; give a reason for each.
- **Not covered**: surfaces no lens covered (e.g., runtime behavior, external services); state them explicitly.

## Where it lives in this repo

- `review.md` execution flow: L2/L3 high-risk diffs layer this skill on top.
- `review-method`: the Standards×Spec dual axis + bad-smell walkthrough remains the single-lens baseline; this skill is a parallel supplement.
- `independent-reviewer`: a single independent review is not replaced; this skill is a multi-model supplement.
- Machine gates: does not replace `verify` / `check-loop`; this skill only produces a list, and a human still signs off on severity.

## Boundaries

- Multi-model agreement is high signal, not proof; still use `blast-radius` to prove key safety facts.
- Do not treat "another model said so too" as evidence; evidence remains `file:line` / code that ran.
- Subagent conclusions must be re-checked yourself; do not pass them through directly.
