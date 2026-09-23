#!/bin/sh
# check-loop.sh 的 fixture 驱动测试（2026-09-13 随 frontmatter 结构化改造引入）
# 现场构造临时 workflow 根目录,经 CHECK_LOOP_ROOT 注入被测脚本,断言 exit code 与 hard-block 关键词。
# 用法:sh .agents/scripts/check-loop.test.sh（在仓库任意目录执行均可）

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TARGET="$SCRIPT_DIR/check-loop.sh"
PASS=0
FAIL=0

# 断言:expect_hard=1 期望 exit 1 且输出含关键词;expect_hard=0 期望 exit 0（输出不阻断）
assert_case() {
  desc="$1"; fixture_root="$2"; expect_hard="$3"; keyword="$4"
  out=$(CHECK_LOOP_ROOT="$fixture_root" sh "$TARGET" 2>&1)
  rc=$?
  if [ "$expect_hard" = "1" ]; then
    if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "$keyword"; then
      PASS=$((PASS+1)); printf 'PASS  %s\n' "$desc"
    else
      FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 1 + 关键词[%s],实际 exit %s）\n%s\n' "$desc" "$keyword" "$rc" "$out"
    fi
  else
    if [ "$rc" -eq 0 ]; then
      PASS=$((PASS+1)); printf 'PASS  %s\n' "$desc"
    else
      FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0,实际 exit %s）\n%s\n' "$desc" "$rc" "$out"
    fi
  fi
}

# mkfix:建空 fixture 根并返回路径
mkfix() {
  d=$(mktemp -d)
  mkdir -p "$d/workflow/intents" "$d/workflow/specs" "$d/workflow/plans" "$d/workflow/incidents"
  printf '%s' "$d"
}

# ---- 场景 1:全合法闭环（intent+plan,L1,done 全勾验带证据）→ exit 0 ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-12-ok.md" <<'EOF'
---
状态: done
级别: L1
日期: 2026-09-12
---
# INTENT — ok

## 验收标准（可测试）
- [x] 用例通过（证据:dotnet test 全绿）
EOF
cat > "$T/workflow/plans/2026-09-12-ok.md" <<'EOF'
---
状态: done
级别: L1
---
# PLAN — ok
EOF
assert_case "全合法闭环(L1 done 勾验带证据) → exit 0" "$T" 0 ""
rm -rf "$T"

# ---- 场景 2:intent 缺 plan → hard ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-12-a.md" <<'EOF'
---
状态: approved
级别: L1
日期: 2026-09-12
---
# INTENT — a
EOF
assert_case "intent 缺 plan → hard 配对断裂" "$T" 1 "配对断裂"
rm -rf "$T"

# ---- 场景 3:L2 intent 缺 spec → hard ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-12-b.md" <<'EOF'
---
状态: approved
级别: L2
日期: 2026-09-12
---
# INTENT — b
EOF
cat > "$T/workflow/plans/2026-09-12-b.md" <<'EOF'
---
状态: approved
级别: L2
---
# PLAN — b
EOF
assert_case "L2 intent 缺 spec → hard 配对断裂" "$T" 1 "缺 spec"
rm -rf "$T"

# ---- 场景 4:L3 spec 缺确认三件 → hard ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-12-c.md" <<'EOF'
---
状态: approved
级别: L3
日期: 2026-09-12
---
# INTENT — c
EOF
cat > "$T/workflow/specs/2026-09-12-c.md" <<'EOF'
---
状态: approved
级别: L3
---
# SPEC — c

## 确认与复核
EOF
cat > "$T/workflow/plans/2026-09-12-c.md" <<'EOF'
---
状态: approved
级别: L3
---
# PLAN — c
EOF
assert_case "L3 spec 缺确认三件 → hard" "$T" 1 "L3 确认缺失"
rm -rf "$T"

# ---- 场景 5:L3 spec 确认三件齐全 → exit 0 ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-12-d.md" <<'EOF'
---
状态: approved
级别: L3
日期: 2026-09-12
---
# INTENT — d
EOF
cat > "$T/workflow/specs/2026-09-12-d.md" <<'EOF'
---
状态: approved
级别: L3
确认结果: approved
确认时间: 2026-09-12
---
# SPEC — d

