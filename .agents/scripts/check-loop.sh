#!/bin/sh
# check-loop: AI-Native 闭环骨架断档扫描（agentic-flow-kit 通用版）
# 扫描 workflow/ 目录,输出 intent/spec/plan 配对、模板字段占位符、incidents 复盘三件套、新 intent 回路等断档
# 本脚本全部为通用逻辑：宿主 Adapter 检查按「目录存在才校验」（flow-kit init --hosts 决定装哪些宿主）
#
# 严重性分级（2026-09-09 按用户决策调整）:
#   - hard-block(阻断 push / CI):配对断裂 + 回路断档（影响三件套可追溯性与闭环电路）
#   - warning(打印提示,exit 0):其余卫生项（状态未确认 / 模板占位残留 / 引用漂移 / Adapter 一致性等）
# 违例输出到 stderr 并 exit 1；只剩警告时 exit 0
#
# 检查项:
#   1. 入口文档/spec/plan 同名配对(L1 必须有 plan;L2/L3 必须有 spec+plan)        [hard-block]
#   2. 模板字段占位符残留(YYYY-MM-DD / <主题> 等未替换)                             [warning]
#   3. incidents 复盘三件套完整性 + 状态严格枚举 + 新 intent 回路(回路断档=hard,其他=warning)
#   4. 引用有效性(文档/指令中引用的 .agents/ 路径必须存在)                          [warning]
#   5. intent/spec/plan 状态字段 + L3 独立复核                                       [warning]
#   6. 子智能体角色契约 + OpenCode/Trae/ZCode Adapter 一致性                          [warning]
#   7. 阶段索引同步(AGENTS.md 与 new-task.md 须双向索引全部阶段指令)                [warning]
#   8. intent 验收标准对账(2026-09-12 起新建:done 未勾验/缺节=hard,勾选缺证据=warning;存量聚合 warning,含「存量对账豁免」声明者出账)
#   9. 文件名英文 kebab-case(非 ASCII 文件名=warning,2026-09-11 规则)
#  10. 级别 vs 迁移文件一致性(L1/L2 入口文档加入提交触及迁移 SQL/Migrations=疑似判低,warning)
#  11. workflow/INDEX.md 漂移(活跃层索引与磁盘不一致=warning,2026-09-21 检索层;调生成器 --check,口径单一)
#  12. frontmatter「模块:」合法性(枚举非法 / 2026-09-22 起新建缺字段=warning;词表单源 .agents/workflow-modules.txt)
# 13. 常驻面体积预算(AGENTS.md / backend / frontend / rules / commands 超限=warning,2026-09-21 规则面精简;
# 上限=瘦身后实测+余量,新增须先删除或下沉——一进一出)
# 14. 新 done 的 spec/plan 须在 git 历史里出现过 `状态: approved`(确认环节留痕,2026-09-22 papercut;
# 生效 2026-09-23=规则发布次日,不追溯发布当日已在途文档,口径同检查 12)[warning]
#
# 文档协议（2026-09-13 结构化改造,papercut #4 防复发）:
#   状态/级别/日期/发现/流程/确认结果/确认时间 等机器字段一律由文件头 YAML frontmatter（受限子集）承载:
#     --- 换行后每行 `键: 值`,值严格枚举(状态/级别)或日期;附注自由文本放 `备注:` 键,本脚本不解析备注内容
#   本脚本只扫 frontmatter 块取字段(不再全文正则猜中文格式),正文叙述性字段(独立复核/复核结论)仍按节锚定扫描。
#   测试:sh .agents/scripts/check-loop.test.sh(fixture 注入 CHECK_LOOP_ROOT)
#
# 已确认状态: approved/done=已批或闭环; superseded/cancelled=放弃留档(仍算确认,不挡 push); incident: fixed/closed

# 根目录:默认 git 仓库根;测试经 CHECK_LOOP_ROOT 注入 fixture 根
if [ -n "${CHECK_LOOP_ROOT:-}" ]; then
  cd "$CHECK_LOOP_ROOT" 2>/dev/null || {
    echo "check-loop: CHECK_LOOP_ROOT 不可访问:$CHECK_LOOP_ROOT" >&2
    exit 1
  }
else
  cd "$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "check-loop: 不在 git 仓库内,跳过扫描" >&2
    exit 0
  }
fi

# fm_get <file> <key>: 读 frontmatter 受限子集键值(首行 --- 起至闭合 --- 止,行首 `键: 值`)
# 无 frontmatter / 键不存在时输出空串
# fm_is_delim <line>: 该行是否为 frontmatter 分隔符（--- 后仅可跟空白）
fm_is_delim() {
  __d="$1"
  while :; do
    case "$__d" in
      *[[:space:]]) __d="${__d%?}" ;;
      *) break ;;
    esac
  done
  [ "$__d" = "---" ]
}

