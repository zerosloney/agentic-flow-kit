---
name: wayfinder
description: Exploration-state decision map — for work spanning more than one session, project the open questions as a map (nodes are questions, not deliverables), resolve one frontier node at a time, and route each answer to an ADR / glossary / intent / spec.
---

# wayfinder — Decision map: resolve one open question at a time

## Triggers

- The work spans >1 session and more than one open question depends on another (A must be settled before B can be asked).
- Drafting an intent reveals a chain of open semantics rather than a single ask (the single-artifact grilling of `grilling` cannot hold it).
- Before a long or unattended run you need to know which decisions are still open (the execution contract is `autonomous-run`; this skill covers only the open surface).
- The user asks to "stop coding and list what still has to be decided".

Not triggered: an L1 micro-change decidable in one session (use the `new-task.md` fast lane); executing an already approved plan (work by the plan, stop on deviation).

## Core

**A node is an open question, not a deliverable.** The map produces decisions, not code. "Implement X" is not a node; "does X follow semantics A or B" is.
Resolve exactly one frontier node at a time (the most blocking one among those whose dependencies are cleared), then send the answer to its source of truth immediately — the map keeps only a pointer.
Exploration is not a work stoppage: a node that can be run or looked up gets a probe first; never stop to ask the user (the typing rule is single-sourced in `new-task.md` §1 "question typing").

## Artifacts and placement

| Artifact | Location | What goes in |
|---|---|---|
| Decision map | `workflow/decision-maps/<YYYY-MM-DD>-<topic>.md` | Node table (question / why it cannot be settled yet / dependencies / type / answer shape or probe / status / destination) + frontier + closeout line |
| Answer to an irreversible trade-off | `workflow/adr/` | Via `domain-modeling`; the map only cites the ADR path |
| Answer about terminology | `workflow/glossary.md` | Via `domain-modeling`; the map only cites the term row |
| Answer about requirements and acceptance | `workflow/intents/`, `workflow/specs/` | Draft and confirm through the `new-task.md` / `stages.md` main line |

- Sources of truth are registered in `workflow/artifact-sources.md`; the map **never copies** decision bodies (single-source discipline).
- A map is not one of the four document types: it does not use the `状态` state machine, does not migrate through `confirm-doc`, and does not enter `workflow/INDEX.md`.
  The frontmatter `状态` is a local map enum (open = still has unresolved nodes / closed = all resolved or dropped); node statuses open / decided / dropped are local enums too.
- File names are English kebab-case (following the document naming convention in `workflow/README.md`).

## Steps

1. **Search first**: `flow-kit run kb-search.mjs "<topic>" --scope workflow` (the four-type corpus) plus direct reads of `workflow/decision-maps/`, `workflow/adr/`, and `workflow/glossary.md`.
   On a hit for the same topic, revise the existing map; never create a second one. When resuming across sessions, rebuild current state via `session-resume` before reading the frontier.
2. **List nodes**: one open question per row, with "why it cannot be settled yet" (which fact is missing / whose ruling is missing), dependency node numbers, and the answer shape (a decidable option set).
   If the nodes no longer fit in one context, split the map per initiative (the context budget is the slice criterion in `stages.md` Build §3); never stack two initiatives in one map.
3. **Type each node**: `experiment` (runnable or lookable: behavior, timing, existing data, output, eval-distinguishable) / `ruling` (product or preference judgment) / `bakeoff` (two options neither wins).
   Experiment nodes carry a minimal probe command; only ruling nodes escalate to user confirmation — the typing criteria are not copied here, see `new-task.md` §1.
4. **Pick the frontier**: take **one** node among those unresolved with cleared dependencies (most blocking first) and write it into the map's frontier section; leave the rest alone this round.
5. **Resolve the node**: experiment → run the probe and record evidence pointers (output / path:line); ruling → ask the user one question at a time (questioning goes through `grilling`), with the verbatim words landing in the existing confirmation / delegation ledgers; bakeoff → go through `arena`.
6. **Backfill the destination**: send the answer to its source of truth per the table above (ADR / term row / intent / spec), set the node to `decided`, and write the destination pointer plus basis;
   an abandoned node becomes `dropped` with a reason (never silently disappears). The map keeps a one-line pointer, not the body.
7. **Close the map**: once every node is decided / dropped, set the map `状态: closed`, name the main-line entry (intent / spec path), and let later sessions advance on the main line;
   keep the map in git, never delete it (`why` and retrospectives read the open surface of the time). If nodes remain open, return to step 4 — one at a time.

## Relation to the confirmation gate

- The map itself is **not a confirmation object**: no new hard gate, no new ledger, no resident injection surface.
- Verbatim user words for ruling nodes go to the existing `confirmations` / `delegations` ledgers. If a node's answer rewrites the **commitment surface** of an already approved document (acceptance criteria / red lines / goals / change approach),
  the user must nod again and you run `flow-kit run confirm-doc.mjs <doc> --reconfirm --delegated "<user's verbatim words>"`. Never hand-edit frontmatter status.
- Once the map hands over to the main line, drafting and confirmation gates for intent / spec / plan apply unchanged (`new-task.md` / `stages.md`); "already explored" waives nothing.

## Boundaries

- No implementation, no code; a map node must never be a deliverable or a task list (task breakdown lives in the plan, criteria in `stages.md` Build §3).
- Do not copy the bodies of `grilling` (questioning) / `arena` (bakeoff) / `domain-modeling` (terms and ADRs) — point at them.
- This does not replace `show-me-your-work` (the trail of decisions already made) or `pause-safely` (the resumable scene): this skill projects the decisions **not yet made**.
- Close the map when the open surface reaches zero; never keep a zombie map "open forever". Revise nodes in place when semantics change; history stays in git.

> Idea source: wayfinder from `mattpocock/skills` (decision map / one open question at a time), plus pstack `figure-it-out` (hypothesis loop + decision trail) and `principle-foundational-thinking`. This file is a rewrite for this repo, not a copy of upstream text.
