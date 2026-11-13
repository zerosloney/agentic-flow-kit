# Repository Guidelines

{{projectName}}. {{stackDescription}}

## 1. Runtime Connectivity
The frontend dev server on port {{webPort}} connects to the API at `http://localhost:{{apiPort}}`; the API must listen on {{apiPort}} to be reachable. Environment facts live in `.agents/notes/runtime-env.md` §6; machine-specific absolute paths and versions are self-registered in `.agents/notes/runtime-env.local.md`.

## 2. Local Setup (required after clone)
> Missing these silently disables the gates. See `.agents/notes/runtime-env.md` §7.
- `git config core.hooksPath .githooks` — mount the repository hooks.
- `git config merge.ours.driver true` — enable `merge=ours` merge protection.
- `git config merge.jsonl-union.driver "flow-kit run git-merge-jsonl.mjs %O %A %B"` — enable union merge for `.agents/*.jsonl` ledgers.
- **Never** use `--no-verify` for commit / merge / push.
- **Self-check**: `flow-kit run check-local-gates.mjs --fix`

## 3. Universal Laws
- **Security/privacy**: never commit secrets, tokens, `.env` files, or real user data; if sensitive material is found, stop spreading it immediately.
- **Irreversible actions**: production deploys, remote pushes, and data deletion are off by default; they require explicit user instruction and must not bypass gates.
- **Minimal change**: do the smallest change that satisfies the request; no drive-by refactors, formatting churn, or unrelated lint fixes.
- **Single source**: paths, versions, and known defects are registered only in `.agents/notes/runtime-env.md` §6; do not copy them elsewhere.
- **Context discipline**: bulk data collection, long logs, large diffs, and repo-wide inventories go to subagents; the main thread keeps conclusions and `file:line` only.
- **Commits**: Conventional Commits; types limited to `feat/fix/docs/style/refactor/perf/chore`.

## 4. Workflow Routing
Jump to the corresponding command file by task type:

| Task type | Command file | Responsibility |
|---|---|---|
| **L0 minimal** | `.agents/commands/new-task.md` | Fully machine-decidable micro-change; same fast lane as L1: edit → `verify --face`/`--scope` → one commit |
| **L1 fast lane** | `.agents/commands/new-task.md` | Classify, implement, `verify --scope`, close in one commit (open a skill only for standalone closeout). Do not open `stages.md` |
| **New requirement / feature** | `.agents/commands/new-task.md` | L1 uses the fast lane; L2/L3 move to `stages.md` |
| **L2/L3 staged flow** | `.agents/commands/stages.md` | Four chapters Plan→Design→Build→Test: intent → spec → plan + implementation → static gates → UI verification → independent review → closeout |
| **Fix / incident** | `.agents/commands/maintain.md` | For non-incident L1, only §1 filing then return to the fast lane. Read fully for production incidents and L2/L3 |
| **Deploy / release** | `.agents/commands/deploy.md` | Static gates → regression checks (including DB verification) → authorization → PR review/merge |
| **Merge review** | `.agents/commands/review.md` | P0/P1/P2 graded review → verdict |
| **Automation driver** | `.agents/commands/pipeline-run.md` | Experimental, reserved: the state machine is unverified and has zero runs; add state-machine tests before enabling |
| **Unattended / overnight** | `.agents/skills/autonomous-run/SKILL.md` | Long-run contract: per-unit sign-off + stop conditions; gates and confirmation doors are not waived |
| **Performance / visual parity** | `.agents/skills/perf/SKILL.md` · `.agents/skills/visual-parity/SKILL.md` | Baseline first, then one variable at a time; claim parity only after the diff table is zero |

> **Short-name corrections**: report the short name mid-task; the index is `.agents/config/principles.md`.

> **Engine-face exemption**: changes to the AI-Native governance engine itself are **exempt from the workflow trio** — no intents/specs/plans and no confirmation doors; use Conventional Commits directly. Engine face = all of `.agents/`, `.githooks/`, `azure-pipelines.yml`, workflow templates and ledgers, root `package.json`, and host adapter directories; machine-local host directories are not committed. **Wiki exemption**: content edits under `wiki/` (including INDEX and boards) share the same exemption. **Boundary**: git hooks and static gates still run; deleting wiki files still requires a separate user instruction; executing data-maintenance SQL is not exempt.

## 5. Directory-level Rules
**Do not backfill this document.** Implementation details live in each directory's `AGENTS.md`:
- **Backend**: `backend/AGENTS.md`
- **Frontend**: `frontend/AGENTS.md`
- **Paired documents**: keep paired documents registered in `wiki/INDEX.md` in sync, and update `wiki/INDEX.md` and `wiki/知识沉淀总览.html` together.

## 6. Project Adaptations
- **Build/test/typecheck**: the command list is single-sourced in `.agents/hooks/commit-check.config.json`.
- **Smoke probes**: script paths and endpoint facts live in `.agents/notes/runtime-env.md` §6.1.
