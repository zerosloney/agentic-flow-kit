---
状态: done
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 intent。开工句是按一个 WP-C 开发包处理。
确认指纹: 8c3ea7c7f3b1c1d1
---
# INTENT — push 扫描被推送的那棵树

## 背景与问题

需求来自 2026-09-29 审查后的修复波次。WP-A、WP-B 已关单。本包只做其中的 WP-C。

`templates/_githooks/pre-push` 读完 stdin 后把四个字段全部丢弃，再无参数调用 `check-loop.sh`。`templates/_agents/scripts/check-loop.mjs` 在仓库模式下用 `git ls-tree HEAD` 决定扫哪些 `workflow/` 路径，正文用 `readFileSync` 读工作区。因此 push 的结论跟「当前检出的 HEAD 名单 + 工作区正文」，不跟 stdin 里的本地 sha。

工作区把已跟踪文档改断、提交本身是好的，push 会被拦住。当前检出是干净分支、却在推另一个有断档的 sha，push 会放行。doctor 调用 `check-loop.mjs` 时不传修订参数，走的是这条工作区路径。

## 目标

- pre-push 把 stdin 里每个非删除的本地 sha 交给闭环扫描，扫描该 sha 的 `workflow/` 树。
- 工作区未提交的改动不改变这次 push 的结论。
- 当前 HEAD 不是被推送的提交时，结论仍跟被推送的 sha 走。
- 一次 push 有多行时，任一行的树有 hard-block，整次 push 失败。
- 不带修订参数的 `check-loop` 与 doctor 仍读工作区，行为与现在相同。
- 现有 `CHECK_LOOP_ROOT` fixture 套件保持通过。

## 非目标

- 不改手动 `check-loop` 与 doctor 的扫描对象。
- 不改检查项编号，也不改配对、验收、确认留痕等判据条文。
- 不扫远端到本地之间的每个祖先提交，只扫被推送 ref 尖上的那棵树。
- 不在本包做检查 17 扩到 approved、委派台账告警，或拆分 check-loop。
- 不要求每次代码提交都带 intent。

## 约束

- 删除 ref 的本地 sha 全为 0。这一行不读树，也不因为读不到树而失败。
- 本地 sha 不是提交对象时，先剥到提交再读树。剥不到则这一行阻断，并打印该 sha。
- 引擎只改 `templates/_githooks/pre-push` 与 `templates/_agents/scripts/check-loop.mjs` 及其测试，再 sync。`check-loop.sh` 文件名保持为钩子入口。
- 不新增运行时依赖。

## 影响面

- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2

pre-push 判定的树从「工作区」改为「被推送的 sha」。判据条文不动，判定对象变了，级别 L2。

## 验收标准（可测试）

- [x] 工作区把已跟踪文档改出配对断裂，被推送 sha 的树没有断裂：按该 sha 扫描退出码 0（证据：`templates/_agents/scripts/check-loop-rev.test.mjs`「同一脏工作区：--rev tip 仍退出 0」；实现 `2841d4d`；`fcf82c7` 后该套件 22/22，`verify.mjs` 退出码 0）
- [x] 工作区无断裂，被推送 sha 的树有配对断裂：按该 sha 扫描退出码 1（证据：同套件「断档提交：--rev 退出 1」「断档文件不在当前 HEAD：--rev 仍退出 1」；`2841d4d`，后者 `fcf82c7`）
- [x] 不带修订参数时，HEAD 提交干净、工作区把已跟踪文档改断：仍报 hard-block（证据：同套件「不带 --rev：工作区改断已跟踪文档仍 hard-block」；`2841d4d`）
- [x] stdin 本地 sha 全 0 的删除行不阻断；一次 push 里另一行的树有断裂则整次失败（证据：同套件「stdin 只有删除行：不阻断」「删除行加断档 sha：整次失败」「stdin 先好后坏：整次失败」；前两条 `2841d4d`，先好后坏 `fcf82c7`）
- [x] `check-loop.test.mjs` 的既有 fixture 用例保持通过（证据：`fcf82c7` 后 `verify.mjs` 中 `templates/_agents/scripts/check-loop.test.mjs` 129/129，全部套件通过）
- [x] doctor 调用闭环扫描时仍不传修订参数（证据：同套件「doctor 调用闭环扫描时不传 --rev」，断言 `src/doctor.mjs` 的调用不含 `--rev`；`2841d4d`）
