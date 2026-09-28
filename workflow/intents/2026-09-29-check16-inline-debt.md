---
状态: draft
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 2026-09-28 双轴审查 4 条判断性 smell 收口：检查 16 内联债（Divergent Change / countDocs 重复 / scanFiles16 口径分裂）+ confirm-doc TTY 测试逃生门信任边界声明
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

- [ ] 口径单源：签名扫描与取数共享同一文档集定义（或差异显式声明并有理由），测试钉住「未跟踪档不进（或进）签名扫描」——git 仓库模式用例（证据：测试用例名 + 输出）
- [ ] `countDocs` 重复消除：过滤链一处定义或派生，源码检索无第二份 `.md ∧ 数字前缀 ∧ tracked` 实现（证据：检索 0 处 + 取数既有用例全绿）
- [ ] 检查 16 拆出后 `npm test` 全绿 + 真装环境 shipped 套件全绿（证据：两处运行输出）
- [ ] sync 后双源一致：`source-sync-check --diff` 0 差异、`check-ledger` 全对齐（含新 managed 件入账）（证据：命令输出）
- [ ] TTY 逃生门处置有书面结论（spec 专节 + 代码注释同步），与 AGENTS「永不伪装 TTY 行」表述一致（证据：spec 节引用）
- [ ] `check-loop` exit 0 无新增告警；检查 1-15 输出与迁移前逐字节一致（证据：前后输出 diff 为空）

## 确认与复核

- 确认日期：
- 确认人：用户（对话内一句「可以」即确认）
- 确认范围：
- 复核：L2 推荐独立复核（结构迁移 + 口径变更，回归面大）
