---
description: "L2/L3 staged flow (four-in-one): Plan files intent → Design drafts spec → Build drafts plan + implements code → Test static gates + UI verification + review + closeout; L1 uses the new-task.md fast track"
stage:
  - Plan
  - Design
  - Build
  - Test
triggers:
  - "start an intent"
  - "file an intent"
  - "start a spec"
  - "continue with the spec"
  - "intent reviewed"
  - "walk through the spec"
  - "start a plan"
  - "spec is fine"
  - "start writing"
  - "get to work"
  - "plan is good"
  - "run verify"
  - "changes done"
  - "run verify and see"
  - "verify it"
delegation:
  - role: independent-reviewer
    instructions: .agents/roles/independent-reviewer.md
    when: L2 / L3 spec draft complete and before user confirmation (Design §3); L2 or L3 changes complete and diff fixed (Test §4)
    required: true
    attach:
      - acceptance criteria of the same-named spec
      - fixed git range: git rev-parse <baseline> resolves, and git diff <baseline>...<HEAD> is non-empty
      - level is L2 or L3
      - new session, not the same context as the implementation
      - conclusion's first line is `reviewed by <model name>`
      - persistence line written by the main agent into the document's "Confirmation and Review" per .agents/roles/independent-reviewer.md
      - do not modify any repository file
  - role: ui-verifier
    instructions: .agents/roles/ui-verifier.md
    when: UI changes involved and static gates have passed
    required: true
    fallback: main
  - role: implementer
    instructions: .agents/roles/implementer.md
    when: plan and change-file list both confirmed, and the work-package boundary meets the role contract
    required: false
    fallback: main
approval_required: true
next: chapter order Plan → Design → Build → Test; after Test, L2/L3 merge (PR review merge) → .agents/commands/deploy.md; L1 → .agents/commands/new-task.md §L1 Fast Track
---

<!-- 2026-11-08 tier 2-F four-in-one (formerly plan/design/build/test.md), see git for history -->

L1's filing, implementation, verification, and closeout are all in `.agents/commands/new-task.md` §L1 Fast Track; this file's four chapters Plan → Design → Build → Test serve only the L2/L3 staged flow. L1 opens it only when Plan §1 finds an existing same-named in-flight document, to align progress, then returns to the fast track.

# Plan · L2/L3 File Intent

The level is already set by `new-task.md`; this chapter branches by level and must not re-grade.

## 1. Admission and Shortcuts
**Input**: user's raw requirement text + already-assigned level
**Process**:
1. **Shortcut check (also session re-entry, session-context)**: L1 checks whether `workflow/plans/` already has a same-named plan; L2/L3 checks whether `workflow/intents/` already has an approved intent. Existing and **terminal** → jump per `next`; existing and **in flight** (draft/approved, checked ≠ complete) → this is re-entry, not a new creation: read the plan's check states and `git status` to align subsequent work, do not file a new document. L1 returns to the fast track and does not enter the Build chapter.
2. **Similar-case search**: `node .agents/scripts/kb-search.mjs "<keyword>" --scope workflow --type intents,plans,specs` $\rightarrow$ on a same-kind hit, read the conclusion and acceptance criteria first
**Output**: confirmed no same-kind entry / existing approved entry

## 3. L2/L3: Draft Intent
**Process**:
1. **Generate draft**: `node .agents/scripts/fill-intent.mjs --module <module> --level <L2|L3> --topic <topic> --output workflow/intents/<date>-<topic>.md --notes "<note>"`
2. **Fill in**: background and problem / historical lessons and recurrence prevention / goals / non-goals / constraints / impact surface / touched red lines / acceptance criteria
3. **Red-line check**: against root `AGENTS.md` and directory-level `AGENTS.md`. If not touched, do not check.
**Output**: `workflow/intents/{name}.md` (Status: Draft)
**Next**: Design chapter

