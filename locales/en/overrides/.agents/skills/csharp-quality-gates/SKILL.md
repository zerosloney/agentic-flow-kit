---
name: csharp-quality-gates
description: C# backend quality gates — manual entry, 3 deterministic gates: CRAP (complexity×coverage)/mutation/duplicate code; TEMP redirect for coverlet failures (0 coverage: fault/untested), report reading, backfill order; for "is this covered / what to test first / over threshold / quality inventory".
---

# csharp-quality-gates — C# backend quality gates (manual trigger)

Backend code maps to ub-mode's three-stage discipline (Uncle Bob's crapper/dryer/mutator do not support C#, so this repo substitutes equivalents):

| ub-mode gate | Uncle Bob original tool | This repo equivalent | Criterion |
|---|---|---|---|
| Crapper (Then Make it Right) | crapper | **dotnet-crap** (Crap4DotNet) | `CRAP = CC²×(1-cov)³+CC`, default threshold 30 |
| Mutator (Then Make it Right) | mutator | **dotnet stryker** (Stryker.NET) | mutation score (killed/total) |
| Dryer (Then Make it Right) | dryer | **PMD CPD** (`--language cs`) | structural duplication, token count |

Below `qg` refers to `node .agents/skills/csharp-quality-gates/scripts/quality-gates.mjs`.

## Trigger / do not trigger

- **Trigger**: "backend quality status / does this change have test coverage / which methods need tests first / is complexity over threshold / any duplicate code / how to run mutation testing"; changes in backend source directories involving business logic; after completing a batch of tests wanting to verify "are the tests really testing".
- **Do not trigger**: pure frontend changes (these gates do not cover frontend directories); only want to know "does it compile" (use `commit-check.config.json` build section); only want to know "do tests pass" (just `dotnet test`).
- **Does not replace** the `verify` gate: this skill is a **manually triggered** diagnostic and inventory tool; it does not enter the commit gate and changes no gate configuration.

## 0. Prerequisite probing

```bash
qg doctor
```

Prints item by item whether tools are in place: `dotnet` / `dotnet-crap` / `dotnet-stryker` / `pmd` / `java` / unit test project / solution. When missing, the script prints install commands:

```bash
dotnet tool install -g Crap4DotNet
dotnet tool install -g dotnet-stryker
# PMD: download pmd-dist-<ver>-bin.zip and extract to ~/.agents/tools/pmd/ (the level containing lib/ and conf/)
```

Actual machine paths are registered in `.agents/notes/runtime-env.local.md` (git-ignore, single-source discipline); the script resolves by `env var → known install location → PATH`, no hardcoded absolute paths.

## 1. The three gates

```bash
qg coverage                 # run unit tests collecting coverage (TEMP redirection built in)
qg crap [--threshold 30] [--top 15] [--min-crap N] [--coverage <absolute path>]
qg dup [--minimum-tokens 100] [--top 10]
qg mutate "<glob>"          # mutation testing, must be targeted
qg all                      # coverage → crap → dup (no mutate, too slow)
```

Exit codes: `0` pass / `1` gate not met (methods over threshold, duplicate blocks, mutation score not met) / `2` usage·configuration·collection failure. **Exit code 2 is never "pass"**, it is "did not run".

Artifacts land in `.agents/tmp/quality-gates/` (git-ignore): coverage XML, `crap-report.json`, Stryker report.

## 2. Collection failure trap (known on this machine, must-read)

**coverlet silently produces 0% coverage under the default TEMP on this machine.**

- Symptom: tests all green, code genuinely calls production services, but cobertura has `lines-covered=0` — every class every line hits is 0.
- Root cause: coverlet writes instrumented modules to `%TEMP%\<module name>_<guid>` before loading; the file is lost under default TEMP, testhost exits with an **unhandled** `FileNotFoundException` (process -532462766), hit data never reaches the report.
- Criterion: tests clearly `new XxxService(...)` call production code, yet cobertura is all 0.
- Fix: `qg coverage` already redirects `TEMP`/`TMP` to `.agents/tmp/quality-gates/tmp`; after redirection coverage is produced normally (numbers vary per project).
- **Script guard**: when `lines-valid>0 && lines-covered==0`, `coverage` **errors and exits 2**, producing no "zero coverage" conclusion; `crap` also refuses to run on such a file.

