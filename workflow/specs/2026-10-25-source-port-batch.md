---
状态: done
级别: L2
模块: infra
确认指纹: 2634016a80836559
---
# SPEC — 源仓闭环优化批回灌

对应入口：../intents/2026-10-25-source-port-batch.md

## 功能行为

### ① 语法门加固（check-scripts-syntax）
检查目录**递归扫描**（SKIP_DIRS = node_modules / .git / tmp；符号链接跳过防环；可检面 .mjs/.cjs）；
**每目录**递归后可检文件数为 0、或检查目录缺失 → 判红（fail-closed，防「改名 / 删除 / 清空脚本即
去门」——源仓 2026-10-24 复核 M1 实证形态）。只读裁决，零工作区副作用，判据语义除递归与 fail-closed
外零变化。

### ② 委派台账在场门（delegation-presence + confirm-doc）
新单源模块 delegation-presence.mjs：`parseDelegationRows`（`## 委派结果` / `## 自做任务结果` 节内
管道行、首列 YYYY-MM-DD）+ `rowCovers`（存在日期 ≥ 文档日期、且行内含文件名带/不带 .md 的行）+
`delegationRowsOf`（分片感知读 = ledger-shards.readDelegationsText）。检查 18 的解析改由本模块供给
（delegationResultRows 语义零变化，agg splitTables 互引纪律不变）。
confirm-doc 终态跳转（intents/specs/plans → done；incidents → fixed/closed）**前置在场门**：
级别 L2/L3 + 日期合法 + 日期 ≥ delegationSince 锚 + 台账无覆盖行 → 拒绝落账（不写盘、不 append），
提示 ledger-shards --append 落行命令。豁免口径与检查 18 逐条一致：非 L2/L3、缺日期/非法、锚前存量。

### ③ 发布观察台账（deploy-observations）
LEDGERS 第四员 `deploy-observations`（数据行签名日期行；**生而分片**——主表只留说明+表头，数据行
从首日起进当月分片，零存量迁移）。deploy.md §6 增观察落账步：结论（枚举 `通过`/`异常`）一行 append
进当月分片，异常行必须关联 incident。gen-workflow-metrics 增「发布观察」节（月度聚合 release 数/
通过/异常；零数据输出占位行保证机制可见；结果列枚举外脏行 throw，fail-loud）。workflow/README.md
（自举+模板双落）「三份台账已分片」句升四份。新增 templates/workflow/deploy-observations.md 模板与
本仓自举副本主表。

### ④ 挂载自检门（check-local-gate-config + verify 门表）
判据四项（kit 面适配，剔除源仓私有 merge.ours/appsettings 面）：core.hooksPath → .githooks；
merge.jsonl-union.driver 指向 git-merge-jsonl.mjs；.gitattributes 含 `.agents/*.jsonl merge=jsonl-union`
行；.githooks/ 五钩子文件在位。档位：默认 WARN（缺配打印修法 exit 0）；`--strict` 缺配 exit 1；
GITHUB_ACTIONS（CI checkout 不挂本地钩子属常态）与非 git 仓 loud-skip exit 0。挂 verify 引擎段第 4 位
（七门→八门），verify.test 门数断言与头部注释同步。

## 验收场景

### S1 语法门递归与 fail-closed
- GIVEN 检查目录的 .mjs 全部位于子目录 / 某目录递归后无可检文件
- WHEN check-scripts-syntax
- THEN 递归命中子目录脚本照常判语法；空/缺失目录判红并点名（fail-closed）

### S2 在场门拦截与放行
- GIVEN L2 intent（日期 ≥ delegationSince）台账无含该文件名的覆盖行 / 已落一行
- WHEN confirm-doc →done
- THEN 前者拒绝落账并给落行命令提示；后者放行

### S3 豁免口径与检查 18 一致
- GIVEN 锚前日期 / 缺日期或非法 / L1 级别 / incidents 族（fixed/closed 纳入、open 不纳入）
- WHEN confirm-doc 终态跳转
- THEN 与检查 18 同口径豁免或纳入，不新增第二套语义

