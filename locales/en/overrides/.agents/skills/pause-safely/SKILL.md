---
name: pause-safely
description: Leave a resumable trail before a long run is interrupted or you step away — write a resume brief (state/next step/open items/evidence pointers), stop processes you started, do not commit or delete; use before pausing, going offline, context compression, or a session restart.
---

# pause-safely — Pausing with a trail

## Triggers

- The user says "stop for now / I'm leaving / continue tomorrow".
- Context is about to be compressed, or the session is about to restart.
- A long run (`autonomous-run` / `pipeline-run`) needs to be suspended.

## Steps

1. **Write a resume brief** to `tmp/pause-<slug>.md` (do not commit):
   - **State**: branch, HEAD short SHA, worktree path, summary of `git status --porcelain -uall`.
   - **Where you got to**: completed units + corresponding green evidence `headShort` / decision-trail rows.
   - **Next step**: the first unfinished action, concrete down to file/command.
   - **Open**: forks awaiting the user's decision, known risks, blocked items.
   - **Evidence pointers**: checkbox state of `workflow/plans/...`, `decisions.tsv`, `tmp/verify-*.log`, screenshot paths.
   - **Processes**: services/ports/PIDs you started (record only your own).
2. **Do not commit, push, or delete**: leave uncommitted changes as-is; ask the user first if a commit is needed.
3. **Stop processes**: stop only processes started by this session; do not kill by process name, kill by PID/port.
4. **Resume**: in the new session, rebuild first per `.agents/skills/session-resume/SKILL.md`, then read the resume brief; do not rely on memory.

## Boundaries

- Do not clean worktrees, delete temp files, or `git reset`—pausing is not wrap-up.
- Do not write the resume brief as a running diary; keep only the facts that let "the next person continue".
- Do not commit half-finished work; do not use `--no-verify`.
