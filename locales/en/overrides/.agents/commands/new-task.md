# New Task · Closed-Loop Entry Point

> **⛔ Order**: grade first → file the trio first → confirm each item → only then write code. "Change first, document later" is prohibited (= bypassing the confirmation gate; violators record both incident+papercuts). Details and strength rationale: `.agents/notes/process-order-rule.md`.

## 1. Risk Grading (Step 0: Grade Before Routing)

| Lane | Level | Criterion | Confirmation & audit policy |
|---|---|---|---|
| **Coordination lane** | **L1** implementation | Implementation-level change that misses L2/L3 | A single plan is the entry point (source / goal / red lines / changes / verification / acceptance). No separate intent. No synchronous prerequisite for independent review; `--batch` is L1-only |
| **Defense lane** | **L2** rule/contract | See §L2 closed set | Synchronous confirmation gates: spec confirmation $\rightarrow$ plan confirmation $\rightarrow$ start work |
| | **L3** data/runtime structure | schema / migration SQL / DI chain / auth and middleware pipeline | Same as L2 + spec independently reviewed in a new session; no go-ahead until confirmed |

> **Two-question grading**: structural surface (schema / migration SQL / DI / auth pipeline) → L3; contract or shared policy → L2; neither → L1. Do not slide upward from L1 based on severity.
> **Question typing**: if it can be run/checked out (behavior/timing/layout/output/existing data/eval distinguishable), prototype/query the DB/run eval first; do not stop to ask. Only product/preference judgments escalate to confirmation. Orthogonal to the STOP line (experimentation does not exempt red lines).
> **Placement**: L1 is written into the plan frontmatter `级别`; L2/L3 into the intent.
> **Under-grading block**: if an L1 plan or intent checks a touched red line → check-loop "red-line under-grading" hard block → escalate to L2/L3 and add a same-named spec.

### L2 Touched Surface (Closed Set; Hitting Any One Means L2)

| # | Category | Criterion |
|---|---|---|
| 1 | **Coding authority** | Coding/naming/numbering rules generated once and consumed in many places |
| 2 | **Shared contract** | Cross-module shared base classes / DTO shapes / public interface signatures |
| 3 | **Existing interface semantics** | Behavior changes to existing parameters or endpoints (disabled becomes enabled, default/clamping policy changes) |
| 4 | **Global cross-cutting policy** | Error response exit points, pagination and validation policy, aggregate projection keys |

> **Negative examples (fall to L1)**: pure page presentation/copy/layout/interaction implementation; purely new endpoints or parameters with unchanged behavior; single-module internal refactoring with no external contract change; purely new pages/routes with no shared contract; single-module internal component splitting; module-internal new types/constants not consumed across modules.
> **Self-check sentence**: can you list $\ge 2$ actual consumers whose behavior is affected (module/endpoint/page; signature-only visibility with unchanged behavior does not count)? If yes $\rightarrow$ L2.
> **Default tier**: if no red line is checked, it is L1. Grading only answers "does it hit the four L2 categories or an L3 structural surface".

## 1b. Todo Seeding

After grading and before starting work, **copy verbatim** the step headings of the chosen command into the first item of the todo list; do not write a separate summary. Keep skipped steps in the list and write `skip: <reason>`. The todo is the execution contract; the command file is the playbook — this page does not duplicate the step body (single source).

## 1c. Stage Coupling Protocol (Load on Entry + Auto-Chaining)

- **Load on entry**: when entering any stage command, first read the SKILL.md of the skill bound to that stage (the body lives single-source on the skill side; this table only holds pointers):

| Stage | Load on entry |
|---|---|
| Plan (intent) | `grilling` (questioning to solidify background/goals/non-goals) |
| Design (spec) | `grilling` (ambiguity checklist / solution stress test); `codebase-design` / `domain-modeling` as needed; `arena` for branching comparison; required inputs see `stages.md` Design §2 |
| Build | No mandatory skill (implementation delegation goes through the `implementer` role) |
| Test | `verify-ui` for frontend changes; `review-method` for L2/L3 independent review |
| Deploy | None (follow the checklist and the go-live authorization gate) |
| Maintain | `why` (root-cause evidence chain) |
| Review (cross-cutting) | `review-method`; `interrogate` for high-risk diffs; `blast-radius` for impact surface |

