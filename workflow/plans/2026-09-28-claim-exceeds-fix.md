---
状态: approved
级别: L1
日期: 2026-09-28
模块: pipeline
备注: 同名入口：../incidents/2026-09-28-claim-exceeds-fix.md。L1 极简形态（改动面 + 验证方式）；无同名 spec（L1 可省，且本单不改契约面）。
确认指纹: 39e040f7b0813de2
---
# PLAN — 结论文档断言强于实际的窄修与纪律固化

对应入口：../incidents/2026-09-28-claim-exceeds-fix.md
对应 spec：（无——L1 可省；本单不改契约 / 规则面判定逻辑，只改文档表述纪律与测试注释）

## 改动面（L1 极简形态主节）

- `templates/_agents/scripts/check-loop.test.mjs`：`:1064` 注释「换锚后锚取 git 首次加入日期（**不可手填**）→ **该通道关闭**」→ 改写为「（**日常不可顺手改动** 的事实）→ 关掉『改文件名』零成本通道；**诚实边界**：锚取 `%aI` = author date，`git commit --date=` 仍可伪造 → 不宣称通道关闭」。判据：全文件不再出现「不可手填」与「该通道关闭」的**陈述式**用法（仅更正节可引用原措辞）
- `templates/_agents/scripts/check-loop.mjs`：`:41` 条件① 注释「作者**不可手填**」→「**不可顺手填**（经 confirm-doc 走确认门才产生）」+ **诚实边界**：台账是本地可写文件、本检查不验签，刻意手改仍可伪造。判据：条件① 不再出现「不可手填」式断言（**本单实测新发现，立项时未预期**——台账为普通可写文件、读盘不验签）
- `.agents/scripts/check-loop.test.mjs` + `.agents/scripts/check-loop.mjs`：同上两份，经 `flow-kit sync` 下发（双源字节一致）。判据：`source-sync-check --diff` 0 差异
- `workflow/README.md`（owned，手改即权威）：新增「**结论文档表述纪律**」节，两条——① **量化断言单源**（跨文档量化值单源定义 / 取数标明时点 / 凡写「N 处同步」须附可重跑取值命令）；② **修复收益措辞须回到事实源重取**（用连续量不用离散态，不得沿用立项时目标措辞）。判据：该节存在且含两条判据句；同时把 `batch-ledger-audit` spec 的两处残留**登记为遗留面**（不追溯改已关单文档）
- `workflow/regression-checklist.md`：「防复发验证」节追加本 incident 条目，落点指向 README 纪律节 + 对账命令。判据：条目在册且落点可点

**明确不改（据实记录）**：
- `workflow/specs/2026-09-28-batch-ledger-audit.md` `:87`（13 条）/ `:39`（61 行）——**改则触发 check-loop 内容绑定 hard 拦**（已关单文档关单后改内容）。用户 2026-09-28 拍板不改旧单，由 incident 登记遗留面
- `check-loop.mjs` 判定逻辑——本单**零行为改动**（仅注释与文档），故无新增自动化用例，防复发靠纪律条目 + 对账命令

## 验证方式

- 静态门：`npm test`（纯 JS 脚手架包，无构建 / 无类型检查）
- 门禁：`node .agents/scripts/check-loop.mjs` → exit 0 无新增 hard；`flow-kit doctor` → 0 FAIL
- 双源：`node bin/flow-kit.mjs sync` + `source-sync-check --diff` → 0 差异
- 纪律生效自检（本单实测口径）：台账计数（`node .agents/scripts/check-loop.mjs` + 台账行数：当前 **77 行**，其中无 `batch` **67 行**）；措辞残留扫描 `不可手填|通道关闭|常量退役` 应仅存于**显式更正节**
- **本单为 L1**：不做 L2 独立复核（无契约面变更）；但 incident §「复核与更正」已据实留痕用户所提三处断言的逐条实证结论，含一处**与用户叙述不符的事实更正**

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 `draft → approved` 并回填本节，`done` 只在关单出现。

- 确认结果：approved（2026-09-28 用户对话内确认——「incident 草稿 可用，plan 可用，确认之后回填看看」）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（**用户对「spec 两处数字残留」的处置亦一并拍板**：不改旧单，由 incident 登记遗留面）
- 执行记录：实现 `37b3c05`（10 文件）——三处措辞窄修（`check-loop.mjs` :41 / `check-loop.test.mjs` :1065 及装副本）+ README 纪律节 + regression-checklist 条目
- 验证结果：`check-loop` exit 0 ｜ `doctor` 12 PASS / 0 WARN / 0 FAIL ｜ `source-sync-check --diff` 0 差异 ｜ `check-loop.test.mjs` **79/1 与 HEAD 基线逐位相同**（该 1 项「常驻面预算:超限」依赖 `sh`/`rule-budget.sh`，为环境预存失败；`gate-dotnet-ca` 5 项同理——**均非本单引入**，已在 incident 据实声明）
- **偏离（据实记录）**：改动面由 2 文件扩为 4 项——实现中发现**第三处**同类残留（`check-loop.mjs:41` 条件①「作者不可手填」，而台账为本地可写、检查不验签），经用户确认后纳入本单
