#!/bin/sh
# check-loop.sh — 兼容 shim（2026-09-26 check-loop-node：实现已全量迁移 node，本文件只保留调用面兼容）
# 实现与检查项清单（14 项 `// N.` 注释）见同目录 check-loop.mjs 头部；判定语义/输出契约/exit 码不变。
# 保留原因：.githooks/pre-push 与既有文档/适配层按「check-loop.sh」文件名引用——文件名即稳定接口。
# 检查项清单与判据「以 check-loop.mjs 头部注释为准」（根 AGENTS.md「闭环兜底」节口径经本行承接）。
exec node "$(dirname "$0")/check-loop.mjs" "$@"
