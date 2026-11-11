---
description: "Maintain stage: file an incident + retrospective trio (fix / recurrence prevention / rule entry)"
stage: Maintain
triggers:
  - "file an incident"
  - "production is down"
  - "log an incident"
  - "something broke, root cause xxx"
delegation:
  - role: implementer
    instructions: .agents/roles/implementer.md
    when: the user has chosen the stop-the-bleeding or structural fix plan, the reproduction path and authorized files are clear, and the task meets the role contract
    required: false
    fallback: main
approval_required: true
next: .agents/commands/stages.md Plan chapter (if the retrospective needs a new intent)
---

# Maintain · File an Incident + Retrospective Trio

For L1 that is not a production incident, a recurrence, data, or a contract change: do only §1 (file the document), then return to `.agents/commands/new-task.md` §L1 Fast Track. §0 stop-the-bleeding and §2 the retrospective trio are reserved for production incidents and L2/L3. An incident must still be filed.

## 0. Active Incident (Emergency Stop-the-Bleeding)
**Input**: failure symptoms / logs
**Process**:
1. **Diagnose**: read logs + code $\rightarrow$ provide [stop-the-bleeding options (revert/rollback/hotfix/degrade)] + [impact surface / time cost]
2. **Execute**: the user decides the plan $\rightarrow$ AI only executes the chosen plan (no self-initiated pushing of fixes)
3. **Verify**: after the hotfix, run `node .agents/scripts/verify.mjs --scope` (policy in the header note)
**Output**: service restored $\rightarrow$ enter the retrospective flow

## 1. Draft the Incident
**Input**: failure context after stop-the-bleeding completes
**Process**:
1. **Similar-case search**: `node .agents/scripts/kb-search.mjs "<keyword>" --scope workflow --type incidents` $\rightarrow$ cite existing recurrence-prevention entries
2. **Create document**: copy `_TEMPLATE.md` $\rightarrow$ `workflow/incidents/{name}.md`
3. **Fill in content**: [timeline (discovery$\rightarrow$recovery)] / [impact surface] / [root cause (underlying reason)] / [gate-failure analysis]
**Output**: `workflow/incidents/{name}.md` (Status: Draft)

## 2. Draft the Retrospective Trio (The Trio)
**Requirement**: all three items are mandatory; recurrence-prevention commitments must not remain only in documents.
**Process**:
1. **Structural fix**: record [fix commit SHA + file list] $\rightarrow$ decide whether a new intent is needed (if the root cause is a missing gate / unimplemented rule $\rightarrow$ mandatory `workflow/intents/`). **Attack the premise**: when under the same premise two fix approaches both fail the same verification, stop and write down the premise itself and test it directly — prevent "reskinned fixes" from slipping through the retrospective
2. **Recurrence-prevention verification**: must land as [automated test case / `stages.md` Test chapter step / `regression-checklist.md` entry]; from the day a fixed/closed document is filed, check-loop §3x hard-blocks "no automated test case / regression-checklist reference" (no "manually verified")
3. **Rule entry**: landing priority order: `regression-checklist.md` $\rightarrow$ `hooks/` $\rightarrow$ `skills/` $\rightarrow$ `notes/` $\rightarrow$ `commands/` (root `AGENTS.md` is prohibited). **Fix-strength ladder**: the landing order is positional; strength is judged separately — architectural consolidation/hooks/CI > automated test cases > rule text; when landing as rule text, the retrospective must state "why the stronger tier cannot block it"
**Output**: landing verification plan + rule change record

## 3. Confirmation & Landing
This section starts from production incidents and L2/L3.
**Process**:
1. **HALT**: output the incident + trio drafts $\rightarrow$ wait for user confirmation
2. **Stepwise confirmation**: incident draft / spec / plan confirmed independently (no combining)
3. **Pre-check**: before L2/L3 confirmation $\rightarrow$ `fill-spec`/`confirm-doc` verifies that "the timeline includes user confirmation" is recorded $\rightarrow$ if not, backfill
4. **Landing execution**:
   - **Pair with plan**: must create a same-named `workflow/plans/{name}.md` (incident $\equiv$ intent, but plan cannot be omitted)
   - **Implement the fix**: L1 $\rightarrow$ return to `.agents/commands/new-task.md` §L1 Fast Track (the same-named L1 plan is the entry; do not enter `stages.md`); L2/L3 $\rightarrow$ `stages.md` Design $\rightarrow$ Build $\rightarrow$ Test chapters
   - **Land the trio**: execute the verification and rule changes from §2
**Next**: if systemic issues need tracking $\rightarrow$ `.agents/commands/stages.md` Plan chapter to file a new intent

## 4. Closeout After Confirmation
**Process**:
1. **Status transitions**: `open` $\rightarrow$ `fixed` (trio landed) $\rightarrow$ `closed` (recurrence-prevention verification passed)
2. **State entry point**: `confirm-doc.mjs` migrates step by step (policy in `new-task.md` Fast Track step 4)
3. **Reconciliation**: `check-loop 15` verifies the order of [closeout edit $\rightarrow$ closed confirmation]
4. **Ruling backfill after closeout**: if a done/closed document genuinely needs a ruling backfilled $\rightarrow$ change the body and in the **same batch** append a **re-confirmation compensation line** to `.agents/confirmations.jsonl` — same doc+stage, fingerprint = post-edit content fingerprint (bindingSha256), prev uses the original line, quote = the user's ruling verbatim (source: chat-delegated); append-only, do not alter historical lines; check-loop 15 takes effect based on the last done line (re-confirmation scenario). Note that `confirm-doc` has no forward transition for terminal-state documents, so append the compensation line directly to the ledger. **Generator**: `node .agents/scripts/append-compensation.mjs <doc...> --quote "<user's verbatim words>"`; hand-crafted hashes are blocked by the s15 content-drift gate

## 🚫 Prohibitions
| Operation | Consequence / machine behavior | Exception |
|---|---|---|
| Commitment stays in documents | $\rightarrow$ treated as not closed | Must land as code/script/checklist |
| Landing in root AGENTS | $\rightarrow$ violates single-source discipline | Must push down to notes/commands/hooks |
| Single-hop status | check-loop 15 blocks | Must be fixed $\rightarrow$ closed |
| Editing the body after closeout without backfill | check-loop 15 fingerprint-drift block | Ruling backfill must include re-confirmation compensation lines in the same batch (see §4.4) |

## 🛠️ Auxiliary Tools
- **Root-cause diagnosis**: `diagnosing-bugs` diagnostic loop
- **Incident triage**: `triage` state-machine approach
