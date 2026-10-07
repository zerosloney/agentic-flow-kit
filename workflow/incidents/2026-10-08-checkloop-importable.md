---
状态: closed
级别: L2
发现: 2026-10-08
模块: pipeline
备注: papercuts 2026-10-04 isMain 行用户点名单独立项——check-loop 可 import 化重构（主守卫 + runCheckLoop 接缝 + 纯零件导出）
确认指纹: 7cc814e16caaa4b5
---
# INCIDENT — 2026-10-08 checkloop-importable

## 时间线
- 2026-10-04：review-fix-batch 实证——测试文件 import check-loop.mjs 后套件空心化（模块顶层即全量执行门禁并 process.exit，自身断言全没跑而 run-tests 仍计 PASS），只能端到端 spawn；对照 workflow-board-server.mjs 的 isMain 守卫先例（board-kb-p1），登记 papercuts（2026-10-04 行，定性「属 L2 引擎重构宜单独走 incident」）
- 2026-10-07：eli5 提升方向卡第 ④ 项「把大机器拆成零件」向用户呈现
- 2026-10-08：用户点名升级，立本单（三件套）
- 用户确认：草稿过目通过（2026-10-08）
- 2026-10-08：修复落地——流程段（实起 :143 非 spec 估算的 :127）包进 `export function runCheckLoop(opts = {})`（codemod 机械变换，`git diff -w` 实质 77+/49-）；10 处流程退出点 + 新增 root 不可访问共 11 处改 return 判决；4 纯零件导出；isMain CLI 入口。修复过程中 codemod 三缺陷（env-if 开括号未跳过致配平失衡 / 缩进退出点未匹配 / 硬编码重复 return）与互斥文案拆散既有断言子串各当场修正；独立复核零 P0/P1/P2（3 条 P3 缩进外观项当场修齐），总判定可提交
- 2026-10-08：验证闭合——同状态输出对账 diff 空（stash 法）、端到端 219/0 + rev 28/0 + unit 10/0、npm test 全套 exit 0、verify 凭证 PASS 15/0；→ fixed

## 影响面
- 引擎件 `templates/_agents/scripts/check-loop.mjs`（1441 行）及其装副本；测试面新增直测套件；门禁消费者（.githooks/pre-push / pre-commit 经 check-loop.sh shim、check-loop.test.mjs 219 断言）行为契约必须逐字节不变

## 根因
check-loop.mjs 无 isMain 主守卫：约 1280 行门禁流全部为模块顶层语句，import 即执行且以 process.exit 收场——模块不可 import、不可在进程内复用，测试只剩端到端 spawn 一条路。
深层原因：sh 脚本血统（2026-09-26 才迁 node），顶层直写是移植时的最小变形；后续每次加检查都在同一平面继续堆叠，从未回收结构。

## 为什么之前没拦住
- 门禁层：无「引擎脚本须可 import」约束（workflow-board-server 的 isMain 是个例先例非规则）；
- 测试层：run-tests 按「套件自身断言数 > 0」放行，import 空心化（子进程 exit 0 被误计 PASS）暴露的是测试基建盲区，非单点缺陷；
- 本单为 papercuts 攒批纪律的正确兑现：首次命中只登记，用户点名才升级。

## 复盘三件套（缺一不可）

> 目的：让事故真正回到 Plan，不让「防复发」承诺停留在文档里。模块已逐步上线，事故可能来自 dev / staging / prod 任一环境。

### 规则面（规则/检查/约束怎么改）
无新门禁——本单是结构重构非行为缺陷；「输出 banner 契约」（banner 后空行、条目 `- ` 前缀、HARD-BLOCK/WARN 两段式）在文件头注释中升格为显式稳定输出契约声明，重构后逐字节校验。

### 自动化面（测试/CI 怎么加）
新增 `check-loop-unit.test.mjs`：①进程内 `runCheckLoop({root})` 直测（fixture 注入，断言 `{exitCode}`，import 不执行不退出的主守卫语义）；②四个纯零件（delegationResultRows / versionGreater / fmStatus / bindingSha256）直测。既有 219 断言端到端套件全量保留 = 重构回归网。

### 流程面（人怎么避免再犯）
引擎脚本新增时默认带 isMain 守卫 + 可 import 接缝（脚本测试缺失 WARN 已有：本单新套件即按该规矩落）；后续把 20 个检查逐个拆独立模块时（check-metric-claims.mjs 先例），沿用「纯函数导出 + import 直测」形态。

## 修复方向（本单范围）

1. **主守卫**：`isMain` 判定 + CLI 入口收敛（takeOpts → runCheckLoop(opts) → process.exit(exitCode)）——import 本模块零副作用。✅ 已落（import 冒烟：5 导出在位、零打印、进程存活）
2. **runCheckLoop(opts) 接缝**：约 1280 行顶层流程包进 `export function runCheckLoop(opts = {})`（opts = { root?, rev?, hardening? }；root 显式参数优先于 CHECK_LOOP_ROOT env 优先于 git toplevel，CLI 缺省行为逐字节一致）；顶层 process.exit 改 return 判决对象 `{ exitCode, blockers, warnings }`（输出打印照旧留在函数内——稳定输出契约不变）。✅ 已落（实际 10+1 处非估算 9 处；同状态对账 diff 空）
3. **纯零件导出**：delegationResultRows / versionGreater / fmStatus / bindingSha256 加 `export`（已是模块级自足函数，仅参数+标准库依赖）。✅ 已落（前三者随 codemod 移至模块尾，bindingSha256 原在尾段仅加关键字）
4. 测试（自动化面）+ 文档注释更新 + papercuts 2026-10-04 行处置标注。✅ 已落（check-loop-unit.test.mjs 10 断言；test.mjs 头注释更新；papercuts 标注随关单提交）

**非目标**：20 个检查逐个拆独立模块（check-metric-claims.mjs 先例的分批程序，另行渐进）；门禁行为/判据/文案任何变化；AGENTS.md 改动（常驻面预算仅剩 223B）。
