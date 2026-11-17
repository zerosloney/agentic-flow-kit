---
状态: open
日期: YYYY-MM-DD
主题: <English kebab-case, identical to the file name>
---
# Decision map — <initiative title>
<!-- Copy this template to workflow/decision-maps/YYYY-MM-DD-<topic>.md, then fill it in. Writing rules and triggers are single-sourced in .agents/skills/wayfinder/SKILL.md -->
<!-- Map status ∈ open/closed (open = still has unresolved nodes, closed = all decided/dropped); node status ∈ open/decided/dropped. Both are local enums, not the workflow document state machine: no confirm-doc migration, no entry in workflow/INDEX.md -->
<!-- A node is an open question, not a deliverable: "implement X" fails, "does X follow semantics A or B" passes. Answer bodies go to their source of truth (ADR / glossary / intent / spec); this table keeps pointers only -->

## Scope
<One sentence naming the initiative this map covers and why it spans sessions; no implementation approach>

## Nodes
| # | Open question (decidable) | Why it cannot be settled yet | Depends on | Type | Answer shape / minimal probe | Status | Destination and basis |
|---|---|---|---|---|---|---|---|
| 1 | <semantics A or B?> | <which fact / whose ruling is missing> | <node number or —> | experiment / ruling / bakeoff | <a decidable option set, or the probe command> | open | <once decided: ADR / term row / intent / spec pointer + basis; once dropped: the reason> |

## Frontier (resolve one at a time)
- Current node: <#> (dependencies cleared, most blocking)
- This round: <run the probe / ask the user one question (via grilling) / start an arena bakeoff>
- Evidence pointer: <output / path:line / the ledger row holding the user's verbatim words; leave empty while unresolved>

## Closeout
- Once every node is decided/dropped: set frontmatter `状态` to closed; main-line entry = <intent / spec path>.
- Keep the map in git, never delete it; revise nodes in place when semantics change, and keep historical basis in git and in the ADR supersession chain.
