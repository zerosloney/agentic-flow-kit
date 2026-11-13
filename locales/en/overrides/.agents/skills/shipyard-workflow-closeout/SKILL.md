---
name: shipyard-workflow-closeout
description: Shipyard.Material close-out sequence — verify --scope, acceptance checklist, closeout.mjs writing terminal state/index/commit, machine gates and failure recovery. Used to bring workflow documents to done/closed.
---

# Shipyard.Material close-out confirmation gate operation sequence

## Goal
Bring approved workflow documents to terminal state and leave auditable verification evidence, confirmation shards, and an index.

## Trigger conditions
- `workflow/{intents,specs,plans,incidents}` documents are to enter `done` or `closed`.

## Prerequisites
`approved` (incident `fixed`) is already in the current branch's git history. If still `draft` or `open`, first `confirm-doc` to `approved` / `fixed` and commit separately, then run the close-out below.

**L1 single-commit exception (from 2026-11-08 batch 2-D, `new-task.md` fast lane step 6)**: after L1's two consecutive approved→done hops, plan(done) + code + confirmation shard + verify evidence **go into the repository in the same commit** — approved need not be committed separately first, and this skill and closeout.mjs are **not used** (its candidate path list does not include product code, and the foreign-path guard rejects it); commit directly with git. Two hops for the same document may use the same release utterance; reuse across documents is forbidden. This skill remains only for "plan independent close-out" (code already committed in a previous commit) and L2/L3 / incident scenarios.

The status line is changed only by `confirm-doc.mjs`. Proxy recording uses the user's original utterance in the conversation. Commits do not use `--no-verify`. Self-done L1 does not write result lines into `workflow/delegations.md`; delegated tasks and self-done L2/L3 still leave traces per `stages.md` Test §5. **Way out when the commitment surface is rewritten**: `confirm-doc.mjs <doc> --reconfirm --delegated "<user's original utterance>"` — re-records the fingerprint and commitment-surface fingerprint, status remains approved (the status line is still written by the script, do not hand-edit frontmatter).

## Execution sequence

### 0. Close-out self-check (former check-loop §1/§3x hard responsibilities pushed down, 2026-10-21 gate minimization batch 2)
Check four items against the document family to close; if any is missing → fill it first before closing, never write done with gaps. Items 1 (L2/L3), 2, 3 (L2/L3 intent) have been moved earlier to machine enforcement at the `confirm-doc.mjs` close-out action (2026-11-08 closeout-skill-hardening) — humans only fill legacy stock and out-of-specialty cases; when the script rejects, fill per the error:

