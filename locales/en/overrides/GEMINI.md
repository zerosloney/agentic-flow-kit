# Repository Guidelines (Antigravity CLI)

Project memory entry. Single source of truth: root `AGENTS.md` (read it fully before starting).

## 1. Runtime & Gates
- After clone: `flow-kit run check-local-gates.mjs --fix`
- **Strict rule**: Never use `--no-verify` for commit / merge / push.

## 2. Universal Laws
- **Security & Privacy**: Never commit secrets, tokens, `.env`, or real user data.
- **Irreversible Actions**: Production deployment, remote push, and data deletion require explicit user confirmation.
- **Minimal Diff**: Make surgical changes strictly scoped to the task; avoid touching adjacent code or reformatting.

## 3. Routing & Skills
- **Fast Track (L0/L1)**: `.agents/commands/new-task.md`
- **Staged Flow (L2/L3)**: `.agents/commands/stages.md`
- **Maintenance / Fix**: `.agents/commands/maintain.md`
- **Code Review**: `.agents/commands/review.md`
- **Skills**: `.agents/skills/` (Antigravity CLI natively discovers and progressively loads skills from this path).

## 4. Boundaries
- Authoritative commands and role contracts live in `.agents/commands/` and `.agents/roles/`.
- Host-specific directory: `.gemini/`.
