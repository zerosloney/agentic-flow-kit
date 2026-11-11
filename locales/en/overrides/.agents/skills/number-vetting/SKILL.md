---
name: number-vetting
description: Number vetting — five questions to ask before reporting, citing, or deciding on any measured value (latency/hit rate/coverage/scale); for use by the main agent when writing metrics, gate costs, review outcomes, and performance conclusions.
---

# number-vetting — Number vetting (five questions)

Before any number enters `workflow/metrics.md`, a `verifications.jsonl` interpretation, a PR body, or an option conclusion, run through every question. If any one cannot be answered → mark it "doubtful" and do not use it as a basis for a decision.

## The five questions

| # | Question | Disqualifying signal |
|---|---|---|
| 1 | **Limiting factor**: what is this number bottlenecked by? | Cannot name the bottleneck; counting serial waits into a single item's latency |
| 2 | **Tuning/environment**: caused by warm cache, parallelism, machine load? | Mixing cold/warm runs; does not reproduce on another machine |
| 3 | **Error/noise**: how large is the variance? What is the distribution across reruns? | Single sample; the difference is the same order as the noise |
| 4 | **Basis/window**: sample n, time window, exclusions the same as last time? | The basis changed quietly; comparing directly across model generations |
| 5 | **End-to-end relevance**: does it measure the segment users perceive? | Microbenchmark improved, end-to-end did not move |

## Verdict and recording

- Three levels: **trustworthy** (all five pass) / **doubtful** (missing 1–2 items; re-check after more measurement) / **unusable** (limiting factor unknown or basis drifted).
- Record format: `value (sample n / window / basis / k reruns)`; write "not measured" for missing items, never 0.
- The `{{指标名}}` signature is filled with live values by the data collector (check16); do not fill it by hand.

## Existing conventions in this repo (read first, do not invent another)

- How to read peak %: the "Number vetting" note at the top of `workflow/metrics.md`—resting-state ≈93% is structural; judge pressure by backfill rate, not peak.
- Cross-model-generation comparisons: read "Model generation baseline" in `workflow/delegations.md` first; do not recompute old monthly snapshots.
- Gate duration: use `wallMs` from `verifications.jsonl`; green rows before 2026-10-16 lack that key, so fall back to the sum of the individual gates—do not mix the two bases in a comparison.

## Red lines

- Do not write "gates got faster" as "quality improved".
- Do not use a single run to prove performance; do not hide the long tail behind an average (list the slowest gate separately).