> Two other dead ends on the same machine: `--collect:"Code Coverage"` (Microsoft.CodeCoverage) only produces a 0KB empty file; `/p:CollectCoverage=true` requires the `coverlet.msbuild` package (check whether your project has that package). **Do not spend more time on these two.**

## 3. Report interpretation: first distinguish "collection broken" vs "code untested"

Order cannot be reversed — first confirm collection is good, then discuss coverage.

1. **Is collection trustworthy**: look at `qg coverage` output's `lines-covered`. 0 → collection failure (§2), fix collection first, **never treat 0% as a conclusion**.
2. **CRAP table reading**: sort by CRAP worst to best; the top "both complex and uncovered" are the priority; **do not only look at CRAP absolute value** — a method with CC=2 but 100% coverage has CRAP=2, not a problem.
3. **Mutation score reading**: a low score has two causes with completely different handling —
   - (a) **tests ineffective**: few NoCoverage, low kill ratio → assertions too loose, tests pass but do not verify logic;
   - **the common cause is (b)**: many NoCoverage (mutants on code paths nobody tests) → **that path lacks tests**, not insufficiently strict assertions. Distinguish before acting.
4. **Duplication detection reading**: PMD's `--minimum-tokens` is the similarity knob (default 100 ≈ dryer's 0.8 similarity tier); multiple hits within the same file prioritize structural duplication like "three places share the same helper" (example: a 451/775-line single file, 62 lines/397 tokens baseline snapshot; line numbers are baseline values, not current).

## 4. Test-backfill priority

**Criterion = zero coverage ∧ high CRAP**, not CRAP absolute value. The script already sorts by this (`qg crap` output's "zero coverage and over threshold" list).

Baseline method: run `qg coverage` and `qg crap` **in this project** to get total methods, zero-coverage count and over-threshold count; backfill zero-coverage methods in CRAP order. The table below only demonstrates the report format (replace values with your own measurements):

| Method | CC | CRAP |
|---|---|---|
| `<Service>.MethodAAsync` | `<CC>` | `<CRAP>` |
| `<Service>.MethodBAsync` | `<CC>` | `<CRAP>` |

**Why there is often a lot of zero coverage**: services covered only by integration tests are blind spots at the regular tier — integration tests need a test database; the CI regular tier only runs the unit test project (no DB), and the full tier can only fall back to a shared dev DB when no test DB connection is configured. Typical: the only test for a service lives in the integration test project, and mutation testing that replaces every input string still stays all green.

Backfill directions are therefore two: **push DB-free pure logic down to unit tests** (header/template generation, validation criteria), or **configure the project test database connection for the integration tier** (declared in `.agents/config/local-gates.json` `testDb`) to run the real integration tier.

## 5. Output format

After the inventory, conclude in four sections:

- **Current state**: numbers for each of the three gates (coverage line-rate / CRAP over-threshold count and share / duplicate block count / mutation score), noting whether collection is trustworthy.
- **Risk**: top N methods sorted by "zero coverage ∧ high CRAP", with `file` location.
- **Cause**: distinguish "tests ineffective" from "code untested"; if the latter, point out the blind-spot source (integration test tier / DB dependency / pure logic not pushed down).
- **Next steps**: specific to "which method gets which test"; do not stop at "recommend raising coverage".

## 6. This repo's placement and boundaries

- Gate single source: `.agents/hooks/commit-check.config.json` (build section command lives in that file, e.g. `dotnet build <solution>.sln`; **checks section is project-defined and empty by default**, local commit gate does not run tests). This skill **does not change** this file.
- Interface with ub-mode: First Make it Work → add tests (give TDD a landing point); Then Make it Right → three gates; Practice → Keep a Log (this skill's conclusions are material for the decision log).
- Interface with `review-method`: when reviewing a diff, "impact-surface proof" can use this skill's dup/crap as machine evidence.
- Boundaries: run only the **unit test project** (integration tests need a test DB; without one they fail); Stryker **must be targeted** (full mutant runs are too slow); write no repository files (except this skill's own directory); do not commit code.