# 2026-09-20 性能:原实现每取一个键就 fork 一次 awk。本脚本每次运行要对 400+ 份文档
# 取 2~4 个键,在 MSYS/Windows 下单次 fork 约 45ms,累计上千次 → 整脚本曾需 6 分钟以上,
# 被误判为「卡死」。改为纯 sh 内建(while read + case + 参数展开),语义与原 awk 逐条对齐:
#   · 第 1 行须是 --- (后可跟空白) 才进入 frontmatter,否则直接返回空
#   · 遇下一个 --- 即闭合退出
#   · 键须出现在行首(原 index($0, k ":") == 1),取首个命中
#   · 值两侧去空白(原去除键前缀 + 去尾空白)
# 注:未用 local —— 本文件须保持 POSIX sh 可执行(pre-push 注「其它环境 sh 兼容」)
fm_get() {
  __key="$2"
  __state=before
  while IFS= read -r __line || [ -n "$__line" ]; do
    if [ "$__state" = "before" ]; then
      fm_is_delim "$__line" || return 0
      __state=in
      continue
    fi
    fm_is_delim "$__line" && return 0
    case "$__line" in
      "$__key":*)
        __v="${__line#"$__key":}"
        while :; do
          case "$__v" in
            [[:space:]]*) __v="${__v#?}" ;;
            *) break ;;
          esac
        done
        while :; do
          case "$__v" in
            *[[:space:]]) __v="${__v%?}" ;;
            *) break ;;
          esac
        done
        printf '%s\n' "$__v"
        return 0
        ;;
    esac
  done < "$1" 2>/dev/null
}

# 状态值域:intent/spec/plan 与 incident 各一套
st_ok_doc() { case "$1" in approved|done|superseded|cancelled) return 0 ;; *) return 1 ;; esac; }

WF="workflow"
blockers=""
warnings=""

# 仓库模式只扫已提交(HEAD)内容（2026-09-18 papercut 升级,用户点名「只扫已跟踪文件」）:
# 共享工作区里并行会话的未跟踪/未提交半成品（如 draft intent 尚未配 plan）会拦住别人的 push——
# 推送门只为已提交内容负责。fixture 模式(CHECK_LOOP_ROOT 注入)不过滤,保持全扫;ls-tree 失败(空仓库等)
# 退化为全扫,门禁不失效。
TRACKED_WF=""
TRACKED_OK=0
if [ -z "${CHECK_LOOP_ROOT:-}" ]; then
  if TRACKED_WF=$(git ls-tree -r --name-only HEAD -- workflow 2>/dev/null); then
    TRACKED_OK=1
  fi
fi
# is_tracked <相对根的文件路径>: fixture 模式/HEAD 清单不可用时恒真;否则按 HEAD 清单整行精确匹配
is_tracked() {
  [ "$TRACKED_OK" = "1" ] || return 0
  case "
$TRACKED_WF
" in *"
$1
"*) return 0 ;; *) return 1 ;; esac
}

# --- 1. intent/spec/plan 三文件同名配对(除 _TEMPLATE) [hard-block] ---
for intent in "$WF"/intents/[0-9]*.md; do
  [ -f "$intent" ] || continue
  is_tracked "$intent" || continue
  base=${intent##*/}
  st=$(fm_get "$intent" 状态)
  lvl=$(fm_get "$intent" 级别)
  if ! st_ok_doc "$st"; then
    if [ "$lvl" = "L3" ]; then
      blockers="$blockers
- [状态未确认] L3 intent 必须为 approved/done/superseded/cancelled:$base（frontmatter 状态键当前值:『${st:-缺失}』）"
    else
      warnings="$warnings
- [WARN 状态未确认] intent 必须为 approved/done/superseded/cancelled:$base（frontmatter 状态键当前值:『${st:-缺失}』）"
    fi
  fi
  case "$lvl" in
    L2|L3)
      [ -f "$WF/specs/$base" ] || blockers="$blockers
- [配对断裂] intent 缺 spec:$base（应在 $WF/specs/ 下同名）"
      ;;
  esac
  [ -f "$WF/plans/$base" ] || blockers="$blockers
- [配对断裂] intent 缺 plan:$base（应在 $WF/plans/ 下同名）"
done

for spec in "$WF"/specs/[0-9]*.md; do
  [ -f "$spec" ] || continue
  is_tracked "$spec" || continue
  base=${spec##*/}
  st=$(fm_get "$spec" 状态)
  lvl=$(fm_get "$spec" 级别)
  if [ ! -f "$WF/intents/$base" ] && [ ! -f "$WF/incidents/$base" ]; then
    blockers="$blockers
- [配对断裂] spec 缺 intent/incident:$base（应在 $WF/intents/ 或 $WF/incidents/ 下同名）"
  fi
  if ! st_ok_doc "$st"; then
    if [ "$lvl" = "L3" ]; then
      blockers="$blockers
- [状态未确认] L3 spec 必须为 approved/done/superseded/cancelled:$base（frontmatter 状态键当前值:『${st:-缺失}』）"
    else
      warnings="$warnings
- [WARN 状态未确认] spec 必须为 approved/done/superseded/cancelled:$base（frontmatter 状态键当前值:『${st:-缺失}』）"
    fi
  fi

  # L3 确认三件:确认结果/确认时间读 frontmatter;独立复核为叙述性内容,按正文行锚定(放弃件 superseded/cancelled 豁免)
  if [ "$lvl" = "L3" ]; then
    case "$st" in
      superseded|cancelled) ;;
      *)
        [ "$(fm_get "$spec" 确认结果)" = "approved" ] || blockers="$blockers
- [L3 确认缺失] $base 确认结果必须为 approved"
        [ -n "$(fm_get "$spec" 确认时间)" ] || blockers="$blockers
- [L3 确认缺失] $base 必须记录确认时间"
        grep -qE '^- 独立复核：[[:space:]]*[^<[:space:]].*$' "$spec" 2>/dev/null || blockers="$blockers
- [L3 复核缺失] $base 必须记录新会话独立复核结论"
        ;;
    esac
  fi
done