## 4. Confirmation and State Transition
**Process**:
1. **HALT**: output the full draft $\rightarrow$ wait for user confirmation
2. **Status transition**: $\text{draft} \rightarrow \text{approved}$ (policy per `new-task.md` Fast Track step 4)
3. **Trace commit**: L2/L3 immediately commit separately as `docs(workflow)`; **L1 single commit** — after verification is green, jump to done; plan(done)+code+confirmation shard+credentials land in the tree in the same commit, with no separate closeout commit (policy single source `new-task.md` Fast Track steps 4/6).
**Next**: L1 $\rightarrow$ `.agents/commands/new-task.md` §L1 Fast Track / L2,L3 $\rightarrow$ Design chapter

## 🚫 Prohibitions
| Operation | Machine behavior | Exception |
|---|---|---|
| Force-check red lines | check-loop judges "red-line under-grading" | Must be actually touched to check |
| Force-fill criteria | Acceptance criteria untestable | If unclear, must HALT and clarify |
| Directly edit status | Status transition disabled | Must go through `confirm-doc` |

## 🛠️ Auxiliary Tools
- **Requirement grilling**: `grilling` (backfill the 6 sections after answering)

# Design · Draft Spec

## 1. Admission and Level Judgment
**Input**: `workflow/intents/{name}.md` (Approved) or a confirmed incident draft. Level is L2 or L3.
**Process**:
1. **L1 forbidden in this stage**: on encountering L1 $\rightarrow$ **HALT** $\rightarrow$ return to `.agents/commands/new-task.md` §L1 Fast Track. This stage drafts only L2/L3 specs
2. **Pre-check**: if the entry document has not passed the confirmation gate $\rightarrow$ **HALT** $\rightarrow$ return to the Plan chapter / `maintain.md` (exit 2)
3. **Level determination** (against `new-task.md` two questions):
   - **L2** (rule/contract): must draft a spec $\rightarrow$ **mandatory independent review** (independent subagent or new session)
   - **L3** (structure/Schema): must draft a spec $\rightarrow$ **mandatory independent review** (same as above, cross-model preferred)
**Output**: determined design level (L2/L3)

## 2. Draft Spec
**Input**: selected level + entry document
**Required inputs (complete before drafting; missing any one means HALT and return to this section to read; comparison results go into "Constraint Compliance Mapping" and "Assumptions and Inferences")**:
1. Search `wiki/INDEX.md` for task documents related to this topic (product requirements / development plans / project rules / data dictionary / user features) — on a hit, read fully and write the basis into the relevant spec sections as path references (the source of the policy for feature behavior / data flow); if no hit, state the search terms and conclusion
2. The full text of `backend/AGENTS.md` (§6 hard constraints / §7 machine-gate checklist) — **regardless of whether this change touches the backend**
3. The full text of `frontend/AGENTS.md` (gates G-2~G-3 / contract rules / list-page state rules)
**Process**:
0. **Check before creating**: if a same-feature spec already exists (including archived) / `verify-ui/features` $\rightarrow$ revise the original, do not create new (single source `workflow/README.md` "same-feature continuation")
1. **Generate draft**: run `node .agents/scripts/fill-spec.mjs --level <L2|L3> --topic <topic> --output workflow/specs/<date>-<topic>.md`
2. **Fill in content**: copy `_TEMPLATE.md` $\rightarrow$ fill in [feature behavior / data flow / system changes / constraint compliance mapping / risk assessment]
3. **Constraint check**: against red lines in root `AGENTS.md` and directory-level `AGENTS.md`, explain how each is satisfied
4. **Interaction confirmation**: explicitly mark the entry form (form/selector/dialog); do not presume
5. **Entry verification**: [frontend-specific] search button events $\rightarrow$ trace router/Drawer $\rightarrow$ locate the actual rendering file $\rightarrow$ mark **entry evidence (file+line)** in the "System Change List"
6. **Solution tradeoffs**: with multiple solutions $\rightarrow$ list [solution comparison table (tradeoff + recommendation)] $\rightarrow$ **HALT** $\rightarrow$ user selects. When branches are real and reasoning cannot decide (contract shape / data flow / performance tradeoff), first open **2 parallel solution routes** (a subagent per solution, read-only on the repository, output into the conversation or `tmp/`, no repository file changes), compare per "solution | key tradeoff | risk | evidence"; cap at 2 routes, do not run when reasoning can decide, and do not consume implementation-surface delegation concurrency
7. **Ambiguity scan**: write an "ambiguity checklist", one line per 6 dimensions — state and boundaries / data policy / failure paths / contract symmetry / existing data / acceptance testability. Column order `dimension | conclusion | basis | status`.
   - Experimentable $\rightarrow$ experiment first, write the experiment result as the basis, **do not ask the user**.
   - Cannot be decided by experiment $\rightarrow$ status `待澄清` (to be clarified), ask in the current round.
   - Upper bound: ≤2 lines per dimension, ≤12 total, ≤5 questions per round.
   - Inferential conclusions $\rightarrow$ record separately in "Assumptions and Inferences".
   - Missing section / missing dimension / 待澄清 ≠ 0 / empty basis / out of bounds → confirmation gate rejects.
