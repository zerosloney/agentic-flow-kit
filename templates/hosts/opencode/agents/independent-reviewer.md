---
description: Independently reviews a fixed spec, plan, or code diff for correctness and project-rule violations without modifying files
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

公共角色契约：`.agents/roles/independent-reviewer.md`。本文件只保留宿主 frontmatter。
