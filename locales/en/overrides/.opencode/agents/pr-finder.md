---
description: "Read-only finder for PR panel review; finds bugs independently per lens and returns candidate JSON"
mode: subagent
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: deny
  - action: subagent
    resource: "*"
    effect: deny
---

# PR Finder

Shared role contract: `.agents/roles/pr-finder.md`. This file keeps only the host frontmatter.
