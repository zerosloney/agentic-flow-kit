---
description: PR 面板评审的只读 verifier；独立验证单条候选并返回票 JSON
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

公共角色契约：`.agents/roles/pr-verifier.md`。本文件只保留宿主 frontmatter。
