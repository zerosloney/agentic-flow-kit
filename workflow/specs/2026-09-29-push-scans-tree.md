---
状态: approved
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 spec。同名 intent 已于 e8bdf04 approved。
确认指纹: a09f934fbd5aad8c
---
# SPEC — push 扫描被推送的那棵树

对应入口：../intents/2026-09-29-push-scans-tree.md

## 功能行为

`check-loop.mjs` 增加可选参数 `--rev <sha>`，一次进程只接受一个。不带该参数时，文件名单仍来自 `git ls-tree HEAD`，正文仍读工作区，doctor 的调用一行不改。

带 `--rev` 时：

- sha 全为 `0`：exit 1，并打印该 sha。删除行由钩子滤掉，不传给扫描。
- 其余 sha 用 `git rev-parse --verify <sha>^{commit}` 剥到提交。剥不到则 exit 1，并打印原始 sha。
- 仓库内文件的存在性、目录列表和正文都从该提交读取（`git cat-file` / `git ls-tree`），不读工作区。`git log` 以该提交为终点。
- 提交里没有的路径视为不存在。
- 与 `CHECK_LOOP_ROOT` 同时出现则 exit 1。夹具模式继续全扫目录，不走修订读层。

因此工作区里未提交的改动，包括把已跟踪文档改断、改索引、改确认台账，都不改变 `--rev` 的结论。当前 HEAD 也不是判定对象。

检查 17 的「当前仍是 draft」一侧同样读这棵树。阻断句在 `--rev` 下把「工作区」换成「提交 <前 7 位>」，判据不变：发版提交上已是 draft、被扫描的这棵树上仍是 draft，才阻断。不带 `--rev` 时句子仍写工作区。

会启动脚本的检查不直接跑工作区里的脚本。检查 11 把该提交的 `workflow/` 与生成索引所需的脚本抽到临时目录再跑 `--check`。规则面预算检查同样只在临时目录里看到该提交的文件。临时目录用完即删。导出失败则 exit 1。

`pre-push` 逐行读 stdin，字段顺序仍是本地 ref、本地 sha、远端 ref、远端 sha。

- 没有任何行：仍无参数跑一次扫描，手跑钩子的行为不变。
- 本地 sha 全为 `0`：跳过该行。
- 其他行：经 `check-loop.sh` 执行 `--rev <本地 sha>`。shim 已把参数转给 node，本包不改 shim。
- 多行都扫。任一次扫描非零，钩子以该退出码失败，已打印的阻断保留。全部行都是删除时，钩子 exit 0。

## 数据流

git push 的 stdin → `templates/_githooks/pre-push` 滤掉全 0 的本地 sha → `check-loop.sh` → `check-loop.mjs --rev <sha>` → 剥到提交 → 该提交的树提供 `workflow/` 与其余仓库文件 → 既有检查项照常出 hard-block 或 warning。

doctor 与手动 `node check-loop.mjs` 不进入这条路径。

## 系统改动清单

- 后端：`templates/_githooks/pre-push`（按行传 `--rev`）、`templates/_agents/scripts/check-loop.mjs`（修订读层）。新增 `templates/_agents/scripts/check-loop-rev.test.mjs`，由 `src/run-tests.mjs` 的脚本目录扫描自动纳入。
- 数据库：无
- 测试：临时 git 仓库覆盖 intent 的前四条；既有 `check-loop.test.mjs` 不改语义；读 `src/doctor.mjs` 断言调用 `check-loop.mjs` 的参数里没有 `--rev`。

## 约束遵守映射（对照 AGENTS.md 触达红线）

| 红线 | 本 spec 如何满足 |
|------|------------------|
| 规则 / 契约：pre-push 的判定对象从工作区改为被推送的提交 | 检查项编号与判据条文不改。只换 `--rev` 的读层。不带参数的路径保持现在的工作区口径 |
| 引擎双源 | 只改 `templates/` 下的钩子与脚本，sync 更新装副本。`check-loop.sh` 文件名不动 |
| 零运行时依赖 | 只用 `git` 与现有 node 模块。临时目录用 `node:fs` 与 `node:os` |

## 风险评估

- 修订读层漏接某次工作区读取，脏工作区仍会改变 push 结论。应对：验收用「提交是好的、工作区把已跟踪文档改断」作为第一例，exit 0 才算过。
- 检查 11、规则面预算若仍跑工作区脚本，索引脏文件会误拦。应对：这两处只看临时目录里该提交的文件。
- 全 0 sha 被误传给 `--rev`。应对：钩子跳过；扫描进程收到全 0 则 exit 1，测试把两条分开锁住。

## 确认与复核

- 确认结果：approved（2026-09-29 用户对话原话「可以」，仅本份）
- 复核：L2，独立复核留到关单前
