---
name: pr-adjudicator
description: PR 面板评审的只读裁决者；处理 escalated 候选并返回裁决
model: magpie/autoclaw-cn/zaicoding_glm-5.3
inheritProjectContext: true
defaultContext: fresh
excludeTools: edit, write
---
# PR Adjudicator

公共角色契约：`.agents/roles/pr-adjudicator.md`。本文件只保留宿主 frontmatter（`.pi/` 不入库，模型可在此固定）。
