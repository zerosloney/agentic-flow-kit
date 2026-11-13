---
name: tfs-pr
description: "Internal self-hosted TFS / Azure DevOps Server PR skill, project-agnostic — auto-detects the git repository and remote to derive collection/project/repo, guides creation and saves an env var when PAT is missing; query PR / create PR (context pulls diff to distill title and description) / update PR description / conflict pre-check and worktree-isolated resolution, via REST API + PAT (the az devops extension rejects http organization URLs, so az is unavailable). Command entry .agents/skills/tfs-pr/scripts/tfs-pr.mjs."
---

Authoritative skill: `.agents/skills/tfs-pr/SKILL.md`. This file is a pointer shell; read the authoritative source at execution time and do not copy the body here.