## 确认与复核
- 独立复核：已由 independent-reviewer 新会话完成,结论 approved
EOF
cat > "$T/workflow/plans/2026-09-12-d.md" <<'EOF'
---
状态: approved
级别: L3
---
# PLAN — d
EOF
assert_case "L3 确认三件齐全(frontmatter 2 件+正文独立复核) → exit 0" "$T" 0 ""
rm -rf "$T"

# ---- 场景 6(papercut #4 回归):新建 done intent 验收未勾验 → hard;带附注不影响判定 ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-13-e.md" <<'EOF'
---
状态: done
级别: L1
日期: 2026-09-13
备注: 回溯补档,原工作 2026-09-12 完成
---
# INTENT — e

## 验收标准（可测试）
- [ ] 用例通过
EOF
cat > "$T/workflow/plans/2026-09-13-e.md" <<'EOF'
---
状态: done
级别: L1
---
# PLAN — e
EOF
assert_case "新建 done 未勾验(附注在备注键,状态仍纯枚举) → hard 验收未对账" "$T" 1 "验收未对账"
rm -rf "$T"

# ---- 场景 7:存量(<2026-09-12) done 未勾验 → warning,exit 0 ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-01-f.md" <<'EOF'
---
状态: done
级别: L1
日期: 2026-09-01
---
# INTENT — f

## 验收标准（可测试）
- [ ] 用例通过
EOF
cat > "$T/workflow/plans/2026-09-01-f.md" <<'EOF'
---
状态: done
级别: L1
---
# PLAN — f
EOF
assert_case "存量 done 未勾验 → warning 不阻断" "$T" 0 ""
rm -rf "$T"

# ---- 场景 8:incident 选「是」但 intent 不存在 → hard 回路断档 ----
T=$(mkfix)
cat > "$T/workflow/incidents/2026-09-12-g.md" <<'EOF'
---
状态: fixed
级别: L2
发现: 2026-09-12
---
# INCIDENT — g

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit:abc1234
   - 影响环境:dev
   - 是否需要新 intent:
     - 是 → ../intents/2026-09-12-ghost.md

2. 防复发验证
   - 用例:XxxTest

3. 规范条目
   - AGENTS.md 某节
EOF
cat > "$T/workflow/plans/2026-09-12-g.md" <<'EOF'
---
状态: done
级别: L2
---
# PLAN — g
EOF
cat > "$T/workflow/specs/2026-09-12-g.md" <<'EOF'
---
状态: approved
级别: L2
---
# SPEC — g
EOF
assert_case "incident 回路引用不存在 intent → hard 回路断档" "$T" 1 "回路断档"
rm -rf "$T"

# ---- 场景 9:incident 流程 legacy → 豁免级别/配对检查,exit 0 ----
T=$(mkfix)
cat > "$T/workflow/incidents/2026-08-27-h.md" <<'EOF'
---
状态: closed
流程: legacy
发现: 2026-08-27
---
# INCIDENT — h（legacy 回填,无级别无配对）

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit:历史回填
   - 影响环境:dev
   - 是否需要新 intent:
     - 否 → 理由:legacy 回填

2. 防复发验证
   - 回归清单条目在案

3. 规范条目
   - AGENTS.md 某节
EOF
assert_case "incident legacy 豁免配对 → exit 0" "$T" 0 ""
rm -rf "$T"

# ---- 场景 10:无 frontmatter → 状态键缺失 warning,exit 0（非 L3） ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-12-i.md" <<'EOF'
# INTENT — i（未迁移旧格式）

状态：draft
EOF
cat > "$T/workflow/plans/2026-09-12-i.md" <<'EOF'
---
状态: approved
级别: L1
---
# PLAN — i
EOF
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARN 状态未确认.*i.md"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "无 frontmatter → warning 提示状态键缺失"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 + WARN 状态未提示）\n%s\n' "无 frontmatter → warning 提示状态键缺失" "$out"
fi
rm -rf "$T"

# ---- 场景 11:frontmatter 状态值域外（自造值）→ warning,exit 0（非 L3） ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-12-j.md" <<'EOF'
---
状态: 进行中
级别: L1
日期: 2026-09-12
---
# INTENT — j
EOF
cat > "$T/workflow/plans/2026-09-12-j.md" <<'EOF'
---
状态: approved
级别: L1
---
# PLAN — j
EOF
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARN 状态未确认.*j.md.*进行中"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "状态值域外 → warning 且带当前值提示"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 + WARN 带当前值）\n%s\n' "状态值域外 → warning 且带当前值提示" "$out"
fi
rm -rf "$T"

