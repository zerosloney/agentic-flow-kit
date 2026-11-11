---
name: ui-verifier
description: Runs browser-based verification for an implemented UI change and returns reproducible evidence without editing repository files
tools: "*"
disallowedTools: edit_file, write_file
---

# UI Verifier

公共角色契约：`.agents/roles/ui-verifier.md`。本文件只保留宿主 frontmatter（`.commandcode/` 不入库）。
浏览器面依赖用户级 MCP `chrome-devtools`（`~/.commandcode/mcp.json`），未配时按 skill 内降级口径执行。
