---
description: PR 面板评审的只读裁决者；处理 escalated 候选并返回裁决
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

公共角色契约：`.agents/roles/pr-adjudicator.md`。本文件只保留宿主 frontmatter。
