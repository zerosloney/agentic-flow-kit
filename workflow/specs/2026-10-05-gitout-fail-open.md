---
状态: approved
级别: L2
日期: 2026-10-05
模块: pipeline
备注: gitOut fail-open 根治——fail-loud + 单次重试，返回语义红线不动；与同名 incident 配对（incident 即 intent 等价入口）
确认指纹: f7fb92c5c9bde7f7
---
# SPEC — gitout-fail-open

<!-- 与 intents/ 下同名入口文档配对；本单入口为同名 incident（check-loop 认 incident≡intent） -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->

## 功能行为

**改前**（缺陷行为，CI 实证 run 37252874044）：

`gitOut`（templates/_agents/scripts/check-loop.mjs:213-218）用一行 `if (r.error || r.status !== 0 || !ok(r)) return null` 把三种结果合并为单一 `null`：① spawn 层异常（`r.error`——runner 资源紧张 EAGAIN/EPERM/EMFILE 类）；② git 业务失败（status≠0，如不在 git 仓）；③ ok 过滤拒绝。调用方无从区分，各 git 探测门只能把 `null` 一律解释为「不在 git 仓」并静默跳过：

- :161 根定位（`--show-toplevel`）→ 整个扫描跳过（exit 0）
- :555 证据上下文 → 返回 null，证据核验降级
- :720 检查 8 入口门 → **证据核验整体静默跳过**（本单 CI 实证路径：fixture 是真 git 仓，瞬时 spawn 异常后检查 8 被跳过，测试拿到 exit=0 无裁决）
- :796 检查 X 入口门 → 同上静默跳过
- :581 直连 spawnSync（绕过 gitOut，验证证据 SHA 存在性）：`r.error` 使 status=null，被 `status !== 0` 捕获 → 误判「证据伪造」（方向相反的同类缺陷）

无任何出账、无重试——瞬时异常与持久「非 git 仓」在观测面上完全一致。

**改后**（方案 A：fail-loud + 单次重试，语义红线不动）：

1. `gitOut` 对 `r.error` 新增两步：**响亮出账**——`console.error`（stderr，与 :156 等基础设施消息同道）一条 `check-loop: git 探测异常 <args0> …（<error code>），按非 git 仓降级`，**进程级去重恰一条**（多探测点连续失败不刷屏）；**单次重试**——`r.error.code` 属瞬时类（EAGAIN/EPERM/EMFILE/EINTR）时重试一次，重试成功则正常返回、无降级发生。重试后仍异常才返回 `null`，调用方语义不变
2. `:581` 直连点套用同一模式（响亮出账 + 瞬时类重试一次；重试后仍异常维持按「证据伪造」拦——fail-closed 方向保持，仅消除把基础设施异常误算业务失败的部分）；与 gitOut 注释互引
3. 新增 `CHECK_LOOP_GIT` env：覆盖 GIT 可执行路径（仅供测试注入必败替身；**未设置时取值与现行为逐字节一致，装户零影响**）
4. 语义红线（不动）：非 git 仓跳过（exit 0）是合法装户形态（非 git 项目装 flow-kit），保持；本单只收紧「git 仓内基础设施异常被静默吞掉」这一条路径——残余风险（连续两次瞬时异常仍降级）由响亮出账兜住可见性，代码处标注 `intentional-simple`

**边界与异常**：`CHECK_LOOP_GIT` 指向不存在/不可执行路径时 spawnSync 稳定返回 `r.error`（ENOENT/EACCES），跨平台一致，测试替身无需脚本文件；出账只针对 `r.error`，业务性 status≠0（真正的非 git 仓）不新增任何输出。

## 数据流

```
check-loop.mjs（引擎单进程）
  → gitOut(args)  [20+ 业务调用点 + 4 探测门：:161 / :555 / :720 / :796]
      spawnSync(GIT, args)                       ← GIT 常量：CHECK_LOOP_GIT env 覆盖（新增）
      ├─ r.error？→ 响亮出账（stderr，进程去重）→ 瞬时类重试一次 → 仍异常 → null（降级路径，带痕）
      └─ 正常 → status/ok 判定 → stdout | null   ← 语义与改前一致
  → :720/:796 探测门 null = 非 git 仓 → 跳过对应检查（exit 0）   ← 行为不变，但异常路径现在有痕
  → :581 直连 spawnSync（证据 SHA 存在性）→ 同一 loud+retry 模式 → status≠0 仍判 forged

测试注入路径：check-loop.test.mjs 新场景
  → fixture 真仓 + env CHECK_LOOP_GIT=<不存在路径> → spawnSync 稳定 r.error
  → 断言：stderr 响亮出账恰一条 + exit 语义不变（降级路径）；正常仓零出账（防误报负例）
```

