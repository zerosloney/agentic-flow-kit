# Project Memory

Single source of truth: root `AGENTS.md` (read it fully before starting). Host surface: this directory's `commands/`, `agents/`, `rules/`; hooks are wired via this directory's `settings.json` to `.agents/hooks/` — the host layer does not own scripts.

- Before touching `backend/` or `frontend/`, read the corresponding `AGENTS.md` (lazy load).
- **Do not** place `CODEBUDDY.md` at the repository root (it takes precedence over `AGENTS.md` without merging and would override the authority).
- English is the language for this generated pack; commits follow Conventional Commits.
