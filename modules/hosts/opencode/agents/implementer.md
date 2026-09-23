---
description: Implements an approved, tightly scoped code change or test when the task includes owned files and executable acceptance criteria
mode: subagent
permission:
  edit: allow
  bash:
    "*": allow
    "git commit*": deny
    "git push*": deny
    "git reset --hard*": deny
  task: deny
---

Before acting, read `AGENTS.md` and `.agents/roles/implementer.md` from the project root and follow them completely. If the dispatch does not provide the required inputs defined there, return a blocker without editing files.
