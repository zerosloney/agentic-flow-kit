#!/bin/sh
# wiki 台账一致性（增量版）：本次暂存触及 wiki/ 时跑 verify 三方校验（磁盘 ↔ INDEX ↔ 看板 DATA）
# 目的：给「登记动作」装触发点——verify 此前无任何钩子调用，只能靠「触及 wiki 时手跑」的文字纪律
# （incident 2026-09-16-wiki-drift-and-verifier-gaps 认定的根因）；本脚本把发现时机提前到 commit。
# 口径与 .agents/scripts/verify-wiki-consistency.mjs 一致：活层新增/删除/移动未登记、数据维护批次目录未入台账即拦。
# 注意 `-c core.quotepath=off`：core.quotepath 为 git 默认 true 时中文路径被转义加引号——实测输出
# `"wiki/\346\265\213\350\257\225..."`，`^wiki/` 前缀匹配失配 → 门禁静默跳过（本机 .gitconfig 恰好设 false，本地不复现）。

cd "$(git rev-parse --show-toplevel)" || exit 1

git -c core.quotepath=off diff --cached --name-only | grep -q '^wiki/' || exit 0

if ! node .agents/scripts/verify-wiki-consistency.mjs; then
  echo "wiki 台账（增量）— BLOCK:"
  echo "  先跑 node .agents/scripts/gen-wiki-board.mjs 补 INDEX/看板（或补 wiki/数据维护/README.md 登记行），再原路重试提交"
  exit 1
fi
exit 0
