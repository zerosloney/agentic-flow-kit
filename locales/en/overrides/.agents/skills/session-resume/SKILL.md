---
name: session-resume
description: Session re-entry and interruption handoff — when taking over, switching worktrees, or continuing after compression/new session, rebuild the current state from machine facts before acting; for use by the main agent before starting work at any level.
---

# session-resume — Session re-entry and interruption handoff

## Triggers

- New session / continuing an existing task after context compression; taking over someone else's branch or worktree.
- The user asks "where did we get to / what is still uncommitted".
- Before acting you find the working tree dirty but cannot tell who owns the changes.

## 1. Rebuild (machine facts first, not memory)

Run in order, all read-only:

| Question | Command | What to read |
|---|---|---|
| Where am I | `node .agents/skills/session-resume/scripts/worktree-audit.mjs` (classification + cleanup suggestions, read-only) | main / active / cleanable / stale, all at once |
| What is unsaved | `git status --porcelain -uall` + `git stash list` | untracked files and stashes (easiest to miss) |
| What is in flight | active states in `workflow/{plans,specs,intents,incidents}` + the last run in `.agents/cache/pipeline-runs/*.json` | task-list checkbox state, stage progress of orchestration runs |
| Where was the last green | last row of `.agents/verifications.jsonl` (pinned `headShort` + 24h window) | whether the current HEAD already has green evidence |

> The single source for L2/L3 plan checkbox alignment = "Session re-entry" in the Build chapter of `.agents/commands/stages.md`; this skill does not copy it, only supplements the L1 and cross-worktree cases.

### 1.5 Dream report loading (if present)

If `tmp/dream-report-*.md` or `tmp/dream-judge-brief-*.md` exists (gitignored runtime state; if deleted it can be rebuilt from git + the ledger), load it per `.agents/skills/dream/SKILL.md`:

1. Read the latest report and AI Judge brief;
2. Delegate independent-reviewer to verify the AI Judge samples;
3. Write verification conclusions back to papercuts / correction notes (no auto commit / push).

## 2. Align (stop first on mismatch)

- Checked but uncommitted / committed but unchecked / changes of unknown origin in the worktree → confirm ownership before continuing; do not overwrite.
- Across worktrees: uncommitted changes **do not** follow automatically. Compare the two trees with `git diff | sha1sum` to confirm whether they are the same set of changes, avoiding a double commit.
- Two branches pointing at the same commit but each with its own changes = two independent worktrees, not sharing.

## 3. Output (4-line brief, conclusion first)

```
Location: <worktree> @ <branch> (<headShort>), ahead/behind
Unsaved: <N modified / M deleted / K untracked / stash count>
Next: <next unchecked item in the active plan, or next stage of the run>
Blocked: <the single item requiring a user decision; write "none" if none>
```

## 4. Interruption handoff (pause)

Write `.agents/cache/handoff.md` (gitignored, local runtime state, disposable; git is the truth):

```
Date / branch / worktree / HEAD
In-flight task: <workflow file>
Completed: <checked items>
Next: <first item>
Uncommitted: <file list + ownership>
Blocked: <none / item>
```

On resume, read it first, then verify per §1; on mismatch, git wins, and write the handoff back.

## Red lines

- Do not continue from memory; do not overwrite uncommitted changes of unknown origin.
- Do not auto commit / push WIP; saving to disk is not committing and requires an explicit user request.
- Do not treat `.agents/cache/` as authoritative: after deletion it must be rebuildable from git + the ledger.
