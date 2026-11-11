---
name: autonomous-run
description: Unattended long-run contract — per-unit sign-off during long/overnight tasks, bottom-up landing, when to stop; for the main agent to establish before the user leaves (may be driven by pipeline-run).
---

# autonomous-run — Unattended contract

Used for long runs (overnight / user away). **Advancement mode**: per-unit sign-off per this contract; orchestration may be driven by `pipeline-run`, or via `.agents/pipelines/` / manual stages. **No gate or confirmation gate is relaxed**; only the advancement rhythm and stop conditions are agreed.

## Contract (once before starting)

1. **Authorization surface**: write out allowed directories/branches and target documents for this run.
2. **Forbidden list**: remote push, deploy, delete data, directly change workflow status, `--no-verify` — still require explicit user instruction.
3. **Budget**: fix loop keeps the 3-attempt cap (same criteria as pipeline-run); no new budget.
4. **Stop contact**: stop when the user returns, report current state.
5. **Decision trace**: long runs/overnight record `decisions.tsv` per `.agents/skills/show-me-your-work/SKILL.md` (append-only, evidence is pointers); commit or not by stakes.

## Per-unit sign-off (each implement / fix ticket)

1. Implement per authorized files; deviation stops (out-of-plan files / public interfaces / new dependencies).
2. Run `node .agents/scripts/verify.mjs --scope`, must exit code 0.
3. Record the green evidence's `headShort` (s15 fingerprint); **HEAD changed or evidence older than 24h window → rerun**, do not reuse old green.
4. Only after sign-off `next`; no advancement without green, no batching.

## Landing order

- Bottom-up by dependency, one commit per unit, Conventional Commits Chinese.
- Do not merge commits across units; the next unit is based on the previous unit's signed-off HEAD.
- After rework of the same unit, old evidence is void, re-sign-off.

## Stop conditions (any triggers stop and report)

- Fix loop reaches 3 attempts and still red.
- Fingerprint mismatch / green evidence expired and still red after rerun.
- Need out-of-scope files, public interface changes, or new dependencies.
- Both hypotheses for the same root cause are falsified.
- User returns or issues any new instruction.

## Recovery

After interruption rebuild first per `.agents/skills/session-resume/SKILL.md`; for pipeline-run run reconciliation use `status --run <id>`; signed-off units are not redone.

## Report

Stage bar / per-gate results / commit chain (sha + title) / open items and matters requiring user decision.
