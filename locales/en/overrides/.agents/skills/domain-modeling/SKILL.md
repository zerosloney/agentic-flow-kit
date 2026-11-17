---
name: domain-modeling
description: Domain modeling — turn terminology and irreversible trade-offs into single-source artifacts (the workflow/glossary.md term table and workflow/adr/ decision records); use for semantic disputes in the Design stage, or when one concept has several names.
---

# domain-modeling — One concept, one name

## Triggers

- A new term enters code or documentation for the first time.
- One concept has ≥2 names (e.g. "supplier / vendor / provider"), or one name means different things in different modules.
- The change hits the L2 surface: coding authority / shared contract / global cross-cutting semantics (`.agents/commands/new-task.md` §1).
- An irreversible trade-off is due: schema, identity semantics, contract shape, existing-data migration.

## Core

**A semantic dispute is a model problem, not a wording problem.** Fixing the comment without fixing the model guarantees the next session disputes it again. Terms and decisions need one source of truth; everywhere else only references them.

## Artifacts and placement

| Artifact | Location | What goes in |
|---|---|---|
| Term table | `workflow/glossary.md` | One row per term: decidable definition + name in code + counter-example (what it is not) + basis |
| Decision record | `workflow/adr/<YYYY-MM-DD>-<topic>.md` | Context / decision / alternatives and trade-offs / consequences / status (proposed → accepted → superseded) |

- Sources of truth are registered in `workflow/artifact-sources.md`; `wiki/` and specs hold links or references, never a copied definition.
- A superseded ADR is not deleted: set status to `superseded`, point at the new ADR, and keep the trade-off basis of the time (the `why` skill reads it).
- File names are English kebab-case (following the document naming convention in `workflow/README.md`).

## Steps

1. **Search first**: `flow-kit run kb-search.mjs "<term>" --scope workflow` plus `workflow/glossary.md` and `wiki/INDEX.md`. On a hit, revise the existing row; never create a synonymous row.
2. **Name it**: pick one name per concept, write a decidable definition and a counter-example, and register the class / field / endpoint names in code. A naming mismatch is logged as a papercut (do not invent a second naming set inside the term table).
3. **Challenge the premise**: if the definition carries interpretive risk (e.g. "display semantics vs storage semantics"), go through the spec "premise challenge" table, answer each against the opposite reading, and record the basis for the choice; `confirm-doc` rejects empty tables and placeholders.
4. **Record the decision**: irreversible trade-offs get an ADR with at least one alternative and a pointable reason it was not chosen. "We decided to use X" alone is not a decision record.
5. **Backfill**: the data-semantics dimension of the spec "ambiguity checklist" cites the term-table row; the "constraint compliance mapping" cites the ADR; the plan change surface lists the consumers of the affected term.
6. **Reconcile**: after the change, check code naming against the term table; on mismatch either fix the code or fix the table (same batch) — never leave two truths.

## Relation to the confirmation gate

If a term definition or an ADR decision rewrites the **commitment surface** of an already approved document (acceptance criteria / red lines / goals / change approach), the user must nod again and you run `flow-kit run confirm-doc.mjs <doc> --reconfirm --delegated "<user's verbatim words>"`. Never hand-edit frontmatter status.

## Boundaries

- No second term source: definitions must not be rewritten in the root `AGENTS.md`, `notes/`, or code comments (single-source discipline).
- No interface-shape assessment (`codebase-design`), no requirement grilling (`grilling`), no implementation.
- The term table and ADRs are living documents, not archives: revise semantics in place, keep historical basis in git and in the superseded chain.

> Idea source: domain-modeling from `mattpocock/skills` (GLOSSARY / ADR conventions) and pstack `principle-model-the-domain`. This file is a rewrite for this repo, not a copy of upstream text.
