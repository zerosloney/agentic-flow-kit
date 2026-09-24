#!/bin/sh
# 常驻面体积预算检查（单源：本脚本 + .agents/rule-budgets.txt；两个触发点共用）
# 用法：sh .agents/scripts/rule-budget.sh [--all|--staged]
#   --all     查「提交后树」全量（check-loop.sh 检查 13 调用，warning 侧）
#   --staged  仅查本次暂存触及的条目 + 触及目录的合计（.githooks/pre-commit 调用，超限即硬拦）
# 退出码：0 通过；1 有超限（违例逐条打到 stdout，调用方决定警告还是阻断）
# 「提交后树」= 索引（index）内容：staged 版优先于 HEAD；无 git（fixture 沙箱）时回退工作区文件。
# 预算表按字节读，显式去 \r——本仓库 core.autocrlf=true，表文件检出即 CRLF，行尾残留会让数值比较失配。
# 字节口径 = 索引 / HEAD 内容（git cat-file，LF 归一）。**禁用 wc -c 核对**——工作区文件是 CRLF，量出来系统性偏大
# （2026-09-21 实测 .agents/commands/ 工作区 39963B vs 索引 39451B，差 ~500B，一度误判「已超限」）。
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || true   # 非 git 环境（fixture）留在原地
MODE=${1:---all}
BUDGETS=.agents/rule-budgets.txt
[ -f "$BUDGETS" ] || exit 0

# 取「提交后」字节数：索引 → HEAD → 工作区
fsize() { # <path>
  if git cat-file -e ":$1" 2>/dev/null; then git cat-file -s ":$1"
  elif git cat-file -e "HEAD:$1" 2>/dev/null; then git cat-file -s "HEAD:$1"
  else wc -c < "$1" 2>/dev/null | tr -d '[:space:]'
  fi
}

staged_list=""
if [ "$MODE" = "--staged" ]; then
  staged_list=$(git -c core.quotepath=off diff --cached --name-only 2>/dev/null)
fi

viol=0
while IFS= read -r line; do
  line=$(printf '%s' "$line" | tr -d '\r')
  pat=${line%% *}
  lim=${line##* }
  case "$pat" in ''|'#'*) continue ;; esac
  case "$lim" in ''|*[!0-9]*) continue ;; esac
  case "$pat" in
    */) # 目录合计：--staged 下仅当暂存触及该目录内文件才查（case 字面前缀匹配——pat 含 . 时不能当正则用，2026-09-24）
      if [ "$MODE" = "--staged" ]; then
        found=0
        while IFS= read -r sf; do
          case "$sf" in "$pat"*) found=1 ;; esac
        done <<EOF
$staged_list
EOF
        [ "$found" = "1" ] || continue
      fi
      total=0
      for f in "$pat"*; do
        [ -f "$f" ] || continue
        total=$((total + $(fsize "$f")))
      done
      if [ "$total" -gt "$lim" ]; then
        echo "常驻面超限：${pat} 合计 ${total}B > 上限 ${lim}B"
        viol=1
      fi
      ;;
    *) # 逐文件（glob 刻意不加引号以展开；无命中时 [ -f ] 兜住）
      for f in $pat; do
        [ -f "$f" ] || continue
        if [ "$MODE" = "--staged" ]; then
          printf '%s\n' "$staged_list" | grep -qxF "$f" || continue
        fi
        b=$(fsize "$f")
        if [ "$b" -gt "$lim" ]; then
          echo "常驻面超限：$f = ${b}B > 上限 ${lim}B"
          viol=1
        fi
      done
      ;;
  esac
done < "$BUDGETS"

[ "$viol" -eq 0 ] || exit 1
exit 0
