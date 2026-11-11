---
状态: draft
级别: L1
模块: <one of the vocabulary entries; see .agents/config/workflow-modules.txt>
---
# SPEC — <same topic as the entry document>
<!-- Pairs with the same-named entry document under intents/ or incidents/; L2 / L3 must have a confirmed spec before a plan may be drafted; L1 may omit this file -->
<!-- frontmatter restricted subset (2026-09-13): status ∈ draft/approved/done/superseded/cancelled (done = closed, superseded = abandoned after confirmation, cancelled = cancelled before completion); after L3 confirmation, append two lines to frontmatter: `确认结果: approved` and `确认时间: YYYY-MM-DD` (check-loop enforces this for L3) -->
<!-- ambiguity discipline (2026-10-16): when drafting/revising, do not guess at ambiguities you cannot decide yourself (multiple interpretations / missing semantics / dependence on external facts) — insert [NEEDS CLARIFICATION]: <one-sentence question> in place in the relevant section and keep the document in draft while asking the user; after clarification, delete the marker and record the decision as body text. Markers must be cleared before approval (see workflow/README.md document protocol "explicit ambiguity blocking"). -->

对应入口：../intents/YYYY-MM-DD-<topic>.md or ../incidents/YYYY-MM-DD-<topic>.md (keep the actual one)

## 功能行为
<Explain clearly how the feature works; break user / system behavior into subsections, and add state-machine / sequence diagrams where needed>

## 数据流
<Where data comes from → what processing it goes through → where it lands; include field mappings, API contracts, and upstream/downstream dependencies>

## 系统改动清单
- Backend: modules / files / API contracts
- Database: none / <table + fields + migration SQL path>
- Frontend: routes / components / stores / api