for plan in "$WF"/plans/[0-9]*.md; do
  [ -f "$plan" ] || continue
  is_tracked "$plan" || continue
  base=${plan##*/}
  st=$(fm_get "$plan" 状态)
  lvl=$(fm_get "$plan" 级别)
  if [ ! -f "$WF/intents/$base" ] && [ ! -f "$WF/incidents/$base" ]; then
    blockers="$blockers
- [配对断裂] plan 缺 intent/incident:$base（应在 $WF/intents/ 或 $WF/incidents/ 下同名）"
  fi
  if ! st_ok_doc "$st"; then
    if [ "$lvl" = "L3" ]; then
      blockers="$blockers
- [状态未确认] L3 plan 必须为 approved/done/superseded/cancelled:$base（frontmatter 状态键当前值:『${st:-缺失}』）"
    else
      warnings="$warnings
- [WARN 状态未确认] plan 必须为 approved/done/superseded/cancelled:$base（frontmatter 状态键当前值:『${st:-缺失}』）"
    fi
  fi
done

# --- 2. 模板字段占位符残留 [warning] ---
placeholder_re='YYYY-MM-DD|<主题>|<日期 主题>|L0 / L1 / L2 / L3|draft / approved / done|open / fixed / closed'
# 排除文件名日期约定(如「导入错误清单_YYYY-MM-DD.xlsx」)——它是运行时文件名格式,非未填占位符
boilerplate_re='\.\./specs/[A-Za-z0-9-]*\.md|写明如何满足|防复发验证|_YYYY-MM-DD\.|format\('"'"'YYYY-MM-DD'"'"'\)|value-format="YYYY-MM-DD"'
# 2026-09-20 性能:原为每文件 2 次 grep fork(426 份 → 852 次子进程)。改为「收集受检文件
# → 一次 grep 批量扫 → 临时文件回放聚合」,告警文本与顺序与原实现完全一致(glob 序、行号升序)。
ph_files=""
for f in "$WF"/intents/[0-9]*.md "$WF"/specs/[0-9]*.md "$WF"/plans/[0-9]*.md "$WF"/incidents/[0-9]*.md; do
  [ -f "$f" ] || continue
  is_tracked "$f" || continue
  ph_files="$ph_files
$f"
done
if [ -n "$ph_files" ]; then
  ph_tmp="${TMPDIR:-/tmp}/check-loop-ph.$$"
  grep -nHE "$placeholder_re" $ph_files 2>/dev/null | grep -vE "$boilerplate_re" > "$ph_tmp"
  ph_cur=""
  ph_buf=""
  while IFS= read -r ph_ln; do
    case "$ph_ln" in
      *:*) ;;
      *) continue ;;
    esac
    ph_f="${ph_ln%%:*}"
    ph_rest="${ph_ln#*:}"
    if [ "$ph_f" != "$ph_cur" ]; then
      if [ -n "$ph_cur" ]; then
        warnings="$warnings
- [WARN 模板未填] $ph_cur 含模板占位符:
$ph_buf"
      fi
      ph_cur="$ph_f"
      ph_buf="$ph_rest"
    else
      ph_buf="$ph_buf
$ph_rest"
    fi
  done < "$ph_tmp"
  if [ -n "$ph_cur" ]; then
    warnings="$warnings
- [WARN 模板未填] $ph_cur 含模板占位符:
$ph_buf"
  fi
  rm -f "$ph_tmp"
fi

# date_ge <YYYY-MM-DD> <YYYY-MM-DD>:前者不早于后者则返回 0（纯 sh,零 fork;原为 awk）
date_ge() {
  __ay=${1%%-*}
  __am=${1#*-}
  __am=${__am%%-*}
  __ad=${1##*-}
  __by=${2%%-*}
  __bm=${2#*-}
  __bm=${__bm%%-*}
  __bd=${2##*-}
  if [ "$__ay" -ne "$__by" ]; then [ "$__ay" -gt "$__by" ]; return $?; fi
  if [ "$__am" -ne "$__bm" ]; then [ "$__am" -gt "$__bm" ]; return $?; fi
  [ "$__ad" -ge "$__bd" ]
}

# --- 3. incidents 复盘三件套完整性(纯字段缺失=warning)+ 新 intent 回路(断档=hard-block) ---
# 2026-09-20 性能:原为每份 incident 5 次 fork(grep -qE×3 + grep -q + grep|head×2,73 份 → 365 次)。
# 改为循环前单次 awk 预扫写入临时文件,循环内用 fd 3 顺序读(与下方 for 同一 glob/过滤/顺序,天然对齐)。
inc_list=""
for inc in "$WF"/incidents/[0-9]*.md; do
  [ -f "$inc" ] || continue
  is_tracked "$inc" || continue
  inc_list="$inc_list
$inc"
done
inc_tmp="${TMPDIR:-/tmp}/check-loop-inc.$$"
: > "$inc_tmp"
if [ -n "$inc_list" ]; then
  # 每份一行: <文件名>|三件套1|2|3|是否有「是否需要新 intent」|回路 intent 路径(- = 选了是但未写路径)
  awk '
    FNR == 1 { flush(); curf = FILENAME }
    /^1\. / { s1 = 1 }
    /^2\. / { s2 = 1 }
    /^3\. / { s3 = 1 }
    index($0, "是否需要新 intent") > 0 { hp = 1 }
    index($0, "是 → ") > 0 && !yseen {
      yseen = 1
      if (match($0, /intents\/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-[^ )]*\.md/))
        ref = substr($0, RSTART, RLENGTH)
      else
        ref = "-"
    }
    END { flush() }
    function flush() {
      if (curf != "") {
        n = split(curf, p, "/")
        printf "%s|%d|%d|%d|%d|%s\n", p[n], s1, s2, s3, hp, ref
      }
      s1 = 0; s2 = 0; s3 = 0; hp = 0; ref = ""; yseen = 0
    }
  ' $inc_list > "$inc_tmp" 2>/dev/null
fi

exec 3< "$inc_tmp"
for inc in "$WF"/incidents/[0-9]*.md; do
  [ -f "$inc" ] || continue
  is_tracked "$inc" || continue
  # 与预扫表逐行对齐(同一 glob/过滤/顺序):此处必须最先读,不能落在任何 continue 之后
  IFS='|' read -r inc_key inc_s1 inc_s2 inc_s3 inc_hasparent inc_ref <&3
  name=${inc##*/}
  inc_lvl=$(fm_get "$inc" 级别)
  inc_st=$(fm_get "$inc" 状态)

  # incident 状态严格枚举（README「文档协议」对齐；2026-09-16 审查补口：此前状态零断言）
  case "$inc_st" in
    open|fixed|closed) ;;
    *) warnings="$warnings
- [WARN 状态非法] incident 状态必须为 open/fixed/closed:$name（frontmatter 状态键当前值:『${inc_st:-缺失}』）" ;;
  esac

  if [ "$(fm_get "$inc" 流程)" != "legacy" ]; then
    case "$inc_lvl" in
      L0|L1|L2|L3)
        case "$inc_lvl" in
          L1|L2|L3)
            [ -f "$WF/plans/$name" ] || blockers="$blockers