消费方（自查句 ≥2，命中 L2）：check-loop.sh / pre-commit / pre-push 钩子链、Release workflow（npm test）、doctor 的 check-loop 调用、check-loop.test.mjs 196 断言、装户 CI。

## 系统改动

- **包源引擎**（唯一行为面）：
  - `templates/_agents/scripts/check-loop.mjs` — `gitOut` 加 r.error 响亮出账（进程级去重）+ 瞬时类单次重试 + `CHECK_LOOP_GIT` env 钩子；`:581` 直连点套同模式；两处注释互引 + 检查 16 fail-loud 先例引用 + `intentional-simple` 标注（残余降级风险与升级路径）
  - `templates/_agents/scripts/check-loop.test.mjs` — 新增 2 场景：①真仓 + `CHECK_LOOP_GIT` 必败替身 → stderr 出账恰一条 + exit 语义不变；②真仓正常 git → 零新增出账（防误报负例）；既有 196 断言零改动
- **装副本同步**：`flow-kit sync` 刷 `.agents/scripts/check-loop.{mjs,test.mjs}` 与 `.agents/kit.json` 两个 sha256
- **台账回填**：`workflow/papercuts.md` 2026-10-05 行「拟修」列回填「已立 incident（<SHA>）」
- **规范条目**：`workflow/regression-checklist.md` 防复发验证节追加一行（引擎内 spawn 基础设施异常须与业务失败区分并响亮出账）
- **不动**：其余 20+ gitOut 业务调用点（返回契约零变化）、:156 等既有基础设施消息、非 git 仓跳过语义、检查 16 取数器路径

## 约束遵守映射

| 红线 / 约束 | 本 spec 如何满足 |
|---|---|
| 既有接口语义变化 → L2（new-task L2-3） | `gitOut` 返回契约（string\|null）不变，但新增 stderr 出账、重试行为与 `CHECK_LOOP_GIT` env 面属既有函数行为变化，被 20+ 调用点与钩子链/CI/发版链消费 → 定 L2，incident + spec + plan 三件套，防御道确认门 |
| 引擎双源纪律（本仓特有） | 全部引擎改动落 `templates/` 包源，`flow-kit sync` 刷装副本与 kit.json sha；装副本不直改 |
| 信任边界 / 数据安全（绝不偷懒项） | 本单不改输入校验与数据路径；fail-loud 恰是补「静默吞异常」的可观测性缺口；不新增任何外部输入信任（env 仅测试用、未设即原值） |
| 简洁优先 / 最小工作量 | 方案 A 改动集中 `gitOut` 与 `:581` 两处，20+ 调用点零接触；方案 B（探测门三态 fail-closed）被评估并否决（见风险评估），不为小概率残余风险扩改动面 |
| 测试不放提交门 | 新场景随套件在 test 阶段验证；稳定性循环 ≥50 轮在 test 阶段记证，不入 pre-commit |
| 确认门（2026-09-27 起） | incident 已 open（时间线含用户确认立单行）；本 spec 用户确认后方可起草同名 plan，plan 确认后方可动手；approved/done 经 `confirm-doc.mjs --delegated "<用户原话>"` 逐件代录 |
| 禁 `--no-verify` | 全程走 .githooks 门禁，被拦按提示修完原路重试 |

## 风险评估

- **`CHECK_LOOP_GIT` 被装户环境误设**（低）→ 未设置时行为逐字节一致；变量名带 `CHECK_LOOP_` 前缀与既有 `CHECK_LOOP_ROOT` 同族，spec/README 注释声明仅测试注入用；误设后果 = 引擎按替身路径 spawn 失败并响亮出账，不会静默错判
- **CI 日志噪音**（低）→ 出账仅在 `r.error` 时出现（常态零输出），且进程级去重恰一条；真异常本就该可见——这正是修复目的
- **重试掩盖真问题**（低）→ 响亮出账保证可见性；papercuts 行与 incident 时间线留跟踪；残余降级（连续两次瞬时异常）以 `intentional-simple` 标注升级路径
- **测试替身跨平台差异**（低）→ 替身 = 指向不存在/不可执行路径，POSIX 与 Windows 的 spawnSync 均稳定返回 `r.error`，无需平台分支脚本（check-loop.test.mjs 已有 GIT.exe 平台先例可循）
- **回滚难度**（低）→ 改动集中两处 + env 钩子向后兼容；revert 单 commit 即回到改前行为，无数据/状态迁移

## 确认与复核

- 确认日期：（用户对话内确认后回填，confirm-doc 代录原话见 confirmations.jsonl）
- 复核：L2 推荐独立复核——计划关单前由 independent-reviewer 复核（基准 = 本 spec approved 时的 HEAD）
