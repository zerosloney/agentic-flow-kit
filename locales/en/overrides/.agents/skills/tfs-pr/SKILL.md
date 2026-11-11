---
name: tfs-pr
description: Internal self-hosted TFS / Azure DevOps Server PR skill, project-agnostic — auto-detects the git repository and remote to derive collection/project/repo, guides creation and saves an env var when PAT is missing; query PR / create PR (context pulls diff to distill title and description) / update PR description / conflict pre-check and worktree-isolated resolution, via REST API + PAT (the az devops extension rejects http organization URLs, so az is unavailable). Command entry .agents/skills/tfs-pr/scripts/tfs-pr.mjs.
---

# tfs-pr — Internal TFS / Azure DevOps Server PR (project-agnostic)

Zero project assumptions: if the remote is in TFS / Azure DevOps form (path contains `_git`), or a collection URL can be provided, it is usable. The skill directory is self-contained. Host side holds only pointer shells (this repo only `.codebuddy`; the `.trae` shell was removed 2026-11-08); main-copy changes carry no synchronization obligation. Below, `tfs-pr` refers to `node .agents/skills/tfs-pr/scripts/tfs-pr.mjs`.

## Trigger / do not trigger
- Trigger: internal TFS transactions such as "check PR / any conflicts", "add / update PR description", "resolve PR conflicts"; `az devops login` reporting "Refusing to attach credentials to an invalid Azure DevOps organization URL" → switch to this skill, do not retry az.
- Trigger (PR creation class): when the host has a unique PR entry convention (e.g., Shipyard.Material's `pr-create.mjs`), "create PR / push and create PR" **does not directly trigger this skill** — PR creation only goes through the host's unique entry `node .agents/scripts/pr-create.mjs` (which internally calls `tfs-pr create`); agents are forbidden to bypass the host entry and call `tfs-pr create` directly. Hosts without this convention may keep direct triggering. (This repo's former review pre-step was retired to a manual tool on 2026-11-09: panel review runs manually on demand, see `.agents/commands/pr-review.md`.)
- Do not trigger: GitHub / GitLab and other public hosted PRs; ordinary code review, commit messages.

## 0. Prerequisite probing
```bash
git rev-parse --is-inside-work-tree   # non-zero → not a git repository, stop and inform
tfs-pr target                          # base/project/repo/tokenUrl/prPage, zero requests, no PAT needed
```
- `target` errors carry remediation: ask the user for a collection URL (form `http://<host>:<port>/tfs/<collection>`), place per `--base` (single run) / `TFS_BASE` (env var) / `git config tfs-pr.base` (repo level); override project / repo with `--project` / `--repo`; non-origin remotes use `--remote` / `TFS_REMOTE`.
- Recognized remote forms: `ssh://host:22/tfs/COLL/PROJ/_git/R`, `git@host:tfs/...` (scp style), `https://host/tfs/COLL/PROJ/_git/R`, root mount (no /tfs), short form (project==collection), `dev.azure.com` / `*.visualstudio.com`.
- ssh remote web base defaults to `http://<host>:8080`, overridden by `TFS_WEB_SCHEME` / `TFS_WEB_PORT`; old TFS set `TFS_API_VERSION=4.1` (default 6.0); target branch can be fixed with `git config tfs-pr.target <branch>`.

## 1. PAT: read → guide → use
Store only in environment variables (never in argv / conversation / prints): single server uses global `TFS_PAT`; multiple servers store per base hostname `TFS_PAT_<HOST>` (non-alphanumerics become `_` uppercase, e.g., `TFS_PAT_10_0_0_1`, matched preferentially).
- Probe and guide in one command: `tfs-pr setup` — prints process/user-level status of the two variables, dynamic portal `<base>/_usersSettings/tokens` (hardcoding site IP forbidden), setx command, whoami self-check. Not configured → give the user the three steps printed by setup: portal generation (scopes check Code Read&Write + Pull Request Read&Write + **Work Items Read** — required for verifying linked work items after creation; without this scope the verification step gets 401) → `setx <variable> "<PAT>"` (effective in a new terminal) → `tfs-pr whoami` real verification (non-empty length ≠ valid PAT).
- After setx the current process does not inherit: read from registry and feed the script, the value must not appear on the command line: `TFS_PAT="$(powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('TFS_PAT','User')")" tfs-pr …` (same for split variables).
- Fallback `--pat-file` only when the user explicitly does not use env vars; clean up with `rm -f`; if PAT leaks into conversation/logs/history → at wrap-up must remind to revoke and recreate in the portal.

## 2. Commands
| Action | Command | Description |
|---|---|---|
| Identify target | `tfs-pr target` | base/project/repo/tokenUrl/prPage |
| PAT guidance | `tfs-pr setup` | portal address + persistence + self-check commands |
| Verify PAT | `tfs-pr whoami` | current identity + base/project/repo + PR page |
| List PRs | `tfs-pr list [--source <b>] [--target <b>] [--status active\|all] [--json]` | `#12 [active/succeeded] feat/x → develop <title>` |
| Get one | `tfs-pr get <id> [--json]` | status/mergeStatus + PR page URL; JSON contains the full description |
| Pre-create context | `tfs-pr context [--source <b>] [--target <b>] [--no-fetch] [--patch] [--json]` | commits/files/stat/overlap/conflicts/push/dirty in one shot |
| Create PR | `tfs-pr create [--source <b>] [--target <b>] --title <t> --body-file <f\|-> [--dry-run] [--json]` | `CREATED #id …` or idempotent `EXISTING #id` |
| Update description | `tfs-pr desc <id> --body-file <f\|-> [--dry-run] [--json]` | `UPDATED #id …` (already read back and compared) |
| Conflict pre-check | `tfs-pr conflicts <id> [--no-fetch] [--json]` | fetch conflicts/overlap/mergeBase by PR branch |
| Local conflict pre-check | `tfs-pr conflicts --source <b> --target <b> [--no-fetch] [--json]` | no PAT, no PR id needed |

- source defaults to current branch (detached HEAD requires `--source`); target defaults to `--target` / `TFS_TARGET` / `git config tfs-pr.target` / remote HEAD; branch names need no `refs/heads/` prefix.
- `--body-file -` reads body from stdin, no temp file; body UTF-8 (BOM auto-stripped), Chinese and line breaks as-is.
- `--dry-run` zero requests and no PAT needed; exit code 0 success (including EXISTING) / 1 HTTP·API·network error / 2 usage·configuration error.

## 3. Create PR: distill title and description from the diff
1. `tfs-pr context --target <target branch> --json` (auto-fetch by default; `--no-fetch` only offline or fresh refs). Output: commits, files, stat/shortstat, overlap (both sides changed), conflicts (merge-tree; `conflictsSupported=false` means git does not support pre-check, do not treat as no conflict), push (unpushed/no remote branch), dirty (uncommitted changes).
2. Pre-create checks: `push.unpushed` or no remote branch → normal `git push` first (if blocked by gates fix the root cause; `--no-verify` / force push forbidden); `dirty` → confirm whether uncommitted changes enter the PR, do not silently ignore; `conflicts.files` non-empty → resolve per §5 first; `overlap` non-empty but no textual conflict → manually review both changes for semantic confirmation.
3. To see specific changes, read key files or `git diff origin/<target branch>...HEAD` (`--patch` may attach the full diff).
4. **Title**: Conventional Commits Chinese `feat(scope): summary` (compound topics joined with `+`, about 70 characters, empty title / PR number forbidden); scope takes the main module/directory, the subject is distilled from the diff's main changes + commits, not a restatement of commit messages.
   - **`#number` prohibition (empirically 2026-10-26)**: in commit messages / PR titles / PR descriptions, **references to PR numbers must always be written "PR 720", never `#720`** — `#N` is work-item linking syntax; pushing automatically links work item N to the commit and PR; PR numbers and work item IDs share the same numeric space, so unrelated work items will definitely collide (PR #719 was once wrongly linked this way). `#N` is used only when genuinely linking a work item. **In PR descriptions, reference other PRs with markdown links** (`[PR 720](<prPage>/<id>)`, `prPage` see `target` output, single-page URL is `pullrequest/<id>`); linking at the first occurrence of a PR number suffices, the rest plain text.
5. **Description** (`create` / `desc` both replace the whole segment, must give the complete body; the template is a **default value** — when the host repo already has its own PR body convention, the host convention prevails; check the host's review/merge docs, this template is only a fallback):
   ```markdown
   ## Summary
   - Why the change, what changed (1-4 items, pointing at key modules/files; must come from the actual diff)

   ## Evidence
   - Tests/builds/manual verification actually run; if not run, explicitly write "not run" and the reason, fabrication forbidden

   ## Merge Danger
   - Door: impact surface (API / DB / config / permissions / compatibility); write "none" if no risk, omission forbidden
   - Blast Radius: local / module / global
   - Rollback: rollback method and risk
   ```
   Large diff, non-empty overlap, or irreversible change → append `## Tradeoffs`: cite the real shortstat scale + why this is still done.
6. `--dry-run` first to verify URL and body, then create officially; `mergeStatus=queued` poll with `get`, `conflicts` go to §5; return the PR page URL to the user.

## 4. Update PR description
`get <id> --json` read existing → decide replace or supplement (supplement = merge new content into existing, keep useful three sections) → `desc <id> --body-file -` (stdin) or file. **desc replaces the whole segment, it is not an append**; incremental fragments overwriting the original are forbidden. If the source branch has new commits → rerun context before updating the description, to prevent Summary drifting from the actual diff.

## 5. Resolve PR conflicts
Locate: `tfs-pr conflicts <id> --json` (take branch from PR → fetch → merge-tree + overlap + mergeBase). Server-side conflicts but empty locally → refs stale/server not refreshed, fetch again then `get` confirm, **directly asserting no conflict is forbidden**.

Resolve (worktree isolation; do not touch the user's current working area; do not stash/reset the user's uncommitted changes):
```bash
git fetch <remote> <src> <tgt>
git worktree add <tmp>/pr-<id> -b tfs-pr/<id>-resolve refs/remotes/<remote>/<src>
cd <tmp>/pr-<id> && git merge refs/remotes/<remote>/<tgt>
# resolve file by file, preserve both intents; blind --ours/--theirs forbidden; even auto-merged overlaps must pass semantic review (callers/config/migrations/contracts)
# run project tests/build; stage only resolved files; commit message states which conflicts were resolved — PR numbers must not be written #N (same §3 step 4 prohibition: #N wrongly links unrelated work items, write "PR 720")
git push <remote> HEAD:<src>
```
- No force push (including `--force-with-lease`, unless the user explicitly confirms); a blocked push = gate enforcement, fix the root cause, `--no-verify` forbidden; if branch policy forbids direct push → stop and report options, do not bypass.
- fork source branch local fetch failure → ask the user for the source repo or resolve in the source repo, do not guess; PR already completed/abandoned → do not resolve conflicts, report status.
- Wrap-up delete only worktrees/branches created by this skill: `git worktree remove <tmp>/pr-<id> && git branch -D tfs-pr/<id>-resolve`, touch no user branch/worktree.
- Recheck: `get <id>` → mergeStatus leaves conflicts (poll queued until converged) before considering complete.

## 6. Error interpretation
- **Three response judgments** (built into the script; manual troubleshooting in the same order): first judge `status` → then judge `content-type` (`401 + text/html` = missing/wrong credentials, common `TF400813`; direct `JSON.parse` only yields misleading `Unexpected token '<'`, hard parse forbidden) → confirm JSON then parse.
- `401 JSON` = PAT invalid/expired/insufficient scope (rebuild in portal); `404 JSON` = base points to wrong site/port (e.g., API on 8080 but base points to 80) or project/repo misspelled (check `target`); `EXISTING` = an active PR already exists from the same source→target (switch to `desc` or abandon first); network/TLS errors check VPN/proxy/certificate (`--verbose` prints only URLs, not PAT).

## 7. Wrap-up criteria
After query/create/update, status/mergeStatus match expectations (desc already read back and compared); **linked work items verified** (`curl -s -u ":$TFS_PAT" "<base>/<project>/_apis/git/repositories/<repo>/pullrequests/<id>/workitems?api-version=6.0"` lists them, verify each against expected work items — this repo defaults to no work-item link, non-empty must be explained; wrong links must be removed in the portal and rechecked as empty; when the PAT lacks the Work Items Read scope this step returns 401 and requires manual portal verification); PR page URL returned to the user; after conflict resolution push succeeds and conflicts no longer appear; temporary body/credential files deleted; PAT not in repository/logs/conversation, leaks reminded to revoke; report PR number, URL, status/mergeStatus, and verification actually performed; if tests were not run, say so explicitly.