## 约束遵守映射（对照 AGENTS.md 触达红线）
<!-- Since 2026-10-29: the mapping must cover the machine-gate / red-line items in the AGENTS.md files of project directories (regardless of this change's surface — it is the repository-wide contract baseline, required reading before drafting, see stages.md Design §2 "required inputs"); cite wiki evidence by path in the relevant section -->
| Red line | How this spec satisfies it |
|------|------------------|
| Application must not reference Infrastructure / DbContext | <Via XXX, without introducing YYY> |
| Rules / contracts (coding authority / shared contracts / existing API semantics / global cross-cutting semantics) | <Whether touched (touching it is the basis for L2); coding authority remains in the backend> |
| schema / migration SQL (no dotnet ef) | <SQL paths involved; the historical EF Migrations directory (including ModelSnapshot) has been removed entirely and must not be recreated> |
| Frontend: Drawer / no a-select / unified style.css | <Which frontend conventions this spec involves> |

## 验收判据
<!-- Machine input for criterion-level convergence reconciliation (check-loop check 23): one criterion per line; "evidence" must be machine-parseable.
     Path: the file must exist. The machine does not read the body or judge whether it is relevant to the criterion (that step is left to a new-session review).
     Command: only npm test / dotnet test / dotnet build / npm run build / verify.mjs that have been run by the full gate are accepted.
     Since convergenceHardSince, workflow/verify-evidence.md must also contain an all-green line whose time is not earlier than this spec's "date"; without that line = not covered.
     Date semantics: the frontmatter "date" and the all-green line time are both UTC (fill-spec defaults to this); for hand-written files do not use a local-timezone date — an all-green line recorded between 00:00 and 08:00 UTC+8 gets the previous day's date and will not match (hard block; rerun the gate after 08:00 to resolve).
     verify-ui / vue-tsc / regression-smoke etc. are not part of the full gate; record an evidence file path instead.
     Writing "covered" as the status while the evidence is invalid still counts as not covered. For manual walkthroughs write "manual" as the status and leave the evidence column empty (only "manual + empty evidence" is exempt from machine reconciliation; images such as screenshots are not on the path allowlist — save them in a .md report and cite that path).
     Missing this section or an empty table → WARN. Invalid evidence: WARN only at convergenceSince; HARD-BLOCK from convergenceHardSince. -->
| 判据（可观察行为） | 证据（测试文件 / 命令 / 证据文件） | 状态 | 对应验收 |
|---|---|---|---|
| <Behavior 1> | <path or command> | <覆盖 / 未覆盖 / 人工> | <A1 or A1, A3> |

<!-- The "Corresponding acceptance" column = acceptance IDs from the entry intent (the confirmation gate has enforced this since anchor coverageSince 2026-10-22): each An must be referenced at least once, and one criterion may map to many; leave it blank when a technical criterion has no corresponding acceptance item (coverage is one-way only — do not invent fake acceptance items to satisfy it in reverse). See stage-gates coverageGate for the criterion gate. -->

## 风险评估
- <Risk 1> | Mitigation: <test / hook / review>
- <Risk 2> | Mitigation: …

## 前提质询
<!-- Blocks "confidently wrong interpretations" (premise-interrogation 2026-10-29; root cause incidents/2026-10-23-pml-quota-substitute-identity-overwrite:
     a presentation requirement was written as a stored-identity rewrite; tests locked in expectations based on the wrong premise, and review only checked internal consistency — three layers failed from the same source, and the only possible interception point is before the premise enters the source of truth).
     One asserted premise per line: challenge the opposite interpretation and state why the conclusion was chosen; for small items with no interpretation risk, write one line "no key premises" + reason.
     confirm-doc hard-blocks this (premiseSince 2026-10-30 anchor): missing section / empty table / unfilled placeholder / missing challenge or missing basis → reject. -->
| 前提 | 反问（对立解读会怎样） | 结论与依据 |
|---|---|---|
| <Interpretation / semantic choice being asserted> | <What happens under the opposite interpretation; worst-case consequence> | <Chosen interpretation + why (user's exact words / document / experiment)> |

## 歧义清单
<!-- One line per dimension; confirmation is allowed only after pending items reach zero; see .agents/commands/stages.md Design §2.7 and stage-gates clarifyGate for the single source of process and criteria.
     A missing dimension ≠ no ambiguity; legacy documents before the anchor and documents without frontmatter "date" do not participate. -->
| 维度 | 结论 | 依据 / 问题 | 状态 |
|---|---|---|---|
| 状态与边界 | <Who can do what in which state; privilege escalation / concurrency / idempotency?> | <State-machine section number or code path> | <已定 / 待澄清> |
| 数据口径 | <Nulls, precision, units, time zones, sort stability?> | <Query result or existing implementation> | <已定 / 待澄清> |
| 失败路径 | <On partial success, is there a rollback, retry, and what prompt does the user see?> | <Basis> | <已定 / 待澄清> |
| 契约对称 | <Do ≥2 consumers use the same semantics; how are old callers kept compatible?> | <Consumer list> | <已定 / 待澄清> |
| 存量数据 | <How are historical rows interpreted; is backfill needed?> | <Measured data distribution> | <已定 / 待澄清> |
| 验收可测性 | <Can each acceptance item be decided by one command or one experiment?> | <Test file or command> | <已定 / 待澄清> |

## 假设与推断
<!-- Record only inferences (semantic choices without experiment / code / documentation support), not measured facts; delete this section if there are no inferences. -->
| Assumption | Impact surface | What if it does not hold |
|---|---|---|
| <One-sentence assumption> | <Affected modules / endpoints / pages> | <Rework scope and fallback> |

## 确认与复核
> AI-Native workflow: confirmation = the user approves in one sentence in the conversation; there is no second approver, and traceability relies on git (commits record the confirmation time).
> Confirmation result / time go in the file-header frontmatter (enforced by check-loop for L3); this section only keeps narrative review records.

- Independent review: <Mandatory for L3: open a new session and have AI review this spec, recording the review session and conclusion; delete this line if absent for L1 / L2. Since 2026-10-12 (reviewerSince) the review line must include "复核上下文：<session/subagent id>">
- Review conclusion: <delete this line if none>
- Rework comments: <delete this line if none>
- Only after confirmation may you draft ../plans/YYYY-MM-DD-<topic>.md
