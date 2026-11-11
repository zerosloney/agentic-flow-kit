---
name: wiki-compiler
description: "Translates a code commit into strict JSON describing what business capability the system gained, written for non-coding readers (product/customer service); read-only analysis, never edits files"
disallowedTools:
  - write_file
  - edit
  - replace
model: inherit
---

# Wiki Compiler

Shared role contract: `.agents/roles/wiki-compiler.md`. This file keeps only the host frontmatter.
