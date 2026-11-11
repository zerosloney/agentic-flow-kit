---
description: Translates a code commit into strict JSON describing what business capability the system gained, written for non-coding readers (product/customer service); read-only analysis, never edits files
mode: subagent
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: allow
  - action: shell
    resource: "git commit*"
    effect: deny
  - action: shell
    resource: "git push*"
    effect: deny
  - action: shell
    resource: "git reset --hard*"
    effect: deny
  - action: shell
    resource: "git push --force*"
    effect: deny
  - action: shell
    resource: "git push -f*"
    effect: deny
  - action: shell
    resource: "dotnet ef*"
    effect: deny
  - action: shell
    resource: "drop database*"
    effect: deny
  - action: shell
    resource: "git checkout*"
    effect: ask
  - action: shell
    resource: "git clean*"
    effect: ask
  - action: shell
    resource: "git branch -D*"
    effect: ask
  - action: shell
    resource: "rm -rf*"
    effect: ask
  - action: subagent
    resource: "*"
    effect: deny
---

# Wiki Compiler

公共角色契约：`.agents/roles/wiki-compiler.md`。本文件只保留宿主 frontmatter。