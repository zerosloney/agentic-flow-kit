---
description: "Designs the test surface for an L2/L3 plan draft and returns an executable case list with a coverage-gap statement; read-only analysis, never edits files"
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

# Test Designer

Shared role contract: `.agents/roles/test-designer.md`. This file keeps only the host frontmatter.
