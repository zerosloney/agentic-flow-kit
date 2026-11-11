---
description: "Deploy stage: merge checklist (static gates + pairing check + regression + DB + authorization + PR review merge)"
stage: Deploy
triggers:
  - "run the release"
  - "we can ship it"
  - "get ready to go live"
approval_required: true
next: .agents/commands/maintain.md (incidents only)
---

# Deploy · Merge Checklist

L1 is already closed out in `.agents/commands/new-task.md` §L1 Fast Track; this file is not opened for L1. This file starts from L2/L3 merges.
**Policy (owner 2026-10-29)**: no tag/24h observation ritual — merge = PR creation $\rightarrow$ review $\rightarrow$ regression $\rightarrow$ merge $\rightarrow$ archive (release tags and the release-observation ledger are retired; see git for history).

## 1. Static Gates
1. `node .agents/scripts/verify.mjs --full` (policy in the header note) all green $\rightarrow$ record evidence; any failure $\rightarrow$ **HALT** $\rightarrow$ return to the Build chapter in `stages.md`. Environment details in `.agents/notes/runtime-env.md` §1, §2

## 2. Documentation Audit
1. **Pairing check (L2/L3)**: `intents/` (or `incidents/`) $\leftrightarrow$ `specs/` $\leftrightarrow$ `plans/` all three present under the same name, all with status `done`
2. **Fix-type special case**: incident trio [structural fix / recurrence-prevention verification / rule entry] complete $\text{AND}$ status `closed`; if the root cause is a missing gate/rule $\rightarrow$ a new intent has been filed to track it
3. **Ruling backfill check**: if a ruling backfill modified a done document $\rightarrow$ re-confirmation compensation lines were backfilled in the same batch (`maintain.md` §4.4) $\rightarrow$ otherwise the pre-push fingerprint hard gate blocks it
4. **Merge closeout self-check**: **before merging**, verify that none of the four `workflow/` directories contain in-flight items that should have been closed in this batch (anything still `draft`/`approved` on the merge tree must be closed before merging)
**Output**: evidence that the closed-loop audit passed

## 3. Regression & DB
1. **Path verification**: all key paths of the affected modules in `workflow/regression-checklist.md` pass
2. **Automated verification**: all project test cases pass (do not skip failing cases); recurrence-prevention entries for historical incidents of the same kind pass one by one
3. **DB change (L3 special case)**: migration SQL $\leftrightarrow$ entity mapping consistent; record [backup point] + [rollback SQL path]; **the rollback SQL must have been executed in a dev rehearsal** (not rehearsed $\rightarrow$ treated as having no contingency plan $\rightarrow$ **HALT**)

## 4. Authorization & PR
1. **User authorization**: only accept the user themself saying "上" (go) or an equivalent confirmation in the conversation
2. **PR creation**: the panel-review trigger policy follows `.agents/commands/pr-review.md` (run it only when its trigger rules are met), then `node .agents/scripts/pr-create.mjs create --source <branch> --target <target> --title "<Conventional Commits in Chinese>" --body-file <file>` — the description carries the three Test evidence items (Summary / Evidence / Merge Danger, format in `review.md`); the automated review gate is retired (2026-11-09), and pr-create only delegates to tfs-pr; if a manual panel review was run, append one line to Evidence: `面板评审：<runId>（Important n / Nit n / Pre-existing n）`
3. **Review**: graded review per `.agents/commands/review.md` (logic $\rightarrow$ security $\rightarrow$ against spec/plan) — do not merge if the review fails
4. **Merge record**: record the PR number + merge commit SHA; release pipeline execution (if any) is manually approved by the user on the platform
**Output**: PR review record + merge SHA

## 5. Closeout & Fallback
1. **Archive**: archiving of the terminal-state family is done automatically by the `confirm-doc` closeout; this stage verifies that archiving occurred
2. **Exception fallback**: post-release exception $\rightarrow$ `workflow/incidents/` $\rightarrow$ `maintain.md` (the user decides the stop-the-bleeding plan; no cross-agent collaborative push of fixes)

## 🚫 Prohibitions
| Operation | Consequence | Exception |
|---|---|---|
| Rollback without rehearsal | $\rightarrow$ treated as no contingency plan | Must verify rollback SQL in dev |
| Bypass test closeout | $\rightarrow$ blocks merge | Documents must be set to done in the test stage first |
| Merge with failed review | $\rightarrow$ violates gate prerequisites | No merging while P0 is nonzero |
| Delegate rollback decisions | $\rightarrow$ violates security policy | Rollback decisions must involve the main Agent + the user |

## 🛠️ Auxiliary Tools
Version rollback = platform-side revert of the merged PR/commit