- [配对断裂] incident 缺 plan:$name（应在 $WF/plans/ 下同名）"
            ;;
        esac
        case "$inc_lvl" in
          L2|L3)
            [ -f "$WF/specs/$name" ] || blockers="$blockers
- [配对断裂] incident 缺 spec:$name（应在 $WF/specs/ 下同名）"
            ;;
        esac
        ;;
      *)
        warnings="$warnings
- [WARN 级别缺失] $name 必须填写 L0/L1/L2/L3（配对检查已跳过——补级别后重跑本脚本校验配对）"
        ;;
    esac
  fi

  if [ "$inc_s1" = "0" ]; then
    warnings="$warnings
- [WARN 三件套不全] $name 缺复盘三件套之 1"
  fi
  if [ "$inc_s2" = "0" ]; then
    warnings="$warnings
- [WARN 三件套不全] $name 缺复盘三件套之 2"
  fi
  if [ "$inc_s3" = "0" ]; then
    warnings="$warnings
- [WARN 三件套不全] $name 缺复盘三件套之 3"
  fi

  if [ "$inc_hasparent" = "0" ]; then
    warnings="$warnings
- [WARN 三件套不全] $name 缺「是否需要新 intent」子项"
    continue
  fi

  if [ "$inc_ref" = "-" ]; then
    blockers="$blockers
- [回路断档] $name 选「是」但未指明 intent 文件路径"
  elif [ -n "$inc_ref" ] && [ ! -f "$WF/$inc_ref" ]; then
    blockers="$blockers
- [回路断档] $name 引用的 intent 不存在:$inc_ref"
  fi
done
exec 3<&-
rm -f "$inc_tmp"