8. **Premise interrogation**: write a "premise interrogation" table — list the interpretive premises on which the spec's argument rests (e.g. "display need vs storage rewrite"), counter-question the opposing interpretation for each, and write the chosen basis; for small items with no interpretation risk, write one line "no key premises" + reason. Missing section / empty table / placeholder / missing counter-question or missing basis → confirmation gate rejects (anchored at premiseSince; the plug for the 10-23 identity-overwrite three-layer same-source failure)
**Output**: `workflow/specs/{name}.md` (Status: Draft)

## 3. Independent Review (L2/L3 Mandatory)
L2/L3 mandatory: delegate `independent-reviewer`; trigger, form, required inputs, and persistence policy follow `.agents/roles/independent-reviewer.md` "Review Policy" (not restated here)
**Output**: review failed $\rightarrow$ return to §2 to revise the spec

## 4. Confirmation and State Transition
**Process**:
1. **HALT**: output the full spec $\rightarrow$ wait for user confirmation. Before confirmation, self-check the ambiguity checklist and premise interrogation: 待澄清 zeroed, 6 dimensions complete, every line has a basis, premises have counter-questions and chosen bases (otherwise the transition is rejected)
2. **Status transition**: $\text{draft} \rightarrow \text{approved}$
3. **State entry point**: run `node .agents/scripts/confirm-doc.mjs <path>` (policy per `new-task.md` Fast Track step 4, not restated here)
4. **Trace commit**: immediately commit separately as `docs(workflow)`
**Next**: Build chapter

## 🚫 Prohibitions
| Operation | Consequence / machine behavior | Exception |
|---|---|---|
| Routing guesses the entry | → whole-round rework | Must provide measured evidence with file+line |
| Presuming interaction | → UI does not match requirements | Form must be confirmed by the user |
| L3 self-check masquerade | `.agents/skills/shipyard-workflow-closeout/SKILL.md` §0.3 HALT. check-loop only WARNs on missing review context | Must be executed by `independent-reviewer` |
| Passing the confirmation gate with "待澄清" unresolved | `confirm-doc` rejects (ambiguity unresolved, exit 2, no persistence, no accounting); missing dimension / empty basis also rejected | Ask the user for a decision before transitioning |
| Premises entering the fact source without interrogation | `confirm-doc` rejects (premise interrogation missing section / empty / placeholder / missing counter-question or basis, exit 2) | If there is no interpretation risk, write a "no key premises" line with a reason |
| Asking the user about experimentable items | Extra round of confirmation tax, and the answer is obtainable by running | Query DB / run eval / prototype first; write the experiment conclusion as the basis |
| "Decided" without writing a basis | `confirm-doc` rejects (equivalent to not having thought) | The basis must be identifiable (section number / code path / DB query result) |
| Skipping required inputs / constraint mapping missing backend/frontend AGENTS entries | → independent review rejects and reworks (a missing mapping source counts as not doing the constraint check) | The two directory specs are the repository-wide contract baseline, independent of this change's surface; wiki no-hit may exempt item 1 (must state the search terms) |

