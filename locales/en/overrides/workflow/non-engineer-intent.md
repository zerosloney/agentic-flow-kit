# Non-engineering roles: write an intent

> Goal: product / business / operations produce a `intent.md` that the next phase can read directly, without git or a command line.
> The produced file still treats the repository as the source of truth; this doc only covers "how to get in".

## Simplest path (claude.ai / Cowork)

1. In the session, describe in your own words: **who hit what problem, what they cannot do now, what counts as better, what is out of scope**. No formal format needed.
2. Have Claude write it up as `intent.md` using the template below; it will ask about scope, users, constraints and success criteria.
3. Correct whatever it misunderstood, item by item. **Author and date** must be preserved.
4. Have Claude commit the file to `workflow/intents/<english-kebab>.md` in the repo via the GitHub connector.
   No git skills needed: the connector handles the commit; you only confirm the file name and content.
5. The product owner flips the status from `draft` to `approved` in the repo (or rejects it).

## Template

```md
# Intent: <one-line title>
Author: <name/role>  Status: draft
Date: <YYYY-MM-DD>

## Problem
<who, in what scenario, cannot do what now; numbers help>

## Expected outcome
<what observable "better" looks like>

## Affected people and systems
<users / roles / modules / interfaces>

## Constraints
<no new PII, must reuse existing auth, release window...>

## Non-goals
<explicitly out of scope, to prevent creep>

## Open questions
<who must decide; write "none" if none>
```

## Red lines

- Do not write implementation plans (that is spec/plan territory); only write what, why and constraints.
- No secrets, real user data or internal link credentials in intents.
- Only the product owner changes the status; the agent never flips draft to approved on its own.
- One intent solves one problem; split if you can.

## Watching progress (way out)

- After submitting an intent, to see progress, pending decisions and risks at a glance: have someone who can run commands execute `flow-kit run owner-digest` (last 7 days by default, `--days N` to adjust). It prints a three-section digest: "Done / Awaiting my decision / Risks"; read-only, changes no repository files.

## Technical-side support

- In the repo, `flow-kit run fill-intent.mjs` generates a skeleton (with the engine installed).
- Before entering Design, the product owner must answer the open questions or explicitly approve "entering with open questions".
