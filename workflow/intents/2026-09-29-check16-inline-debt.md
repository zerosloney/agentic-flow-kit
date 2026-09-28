---
状态: done
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 2026-09-28 双轴审查 4 条判断性 smell 收口：检查 16 内联债（Divergent Change / countDocs 重复 / scanFiles16 口径分裂）+ confirm-doc TTY 测试逃生门信任边界声明
确认指纹: c174a298050708ff
---
# INTENT — check16-inline-debt

## 背景与问题

需求来源：2026-09-28 全量提交（48 提交）双轴审查（Standards / Spec 两子代理 + 主线逐条复核）提出 4 条判断性 smell；2026-09-29 用户拍板「独立开单」收口。四条均已锚定查证：

1. **Divergent Change**：检查 16（264 行，`check-loop.mjs:735-998`）把 glob 状态机、walkFiles 防环遍历、装户 CJS 模块加载器整体内联进门禁主脚本（全文件约 1050 行）——指标子系统与门禁框架两个变更原因耦合。落地后 4 天内 6 个提交反复手术该区间（`c9e7ce3` 落地 / `593c074` 复核收口 / `9b57d70`+`4204093`+`08768eb` adopter-derivers / `b30a409` .cjs 改造），变更频率已实证该耦合的成本。
2. **Duplicated Code**：`countDocs`（检查 16 内）复刻 `docFiles`（:172）的过滤链（.md ∧ 数字前缀 ∧ tracked），靠注释「同口径」人守，无机器保证。
3. **口径分裂（有行为后果）**：`scanFiles16`（:936-941）不过滤 `isTracked`（仅排 `_TEMPLATE.md`），而取数侧 `countDocs`/`docFiles` 滤——检查 16 头注释（:747-748）声称「扫描看得到的文档集 == 取数统计的文档集」，对签名扫描自身不成立：未跟踪新档（并行会话半成品）中的签名会与 tracked-only 的取数值对账；无测试钉住该口径。
4. **信任边界**：`confirm-doc.mjs:126/:155` 的 `CONFIRM_DOC_TEST_TTY` / `CONFIRM_DOC_TEST_ANSWERS` 环境变量使生产进程可绕 TTY 门并落 `source:"tty"` 台账行——与 AGENTS.md「永不伪装 TTY 行」承诺存在文档层张力。使用面仅测试两处（`confirm-doc.test.mjs:288/:309`）；本地信任边界内机器防收益趋零（能设环境变量的进程已可直接 append 无签名的台账文件）。

## 目标

- 检查 16 逻辑与门禁主脚本结构解耦，可独立演进（装户自包含约束内，同目录 import，沿 `workflow-enums.mjs` 先例）
- 扫描 / 取数口径单源：文档集一处定义（或一处派生），并用测试钉住「未跟踪档是否进签名扫描」的既定口径
- `countDocs` 重复消除：过滤链不靠注释人守
- TTY 逃生门处置有显式书面结论（加固或声明接受，附论证），与 AGENTS 承诺表述一致

## 非目标

- 不改检查 16 对外判据语义：签名形态（小写点分）、转义约定、失败语义档位（登记表缺失静默跳过 / 取数器缺失 fail-loud）、登记表契约、内置指标集——均不动；若口径决策要求行为变化，须在 spec 留实现期修订声明
- 不动检查 1-15 的判据与输出（迁移须可对照证明逐字节不变）
- 不引入 TTY 伪终端测试基建（若评估认为成本大于收益，以「声明接受」收尾）

## 约束

- 引擎双源纪律：改 `templates/` 包源 → `flow-kit sync` 刷装副本 + kit.json 台账（新 managed 件入账）
- 装户自包含：`.agents/scripts/` 不得 import `src/`；同目录 import 允许（`workflow-enums.mjs` 先例）
- 检查项编号不增删改号（仍为 16）；`gate-checklist` PAIRS 不动
- shipped 测试套件须在真装环境验证（adopter-derivers P1 教训：本仓能跑 ≠ 装户能跑）

## 影响面

- 模块：pipeline
- 数据库：无
- 包源脚本：`templates/_agents/scripts/check-loop.mjs`（检查 16 段拆出）、拟新增 `templates/_agents/scripts/check-metric-claims.mjs`、`check-loop.test.mjs`（迁移 + 口径用例）、`confirm-doc.mjs`（视 #4 处置，仅注释/无改动）
- 台账：`.agents/kit.json` 经 sync 收编新 managed 件