# --- 4. 引用有效性 [warning] ---
# 2026-09-20 性能:原为每文件 2 次 fork(grep -o + sort,445 份 → 890 次)。改为一次
# grep -oHE 批量抽取 + 临时文件按文件去重回放。原实现用 sort -u 排序输出,此处按首次
# 出现序去重;两者仅在「同一文件存在多处引用断档」时告警顺序不同(当前仓库该告警为 0)。
rf_files=""
for f in AGENTS.md */AGENTS.md "$WF"/*.md "$WF"/*/[0-9]*.md "$WF"/*/_TEMPLATE.md .agents/commands/*.md; do
  [ -f "$f" ] || continue
  rf_files="$rf_files
$f"
done
if [ -n "$rf_files" ]; then
  rf_tmp="${TMPDIR:-/tmp}/check-loop-rf.$$"
  grep -ohHE '\.agents/(commands|hooks|scripts|skills|roles)/[A-Za-z0-9_][A-Za-z0-9_./-]*' $rf_files > "$rf_tmp" 2>/dev/null
  rf_cur=""
  rf_seen=""
  while IFS= read -r rf_ln; do
    rf_f="${rf_ln%%:*}"
    ref="${rf_ln#*:}"
    [ -n "$ref" ] || continue
    if [ "$rf_f" != "$rf_cur" ]; then
      rf_cur="$rf_f"
      rf_seen=""
    fi
    case "
$rf_seen
" in
      *"
$ref
"*) continue ;;
    esac
    rf_seen="$rf_seen
$ref"
    if [ ! -e "$ref" ]; then
      # .agents/skills/ 技能库装在用户级(~/.agents/skills/,AGENTS.md「技能辅助」节),
      # 仓库内无而用户级有不算断档;其余路径仍须仓库内存在
      case "$ref" in
        .agents/skills/*) [ -e "$HOME/$ref" ] || warnings="$warnings
- [WARN 引用断档] $rf_f 引用不存在的文件:$ref" ;;
        *) warnings="$warnings
- [WARN 引用断档] $rf_f 引用不存在的文件:$ref" ;;
      esac
    fi
  done < "$rf_tmp"
  rm -f "$rf_tmp"
fi

# --- 5. 子智能体角色契约与宿主 Adapter 一致性 [warning] ---
for role in implementer independent-reviewer ui-verifier; do
  role_path=".agents/roles/$role.md"
  if [ ! -f "$role_path" ]; then
    warnings="$warnings
- [WARN 角色缺失] 公共角色契约不存在:$role_path"
    continue
  fi

  opencode_adapter=".opencode/agents/$role.md"
  trae_adapter=".trae/agents/$role.md"

  if [ ! -d .opencode/agents ]; then
    # 未安装 OpenCode 宿主（init 未选或已移除）——静默跳过
    :
  elif [ ! -f "$opencode_adapter" ]; then
    warnings="$warnings
- [WARN Adapter 缺失] OpenCode 缺 $role:$opencode_adapter"
  else
    grep -q '^mode:[[:space:]]*subagent[[:space:]]*$' "$opencode_adapter" 2>/dev/null || warnings="$warnings
- [WARN Adapter 无效] OpenCode $role 未声明 mode:subagent:$opencode_adapter"
    grep -qF "$role_path" "$opencode_adapter" 2>/dev/null || warnings="$warnings
- [WARN Adapter 断线] OpenCode $role 未引用公共角色:$role_path"
  fi

  if [ ! -d .trae/agents ]; then
    # 未安装 Trae 宿主（init 未选或已移除）——静默跳过
    :
  elif [ ! -f "$trae_adapter" ]; then
    warnings="$warnings
- [WARN Adapter 缺失] Trae 缺 $role:$trae_adapter"
  else
    grep -q "^name:[[:space:]]*$role[[:space:]]*$" "$trae_adapter" 2>/dev/null || warnings="$warnings
- [WARN Adapter 无效] Trae $role 的 name 与文件名不一致:$trae_adapter"
    grep -qF "$role_path" "$trae_adapter" 2>/dev/null || warnings="$warnings
- [WARN Adapter 断线] Trae $role 未引用公共角色:$role_path"
  fi

  zcode_adapter=".zcode/agents/$role.md"
  if [ ! -f "$zcode_adapter" ]; then
    # 2026-09-13 起 .zcode/agents/ 为本地配置不入 git(AGENTS.md「指令与子代理调用」节),
    # 干净 clone / 未维护本地的环境必然缺失——缺失不再告警,宿主按 fallback: main 兜底;
    # 存在时仍校验一致性,作为「本地自行维护」的质量门
    :
  else
    grep -qE "^name:[[:space:]]*[\"']?$role[\"']?[[:space:]]*$" "$zcode_adapter" 2>/dev/null || warnings="$warnings
- [WARN Adapter 无效] ZCode $role 的 name 与文件名不一致:$zcode_adapter"
    grep -qF "$role_path" "$zcode_adapter" 2>/dev/null || warnings="$warnings
- [WARN Adapter 断线] ZCode $role 未引用公共角色:$role_path"
  fi

  if ! grep -qF "$role_path" AGENTS.md .agents/commands/*.md 2>/dev/null; then
    warnings="$warnings
- [WARN 命令断线] 工作流未引用公共角色:$role_path"
  fi
done

legacy_agent_refs=$(grep -nHE '(^subagent:|subagent_type=|general_purpose_task|browser_use)' AGENTS.md .agents/commands/*.md 2>/dev/null)
if [ -n "$legacy_agent_refs" ]; then
  warnings="$warnings
- [WARN 旧委派残留] 主规则或阶段命令仍含宿主特定/旧委派声明:
$legacy_agent_refs"
fi

pinned_models=$(grep -nH '^model:' .opencode/agents/*.md .trae/agents/*.md .zcode/agents/*.md 2>/dev/null | grep -v 'model:[[:space:]]*inherit')
if [ -n "$pinned_models" ]; then
  warnings="$warnings
- [WARN 宿主耦合] 薄 Adapter 不应固定模型:
$pinned_models"
fi

# --- 6. 阶段索引同步 [warning] ---
for cmd in plan design build test deploy maintain review; do
  for doc in AGENTS.md .agents/commands/new-task.md; do
    grep -q "\.agents/commands/$cmd\.md" "$doc" 2>/dev/null || warnings="$warnings
- [WARN 阶段索引漂移] $doc 缺 $cmd 指令索引(两处阶段表须同步维护)"
  done
done

# --- 8. intent 验收标准对账（闭环最后一公里:done 必须逐条勾验并补证据） ---
# 2026-09-12 起新建的 intent:done 状态下验收标准有未勾项 = hard-block（闭环断档类）；
# 勾选但缺「证据：」= warning；存量 intent 不回填，聚合为一条 warning 提示，豁免 hard。
acc_cutoff="2026-09-12"
legacy_unaccounted=0
# 2026-09-20 性能:原为每份 done intent 7 次 fork(printf|grep + awk 日期 + grep -qE 节存在
# + 2 awk 勾选扫描 + grep 豁免,约 100 份 → 约 700 次)。改为循环前单次 awk 预扫写临时文件,
# 循环内 fd 4 顺序读;日期改纯 sh 比较。
acc_list=""
for intent in "$WF"/intents/[0-9]*.md; do
  [ -f "$intent" ] || continue
  is_tracked "$intent" || continue
  acc_list="$acc_list
$intent"
done
acc_tmp="${TMPDIR:-/tmp}/check-loop-acc.$$"
: > "$acc_tmp"
if [ -n "$acc_list" ]; then
  # 每份一行: <文件名>|有无验收节|有无未勾项|有无勾选缺证据|是否含存量对账豁免声明
  awk '
    FNR == 1 { flush(); curf = FILENAME }
    /^[[:space:]]*##[[:space:]]+[^#]*验收标准/ { hs = 1; insec = 1; next }
    insec && /^[[:space:]]*##[[:space:]]/ { insec = 0 }
    insec && /^[[:space:]]*- \[ \]/ { uc = 1 }
    insec && /^[[:space:]]*- \[x\]/ && $0 !~ /证据：/ { ne = 1 }
    index($0, "存量对账豁免（") > 0 { ex = 1 }
    END { flush() }
    function flush() {
      if (curf != "") {
        n = split(curf, p, "/")
        printf "%s|%d|%d|%d|%d\n", p[n], hs, uc, ne, ex
      }
      hs = 0; uc = 0; ne = 0; ex = 0; insec = 0
    }
  ' $acc_list > "$acc_tmp" 2>/dev/null
fi

exec 4< "$acc_tmp"
for intent in "$WF"/intents/[0-9]*.md; do
  [ -f "$intent" ] || continue
  is_tracked "$intent" || continue
  # 与预扫表逐行对齐:此读必须最先执行(不能落在任何 continue 之后)
  IFS='|' read -r acc_key acc_has_sec acc_uc acc_ne acc_ex <&4
  base=${intent##*/}
  [ "$(fm_get "$intent" 状态)" = "done" ] || continue
  # 日期改纯 sh:文件名以 YYYY-MM-DD 开头,取前 10 字符后用 date_ge 数值比较
  __d="${base%.md}"
  filedate=""
  __i=0
  while [ "$__i" -lt 10 ]; do
    filedate="$filedate${__d%"${__d#?}"}"
    __d="${__d#?}"
    __i=$((__i + 1))
  done
  case "$filedate" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
    *) filedate="" ;;
  esac
  is_new=0
  if [ -n "$filedate" ] && date_ge "$filedate" "$acc_cutoff"; then
    is_new=1
  fi
  # 节存在性(2026-09-16 补口):done intent 必须含「## 验收标准」节(允许前导空白与标题内编号),缺节不得静默视为已对账
  if [ "$acc_has_sec" = "0" ]; then
    if [ "$is_new" = "1" ]; then
      blockers="$blockers
