#!/bin/sh
# 闭环配对（增量版）：本次暂存的 intents/ incidents/ 入口文档必须已有同名 plan
# 目的：把 check-loop.sh「配对断裂」hard-block 的发现时机从 pre-push 提前到 commit
# （papercut 2026-09-15：maintain.md 只写「incident≡intent 免另立 intent」，未把配 plan 写成显式步骤，
#  按文档字面执行三次 commit 全绿、push 才爆红，只能后补）
# 口径与 check-loop.sh 对齐：入口文档（intents/ incidents/ 直下 .md）↔ workflow/plans/ 同名；
# 同 commit 携带 plan 合法（检查的是工作区文件存在，staged 新建 plan 同样命中）。

cd "$(git rev-parse --show-toplevel)" || exit 1

fail=0
for f in $(git diff --cached --name-only --diff-filter=ACMR | grep -E '^workflow/(intents|incidents)/[^/]+\.md$' | grep -v '_TEMPLATE\.md$'); do
  # 闭环引擎启用前的回填件带「流程: legacy」豁免配对检查（与 check-loop 同口径）
  if grep -q '^流程: legacy' "$f"; then
    continue
  fi
  base=$(basename "$f" .md)
  if [ ! -f "workflow/plans/$base.md" ]; then
    echo "闭环配对（增量）— BLOCK:"
    echo "  入口缺同名 plan: $f（应在 workflow/plans/$base.md）"
    echo "  L1 极简 plan 只需「改动面 + 验证方式」两节（复制 workflow/plans/_TEMPLATE.md）"
    fail=1
  fi
done

if [ $fail -ne 0 ]; then
  echo "pre-commit: 入口文档缺同名 plan，提交已阻止（与 pre-push check-loop 同口径，发现时机提前到 commit）" >&2
fi
exit $fail