## 触达红线

- [x] 规则 / 契约变更（门禁扫描口径 + managed 文件集变化）→ 级别至少 L2

> 命令名/门禁口径属对外可见契约，级别 L2，立同名 spec 写明如何满足。

## 验收标准（可测试）

- [x] 口径单源：签名扫描与取数共享同一文档集定义（或差异显式声明并有理由），测试钉住「未跟踪档不进（或进）签名扫描」——git 仓库模式用例（证据：`check-loop.test.mjs` 场景 91 双向用例（子目录 + 根级双侧，P2-1 收口后变异自验恰 1 红）；根级无数字前缀约束的差异在 spec §2 显式声明）
- [x] `countDocs` 重复消除：过滤链一处定义或派生，源码检索无第二份 `.md ∧ 数字前缀 ∧ tracked` 实现（证据：复核 #3 CONFIRMED——全仓仅 `check-loop.mjs` `docFiles` 一处，`countDocs` 仅余 1 条历史注释；取数用例全绿）
- [x] 检查 16 拆出后 `npm test` 全绿 + 真装环境 shipped 套件全绿（证据：`npm test` 557/0（7fc02da）+ 收口后全部套件通过（ad2117a）；真装 `/tmp/tmp.CSJjraTdbm`（临时 `flow-kit init`）：`check-loop.test` 121/0、`confirm-doc.test` 26/0、check-loop 实跑 exit 0）
- [x] sync 后双源一致：`source-sync-check --diff` 0 差异、`check-ledger` 全对齐（含新 managed 件入账）（证据：包源/装副本 68 对无差异；`managed 81 份 全对齐`，新件 `.agents/scripts/check-metric-claims.mjs` 入账 kit.json:118）
- [x] TTY 逃生门处置有书面结论（spec 专节 + 代码注释同步），与 AGENTS「永不伪装 TTY 行」表述一致（证据：spec §3「成本位移」论证 + `confirm-doc.mjs` 信任边界注释（沿 check8 口径）；复核 #4 CONFIRMED）
- [x] `check-loop` exit 0 无新增告警；检查 1-15 输出与迁移前逐字节一致（证据：复核 #1/#2/#7 CONFIRMED——迁移等价门 diff 空（初跑 1 行差异归因 worktree CRLF 环境伪影）、check-loop.mjs 仅 2 hunk（import + 检查 16 块替换））

## 确认与复核

- 确认日期：2026-09-29（对话委托代录，用户原话「可以」）
- 确认人：用户（对话内一句「可以」即确认）
- 确认范围：三件套全文逐件（intent / spec / plan）
- 复核：L2 独立复核**已执行**（`independent-reviewer` 子代理，独立上下文，detached worktree、未动主工作区；基准 `e18d28e` → `7fc02da`）——**7 项全部 CONFIRMED**，verdict **0 P0 / 0 P1 / P2×2（全部采纳并修复，`ad2117a`）**：
  - P2-1 根级 tracked-only 无测试承重（变异去除后全绿）→ 场景 91 扩根级用例，修复后变异自验恰 1 红（122/1→还原 123/0）
  - P2-2 spec ctx 符号计数 8→9（漏 `inSet`）→ 已修正并留痕
  - 复核者变异自验：子目录 tracked 去除 → 1 红；`ttyForced` 还原单条件 → 1 红（S18e）
  - 迁移等价性的复核确认：内联块与新模块逐段相同，仅 countDocs 删除 / scanFiles16 改造（T2 声明内）/ `ctx`→`deriverCtx` 纯改名三类差异；子目录迭代 readdir 序改 `docFiles` `.sort()` 为输出序确定化（等价门实测无差）
- 关单复验（2026-09-29）：`npm test` 全部套件通过；sync 后 `doctor` 12 PASS / 0 WARN / 0 FAIL；`check-ledger` 81 份全对齐；check-loop exit 0 且输出与实现提交时点逐字节一致
- 未验证范围（据实声明）：① Node 18/20/22 真机重跑 shipped 套件（依赖 CI 矩阵覆盖——新模块仅 import `node:*` 且无版本敏感 API，`createRequire` 装户载入沿用 adopter-derivers 已跨版本验过的写法）；② POSIX 实机（仅 Windows 实跑；新增代码无平台分支）