# ---- 场景 12:无 frontmatter 的旧格式 L3 声明 → 状态 warning(有意决策,见注释) ----
# frontmatter 唯一来源:无 frontmatter 判不出 L3,降为 warning 引导补 frontmatter;
# 不回退读正文级别行(回退=双源,违背结构化初衷)。恶意删 frontmatter 绕 hard 与旧格式删状态行同性质,不设防。
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-12-k.md" <<'EOF'
# INTENT — k

级别：L3
状态：approved
EOF
cat > "$T/workflow/plans/2026-09-12-k.md" <<'EOF'
# PLAN — k

级别：L3
状态：approved
EOF
cat > "$T/workflow/specs/2026-09-12-k.md" <<'EOF'
# SPEC — k

级别：L3
状态：approved
EOF
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARN 状态未确认.*k.md（frontmatter 状态键当前值:『缺失』）"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "无 frontmatter 旧格式 → warning 引导补 frontmatter(不回退读正文)"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 + WARN 状态键缺失）\n%s\n' "无 frontmatter 旧格式 → warning 引导补 frontmatter(不回退读正文)" "$out"
fi
rm -rf "$T"

# ---- 场景 13:git fixture——L1 intent 与迁移 SQL 同 commit → warning,exit 0(检查项 10) ----
T=$(mkfix)
git -C "$T" init -q
cat > "$T/workflow/intents/2026-09-12-m.md" <<'EOF'
---
状态: done
级别: L1
日期: 2026-09-12
---
# INTENT — m

## 验收标准（可测试）
- [x] 场景构造项（证据:fixture）
EOF
cat > "$T/workflow/plans/2026-09-12-m.md" <<'EOF'
---
状态: done
级别: L1
---
# PLAN — m
EOF
mkdir -p "$T/docs/scripts"
printf 'CREATE TABLE t(id INT);\n' > "$T/docs/scripts/01-add-table.sql"
git -C "$T" add -A
git -C "$T" -c user.email=t@t -c user.name=t commit -qm test
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARN 级别疑似判低.*m.md"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "L1 入口文档提交触及迁移 SQL → warning 疑似判低"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 + WARN 级别疑似判低）\n%s\n' "L1 入口文档提交触及迁移 SQL → warning 疑似判低" "$out"
fi
rm -rf "$T"

# ---- 场景 14:git fixture——L3 intent 与迁移 SQL 同 commit → 级别一致,不告警,exit 0 ----
T=$(mkfix)
git -C "$T" init -q
cat > "$T/workflow/intents/2026-09-12-n.md" <<'EOF'
---
状态: done
级别: L3
日期: 2026-09-12
---
# INTENT — n

## 验收标准（可测试）
- [x] 场景构造项（证据:fixture）
EOF
cat > "$T/workflow/specs/2026-09-12-n.md" <<'EOF'
---
状态: done
级别: L3
确认结果: approved
确认时间: 2026-09-12
---
# SPEC — n

## 确认与复核
- 独立复核：已由 independent-reviewer 新会话完成,结论 approved
EOF
cat > "$T/workflow/plans/2026-09-12-n.md" <<'EOF'
---
状态: done
级别: L3
---
# PLAN — n
EOF
mkdir -p "$T/docs/scripts"
printf 'CREATE TABLE t(id INT);\n' > "$T/docs/scripts/01-add-table.sql"
git -C "$T" add -A
git -C "$T" -c user.email=t@t -c user.name=t commit -qm test
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && ! printf '%s' "$out" | grep -q "级别疑似判低"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "L3 入口文档提交触及迁移 SQL → 级别一致不告警"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 且无级别疑似判低）\n%s\n' "L3 入口文档提交触及迁移 SQL → 级别一致不告警" "$out"
fi
rm -rf "$T"

# ---- 场景 15:ZCode Adapter 缺失不再告警(本地配置不入 git),但存在且断线仍告警 ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-12-o.md" <<'EOF'
---
状态: done
级别: L1
日期: 2026-09-12
---
# INTENT — o

