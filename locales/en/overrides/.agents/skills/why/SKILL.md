---
name: why
description: Trace "why it looks like this" — search source history, process trail, domain docs, session records, issues/PRs, and external evidence in parallel, giving a pointer for each finding; use before changing code you do not understand.
---

# why — Why it looks like this

## Triggers

- "Why was it designed this way / why is this flag off / why was this option chosen".
- You are about to change code you do not understand and first need to know why it exists.
- During review you are uneasy about the intuition "this line cannot be deleted" and need evidence.

## Core

**No memory, no guessing.** Search in parallel by evidence category, and give every conclusion a pointer (`file:line` / commit / doc / issue / metric). Distinguish **measured / inferred / guess**; not finding anything is also an answer—write "no record", do not invent.

## Evidence categories (search in parallel)

| Category | Entry point in this repo |
|---|---|
| Source and history | `git log -S<term>` (pickaxe), `git log --follow -- <path>`, `git blame`, `xd://lsp` references |
| Process trail | `workflow/{intents,specs,plans,incidents}`, `workflow/archive/`, `workflow/delegations.md`, `workflow/papercuts.md`, `workflow/regression-checklist.md` |
| Domain knowledge | `wiki/`, `node .agents/scripts/kb-search.mjs <term>` |
| Session records | `history://`, `archive` (eval global), `.agents/skills/session-resume/SKILL.md` |
| Issue / PR | `issue://<N>`, `pr://<N>` (when a GitHub remote exists) |
| External docs | `microsoft_docs_search`, `web_search`, `read <url>` |
| Runtime / monitoring | available MCPs (chrome-devtools, context-mode, etc.), logs, `workflow/metrics.md` |

## Steps

1. **Break down the subject**: split the question into searchable terms—symbol names, file paths, feature names, decision keywords. If one term finds nothing, try synonyms/Chinese/English.
2. **Local evidence**: run `node .agents/skills/why/scripts/why-evidence.mjs <term> [--path <file>]` to get pickaxe, path history, workflow/wiki hits, and kb-search summaries in one pass.
3. **External evidence**: search issues/PRs, external docs, and monitoring in parallel via available MCPs; skip if unavailable—do not pretend you searched.
4. **Synthesize**: give the conclusion first (why), then the evidence chain (each claim with a pointer), and finally unknowns/conflicts.
5. **Mark certainty**: `measured` (ran it / read the original), `inferred` (derived from evidence), `guess` (no evidence). Predictions and unobserved causes are always `guess`.
6. **Timeline** (optional): when a decision spans multiple commits/docs, order a chain by time and mark the turning points.

## Output format

- **Conclusion**: one sentence answering "why".
- **Evidence chain**: each = claim + pointer (`file:line` / commit / doc / issue) + certainty.
- **Unknowns / conflicts**: parts that cannot be found, evidence that contradicts itself, or that needs the owner to decide.
- **Implications for the change**: whether this can be touched, and what must hold before touching it.

## Where it lives in this repo

- Takeover/continuation: after `session-resume` rebuilds the current state, use this skill to fill in "why".
- Bug fixing: before `diagnosing-bugs` finds the root cause, confirm why this code exists.
- Review: "Impact proof" in `review.md` uses `blast-radius`; this skill adds "historical intent".
- Evidence collector: `.agents/skills/why/scripts/why-evidence.mjs` (collects only, does not conclude).

## Boundaries

- This skill answers "why it looks like this"; `blast-radius` answers "what it will break"; `how` answers "how it works". The three do not replace each other.
- Do not write speculation as fact; without evidence, write "no record".
