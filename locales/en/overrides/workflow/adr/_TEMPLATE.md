---
状态: proposed
日期: YYYY-MM-DD
主题: <English kebab-case, identical to the file name>
---
# ADR — <decision title>
<!-- Copy this template to workflow/adr/YYYY-MM-DD-<topic>.md, then fill it in. Writing rules and triggers: .agents/skills/domain-modeling/SKILL.md -->
<!-- Status ∈ proposed/accepted/superseded (a local ADR enum, not the workflow document state machine; it does not migrate through confirm-doc). A superseded ADR is not deleted: change its status and point at the new ADR under "Supersession". -->

## Context
<Why the decision is due now; the surface it touches (schema / contract / identity semantics / existing data) and the cost of not deciding>

## Decision
<One decidable sentence; who consumes it and from which commit it takes effect>

## Alternatives and trade-offs
| Option | Key trade-off | Risk | Why it was not chosen |
|---|---|---|---|
| <chosen option> | <trade-off> | <risk> | — (chosen; basis below) |
| <alternative> | <trade-off> | <risk> | <pointable reason> |

## Consequences
- Positive: <what we gain>
- Negative / cost: <what we must accept, including existing data and migration semantics>
- Terminology impact: <which rows of workflow/glossary.md were added or rewritten>

## Basis
<spec / incident / experiment output / path:line / the user's verbatim ruling; mark inferred conclusions explicitly as inferences>

## Supersession
<none / supersedes ADR-<date>-<topic> / superseded by ADR-<date>-<topic>>