# Build · Draft Plan + Write Code

L1 does not draft a plan in this chapter; return to `.agents/commands/new-task.md` §L1 Fast Track step 4; this chapter is only for L2/L3 implementation, or delegating implementer (§3), handling plan deviations.

## 1. Draft Plan
**Input**: `workflow/intents/{name}.md` (Approved) + `workflow/specs/{name}.md` (Approved)
**Process**:
1. **Create document**: copy `_TEMPLATE.md` $\rightarrow$ `workflow/plans/{name}.md`, fill in the change approach / task breakdown (each step with "files" and criteria) / execution order / verification plan
2. **HALT**: output the just-drafted full plan $\rightarrow$ wait for the user's item-by-item confirmation.
**Output**: `workflow/plans/{name}.md` (Status: Approved)
**Gates**:
- **Confirmation gate (confirm-doc)**: $\text{draft} \rightarrow \text{approved}$ (policy per `new-task.md` Fast Track step 4)
- **Basis**: `workflow/papercuts.md`

## 2. Enter Plan Mode and List Changes
**Input**: `workflow/plans/{name}.md` (Approved)
**Process**:
1. **Pitfall search**: `node .agents/scripts/kb-search.mjs --scope workflow --module <module> "<keyword>"` $\rightarrow$ extract incident root causes into self-check items
2. **List**: specify the [read-then-modify/new] file list + [action $\rightarrow$ object] execution steps
3. **Sync audit**: when changes hit `.agents/commands/` or `.agents/roles/`, change only the authoritative source body; host shells stay pointers (see §🛠️ Auxiliary and Sync)
4. **Red-line check**: against root `AGENTS.md` and directory-level `AGENTS.md`, mark touched red lines
5. **Generate overview + start dashboard**: first `node .agents/scripts/gen-dev-tour.mjs workflow/plans/{name}.md --strict` to pass the per-step file gate (implementation steps missing `- 文件：` are rejected; pure verification steps are marked "验证步骤"), then `node .agents/scripts/auto-tour.mjs workflow/plans/{name}.md` to start the dashboard (idempotent, failures only warn). For snapshots, run gen-dev-tour separately; verify "actual changes outside the document", backfill/rollback out-of-bounds first; policy see dev-tour/SKILL.md. Layer fallback (defaults to 0) = heading contract violation, regenerate after normalizing
6. **HALT**: output the change list $\rightarrow$ wait for user confirmation
**Output**: confirmed change list $\rightarrow$ **backfill into the plan's "change surface/task breakdown"** (session-context: conversation traces are for the current session only; on re-entry the plan is authoritative — change surface + task check state + git status = the three session re-entry anchors). **After persisting, rerun `node .agents/scripts/auto-tour.mjs workflow/plans/{name}.md`** — the real purpose is to ensure the dashboard process is running (idempotent, reuse if already running); if running, the live page redraws automatically (SSE push + 5s fallback polling), and the persisted change surface enters the graph

