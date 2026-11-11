---
name: pr-finder
description: PR 面板评审的只读 finder；按镜头独立找 bug，返回候选 JSON
tools: Read, Grep, Glob, Bash
model: inherit
---

公共角色契约：`.agents/roles/pr-finder.md`。本文件只保留宿主 frontmatter。只读找 bug，禁止修改仓库文件。