## 验收标准（可测试）
- [x] 用例通过（证据:全绿）
EOF
cat > "$T/workflow/plans/2026-09-12-o.md" <<'EOF'
---
状态: done
级别: L1
---
# PLAN — o
EOF
mkdir -p "$T/.agents/roles" "$T/.zcode/agents"
for r in implementer independent-reviewer ui-verifier; do printf '# role %s\n' "$r" > "$T/.agents/roles/$r.md"; done
printf -- '---\nname: implementer\n---\n断线内容,无角色引用\n' > "$T/.zcode/agents/implementer.md"
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "ZCode implementer 未引用公共角色" && ! printf '%s' "$out" | grep -q "ZCode 缺"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "ZCode 缺失跳过/存在断线仍告警"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 + ZCode 断线告警且无缺失告警）\n%s\n' "ZCode 缺失跳过/存在断线仍告警" "$out"
fi
rm -rf "$T"

# ---- 场景 16:skills 引用仓库内与用户级均不存在 → 仍报引用断档(用户级回退不放行一切) ----
T=$(mkfix)
cat > "$T/workflow/README.md" <<'EOF'
# WF README

技能见 .agents/skills/fake-skill（仓库内与用户级均不存在）
EOF
cat > "$T/workflow/intents/2026-09-12-p.md" <<'EOF'
---
状态: done
级别: L1
日期: 2026-09-12
---
# INTENT — p

## 验收标准（可测试）
- [x] 用例通过（证据:全绿）
EOF
cat > "$T/workflow/plans/2026-09-12-p.md" <<'EOF'
---
状态: done
级别: L1
---
# PLAN — p
EOF
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "引用断档.*fake-skill"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "skills 引用仓库内与用户级均无 → 仍报引用断档"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 + 引用断档告警）\n%s\n' "skills 引用仓库内与用户级均无 → 仍报引用断档" "$out"
fi
rm -rf "$T"

# ---- 场景 17:存量 done 未勾验但含「存量对账豁免」声明 → 出账,无验收对账 warning ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-01-q.md" <<'EOF'
---
状态: done
级别: L1
日期: 2026-09-01
---
# INTENT — q

## 验收标准（可测试）
> **存量对账豁免（2026-09-12，用户拍板不追溯）**：下方未勾项均为第二轮 UI/浏览器实测项。
- [ ] 用例通过
EOF
cat > "$T/workflow/plans/2026-09-01-q.md" <<'EOF'
---
状态: done
级别: L1
---
# PLAN — q
EOF
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && ! printf '%s' "$out" | grep -q "验收对账存量"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "存量含豁免声明 → 出账不计未对账"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 且无验收对账存量 warning）\n%s\n' "存量含豁免声明 → 出账不计未对账" "$out"
fi
rm -rf "$T"

# ---- 场景 18:新建 done intent 缺「## 验收标准」节 → hard(2026-09-16 补口回归:此前后缺节静默通过) ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-13-r.md" <<'EOF'
---
状态: done
级别: L1
日期: 2026-09-13
---
# INTENT — r

## 目标
关单前未写验收标准节。
EOF
cat > "$T/workflow/plans/2026-09-13-r.md" <<'EOF'
---
状态: done
级别: L1
---
# PLAN — r
EOF
assert_case "新建 done 缺验收标准节 → hard 验收未对账" "$T" 1 "缺「## 验收标准」节"
rm -rf "$T"

# ---- 场景 19:新建 done intent 勾选项缩进写法 → hard(口径放宽后仍拦,2026-09-16 补口回归) ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-13-s.md" <<'EOF'
---
状态: done
级别: L1
日期: 2026-09-13
---
# INTENT — s

## 验收标准（可测试）
  - [ ] 缩进未勾项（此前后静默通过）
EOF
cat > "$T/workflow/plans/2026-09-13-s.md" <<'EOF'
---
状态: done
级别: L1
---
# PLAN — s
EOF
assert_case "新建 done 勾选项缩进 → hard 验收未对账" "$T" 1 "验收未对账"
rm -rf "$T"

# ---- 场景 20:incident 状态值域外 → warning(2026-09-16 补口:此前 incident 状态零断言) ----
T=$(mkfix)
cat > "$T/workflow/incidents/2026-09-13-t.md" <<'EOF'
---
状态: 已修复
级别: L1
发现: 2026-09-13
---
# INCIDENT — t

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit:abc1234
   - 影响环境:dev
   - 是否需要新 intent:
     - 否 → 理由:实现 bug 单点修复

2. 防复发验证
   - 回归清单条目在案

