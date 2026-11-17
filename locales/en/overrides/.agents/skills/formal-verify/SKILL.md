---
name: formal-verify
description: Formal verification assets (enterprise-only, advisory): invariant lists, state-machine models with property cases, model-checking or property-testing for state-machine/concurrency/consistency surfaces; re-check on high-risk changes. SKIP (exit 0) when tools or surfaces are missing; never a gate.
---

# formal-verify — Formal verification assets (optional, advisory)

Idea source: pstack `create-formal-verification-skill` / `maintain-formal-verification-skill` (rewritten here and made advisory: never enters the gate surface).

## Triggers

- The user asks for: `formal verification` / `invariants` / `model checking` / `property testing` / `state-machine modeling`.
- The task touches state-machine, concurrency, or consistency high-risk surfaces (design / review / debugging): run the 3-clue applicability check first; start only on ≥1 hit.

## Scope and boundary

- Advisory surface: assets and check results are reference only — never CI, never pipeline, never any commit gate; no `.agents/config/mechanism-registry.md` entry (not a gate surface, so no add/remove ledger rule).
- The verdict "is this design correct" stays with humans: model-checker and property-test output verbatim is the evidence; this skill never concludes on your behalf and never reads `green` as a safety seal.
- A red asset is not a blocker: the human picks 1 of 3 dispositions (fix the design / fix the asset / record an exemption with rationale); each exemption states its re-check criterion and expiry.

## Applicability check (judge before acting)

Check clue by clue; any hit makes it applicable; zero hits → loud-skip:

- State-machine artifacts: explicit state enums plus transition logic (workflow stage tables, order lifecycles, protocol handshakes); clues: centralized state definition files, `state` / `stage` transition branches.
- Lock / transaction / concurrency surfaces: mutexes, transaction boundaries, idempotency keys, lease renewal, single-writer constraints; clues: `lock` / `transaction` / `lease` / `acquire` / `idempotent` hits.
- Distributed consistency surfaces: consensus, replica sync, compensation and rollback, retry delivery (`at-least-once` + idempotent consumption); clues: retry and compensation paths, cross-service event ordering.
- Record the verdict: the hit clue plus evidence paths (`file:line`) go into the asset inventory header; that verdict is the only basis for SKIP or proceed.

## Asset creation (first engagement)

1. Invariant list `.agents/formal/invariants.md`: number from FV-1, each with "description + target artifact + checkable criterion"; anything without a checkable expression degrades to a normal test requirement and stays out of the list.
2. State-machine model `.agents/formal/<name>.md`: state set / transition table / final states / invariant references (FV-x); at least 1 property case per transition, covering reachability, deadlock freedom, and invariant preservation at least once each.
3. Write the integration note "tool-agnostic + per-stack examples" into the model file header: model checkers consume explicit transition tables, property tests consume runtime assertions. Examples (not gates, optional): dotnet / Java model transition tables in `TLA+`; TS / Node use `fast-check` property tests; Rust uses `proptest` / `Kani`; Go uses `go test` plus property assertions.
4. Register the maintenance anchor in each asset header: `Anchors:` the high-risk code path inventory (same paths as the applicability check); drift checks use it as the boundary.

## Maintenance leg (on change)

- A change touching a registered high-risk path → re-check: verify the transition table against current code line by line, run the full property suite, and append `FV recheck: <asset> <pass|fail>` to the change record.
- Code gains a state / transition / lock surface the assets do not cover → append a "drift candidate" entry to `.agents/formal/invariants.md` (path + one-line delta); candidates only, never edit the model body — the human decides between extending the model and narrowing the scope.
- Docs-only or style-only changes, no high-risk path touched → the leg does not trigger (0 recheck records required).

## Loud-skip discipline

On any hit → print one SKIP line (naming the clause) and exit 0; no red, no fabricated data, no empty assets:

- All 3 applicability clues miss (no state-machine / concurrency / consistency high-risk surface).
- The chosen verification tool is unavailable (not installed or not executable, probe exit code non-0) and no existing property tests can run.
- `.agents/formal/` assets do not exist and the high-risk surface touched this round has none: SKIP and name the next step to build them.
- SKIP output example: `SKIP formal-verify: no high-risk surface hit (applicability check missed on every clue, exit 0)`.
