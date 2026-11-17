# Glossary — single source of truth for domain semantics

> One concept, one name, one definition. When and how to write entries: `.agents/skills/domain-modeling/SKILL.md` (the body lives single-source on the skill side; this file holds data rows only).
> Source-of-truth registration: `workflow/artifact-sources.md`. `wiki/`, specs, and code comments reference this table; they never restate a definition.

| Term | Definition (decidable, one sentence) | Name in code | What it is not (counter-example) | Basis |
|---|---|---|---|---|
| <term> | <definition> | <class / field / endpoint name> | <adjacent concept it is confused with> | <spec / ADR / path:line> |

## Maintenance discipline

- **Search before adding**: `flow-kit run kb-search.mjs "<term>" --scope workflow`; on a hit revise the existing row, never create a synonymous one.
- **Reconcile semantic changes in the same batch**: rewriting a definition requires updating the specs / ADRs and code naming that reference it; when the commitment surface of an approved document is touched, run `flow-kit run confirm-doc.mjs <doc> --reconfirm --delegated "<user's verbatim words>"`.
- **Treat naming mismatch as a defect**: code name ≠ term name → log it in `workflow/papercuts.md`; do not invent a second naming set here.
- This table is a living document, not an archive: historical definitions stay in git, superseded decisions stay in the `workflow/adr/` superseded chain.