3. 规范条目
   - AGENTS.md 某节
EOF
cat > "$T/workflow/plans/2026-09-13-t.md" <<'EOF'
---
状态: done
级别: L1
---
# PLAN — t
EOF
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARN 状态非法.*t.md.*已修复"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "incident 状态值域外 → warning 且带当前值"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 + WARN 状态非法）\n%s\n' "incident 状态值域外 → warning 且带当前值" "$out"
fi
rm -rf "$T"

# ---- 场景 21:incident 缺级别 → warning 明示配对检查已跳过(不再静默豁免整段配对门) ----
T=$(mkfix)
cat > "$T/workflow/incidents/2026-09-13-u.md" <<'EOF'
---
状态: open
发现: 2026-09-13
---
# INCIDENT — u

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit:待修复
   - 影响环境:dev
   - 是否需要新 intent:
     - 否 → 理由:实现 bug 单点修复

2. 防复发验证
   - 回归清单条目在案

3. 规范条目
   - AGENTS.md 某节
EOF
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARN 级别缺失.*u.md.*配对检查已跳过"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "incident 缺级别 → warning 明示配对已跳过"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 + WARN 级别缺失含配对提示）\n%s\n' "incident 缺级别 → warning 明示配对已跳过" "$out"
fi
rm -rf "$T"

# ---- 场景 22:存量(<2026-09-12) done 缺验收标准节 → 不 hard(存量聚合 warning 口径) ----
T=$(mkfix)
cat > "$T/workflow/intents/2026-09-01-v.md" <<'EOF'
---
状态: done
级别: L1
日期: 2026-09-01
---
# INTENT — v

## 目标
存量旧格式,缺验收标准节。
EOF
cat > "$T/workflow/plans/2026-09-01-v.md" <<'EOF'
---
状态: done
级别: L1
---
# PLAN — v
EOF
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "验收对账存量"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "存量 done 缺节 → 聚合 warning 不 hard"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 + 验收对账存量 warning）\n%s\n' "存量 done 缺节 → 聚合 warning 不 hard" "$out"
fi
rm -rf "$T"

# ---- 场景 15:git 仓库模式——未跟踪的并行半成品（draft intent 无 plan）不拦 push → exit 0 ----
# 2026-09-18 现场:共享工作区里并行会话的未跟踪 draft intent（尚未配 plan）恰好处于编辑瞬间,
# 拦住了另一会话的 push。修复口径:仓库模式只扫 HEAD 已提交内容。此场景不设 CHECK_LOOP_ROOT（走 git 模式）。
T=$(mkfix)
git -C "$T" init -q
cat > "$T/workflow/intents/2026-09-12-ok2.md" <<'EOF'
---
状态: done
级别: L1
日期: 2026-09-12
---
# INTENT — ok2

