---
name: blast-radius
description: Blast-radius proof for a small change — find the one fact behind "it is safe because X" and prove it by running code rather than writing a plausible-sounding explanation; use for reviews of the "what else could this break / a small diff makes me uneasy" kind.
---

# blast-radius — Impact proof

## Triggers

- The user asks "what else could this break / blast radius / anything missed".
- The diff is small but crosses a function boundary, shared state, serialization format, DB column, or feature flag.
- During review you are uneasy about "it should be fine" and need reviewable evidence.

## Core

**Do not trust your own written analysis.** An impact explanation always reads as correct, whether true or false. Find **the one or two facts** the whole judgment rests on and prove them by running code; if you cannot prove them, write `unproven`.

Listing callers is not the skill—grep does that in a second. The skill is where grep stops: library source, pinned versions, runtime ordering, wire format, DB columns, another language reading the same bytes, downstream after three hops.

## Certainty ladder (mark which level each fact stops at)

1. **Because I say so**—not evidence on its own.
2. **Points to a line**—a real `file:line`, or the library's own source.
3. **Counter-example path exhausted**—step through the failure path and confirm it cannot be reached.
4. **Ran it**—a small script/test calls real code and fails loudly if wrong.
5. **Reproduced in the running app**—end-to-end evidence.

Level 4 is usually a small script: import the same library the app uses, call the function you are worried about, assert the result.

## Steps

1. **Read the change**: diff, added/modified/deleted symbols, behavioral differences (including what the diff does not say). Use `git log -S`, `xd://lsp` references, and `kb-search` to fill in context.
2. **Find the one safety fact**: most changes that look dangerous are safe because of one fact (e.g., "this call only drops dead cache entries and does nothing else"). Spend your time here, not on a long list of maybes.
3. **Look where grep stops**: library source and pinned version, local patches, microtask/unmount/teardown ordering, JSON returned by APIs, DB columns, wire format, another language, feature flag, three-hop downstream.
4. **List risks honestly**: give each a probability and cost, `file:line`, and how to check it; list confirmed-clean items separately. Not finding something is also an answer; do not invent callers or APIs.
5. **Prove the one fact**: write a script/test that runs real code and paste the output. If you cannot prove it → `unproven`.
6. **Large/broad changes**: have multiple models answer the same question independently, then merge—different models catch different real bugs.

## Output format

- **What changed**: including the non-obvious parts.
- **Safe because**: the one fact + which ladder level it stops at + proof output; write `unproven` if unproven.
- **Risks**: each = how it breaks + `file:line` + probability/cost + how to check; paste proof for the important ones.
- **Ruled out**: checked, and why it is fine.
- **Before merge**: the cheapest test/reproduction that can catch real bugs (including the script you wrote).

## Where it lives in this repo

- Review: `.agents/commands/review.md` P1 "Impact proof".
- Design: contract-surface changes in the Design chapter of `.agents/commands/stages.md`.
- Machine side: `verify-scope.mjs` only computes the diff surface; this skill adds "why it is safe".
- Evidence: put proof scripts in `tmp/` or commit them with the PR; do not write conclusions only.
- Boundary: this skill does not replace the `verify` gate; it proves "nothing else broke", not "this change is correct".
