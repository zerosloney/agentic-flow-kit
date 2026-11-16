---
description: Designs the test surface for an L2/L3 plan draft and returns an executable case list with a coverage-gap statement; read-only analysis, never edits files
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

公共角色契约：`.agents/roles/test-designer.md`。本文件只保留宿主 frontmatter。
