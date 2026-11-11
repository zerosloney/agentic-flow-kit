---
description: "Read-only verifier for PR panel review; independently verifies a candidate and returns a vote JSON"
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

# PR Verifier

Shared role contract: `.agents/roles/pr-verifier.md`. This file keeps only the host frontmatter.