## 3. Implementation and Self-Verification
**Input**: `workflow/plans/{name}.md` (Approved, including the persisted change surface and task list)
**Process**:
1. **Session re-entry** (mandatory for compaction / new session / handover continuation): read the plan task list check states + compare with `git status` / `git diff` on the ground $\rightarrow$ rebuild progress then continue. If check states do not match the working tree (checked but uncommitted / committed but unchecked) $\rightarrow$ align first, then write new code; when the change list exists only in the conversation, use the plan change surface + working tree as authoritative and backfill the plan
2. **Drive implementation**: execute tasks by dependency — **frontier = tasks whose "dependency" line has no unresolved blocker**, dispatched in parallel (multiple worktrees with their own branches / delegating "new + merge scope"), a pure sequential chain goes top-down; **immediately backfill the task list checks and traces after each item completes** (commit SHA / test name / measured output), and unlock downstream tasks that depend on it (after each item, refresh `/tour?file=workflow/plans/{name}.md`, confirming there are no "actual changes outside the document"). When the `.agents/roles/implementer.md` boundary is met, `implementer` may be delegated (model from `model-roles.json`, local override preferred, both empty = host default)
3. **Architecture constraints**: strictly forbid inventing bypass data access; must follow root/directory-level `AGENTS.md` red lines
4. **L3 special case**: schema changes must follow the project's agreed maintenance method; do not introduce a migration mechanism arbitrarily
5. **Change control**: if a plan deviation is needed (change public interface / touch unlisted files / add new dependency) $\rightarrow$ **HALT** $\rightarrow$ continue after confirmation
6. **Self-verification loop**: run [project build / type check / automated tests] (details in Test chapter §1); scope reconciliation `node .agents/scripts/check-scope.mjs workflow/plans/{name}.md` — out-of-bounds items must be closed out (backfill the plan or roll back); **L2/L3 must pass with `--strict` before closeout**, L1 stays advisory (at push time, check-scope-range hard-blocks by old..new range)
**Output**: implemented code changes + self-verification pass evidence

## 4. Wind Down After Confirmation
**Process**:
1. **Status transition**: the plan stays `approved`, not set to `done` here. Closeout happens in Test chapter §5, set to `done` via confirm-doc.
2. **Commit trace**: intent/spec are committed separately as `docs(workflow)` after design confirmation. The plan is likewise committed separately after confirmation, not in the same commit as code. Conventional Commits in Chinese.
3. **Scripted rewrite**: to modify workflow documents or ledgers, use `node .agents/scripts/rewrite-file.mjs <file> --find <literal string> --replace <literal string>`. Prohibit `node -e` with `writeFileSync` (on CRLF checkouts it silently does nothing yet prints success).
**Next**: Test chapter

## 🚫 Prohibitions
| Operation | Machine behavior | Exception |
|---|---|---|
| Directly edit frontmatter | Status transition disabled | Must go through `confirm-doc` |
| draft $\rightarrow$ done | check-loop 15 blocks | Must pass through approved |
| Summary confirmation | confirm-doc rejects | Must review the full text |

## 🛠️ Auxiliary and Sync
- **Hosts are pointer shells**: when changing `.agents/commands/` or `.agents/roles/`, do not copy the body into opencode / trae / codebuddy. Shells keep only host frontmatter and state the authoritative path. The machine check only covers the five check-loop hard sections, not host shells; manually verify whether shells are disconnected/too thick.
- **Change-surface discipline**: the plan change surface lists authoritative source paths. If host shells are unchanged, do not write `wf-*.md` into the change surface.
- **Self-check**: after changing check-loop, run `node .agents/scripts/check-loop.mjs`

# Test · Static Gates + UI Verification

This chapter is for L2/L3, DB-switch smoke tests, flaky, and independent review.

## 1. Static Gates
**Input**: code changes to verify
**Process**:
1. **Run gates**: `node .agents/scripts/verify.mjs` (tier policy per the verify.mjs header note, not restated here). The single source for project build, test, and type-check command lists is `.agents/hooks/commit-check.config.json`.
2. **Failure handling**: any failure $\rightarrow$ **HALT**. L1 returns to `.agents/commands/new-task.md` Fast Track step 5 to change code. L2/L3 return to the Build chapter to fix. For intermittent/cross-layer issues use `diagnosing-bugs` diagnosis. A full-suite first run red with an isolated rerun green does not count as green: file it as flaky (papercut/incident) and fix it; do not close out just because a rerun is green.
3. **Tier by task subtype**: pure docs/business surface → default tier (product gates cut by diff surface); cross-surface or before release → `--full`. The engine surface has no test gate; `*.test.mjs` is not checked in and does not run automatically (cleared 2026-10-29); manual tool — merge-semantics probe `node .agents/scripts/check-loop-rev-semantics.mjs` (runs automatically at the end of FULL mode).
**Output**: static-gate all-green evidence
**Note**: runtime environment details in `.agents/notes/runtime-env.md` §1, §2; for long gate commands (verify full / `dotnet test`) **wait in segments + report progress per segment**, do not block to the timeout limit — policy in §6.4 "retrieving results of long background tasks"