### S4 观察台账分片读写
- WHEN ledger-shards --append deploy-observations --row "| YYYY-MM-DD | release/… | 通过 | … |"
- THEN 行落当月分片；readLedger 主表 ∪ 分片合并可见；主表不被数据行污染

### S5 metrics 发布观察节
- GIVEN 零数据台账 / 结果列枚举外脏行
- WHEN gen-workflow-metrics
- THEN 零数据输出占位行（机制可见）；脏行 throw（fail-loud）

### S6 挂载自检三档
- GIVEN 缺 core.hooksPath / 带 --strict / CI（GITHUB_ACTIONS）或非 git 环境
- WHEN check-local-gate-config
- THEN 缺配 WARN 带修复命令 exit 0；--strict 下缺配 exit 1；CI 与非 git 仓 loud-skip exit 0

### S7 verify 引擎段八门
- WHEN node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-25-source-port-batch.md
- THEN 引擎段八门（含挂载自检门）全绿

## 数据流
② delegations.md（主 ∪ 分片）→ delegation-presence 解析 → 检查 18 对账与 confirm-doc 前置门（同一判据源）。
③ deploy.md §6 结论 → ledger-shards --append → 当月分片 → readLedger 合并读 → metrics 月度聚合 → metrics.md。
④ git config / .gitattributes / .githooks 在位性 → verify 引擎段第 4 门每次关单自动对质。

## 系统改动清单
- 后端：无（引擎面改动）
- 引擎（均双落 .agents/ + templates/_agents/）：check-scripts-syntax.mjs（+test）、
  delegation-presence.mjs（新，+test）、check-loop.mjs（检查 18 解析改单源供给）、confirm-doc.mjs（+test）、
  ledger-shards.mjs（+test）、gen-workflow-metrics.mjs（+test）、check-local-gate-config.mjs（新，+test）、
  verify.mjs（门表+头部注释，+test）、deploy.md（§6 落账步）、workflow/README.md（台账句）；
  templates/workflow/deploy-observations.md（新）+ workflow/deploy-observations.md（自举副本）；
  engine-lock.json（--update --note 显式演进）、kit.json（自举 sync 刷 managed 清单）、CHANGELOG（Unreleased）
- 数据库：无
- 前端：无

## 约束遵守映射（对照 AGENTS.md 触达红线 / 工程原则）
| 红线 / 工程原则 | 本 spec 如何满足 |
|------|------------------|
| 规则 / 契约变更（关单判据 / 台账契约 / 门表）→ L2 | 三件套防御道；在场门是执法点前移，判据与检查 18 单源一致，不新增第二套口径 |
| 最短可工作 diff / 禁蔓延 | 检查 18 只换解析来源不改判据；--fast 分层等明确不移植面零触碰 |
| 单源纪律 | 解析单源 delegation-presence；台账读写单源 ledger-shards；生效锚沿用 policy 既有键（delegationSince） |
| 引擎完整性 | engine-lock --update --note 显式演进（唯一合法路径），改弱面无条件 BLOCK 的既有判据不变 |

## 验收判据
| 判据（可观察行为） | 证据（测试文件 / 命令 / 证据文件） | 状态 |
|---|---|---|
| 全量测试绿（含四个新/扩套件） | npm test | 覆盖 |
| 引擎八门全绿（本单 --doc 绑定） | node .agents/scripts/verify.mjs --doc workflow/intents/2026-10-25-source-port-batch.md | 覆盖 |

## 风险评估
- 装户存量无 .gitattributes jsonl-union 行｜应对：挂载门默认 WARN 档不拦，README 迁移指引已有
- verify 门数变化波及断言/CI｜应对：verify.test 门数断言与注释同步改；kit-ci 复跑兜底
- 在场门拦住存量关单动作｜应对：豁免口径 = 检查 18 全量（锚前/缺日期/非 L2/L3 均豁免），锚 2026-10-06 存量不回溯
- 检查 18 单源改造引入语义漂移｜应对：既有 check-loop.test 断言零改动跑绿即证；delegationResultRows 签名不变

## 确认与复核
- 确认结果 / 确认时间写在文件头 frontmatter。
