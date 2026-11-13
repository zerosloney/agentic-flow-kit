# Project Guidance

Single source of truth: root `AGENTS.md` (read it fully before starting). This file is the Claude Code host memory mirror; do not duplicate authoritative rules here.

## Runtime / Setup
- Frontend dev server `{{webPort}}` → API `http://localhost:{{apiPort}}`.
- After clone: `flow-kit run check-local-gates.mjs --fix`.
- Never use `--no-verify` for commit / merge / push.

## Routing
- L0/L1: `.agents/commands/new-task.md`
- L2/L3: `.agents/commands/stages.md`
- Fix/incident: `.agents/commands/maintain.md`
- Deploy: `.agents/commands/deploy.md`
- Review: `.agents/commands/review.md`
- Automation: `.agents/commands/pipeline-run.md` (experimental)

## Boundaries
- Host hooks and pointer shells are wired from this directory to `.agents/`.
- Authoritative commands and role contracts live in `.agents/commands/` and `.agents/roles/`.