- [验收未对账] done intent 缺「## 验收标准」节(勾验无从核对):$base"
    else
      [ "$acc_ex" = "1" ] || legacy_unaccounted=$((legacy_unaccounted+1))
    fi
    continue
  fi
  # 勾选扫描:允许前导空白(与看板 parseAcceptance 同口径);节结束=下一个二级标题
  [ "$acc_uc" = "0" ] && [ "$acc_ne" = "0" ] && continue
  if [ "$is_new" = "1" ]; then
    if [ "$acc_uc" = "1" ]; then
      blockers="$blockers
- [验收未对账] done intent 验收标准有未勾验项:$base（逐条勾验并补证据：commit/用例/冒烟输出）"
    fi
    if [ "$acc_ne" = "1" ]; then
      warnings="$warnings
- [WARN 验收缺证据] $base 验收标准勾选项缺「证据：」标注"
    fi
  else
    # 存量豁免:intent 含「存量对账豁免(日期,用户拍板不追溯)」声明即视为已对账
    # (2026-09-12 用户拍板 UI 二轮实测不追溯,commit 1069c94;此处为该决策的机器识别。
    #  放在 else 分支:新建 intent 的 hard 判定不受豁免声明影响,不可借声明逃避勾验)
    [ "$acc_ex" = "1" ] || legacy_unaccounted=$((legacy_unaccounted+1))
  fi
done
exec 4<&-
rm -f "$acc_tmp"
if [ "$legacy_unaccounted" -gt 0 ]; then
  warnings="$warnings
- [WARN 验收对账存量] $legacy_unaccounted 个存量 done intent 验收标准未对账（2026-09-12 前创建，豁免 hard，不回填）"
fi

# 2026-09-20 性能:原为每文件 2 次 fork(printf + grep -q),426 文件 → 852 次子进程。
# 纯 sh case 判定:含任意非 ASCII/不可打印字符即返回 1(等价于 LC_ALL=C grep '[^ -~]')
is_ascii_name() {
  case "$1" in *[!\ -~]*) return 1 ;; *) return 0 ;; esac
}

# --- 9. 文件名英文 kebab-case（非 ASCII 文件名 = warning，2026-09-11 规则） ---
for f in "$WF"/intents/*.md "$WF"/specs/*.md "$WF"/plans/*.md "$WF"/incidents/*.md; do
  [ -f "$f" ] || continue
  is_tracked "$f" || continue
  base=${f##*/}
  [ "$base" = "_TEMPLATE.md" ] && continue
  if ! is_ascii_name "$base"; then
    warnings="$warnings
- [WARN 文件名非英文] 文件名含非 ASCII 字符,应为英文 kebab-case:$f"
  fi
done

