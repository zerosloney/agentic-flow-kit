---
description: "Read-only adjudicator for PR panel review; handles escalated candidates and returns verdicts"
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

# PR Adjudicator

Shared role contract: `.agents/roles/pr-adjudicator.md`. This file keeps only the host frontmatter.
