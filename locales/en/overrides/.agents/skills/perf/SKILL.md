---
name: perf
description: Performance investigation playbook — baseline first, then single variable; accept only when retests exceed the noise band; for "slow / laggy / long load / API latency" tasks.
---

# perf — Performance investigation

## Trigger

- User reports "slow / laggy / long load / API takes N seconds".
- The approach involves performance tradeoffs that need measurement to decide.

## 0. Define a measurable target first

Metric (LCP / API p95 / list first screen / build time) + scenario (page / API / data volume) + pass line. Cannot articulate the metric → measure first before optimizing; changing based on feeling is forbidden.

## 1. Baseline (same machine / same data / same concurrency)

- Rerun $\ge 3$ times, take median and slowest; record machine load and data volume.
- Evidence lands in `tmp/perf/<topic>-baseline.json` (or stdout archive).

## 2. Locate

- Frontend: Performance trace / LCP / long tasks; backend: slow queries, N+1, unbounded fetches (performance three see `.agents/skills/review-method/SKILL.md`).
- Validate one hypothesis at a time; when a hypothesis is falsified, write down the conclusion then switch.

## 3. Single-variable change

Change one place at a time; do not change criteria, do not swap data, do not adjust the machine. For gate-timing changes distinguish "gate got faster" from "quality improved".

## 4. Retest and accept

- Rerun the same scenario $\ge 3$ times; improvement must exceed the noise band (number credibility single source `.agents/skills/number-vetting/SKILL.md`).
- Not past the noise band → roll back or record "unproven", do not put it in conclusions.

## 5. Record

Table: baseline / change / retest / conclusion + evidence path. For environment jitter (shared DB locks, machine load), isolate and retest first; attribute per `review-method/golden-set.md` #21 criteria, do not falsely report regression.

## Red lines

- Do not change two variables at once; do not use a single run; do not optimize what was not measured.