# --- 10. 级别 vs 迁移文件一致性(启发式:疑似判低)[warning] ---
# 依据「入口文档随代码同一提交」约定,定位 L1/L2 intent/incident 首次加入的 commit;
# 该提交触及 docs/scripts/ 迁移 SQL 或 **/Migrations/ 时提示复核级别(混合改动应就高不就低)。
# 启发式有漏报(代码与文档分 commit 提交、merge commit 首次引入)与误报可能,仅 advisory 不阻断;
# 不在 git 仓库内(fixture 测试)时整体跳过。
# 性能:单次 git log 拉全量「文件→首次加入 commit→该提交文件清单」映射,单 awk 内完成匹配,
#       避免逐文档起 git 进程(Windows 下每次 fork ~0.6s,95 文档逐查曾耗时 ~2min)。
if git rev-parse --git-dir >/dev/null 2>&1; then
  # 单次 git log 走管道进 awk(stdin=add 映射),md 文件由 awk 按相对路径 getline 读取;
  # 不落临时文件——Git Bash 的 gawk 是原生 Windows 程序,打不开 mktemp 的 MSYS 虚拟路径(/tmp/...)。
  # 输出以 \x1e(记录分隔符)切条:每条 = 描述首行 + 换行 + 命中的迁移文件行
  hits=$(git log --diff-filter=A --format=@%H --name-only 2>/dev/null | awk -v docs="$(echo "$WF"/intents/[0-9]*.md "$WF"/incidents/[0-9]*.md)" '
    function check(f,   c, arr, n, i, hit, p, m, base) {
      c = addpath[f]
      if (c == "") return
      n = split(cfiles[c], arr, "\n")
      hit = ""
      for (i = 1; i <= n; i++)
        if (arr[i] ~ /(^|\/)docs\/scripts\/.*\.sql$/ || arr[i] ~ /(^|\/)Migrations\//)
          hit = hit "\n" arr[i]
      if (hit != "") {
        m = split(f, p, "/"); base = p[m]
        printf "%s 级别 %s 但其加入提交触及迁移文件(混合改动应就高不就低,请复核级别):\n%s\x1e", base, lvl, substr(hit, 2)
      }
    }
    { # 主输入 = git log 的「@commit + 文件清单」流
      if ($0 ~ /^@/) { c = substr($0, 2); next }
      if (NF && c != "" && !($0 in addpath)) { # 逆序输出(新→旧):仅首次遇及,同名文件删后重建取最新 add
        addpath[$0] = c
        cfiles[c] = cfiles[c] "\n" $0
      }
    }
    END {
      nd = split(docs, dl, " ")
      for (i = 1; i <= nd; i++) {
        f = dl[i]; fm2 = 0; lvl = ""; ln = 0
        while ((getline line < f) > 0) {
          ln++
          if (ln == 1) { fm2 = (line ~ /^---[[:space:]]*$/) ? 1 : 0; continue }
          if (fm2 && line ~ /^---[[:space:]]*$/) { fm2 = 0; continue }
          if (fm2 && index(line, "级别:") == 1) {
            s = line; sub(/^级别:[[:space:]]*/, "", s); sub(/[[:space:]]+$/, "", s); lvl = s
          }
        }
        close(f)
        if (lvl == "L1" || lvl == "L2") check(f)
      }
    }
  ')
  if [ -n "$hits" ]; then
    set -f
    IFS="$(printf '\036')"
    for rec in $hits; do
      [ -n "$rec" ] || continue
      warnings="$warnings
- [WARN 级别疑似判低] $rec"
    done
    unset IFS
    set +f
  fi
fi

# --- 11. workflow/INDEX.md 漂移(活跃层索引与磁盘不一致 = warning,2026-09-21 检索层) ---
# 口径与生成器一致(扫磁盘):直接调生成器 --check,不在本脚本复刻渲染逻辑(避免双写漂移)。
# 根下无生成器(fixture 未提供)/无 node 时自然跳过,不误报、门禁不失效。
if [ -f .agents/scripts/gen-workflow-index.mjs ] && command -v node >/dev/null 2>&1; then
  idx_out=$(node .agents/scripts/gen-workflow-index.mjs --check 2>&1)
  if [ $? -ne 0 ]; then
    idx_first=$(printf '%s' "$idx_out" | head -1)
    warnings="$warnings
- [WARN 索引漂移] workflow/INDEX.md 与磁盘不一致——跑 node .agents/scripts/gen-workflow-index.mjs 重新生成（$idx_first）"
  fi
fi

# --- 12. frontmatter「模块:」合法性(2026-09-21 检索层)[warning] ---
# 词表单源 .agents/workflow-modules.txt;缺字段只对「2026-09-22 起新建」(日期/发现 ≥ 2026-09-22)提示——
# 规则发布次日生效,不追溯发布当日已在途的并行文档。词表缺失(fixture 未提供)时整体跳过。
# 性能:单次 awk 完成全部文档扫描(对照检查 10 的预扫思路),避免逐文档 fork。
if [ -f .agents/workflow-modules.txt ]; then
  mods=$(grep -v '^#' .agents/workflow-modules.txt | grep -v '^[[:space:]]*$')
  mod_docs=""
  for f in "$WF"/intents/[0-9]*.md "$WF"/specs/[0-9]*.md "$WF"/plans/[0-9]*.md "$WF"/incidents/[0-9]*.md; do
    [ -f "$f" ] || continue
    is_tracked "$f" || continue
    mod_docs="$mod_docs $f"
  done
  if [ -n "$mod_docs" ]; then
    mod_hits=$(awk -v modules="$mods" -v docs="$mod_docs" 'BEGIN {
      n = split(modules, m, "\n")
      for (i = 1; i <= n; i++) if (m[i] != "") vocab[m[i]] = 1
      nd = split(docs, dl, " ")
      for (k = 1; k <= nd; k++) {
        f = dl[k]; fm = 0; ln = 0; d = ""; mod = ""
        while ((getline line < f) > 0) {
          ln++
          if (ln == 1) { fm = (line ~ /^---[[:space:]]*$/) ? 1 : 0; continue }
          if (fm && line ~ /^---[[:space:]]*$/) break
          if (!fm) continue
          if (index(line, "模块:") == 1) { s = line; sub(/^模块:[[:space:]]*/, "", s); sub(/[[:space:]]+$/, "", s); mod = s }
          else if (index(line, "日期:") == 1) { s = line; sub(/^日期:[[:space:]]*/, "", s); sub(/[[:space:]]+$/, "", s); d = s }
          else if (index(line, "发现:") == 1) { s = line; sub(/^发现:[[:space:]]*/, "", s); sub(/[[:space:]]+$/, "", s); d = s }
        }
        close(f)
        m3 = split(f, p, "/"); base = p[m3]
        # 日期回退文件名前缀(plan/spec 的 frontmatter 无日期字段,口径同 gen-workflow-index.mjs / 看板)
        if (d == "") d = substr(base, 1, 10)
        if (mod != "") {
          if (!(mod in vocab)) printf "%s「模块: %s」不在词表(见 .agents/workflow-modules.txt)\036", base, mod
        } else if (d ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/ && d >= "2026-09-22") {
          printf "%s 缺「模块:」字段(2026-09-22 起新建文档必填)\036", base
        }
      }
    }' </dev/null)
    if [ -n "$mod_hits" ]; then
      set -f
      IFS="$(printf '\036')"
      for rec in $mod_hits; do
        [ -n "$rec" ] || continue
        warnings="$warnings
- [WARN 模块元数据] $rec"
      done
      unset IFS
      set +f
    fi
  fi
fi

# --- 13. 常驻面体积预算(超限 = warning,不阻断;2026-09-21 规则面精简配套) ---
# 判定逻辑与预算表**单源**在 .agents/scripts/rule-budget.sh + .agents/rule-budgets.txt（与 pre-commit 的
# --staged 硬拦共用），本脚本只把退出码转成 WARN——push 侧提示，commit 侧已硬拦；不在此复刻判定。
# 脚本 / 预算表缺失（fixture 未提供）时自然跳过，不误报。
if [ -f .agents/scripts/rule-budget.sh ] && [ -f .agents/rule-budgets.txt ]; then
  if ! rb_out=$(sh .agents/scripts/rule-budget.sh --all 2>&1); then
    warnings="$warnings
- [WARN 常驻面超限] 常驻面体积超预算(先删除或下沉被取代条目再增——一进一出):
$(printf '%s' "$rb_out" | head -5 | sed 's/^/    /')"
  fi
fi

# --- 14. 新 done 的 spec/plan 须在 git 历史里出现过 approved(确认环节留痕)[warning] ---
# 规则生效 2026-09-22(papercut 2026-09-22,用户点名):`approved` 是确认环节的机器可见态,`done` 只在关单出现;
# 从 draft 直跳 done 会让确认环节在文档里消失——而检查 5 视 approved/done 同权,此前无任何门禁能发现跳态。
# 作用域:日期 ≥ 2026-09-23(生效次日,不追溯发布当日已在途的并行文档;存量同理——避免对无法诚实补正的旧件刷屏,
# 口径同检查 12:frontmatter 日期/发现 → 文件名前缀回退)。
# 判据:当前状态为 done 的文件,须在 git 历史中至少有一个提交版本的**行首**出现过 `状态: approved`
# (用 -G 行级正则而非 -S 计数:前者按行匹配,配 ^ 锚定即与 fm_get「键须在行首」口径一致,且一次调用覆盖空格变体)。
# 依赖 git:非 git 目录(fixture 未 git init)/ 尚无提交的空仓库自动跳过;候选集仅新文档,每候选一次 git 调用,成本可控。
if git rev-parse --git-dir >/dev/null 2>&1 && git rev-parse -q --verify HEAD >/dev/null 2>&1; then
 for f in "$WF"/specs/[0-9]*.md "$WF"/plans/[0-9]*.md; do
 [ -f "$f" ] || continue
 is_tracked "$f" || continue
 [ "$(fm_get "$f" 状态)" = "done" ] || continue
 base=${f##*/}
 d=$(fm_get "$f" 日期)
 [ -n "$d" ] || d=$(fm_get "$f" 发现)
 [ -n "$d" ] || d=${base%${base#??????????}}
 case "$d" in
 2026-09-2[3-9]|2026-09-[3-9][0-9]|2026-1[0-2]-[0-3][0-9]|202[7-9]-*|20[3-9][0-9]-*|2[1-9][0-9][0-9]-*) ;;
 *) continue ;;
 esac
 [ -n "$(git log -1 --format=%H -G'^状态:[[:space:]]*approved' -- "$f" 2>/dev/null)" ] && continue
 warnings="$warnings
- [WARN 确认态缺失] $base 状态已 done 但 git 历史中从未出现行首「状态: approved」——确认环节未留痕(draft 直跳 done)"
 done
fi

# --- 输出 ---
# hard-block 阻断(配对断裂/回路断档),warning 提示不阻断
if [ -n "$blockers" ]; then
  printf '闭环骨架断档（check-loop.sh）— HARD-BLOCK:\n%s\n\n' "$blockers" >&2
  if [ -n "$warnings" ]; then
    printf 'WARN（advisory,不阻断）:\n%s\n' "$warnings" >&2
  fi
  exit 1
fi

if [ -n "$warnings" ]; then
  printf 'check-loop.sh WARN（advisory,不阻断）:\n%s\n' "$warnings" >&2
fi
exit 0
