---
description: "Runs browser-based verification for an implemented UI change and returns reproducible evidence without editing repository files"
mode: subagent
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: allow
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

# UI Verifier

Shared role contract: `.agents/roles/ui-verifier.md`. This file keeps only the host frontmatter.