- **Auto-chaining**: after a stage completes (confirmation gate passed + trace commit landed), **automatically proceed to the next-stage command pointed to by the frontmatter `next`** without waiting for the user to prompt.
- **Human gates are never crossed automatically**: automatic flow refers only to stage chaining and skill loading — every stage's HALT confirmation, pipeline-run's `await-confirm`, and go-live authorization (deploy's "上") stop at their points and wait for the user's verbatim go-ahead.

## L0 Minimal Path

Criteria (all machine-checkable): product surface ≤5 files; misses the §1 L2 closed set/L3 structural surface; not a data-maintenance SQL execution; no new dependencies/build steps (the engine/wiki surface is already exempt).
Overlapping criteria: take L0.
Flow: grade → change code → `node .agents/scripts/verify.mjs --face`/`--scope` green → single commit; the message body includes a line `L0: <criterion>` (machine-greppable).

## L1 Fast Track

If L2 or L3 is hit, leave this page. L1 stops at the following 6 steps and does not open `stages.md`.

> **Takeover/resume**: first read `.agents/skills/session-resume/SKILL.md` to rebuild the current state, then follow the 6 steps below.

1. **Grade**: use the two questions in §1 and the L2 closed set. If nothing is hit, it is L1; write `级别` in the plan frontmatter. Completion criterion: the level in the plan header matches the two-question conclusion.
2. **Search**: `node .agents/scripts/kb-search.mjs --scope workflow --module <module> "<keyword>"`. Write the root causes of hit incidents into the self-check of the plan in the next step. Completion criterion: the command was run; hit root causes are prepared for the plan, and with no hits it is enough to paste the script output (no separate explanation needed). Hit same-feature spec / features $\rightarrow$ modify the original per `workflow/README.md` "same-feature continuation" instead of creating new.
3. **File the plan**: `node .agents/scripts/fill-plan.mjs --level L1 --topic <topic> --output workflow/plans/<YYYY-MM-DD>-<topic>.md`. `--lite` may be added (three sections: entry / change approach / verification and acceptance; conditions: step 2 search has no incident hits and no red line is checked); the default remains five sections. Fill in the entry (source, goal, red lines), change approach, constraints and risks, verification plan, acceptance criteria, and write the step 2 search results into the self-check. Change the frontmatter `模块` to the leading module. Do not write an intent, do not write prediction fields. Completion criterion: each section of the chosen template has a body (five sections or lite's three), the search conclusion is in the plan; if acceptance cannot be written as a testable criterion, stop; red lines are either checked and escalated to L2/L3, or explicitly unchecked.
4. **Start after confirmation**: `node .agents/scripts/confirm-doc.mjs <plan> --delegated "<user's verbatim words>"` moves draft to approved (confirmation gate policy single-source: call per item, no combining; use each item's own verbatim words, no reuse; migrate step by step, no single hop), then change code. Only change files listed in the plan. Four red lines: do not commit secrets or `.env`, do not use `--no-verify`, minimal change, stop first when deviating from the plan. **Commitment-surface lock**: after approval, changing the "commitment surface" (acceptance criteria text / red lines / goal / change approach) requires the user to nod again and re-record the commitment-surface fingerprint — the re-confirmation password is in `workflow/README.md` "commitment-surface binding"; otherwise closeout is rejected and push is hard-blocked by check 15 (checking acceptance + backfilling evidence does not count as changing commitments). Do not commit separately after changes: once verification (step 5) is green, jump to done per step 6 and commit in the same commit as the code. Before changing code, open the /tour overview and refresh it every batch (skills/dev-tour). Completion criterion: changes remain in the working tree, and the plan is still approved.
5. **Verify**: `node .agents/scripts/verify.mjs --scope` (policy in the header note). If there are frontend changes, also open `.agents/skills/verify-ui/SKILL.md`. If it fails, change the code; do not change the gate on this page. Completion criterion: command exit code 0, and frontend changes additionally have measured evidence.
6. **Closeout = single commit**: `node .agents/scripts/confirm-doc.mjs <plan> --delegated "<user's verbatim words>"` jumps one more step to move approved to done, then make a single commit — plan(done) + code + confirmation shard + verify credentials land in one commit; L1 has no separate closeout commit. Only in the plan-independent-closeout scenario (code already landed in a previous commit) open `.agents/skills/shipyard-workflow-closeout/SKILL.md`. Completion criterion: the plan is done and the single commit has landed.

Only then open other files: delegate implementer → `stages.md` Build §3; changed DB connection → `stages.md` Test §2; full-suite first run red, isolated rerun green → `stages.md` Test §1; L2/L3 independent review → `stages.md` Test §4.

## 2. Level Sub-Routing (Pointer Only)

Task-type routing **single source** = root `AGENTS.md` §4. Fix-type level routing **single source** = `.agents/commands/maintain.md` §3 (after L1 files the document, return to this page §L1 Fast Track; L2/L3 go to `stages.md` Design → Build → Test chapters; if the root cause is a missing gate/rule, file a same-named intent separately).

## 3. Intent Exemption Rules

| Scenario | Criterion | Handling |
|---|---|---|
| **AI-Native engine surface** | Root `AGENTS.md` §4 engine-surface exemption policy | Exempt from the trio (intent/spec/plan and confirmation gates); commit directly with Conventional Commits; parts touching business code follow their level |
| **wiki document adjustment** | Root `AGENTS.md` §4 "wiki exemption" | Exempt from the trio (intent/spec/plan and confirmation gates); commit directly with `docs(wiki)`; execution of data-maintenance SQL and business code are not exempt |
| **bootstrap-type changes** | Introducing the rules themselves | Exempt from intent; explicitly declare `bootstrap` in the commit message |

## 4. Closed-Loop Backstop

- **Gate checklist**: refer to the header comments of `.githooks/` / `.agents/hooks/` / `.agents/scripts/check-loop.mjs` (not restated here).
- **hard-block**: checklist single source = check-loop header comment; pairing breaks and loop gaps have been downgraded to WARN; self-check goes through closeout skill §0.
- **Prohibition**: local hooks are local machine gates; `--no-verify` is prohibited (see root `AGENTS.md`).