## 2. DB Smoke Test
**Trigger**: changed the project DB connection config or added a target database
**Process**:
1. **Schema comparison**: actual target-DB schema $\leftrightarrow$ code expectation (recent change scripts + base tables)
2. **Endpoint liveness**: run the smoke script $\rightarrow$ verify 6 core endpoints $\text{HTTP 200}$
**Output**: liveness pass evidence
**Fact**: smoke script path in `.agents/notes/runtime-env.md` §6.1
**Fail**: any non-200 $\rightarrow$ **HARD-BLOCK** $\rightarrow$ stop at this step, no deployment.

## 3. UI Verification
**Trigger**: frontend changes involved $\text{AND}$ static gates have passed
**Process**:
1. **Invoke skill**: use `.agents/skills/verify-ui/SKILL.md` to perform verification.
2. **Environment config**: details in `.agents/notes/runtime-env.md` §4 and §6.3
**Output**: UI verification report (screenshots/DOM evidence)

## 4. Independent Review (L2/L3 Mandatory)
1. **Delegate review**: hand to `independent-reviewer` (must attach the role's `attach` from the file header; missing any one means do not dispatch; this section's scenario = independent review before closeout). Trigger, form, review package, persistence, opinion-level ledger, and cross-model policy follow `.agents/roles/independent-reviewer.md` "Review Policy" (not restated here)
2. **Review classification**: based on the review opinions $\rightarrow$ adopt $\rightarrow$ return to the Build chapter to modify $\rightarrow$ rerun this stage
**Output**: review conclusion (Approved / Reject) + opinion-level ledger line; signature and persistence policy per the role's "Review Policy"

## 5. Closeout After Confirmation (Closure)
L1 closeout is the single commit in `.agents/commands/new-task.md` Fast Track step 6 (by default the closeout skill is not opened; it is opened only for the plan-independent-closeout scenario — policy single source new-task.md step 6); this section starts from L2/L3 new requirements and fix-type work.
**Process**:
1. **Verify and close out**: per `.agents/skills/shipyard-workflow-closeout/SKILL.md`.
2. **Acceptance check-off**:
   - **L2/L3 new requirement**: check off the intent's "acceptance criteria" one by one $\rightarrow$ backfill evidence $\rightarrow$ intent $\text{approved} \rightarrow \text{done}$
   - **Fix-type**: verify recurrence-prevention landing $\rightarrow$ incident $\text{open} \rightarrow \text{fixed} \rightarrow \text{closed}$
3. **Same-family cleanup**: plans with the same name as L2/L3 and fix-type work are also set to `done`. Do not leave `approved` orphans.
4. **Trace record**: delegated tasks go into the `workflow/delegations.md` delegation results table; L2/L3 self-performed work goes into the self-performed task results table. Self-performed L1 is not written. Run `node .agents/scripts/agg-delegations.mjs --write` only after a row is written.
5. **Opportunistic backfeed (advisory)**: if there is friction, record it in `workflow/papercuts.md`; if not, write "no candidates" in the closeout reply.
**Next**: L2/L3 $\rightarrow$ `.agents/commands/deploy.md`

## 🚫 Prohibitions
| Operation | Machine behavior | Exception |
|---|---|---|
| Opportunistic code changes | Violates the Test stage definition | Must return to the Build chapter to fix $\rightarrow$ rerun Test |
| Partial pass | `ui-verifier` report blocked | Do not mark partially passed items as passed |
| Checking without evidence | check-loop blocks | Must provide specific evidence (screenshot/SHA/Log) |
