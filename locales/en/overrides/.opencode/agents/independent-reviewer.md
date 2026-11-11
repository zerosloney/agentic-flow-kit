---
description: "Independently reviews a fixed spec, plan, or code diff for correctness and project-rule violations without modifying files"
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

# Independent Reviewer

Shared role contract: `.agents/roles/independent-reviewer.md`. This file keeps only the host frontmatter.