## 验收标准（可测试）
- [x] 场景构造项（证据:fixture）
EOF
cat > "$T/workflow/plans/2026-09-12-ok2.md" <<'EOF'
---
状态: done
级别: L1
---
# PLAN — ok2
EOF
git -C "$T" add -A
git -C "$T" -c user.email=t@t -c user.name=t commit -qm base
# 未跟踪的并行半成品:draft L1 intent,无同名 plan（修复前会 hard-block「入口缺同名 plan」+ WARN 状态未确认）
cat > "$T/workflow/intents/2026-09-18-parallel-wip.md" <<'EOF'
---
状态: draft
级别: L1
日期: 2026-09-18
---
# INTENT — 并行会话半成品
EOF
out=$(cd "$T" && sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && ! printf '%s' "$out" | grep -q "parallel-wip"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "仓库模式:未跟踪 draft intent(无 plan)不进扫描,不拦 push"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 且输出不含 parallel-wip,实际 exit %s）\n%s\n' "仓库模式:未跟踪 draft intent(无 plan)不进扫描,不拦 push" "$rc" "$out"
fi

# ---- 场景 16:git 仓库模式——同一断档件提交进 HEAD 后仍须 hard-block（门禁不因过滤失效）----
git -C "$T" add workflow/intents/2026-09-18-parallel-wip.md
git -C "$T" -c user.email=t@t -c user.name=t commit -qm wip
out=$(cd "$T" && sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "缺 plan.*parallel-wip"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "仓库模式:已提交的入口缺 plan 断档仍 hard-block"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 1 + 关键词[缺同名 plan],实际 exit %s）\n%s\n' "仓库模式:已提交的入口缺 plan 断档仍 hard-block" "$rc" "$out"
fi
rm -rf "$T"

# ---- 场景 23:检索层——模块合法 + INDEX 一致 → exit 0 且无两条新告警 ----
# fixture 拷入真实生成器与词表（测接线，非假桩；生成器逻辑自身由 gen-workflow-index.test.mjs 覆盖）
T=$(mkfix)
mkdir -p "$T/.agents/scripts" "$T/.agents"
cp "$SCRIPT_DIR/gen-workflow-index.mjs" "$T/.agents/scripts/"
cp "$SCRIPT_DIR/../workflow-modules.txt" "$T/.agents/"
cat > "$T/workflow/intents/2026-09-22-mod-ok.md" <<'EOF'
---
状态: approved
级别: L1
日期: 2026-09-22
模块: pipeline
---
# INTENT — mod ok

## 验收标准（可测试）
- [ ] 用例通过
EOF
cat > "$T/workflow/plans/2026-09-22-mod-ok.md" <<'EOF'
---
状态: approved
级别: L1
模块: pipeline
---
# PLAN — mod ok
EOF
(cd "$T" && node .agents/scripts/gen-workflow-index.mjs >/dev/null 2>&1)
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && ! printf '%s' "$out" | grep -q "WARN 模块元数据" && ! printf '%s' "$out" | grep -q "WARN 索引漂移"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "检索层:模块合法+INDEX 一致 → exit 0 无新告警"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 且无模块/索引告警）\n%s\n' "检索层:模块合法+INDEX 一致 → exit 0 无新告警" "$out"
fi
rm -rf "$T"

# ---- 场景 24:模块枚举非法 + 2026-09-22 起新建缺字段 → WARN 不阻断 ----
T=$(mkfix)
mkdir -p "$T/.agents"
cp "$SCRIPT_DIR/../workflow-modules.txt" "$T/.agents/"
cat > "$T/workflow/intents/2026-09-22-mod-bad.md" <<'EOF'
---
状态: approved
级别: L1
日期: 2026-09-22
模块: 不存在的模块
---
# INTENT — mod bad
EOF
cat > "$T/workflow/plans/2026-09-22-mod-bad.md" <<'EOF'
---
状态: approved
级别: L1
---
# PLAN — mod bad
EOF
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARN 模块元数据" && printf '%s' "$out" | grep -q "不在词表" && printf '%s' "$out" | grep -q "缺「模块:」字段"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "检索层:模块非法/缺字段 → WARN 且 exit 0"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 + 模块元数据 WARN 含两类）\n%s\n' "检索层:模块非法/缺字段 → WARN 且 exit 0" "$out"
fi
rm -rf "$T"

# ---- 场景 25:INDEX 漂移 → WARN 索引漂移，exit 0（口径:调生成器 --check）----
T=$(mkfix)
mkdir -p "$T/.agents/scripts" "$T/.agents"
cp "$SCRIPT_DIR/gen-workflow-index.mjs" "$T/.agents/scripts/"
cp "$SCRIPT_DIR/../workflow-modules.txt" "$T/.agents/"
cat > "$T/workflow/intents/2026-09-22-drift.md" <<'EOF'
---
状态: approved
级别: L1
日期: 2026-09-22
模块: pipeline
---
# INTENT — drift

## 验收标准（可测试）
- [ ] 用例通过
EOF
cat > "$T/workflow/plans/2026-09-22-drift.md" <<'EOF'
---
状态: approved
级别: L1
模块: pipeline
---
# PLAN — drift
EOF
(cd "$T" && node .agents/scripts/gen-workflow-index.mjs >/dev/null 2>&1)
sed -i 's/^状态: approved$/状态: done/' "$T/workflow/plans/2026-09-22-drift.md" 2>/dev/null || printf '%s\n' "$(sed 's/^状态: approved$/状态: done/' "$T/workflow/plans/2026-09-22-drift.md")" > "$T/workflow/plans/2026-09-22-drift.md"
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARN 索引漂移"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "检索层:INDEX 漂移 → WARN 且 exit 0"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 + WARN 索引漂移）\n%s\n' "检索层:INDEX 漂移 → WARN 且 exit 0" "$out"
fi
rm -rf "$T"

# ---- 场景 26:常驻面预算——合规(小体积)→ 无超限告警,exit 0 ----
T=$(mkfix)
mkdir -p "$T/.agents/scripts"
cp "$SCRIPT_DIR/rule-budget.sh" "$T/.agents/scripts/"
cp "$SCRIPT_DIR/../rule-budgets.txt" "$T/.agents/"
printf '# AGENTS 小体积 fixture\n' > "$T/AGENTS.md"
mkdir -p "$T/.agents/commands"
printf '# 小命令\n' > "$T/.agents/commands/plan.md"
cat > "$T/workflow/intents/2026-09-22-budget-ok.md" <<'EOF'
---
状态: approved
级别: L1
日期: 2026-09-22
模块: pipeline
---
# INTENT — budget ok
EOF
cat > "$T/workflow/plans/2026-09-22-budget-ok.md" <<'EOF'
---
状态: approved
级别: L1
模块: pipeline
---
# PLAN — budget ok
EOF
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && ! printf '%s' "$out" | grep -q "WARN 常驻面超限"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "常驻面预算:合规 → 无超限告警且 exit 0"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 且无超限告警）\n%s\n' "常驻面预算:合规 → 无超限告警且 exit 0" "$out"
fi
rm -rf "$T"

# ---- 场景 27:常驻面预算——AGENTS.md 超限 → WARN 且 exit 0（一进一出提示）----
T=$(mkfix)
mkdir -p "$T/.agents/scripts"
cp "$SCRIPT_DIR/rule-budget.sh" "$T/.agents/scripts/"
cp "$SCRIPT_DIR/../rule-budgets.txt" "$T/.agents/"
head -c 8000 /dev/zero | tr '\0' 'x' > "$T/AGENTS.md"
cat > "$T/workflow/intents/2026-09-22-budget-bad.md" <<'EOF'
---
状态: approved
级别: L1
日期: 2026-09-22
模块: pipeline
---
# INTENT — budget bad
EOF
cat > "$T/workflow/plans/2026-09-22-budget-bad.md" <<'EOF'
---
状态: approved
级别: L1
模块: pipeline
---
# PLAN — budget bad
EOF
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARN 常驻面超限" && printf '%s' "$out" | grep -q "一进一出"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "常驻面预算:超限 → WARN(含一进一出提示) 且 exit 0"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0 + WARN 常驻面超限）\n%s\n' "常驻面预算:超限 → WARN 且 exit 0" "$out"
fi
rm -rf "$T"

# ---- 场景 28:rule-budget --staged——暂存超限即 exit 1（pre-commit 硬拦路径）；换成合规即 exit 0 ----
T=$(mkfix)
mkdir -p "$T/.agents/scripts"
cp "$SCRIPT_DIR/rule-budget.sh" "$T/.agents/scripts/"
cp "$SCRIPT_DIR/../rule-budgets.txt" "$T/.agents/"
git -C "$T" init -q
head -c 8000 /dev/zero | tr '\0' 'x' > "$T/AGENTS.md"
git -C "$T" add AGENTS.md
out=$(cd "$T" && sh .agents/scripts/rule-budget.sh --staged 2>&1); rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "常驻面超限：AGENTS.md"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "rule-budget --staged:暂存超限 → exit 1（硬拦路径）"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 1 + 超限行,实际 exit %s）\n%s\n' "rule-budget --staged:暂存超限 → exit 1" "$rc" "$out"
fi
printf '# 小体积\n' > "$T/AGENTS.md"
git -C "$T" add AGENTS.md
out2=$(cd "$T" && sh .agents/scripts/rule-budget.sh --staged 2>&1); rc2=$?
if [ "$rc2" -eq 0 ]; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "rule-budget --staged:合规 → exit 0（不误拦）"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s（期望 exit 0,实际 exit %s）\n%s\n' "rule-budget --staged:合规 → exit 0" "$rc2" "$out2"
fi
rm -rf "$T"

# ---- 场景 29:git fixture——新 done 的 spec/plan 历史无 approved → WARN 确认态缺失,exit 0(检查项 14) ----
T=$(mkfix)
git -C "$T" init -q
cat > "$T/workflow/incidents/2026-09-23-confirm-gate.md" <<'EOF'
---
状态: closed
级别: L1
发现: 2026-09-23
模块: material
---
# INCIDENT — confirm gate

## 复盘三件套（缺一不可）

1. 结构性修复
 - 修复 commit:abc1234
 - 影响环境:dev
 - 是否需要新 intent:
 - 否 → 理由:实现 bug 单点修复

2. 防复发验证
 - 回归清单条目在案

3. 规范条目
 - AGENTS.md 某节
EOF
cat > "$T/workflow/plans/2026-09-23-confirm-gate.md" <<'EOF'
---
状态: done
级别: L1
模块: material
---
# PLAN — confirm gate
EOF
git -C "$T" add -A
git -C "$T" -c user.email=t@t -c user.name=t commit -qm test
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARN 确认态缺失.*2026-09-23-confirm-gate.md"; then
 PASS=$((PASS+1)); printf 'PASS %s\n' "新 done 无 approved 历史 → WARN 确认态缺失 且 exit 0"
else
 FAIL=$((FAIL+1)); printf 'FAIL %s（期望 exit 0 + WARN 确认态缺失）\n%s\n' "新 done 无 approved 历史 → WARN 确认态缺失" "$out"
fi
rm -rf "$T"

# ---- 场景 30:git fixture——先 approved 后 done（确认环节留痕）→ 无该 WARN,exit 0 ----
T=$(mkfix)
git -C "$T" init -q
cat > "$T/workflow/incidents/2026-09-23-confirm-ok.md" <<'EOF'
---
状态: closed
级别: L1
发现: 2026-09-23
模块: material
---
# INCIDENT — confirm ok

## 复盘三件套（缺一不可）

1. 结构性修复
 - 修复 commit:abc1234
 - 影响环境:dev
 - 是否需要新 intent:
 - 否 → 理由:实现 bug 单点修复

2. 防复发验证
 - 回归清单条目在案

3. 规范条目
 - AGENTS.md 某节
EOF
cat > "$T/workflow/plans/2026-09-23-confirm-ok.md" <<'EOF'
---
状态: approved
级别: L1
模块: material
---
# PLAN — confirm ok
EOF
git -C "$T" add -A
git -C "$T" -c user.email=t@t -c user.name=t commit -qm approved
cat > "$T/workflow/plans/2026-09-23-confirm-ok.md" <<'EOF'
---
状态: done
级别: L1
模块: material
---
# PLAN — confirm ok
EOF
git -C "$T" add -A
git -C "$T" -c user.email=t@t -c user.name=t commit -qm done
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && ! printf '%s' "$out" | grep -q "WARN 确认态缺失"; then
 PASS=$((PASS+1)); printf 'PASS %s\n' "approved → done 留痕 → 无确认态缺失告警"
else
 FAIL=$((FAIL+1)); printf 'FAIL %s（期望 exit 0 且无确认态缺失告警）\n%s\n' "approved → done 留痕 → 无确认态缺失告警" "$out"
fi
rm -rf "$T"

# ---- 场景 31:非 git fixture——历史不可考,检查项 14 静默跳过(不误报) ----
T=$(mkfix)
cat > "$T/workflow/incidents/2026-09-23-confirm-nogit.md" <<'EOF'
---
状态: closed
级别: L1
发现: 2026-09-23
模块: material
---
# INCIDENT — confirm nogit

## 复盘三件套（缺一不可）

1. 结构性修复
 - 修复 commit:abc1234
 - 影响环境:dev
 - 是否需要新 intent:
 - 否 → 理由:实现 bug 单点修复

2. 防复发验证
 - 回归清单条目在案

3. 规范条目
 - AGENTS.md 某节
EOF
cat > "$T/workflow/plans/2026-09-23-confirm-nogit.md" <<'EOF'
---
状态: done
级别: L1
模块: material
---
# PLAN — confirm nogit
EOF
out=$(CHECK_LOOP_ROOT="$T" sh "$TARGET" 2>&1); rc=$?
if [ "$rc" -eq 0 ] && ! printf '%s' "$out" | grep -q "WARN 确认态缺失"; then
 PASS=$((PASS+1)); printf 'PASS %s\n' "非 git fixture → 检查项 14 跳过,不误报"
else
 FAIL=$((FAIL+1)); printf 'FAIL %s（期望 exit 0 且无确认态缺失告警）\n%s\n' "非 git fixture → 检查项 14 跳过" "$out"
fi
rm -rf "$T"

# ---- 汇总 ----
printf '\n合计: PASS %s / FAIL %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
