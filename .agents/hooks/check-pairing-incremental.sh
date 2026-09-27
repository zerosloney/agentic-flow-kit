#!/bin/sh
# 闭环配对（增量版）：本次暂存的 intents/ incidents/ 入口文档必须已有同名 plan（L2/L3 另须同名 spec）
# 目的：把 check-loop.sh「配对断裂」hard-block 的发现时机从 pre-push 提前到 commit
# （papercut 2026-09-15：maintain.md 只写「incident≡intent 免另立 intent」，未把配 plan 写成显式步骤，
#  按文档字面执行三次 commit 全绿、push 才爆红，只能后补；
#  2026-09-27 audit-gate-hardening 补齐 spec 档——此前只查 plan，L2/L3 缺 spec 仍要拖到 push 才爆红）
# 口径与 check-loop.sh 对齐：入口文档（intents/ incidents/ 直下 .md）↔ workflow/plans/ 同名，
# L2/L3 级别另须 workflow/specs/ 同名（check-loop 检查 1 同款分档）；
# 同 commit 携带 plan/spec 合法（检查的是工作区文件存在，staged 新建同样命中）。
# 已知边界：legacy 豁免与级别读取均基于工作区文件而非暂存 blob——add 后又改工作区时可能误豁免/误拦（逐文件取 blob 的 fork 成本大于收益，接受）。

cd "$(git rev-parse --show-toplevel)" || exit 1

fail=0
# -c core.quotepath=off：quotepath 默认 true 时非 ASCII 路径被引号转义（"workflow/\346..."），
# ^workflow/ 前缀匹配失配 → 门禁静默跳过——教训与修法同 check-wiki-ledger.sh（2026-09-27 gate-coverage）
for f in $(git -c core.quotepath=off diff --cached --name-only --diff-filter=ACMR | grep -E '^workflow/(intents|incidents)/[^/]+\.md$' | grep -v '_TEMPLATE\.md$'); do
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
  lvl=$(sed -n 's/^级别:[[:space:]]*//p' "$f" | head -1)
  if [ "$lvl" = "L2" ] || [ "$lvl" = "L3" ]; then
    if [ ! -f "workflow/specs/$base.md" ]; then
      echo "闭环配对（增量）— BLOCK:"
      echo "  入口缺同名 spec: $f（级别 $lvl 须三件套，应在 workflow/specs/$base.md）"
      echo "  与 pre-push check-loop 检查 1 同口径——先起草 spec 走 design.md，再提交"
      fail=1
    fi
  fi
done

if [ $fail -ne 0 ]; then
  echo "pre-commit: 入口文档配对不全（plan / L2-L3 spec），提交已阻止（与 pre-push check-loop 同口径，发现时机提前到 commit）" >&2
fi
exit $fail