1. **Pairing self-check**: sibling documents of the same family present — L2/L3 intent must have same-named spec and plan (confirm-doc's `specConfirmed` / `planConfirmedFor` hard gates); intent (including legacy L1) must have a same-named plan; incident must have a same-named plan (L2/L3 additionally must have a same-named spec). L1 pairing remains a self-check: 2026-10-21 gate minimization downgraded the pairing hard gate to WARN, not re-hardened here.
2. **incident trio** (when closing an incident): `## 复盘三件套` section contains `1. 结构性修复 / 2. 防复发验证 / 3. 规范条目` all three + "whether a new intent is needed" line; if "yes" → the referenced intent path exists. Criterion single source `stage-gates.mjs / incidentTrioGate`, hard-blocked by confirm-doc for →fixed/→closed; legacy documents before the 2026-11-09 first-anchor addition and documents declaring `流程: legacy` / `存量确认态豁免（` remain manual self-check (same criteria).
3. **L2/L3 review context required**: persisted line format `- 独立复核：…（复核上下文：<session/subagent id>）`, starting with `- 独立复核：` and containing "复核上下文："; L2/L3 intent→done hard-blocked by confirm-doc's `reviewLineFor`, spec/plan and L1 remain self-check. If missing → **HALT**: go back to `.agents/commands/stages.md` Test §4 to add the independent review, persist that line, then close.
4. **Commitment surface not rewritten (new 2026-10-27)**: if the **commitment surface** (criteria text / red lines / goal / change plan) was changed after approval, the user must **nod again** before close-out — run `flow-kit run confirm-doc.mjs <doc> --reconfirm --delegated "<user's original utterance>"` to re-record the commitment-surface fingerprint (does not advance status). **Checking acceptance + evidence backfill / `确认结果` / review-line anchor changes do not count as commitment changes** (normalized; normal close-out unaffected).

Completion criteria: four items pass; machine gates per confirm-doc rejection messages, human self-check items verified one by one.

### 1. Verification
Run `flow-kit run verify.mjs --scope`. If just run in fast lane step 5 it can be reused; criteria no longer rely on memory: when the all-green line is persisted record `dirty` (snapshot of dirty paths under `backend/` `frontend/` at that time); at close-out confirm-doc compares current business dirty paths — business changes appearing after verify are judged stale evidence (24h window as before). Legacy green lines (without a dirty field) keep the original criteria.

Completion criteria: one exit code 0, and not judged "evidence stale" at close-out (if judged, rerun verify to refresh the snapshot). When scope judgment needs full coverage the script falls back itself; do not hand-edit `workflow/verify-evidence.md`. Ordering: the verify green line must be produced **before** the done transition (the dirty snapshot records current business dirty paths; code from the same-batch L1 single commit is already in the working tree at verify time, a path the green line has seen, so it is not judged stale).

Scope reconciliation (advisory, 2026-11-11 dev-tour wiring): run `flow-kit run gen-dev-tour.mjs workflow/plans/<name>.md --scope-report` — when "actual changes outside the document" is non-empty, explain or backfill the plan before closing (same criteria as dev-tour trigger conditions; complements the `check-scope.mjs` out-of-scope hard gate, here only prompts and never blocks, always exit 0).

### 2. Check acceptance
In the document check each acceptance item and write evidence, fixed format: `- [x] acceptance item` with "证据：<command output / path / verification record>" on the same line or immediately following continuation line. Criterion single source `stage-gates.mjs / acceptanceEvidenceGate` (close-out format gate): unchecked items, checked items missing the "证据：" annotation, and L2/L3 specs without a "验收判据" data row are all rejected at confirm-doc. L1 checks the plan. L2/L3 new requirements check the intent. Fixes check the incident, path is `open` → `fixed` → `closed`.

Completion criteria: every acceptance item points to evidence (command output, path, or verification record); for the L1 single commit, checking and evidence backfill must be completed **before commit** (checks go into the same commit's plan(done) blob).

**Check semantics (criteria declaration, 2026-11-10)**: document checks fall into three classes; done is unrelated to total check count — ① task-breakdown checks = process trace / session re-entry anchor (e.g., `stages.md` §1 shortcut check reads check state to align progress); not all checked ≠ not complete, not a reason to withhold close-out; ② entry red-line questionnaires are negative declarations; L1 all unchecked is the correct "not touched" state; ③ the only check criterion for done = acceptance criteria section each `[x]` cleared + evidence line (this section's acceptanceEvidenceGate). Fabricating backfilled checks for "tidiness" is forbidden.

### 3. Proxy-record terminal state
First choice is one call `flow-kit run closeout.mjs <doc> --delegated "<user's original utterance>"` (chains §3–§5; usage and failure recovery see §5.1); the three steps below are the manual equivalent path.

Manual proxy record: `flow-kit run confirm-doc.mjs <doc> --delegated "<user's original utterance>"`.

Incident from `fixed` to `closed` run once more. When spec is marked `done`, step 1's all-green evidence already exists.

Completion criteria: target document status is `done` or `closed`, body remains unchanged after this proxy record.

### 4. Index
Run `flow-kit run gen-workflow-index.mjs`.

Completion criteria: `workflow/INDEX.md` regenerated from disk.

### 5. Commit
`git add` these paths: `.agents/confirmations.d/<document basename>.jsonl`, `workflow/INDEX.md`, `workflow/verify-evidence.md`, and the closed documents. Add `.agents/confirmations.jsonl` only if this diff touched it.

Before commit inspect that shard's `git diff`, keep only this session's confirmation lines. `closeout.mjs` has automatically added per this list and checks that the staging area contains only candidate paths (any other in-flight change = reject); commits do not use `--no-verify`.

Commit message: `docs(workflow): <batch> close-out`.

Completion criteria: above paths committed, hooks pass.

### 5.1 Single call and failure recovery (re-entry)

`flow-kit run closeout.mjs <doc> --delegated "<user's original utterance>" [--msg "<commit subject>"] [--dry-run]`

Chain order: confirm-doc writes terminal state → gen-workflow-index regenerates → git add fixed path list → git commit. Incident's two hops run once each (`fixed` and `closed`). `--dry-run` reports only current status / next hop / candidate path changes; no state, no write, no commit.

On any step failure stop, fix the cause then **rerun the same command** (idempotent: terminal state skips proxy record, index generation idempotent, no staged changes skips commit):

- confirm-doc rejects: that document not recorded, not written; fill per the error (pairing / trio / review line / acceptance evidence / delegation ledger) then rerun.
- Evidence stale: rerun `verify.mjs --scope` to refresh the dirty snapshot then rerun.
- Commitment-surface fingerprint mismatch: first `confirm-doc.mjs <doc> --reconfirm --delegated "<user's original utterance>"` to re-nod, then close out.
- Staging area contains foreign paths: the script rejects the commit and lists them; commit or revert these paths separately then rerun (proxy record and index already done; rerun only commits).
- Hook rejects the commit: fix the hook cause then rerun, do not use `--no-verify`.

> L1 single commit does not use this entry (see "Prerequisites" exception) — that path has only one git commit and no separate close-out commit.

### 6. Backfill feature docs

Write this behavior change into the corresponding living doc, and leave a pointer in plan / incident; keep only one doc per feature:

| Change type | Backfill target |
|---|---|
| User-visible interaction / path | `.agents/skills/verify-ui/features/<feature>.md` |
| Contract / rule / data criteria | Amend the original spec in place (`workflow/README.md` spec lifecycle) |
| Anti-recurrence assertion | Corresponding module section of `workflow/regression-checklist.md` |
| Architecture / approach | `wiki/开发方案/` |

Append only change facts and evidence pointers, do not copy the whole doc; backfill goes with the close-out commit. If no corresponding doc exists, create one with the feature key in the topic.

### 7. Recipe recovery (long tasks / detours, not incidents)

Criteria (any): the same action repeated $\ge 2$ times in this session; the same spot reworked $\ge 2$ times; $\ge 2$ rounds probing to locate an entry or environment.

Action: write the recipe back to one authoritative file — prefer editing existing command / skill / role text, do not create a new skill. Placement level per `.agents/skills/papercut-fix/SKILL.md` §0 ladder; this loop usually lands at level 5 (text).

Wording: one trigger condition + one action step + one identifiable verification; cite this session's blocker, generic advice forbidden.

Do not: one-off environment failures (go to `.agents/notes/runtime-env.local.md` or papercuts `[env]`); incidents follow `.agents/commands/maintain.md` trio.

Commit: `docs(engine)` separate commit, no business code.
